import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string, comGestor: string;
let setembro: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const linha = (o: Record<string, unknown>) => ({
  cod_representante: "3", cod_representante_venda: "3", chave: "T:1001249E", origem: "titulo", cod_titulo: "1001249E", cod_cliente: "100",
  nome_cliente: null, nota_fiscal: "1249", data_pagamento: "2026-09-14", tipo_baixa: "3", tipo: "venda", valor_base: 480000, percentual: 1.5,
  valor_comissao: 7200, valor_consistem: 7200, observacao: null, ...o,
});

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  comGestor = await novoUsuario(db, "com.gestor@neo.com", { comercial: "gestor" });
});

describe("cadastro (0171)", () => {
  it("módulo ativo e Fernando/Heitor com os percentuais das planilhas", async () => {
    expect((await q(`select ativo from modulos where codigo = 'financeiro.comissoes'`)).rows[0].ativo).toBe(true);
    const r = (await q(`select cod_representante, perc_venda, perc_locacao, recebe_de from fin_com_representantes order by cod_representante`)).rows;
    expect(r).toEqual([
      { cod_representante: "3", perc_venda: "1.500", perc_locacao: "3.000", recebe_de: ["3", "7"] },
      { cod_representante: "7", perc_venda: "1.000", perc_locacao: "1.000", recebe_de: ["7"] },
    ]);
  });
  it("só o gestor altera o representante; o próprio código sempre entra em recebe_de", async () => {
    await expect(como(db, finOperador, () => q(`select fin_com_salvar_representante('7', 'Heitor', 1, 1, '{}', true)`))).rejects.toThrow(/gestor/);
    await como(db, finGestor, () => q(`select fin_com_salvar_representante('7', 'Heitor Selerges', 1, 1, '{}', true)`));
    expect((await q(`select recebe_de from fin_com_representantes where cod_representante = '7'`)).rows[0].recebe_de).toEqual(["7"]);
  });
  it("quem não tem o Financeiro não vê nada", async () => {
    expect((await como(db, comGestor, () => q(`select count(*)::int as n from fin_com_representantes`))).rows[0].n).toBe(0);
  });
});

