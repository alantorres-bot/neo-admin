import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, semAcesso: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  semAcesso = await novoUsuario(db, "sem@neo.com", { fiscal: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("módulo e parâmetros (0121)", () => {
  it("o módulo financeiro.contas-pagar está ativo na área financeiro", async () => {
    const m = (await q(`select area, nome, ativo from modulos where codigo = 'financeiro.contas-pagar'`)).rows[0];
    expect(m).toEqual({ area: "financeiro", nome: "Contas a pagar", ativo: true });
  });
  it("o corte das antecipações nasce vazio (todas entram)", async () => {
    const c = (await q(`select valor from configuracoes where chave = 'financeiro.contas-pagar.antecipacoes_a_partir_de'`)).rows[0];
    expect(c.valor).toBeNull();
  });
  it("quem só tem a área fiscal não enxerga o módulo; consulta do financeiro enxerga; operador pode atualizar", async () => {
    expect((await como(db, semAcesso, () => q(`select tem_acesso_modulo('financeiro.contas-pagar', 'consulta') as ok`))).rows[0].ok).toBe(false);
    expect((await como(db, finConsulta, () => q(`select tem_acesso_modulo('financeiro.contas-pagar', 'consulta') as ok`))).rows[0].ok).toBe(true);
    expect((await como(db, finConsulta, () => q(`select tem_acesso_modulo('financeiro.contas-pagar', 'operador') as ok`))).rows[0].ok).toBe(false);
    expect((await como(db, finOperador, () => q(`select tem_acesso_modulo('financeiro.contas-pagar', 'operador') as ok`))).rows[0].ok).toBe(true);
  });
});

describe("espelho cap_lancamentos e cap_fornecedores", () => {
  it("a service role (Edge Function) grava; o tipo só aceita C, A e D; o código é único por empresa", async () => {
    await como(db, "service", async () => {
      await q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, documento) values ($1, '382', 'PERFILADOS MULTIACO', '12.345.678/0001-95')`, [empresa]);
      await q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, valor_documento, valor_atualizado)
               values ($1, '33428', 'A', '382', '33428', '2026-10-09', 46728.90, 46728.90)`, [empresa]);
      await q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_vencimento, valor_documento, valor_atualizado)
               values ($1, '2', 'C', '205', '92966', '2026-07-01', 2525.44, 2525.44)`, [empresa]);
    });
    await expect(como(db, "service", () => q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, valor_documento, valor_atualizado) values ($1, '9', 'P', 1, 1)`, [empresa])))
      .rejects.toThrow(/tipo_lancamento/);
    await expect(como(db, "service", () => q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, valor_documento, valor_atualizado) values ($1, '2', 'C', 1, 1)`, [empresa])))
      .rejects.toThrow(/unique|duplicate/i);
  });
  it("quem tem a área financeiro lê; quem não tem, não vê nada", async () => {
    const r = await como(db, finConsulta, () => q(`select cod_lancamento, tipo_lancamento, valor_atualizado from cap_lancamentos order by cod_lancamento`));
    expect(r.rows.map((l) => [l.cod_lancamento, l.tipo_lancamento, Number(l.valor_atualizado)])).toEqual([["2", "C", 2525.44], ["33428", "A", 46728.9]]);
    expect((await como(db, finConsulta, () => q(`select nome from cap_fornecedores`))).rows[0].nome).toBe("PERFILADOS MULTIACO");
    expect((await como(db, semAcesso, () => q(`select count(*)::int as n from cap_lancamentos`))).rows[0].n).toBe(0);
    expect((await como(db, semAcesso, () => q(`select count(*)::int as n from cap_fornecedores`))).rows[0].n).toBe(0);
  });
  it("usuário logado (mesmo operador) não grava nem altera o espelho: só a Edge Function", async () => {
    await expect(como(db, finOperador, () => q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, valor_documento, valor_atualizado) values ($1, '77', 'C', 1, 1)`, [empresa])))
      .rejects.toThrow(/row-level security/);
    const antes = (await como(db, finOperador, () => q(`update cap_lancamentos set valor_atualizado = 0 where cod_lancamento = '2' returning id`))).rows;
    expect(antes).toHaveLength(0); // sem política de update: nenhuma linha é alcançada
    await expect(como(db, finOperador, () => q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome) values ($1, '1', 'X')`, [empresa])))
      .rejects.toThrow(/row-level security/);
  });
  it("baixar = marcar baixado_em (nada é apagado) e atualizado_em acompanha", async () => {
    await como(db, "service", () => q(`update cap_lancamentos set baixado_em = current_date, valor_atualizado = 0 where cod_lancamento = '2'`));
    const l = (await q(`select baixado_em, valor_atualizado, atualizado_em > primeiro_visto_em as mexeu from cap_lancamentos where cod_lancamento = '2'`)).rows[0];
    expect(l.baixado_em).not.toBeNull();
    expect(Number(l.valor_atualizado)).toBe(0);
    expect(l.mexeu).toBe(true);
    expect((await q(`select count(*)::int as n from cap_lancamentos`)).rows[0].n).toBe(2);
  });
  it("a Edge Function registra a rodada em importacoes com o módulo do contas a pagar", async () => {
    await como(db, "service", () => q(`insert into importacoes (modulo, tipo, arquivo, linhas_novas, linhas_alteradas, linhas_baixadas, linhas_divergentes) values ('financeiro.contas-pagar', 'lancamentos', 'api:consistem', 2, 0, 1, 0)`));
    const r = await como(db, finConsulta, () => q(`select tipo, linhas_novas from importacoes where modulo = 'financeiro.contas-pagar'`));
    expect(r.rows[0]).toEqual({ tipo: "lancamentos", linhas_novas: 2 });
  });
});
