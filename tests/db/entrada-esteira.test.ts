import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, fiscalConsulta: string, semAcesso: string;
let empresa: string, cliente: string, notaId: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  fiscalConsulta = await novoUsuario(db, "fiscal.consulta@neo.com", { fiscal: "consulta" });
  semAcesso = await novoUsuario(db, "sem@neo.com");

  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Teste', '{cliente}', '156') returning id`)).rows[0].id;
  notaId = (await q(
    `insert into rec_notas_saida (empresa_id, nota, serie, chave_acesso, cod_cliente, valor_total, data_emissao, pedidos)
     values ($1, '1371', '1', $2, '156', 3000, '2026-10-05', '{187,188}') returning id`,
    [empresa, "7".repeat(44)],
  )).rows[0].id;
  await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, nota_fiscal, chave_nfe, cod_portador, tipo_cobranca, nota_saida_id, entrou_esteira_em)
     values ($1, $2, '1371A', '1', '2026-10-05', '2999-01-01', 1500, 'aguardando_boleto', '1371', $3, '91', '1', $4, now())`,
    [empresa, cliente, "7".repeat(44), notaId],
  );
});

describe("configuração da esteira", () => {
  it("a data de início vem semeada", async () => {
    const r = await q(`select valor from configuracoes where chave = 'financeiro.recebiveis.esteira_a_partir_de'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].valor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("rec_notas_saida", () => {
  it("quem tem acesso ao Financeiro lê; sem acesso ou só em outra área não vê nada", async () => {
    expect((await como(db, finConsulta, () => q(`select pedidos from rec_notas_saida`))).rows).toEqual([{ pedidos: ["187", "188"] }]);
    expect((await como(db, finOperador, () => q(`select id from rec_notas_saida`))).rows).toHaveLength(1);
    expect((await como(db, fiscalConsulta, () => q(`select id from rec_notas_saida`))).rows).toHaveLength(0);
    expect((await como(db, semAcesso, () => q(`select id from rec_notas_saida`))).rows).toHaveLength(0);
  });

  it("nenhum usuário grava: só a sincronização (service role)", async () => {
    await expect(como(db, finOperador, () => q(
      `insert into rec_notas_saida (empresa_id, nota, serie) values ($1, '9', '1')`, [empresa],
    ))).rejects.toThrow();
    await como(db, finOperador, () => q(`update rec_notas_saida set pedidos = '{}'`));
    expect((await q(`select pedidos from rec_notas_saida`)).rows[0].pedidos).toEqual(["187", "188"]);
  });

  it("a mesma NF (empresa + número + série) e a mesma chave não repetem", async () => {
    await expect(q(`insert into rec_notas_saida (empresa_id, nota, serie) values ($1, '1371', '1')`, [empresa])).rejects.toThrow();
    await expect(q(`insert into rec_notas_saida (empresa_id, nota, serie, chave_acesso) values ($1, '2', '1', $2)`, [empresa, "7".repeat(44)])).rejects.toThrow();
  });
});

describe("rec_vw_titulos recriada", () => {
  it("enxerga as colunas novas e mantém dias de atraso, faixa e valor atualizado", async () => {
    const r = await como(db, finConsulta, () => q(
      `select nota_fiscal, chave_nfe, cod_portador, tipo_cobranca, nota_saida_id, entrou_esteira_em is not null as na_esteira,
              faixa, dias_atraso, valor_atualizado
         from rec_vw_titulos where documento = '1371A'`));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ nota_fiscal: "1371", cod_portador: "91", tipo_cobranca: "1", nota_saida_id: notaId, na_esteira: true, faixa: "a_vencer", dias_atraso: 0 });
    expect(Number(r.rows[0].valor_atualizado)).toBe(1500);
  });

  it("títulos antigos (sem os campos novos) continuam funcionando, e o valor atualizado ainda calcula encargos", async () => {
    await q(
      `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor)
       values ($1, $2, 'ANTIGO', '1', current_date - 30, 1000)`, [empresa, cliente]);
    const r = await q(`select nota_fiscal, nota_saida_id, entrou_esteira_em, estagio, faixa, valor_atualizado from rec_vw_titulos where documento = 'ANTIGO'`);
    expect(r.rows[0]).toMatchObject({ nota_fiscal: null, nota_saida_id: null, entrou_esteira_em: null, estagio: "importado", faixa: "16_30" });
    // 1000 + multa 2% (20) + juros 2% a.m. pro rata por 30 dias (20) = 1040
    expect(Number(r.rows[0].valor_atualizado)).toBe(1040);
  });

  it("o índice do estágio aguardando_boleto existe", async () => {
    const r = await q(`select indexname from pg_indexes where indexname = 'idx_rec_titulos_aguardando_boleto'`);
    expect(r.rows).toHaveLength(1);
  });
});