describe("fechamento do mês", () => {
  it("consulta não abre; operador abre (um por mês, sempre no dia 1)", async () => {
    await expect(como(db, finConsulta, () => q(`select fin_com_abrir('2026-09-15')`))).rejects.toThrow(/operador/);
    setembro = (await como(db, finOperador, () => q(`select fin_com_abrir('2026-09-15') as id`))).rows[0].id;
    const de_novo = (await como(db, finOperador, () => q(`select fin_com_abrir('2026-09-01') as id`))).rows[0].id;
    expect(de_novo).toBe(setembro);
    expect((await q(`select competencia::text from fin_com_fechamentos where id = $1`, [setembro])).rows[0].competencia).toBe("2026-09-01");
    await expect(como(db, finOperador, () => q(`select fin_com_abrir('2099-01-01')`))).rejects.toThrow(/já começou/);
  });

  it("importa a planilha da CCCCI010 (substitui a anterior)", async () => {
    const creditos = [{ linha: 3, data: "2026-09-09", cod_cliente: "300", nome_cliente: "MIRANTE", valor: 1830000 }];
    await como(db, finOperador, () => q(`select fin_com_importar_creditos($1, 'creditos.xlsx', $2::jsonb)`, [setembro, JSON.stringify([...creditos, { ...creditos[0], linha: 4 }])]));
    const n = (await como(db, finOperador, () => q(`select fin_com_importar_creditos($1, 'creditos.xlsx', $2::jsonb) as n`, [setembro, JSON.stringify(creditos)]))).rows[0].n;
    expect(n).toBe(1);
    expect((await q(`select count(*)::int as n from fin_com_creditos where fechamento_id = $1`, [setembro])).rows[0].n).toBe(1);
  });

  it("grava a proposta e mantém as decisões da conferência ao refazer", async () => {
    const credito = (await q(`select id from fin_com_creditos where fechamento_id = $1`, [setembro])).rows[0].id;
    const proposta = [linha({}), linha({ chave: "T:1001295C", cod_titulo: "1001295C", cod_representante_venda: "7", valor_base: 154000, valor_comissao: 2310, valor_consistem: null })];
    await como(db, finOperador, () => q(`select fin_com_gravar_proposta($1, $2::jsonb, $3::jsonb, $4::jsonb)`, [setembro, JSON.stringify(proposta),
      JSON.stringify([{ id: credito, cod_titulo_z: null, cod_representante_sugerido: "3" }]), JSON.stringify([{ cod_titulo: "Z00099A" }])]));
    const l1295 = (await q(`select id from fin_com_linhas where fechamento_id = $1 and chave = 'T:1001295C'`, [setembro])).rows[0].id;
    await expect(como(db, finOperador, () => q(`select fin_com_ajustar_linha($1, false, '', 'venda')`, [l1295]))).rejects.toThrow(/motivo/);
    await como(db, finOperador, () => q(`select fin_com_ajustar_linha($1, false, 'Já pago em agosto', 'venda')`, [l1295]));
    const l1249 = (await q(`select id from fin_com_linhas where fechamento_id = $1 and chave = 'T:1001249E'`, [setembro])).rows[0].id;
    await como(db, finOperador, () => q(`select fin_com_ajustar_linha($1, true, null, 'locacao')`, [l1249])); // 3% do Fernando

    // Refaz a busca: a decisão e o tipo trocado ficam; a linha que saiu da proposta some.
    await como(db, finOperador, () => q(`select fin_com_gravar_proposta($1, $2::jsonb, '[]', '[]')`, [setembro, JSON.stringify([linha({}), proposta[1]])]));
    const r = (await q(`select chave, incluida, motivo, tipo, percentual, valor_comissao from fin_com_linhas where fechamento_id = $1 order by chave`, [setembro])).rows;
    expect(r).toEqual([
      { chave: "T:1001249E", incluida: true, motivo: null, tipo: "locacao", percentual: "3.000", valor_comissao: "14400.00" },
      { chave: "T:1001295C", incluida: false, motivo: "Já pago em agosto", tipo: "venda", percentual: "1.500", valor_comissao: "2310.00" },
    ]);
    expect((await q(`select cod_representante_sugerido from fin_com_creditos where id = $1`, [credito])).rows[0].cod_representante_sugerido).toBe("3");
  });

  it("lançamento manual e antecipação", async () => {
    await expect(como(db, finOperador, () => q(`select fin_com_lancar($1, '3', 'manual', '2026-09-09', '', 1000)`, [setembro]))).rejects.toThrow(/descrição/);
    await como(db, finOperador, () => q(`select fin_com_lancar($1, '3', 'manual', '2026-09-09', 'Adiantamento Mirante', 1830000)`, [setembro]));
    await como(db, finOperador, () => q(`select fin_com_lancar($1, '3', 'antecipacao', '2026-09-12', 'Antecipação de comissão', 10000)`, [setembro]));
    const r = (await q(`select origem, percentual, valor_comissao from fin_com_linhas where fechamento_id = $1 and origem in ('manual', 'antecipacao') order by origem`, [setembro])).rows;
    expect(r).toEqual([
      { origem: "antecipacao", percentual: "0.000", valor_comissao: "10000.00" },
      { origem: "manual", percentual: "1.500", valor_comissao: "27450.00" },
    ]);
  });

  it("ninguém grava direto nas tabelas (só pelas funções)", async () => {
    await expect(como(db, finGestor, () => q(`insert into fin_com_linhas (fechamento_id, cod_representante, chave, origem) values ($1, '3', 'X', 'manual')`, [setembro]))).rejects.toThrow();
    const r = await como(db, finGestor, () => q(`update fin_com_linhas set valor_comissao = 0 where fechamento_id = $1`, [setembro]));
    expect(r.affectedRows).toBe(0);
  });

  it("só o gestor fecha; fechado fica congelado", async () => {
    await expect(como(db, finOperador, () => q(`select fin_com_fechar($1)`, [setembro]))).rejects.toThrow(/gestor/);
    await como(db, finGestor, () => q(`select fin_com_fechar($1)`, [setembro]));
    expect((await q(`select status, fechado_por is not null as quem from fin_com_fechamentos where id = $1`, [setembro])).rows[0]).toEqual({ status: "fechado", quem: true });
    expect((await q(`select bool_and(fechada) as todas from fin_com_linhas where fechamento_id = $1`, [setembro])).rows[0].todas).toBe(true);
    await expect(como(db, finOperador, () => q(`select fin_com_lancar($1, '3', 'manual', '2026-09-09', 'x', 1)`, [setembro]))).rejects.toThrow(/já foi fechado/);
    await expect(q(`update fin_com_linhas set valor_comissao = 0 where fechamento_id = $1`, [setembro])).rejects.toThrow(/já foi fechado/);
    await expect(q(`delete from fin_com_creditos where fechamento_id = $1`, [setembro])).rejects.toThrow(/já foi fechado/);
    await expect(q(`delete from fin_com_fechamentos where id = $1`, [setembro])).rejects.toThrow();
  });

  it("o mesmo recebimento não é pago de novo ao mesmo representante em outro mês", async () => {
    const outubro = (await como(db, finOperador, () => q(`select fin_com_abrir('2026-10-01') as id`))).rows[0].id;
    await como(db, finOperador, () => q(`select fin_com_gravar_proposta($1, $2::jsonb, '[]', '[]')`, [outubro, JSON.stringify([linha({ data_pagamento: "2026-10-01" })])]));
    await expect(como(db, finGestor, () => q(`select fin_com_fechar($1)`, [outubro]))).rejects.toThrow(/já pago em outro fechamento/);
    // Excluída com motivo, fecha.
    const id = (await q(`select id from fin_com_linhas where fechamento_id = $1`, [outubro])).rows[0].id;
    await como(db, finOperador, () => q(`select fin_com_ajustar_linha($1, false, 'Pago em setembro', 'venda')`, [id]));
    await como(db, finGestor, () => q(`select fin_com_fechar($1)`, [outubro]));
    expect((await q(`select status from fin_com_fechamentos where id = $1`, [outubro])).rows[0].status).toBe("fechado");
  });

  it("tudo passa pela auditoria", async () => {
    const r = (await q(`select count(*)::int as n from auditoria where tabela in ('fin_com_linhas', 'fin_com_fechamentos', 'fin_com_creditos')`)).rows[0].n;
    expect(r).toBeGreaterThan(10);
  });
});
