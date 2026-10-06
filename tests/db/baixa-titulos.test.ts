import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, outroOperador: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

/** Título aberto (valor 1000, vencido há 30 dias) com a sua pendência "Possível baixa". */
async function novoTitulo(estagio = "importado", emissao: string | null = "2026-01-10") {
  const n = ++contador;
  const id = (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio)
     values ($1, $2, $3, '1', $4, current_date - 30, 1000, $5) returning id`,
    [empresa, cliente, `B${n}`, emissao, estagio],
  )).rows[0].id as string;
  await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'rec_titulos', $3)`, [MOD, `Possível baixa: B${n}`, id]);
  return id;
}

const baixa = (usuario: string, id: string, resultado: string, data: string | null, valor: number | null, descricao: string | null = null) =>
  como(db, usuario, () => q(`select rec_registrar_baixa($1::uuid, $2, $3::date, $4::numeric, $5) as r`, [id, resultado, data, valor, descricao]));
const hojeSql = async () => (await q(`select (now() at time zone 'America/Cuiaba')::date::text as d`)).rows[0].d as string;
const titulo = async (id: string) => (await q(`select estagio, data_pagamento::text as data, valor_pago::float as valor_pago from rec_titulos where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  outroOperador = await novoUsuario(db, "operador2@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Teste', '{cliente}', '1') returning id`)).rows[0].id;
});

describe("rec_registrar_baixa: pago", () => {
  it("baixa com data e valor, registra a interação e conclui a pendência 'Possível baixa'", async () => {
    const id = await novoTitulo();
    const r = await baixa(finOperador, id, "pago", "2026-10-02", 1000);
    expect(r.rows[0].r).toMatchObject({ resultado: "pago", pendencias_concluidas: 1 });
    expect(await titulo(id)).toEqual({ estagio: "pago", data: "2026-10-02", valor_pago: 1000 });

    const i = await q(`select tipo, canal, usuario_id, descricao from interacoes where referencia_id = $1`, [id]);
    expect(i.rows).toEqual([{ tipo: "baixa", canal: "interno", usuario_id: finOperador, descricao: "Baixa: pago em 02/10/2026, valor R$ 1.000,00." }]);
    const p = await q(`select status, concluido_por from pendencias where referencia_id = $1`, [id]);
    expect(p.rows).toEqual([{ status: "concluida", concluido_por: finOperador }]);
  });

  it("valor diferente exige o motivo e aparece no histórico", async () => {
    const id = await novoTitulo();
    await expect(baixa(finOperador, id, "pago", "2026-10-02", 1234.56)).rejects.toThrow(/informe o motivo/);
    expect((await titulo(id)).estagio).toBe("importado");
    await baixa(finOperador, id, "pago", "2026-10-02", 1234.56, "Juros de 30 dias.");
    expect((await q(`select descricao from interacoes where referencia_id = $1`, [id])).rows[0].descricao).toBe("Baixa: pago em 02/10/2026, valor R$ 1.234,56. Juros de 30 dias.");
  });

  it("valida data (obrigatória, não futura, não anterior à emissão) e valor (positivo)", async () => {
    const id = await novoTitulo("importado", "2026-09-01");
    const hoje = await hojeSql();
    const amanha = (await q(`select ($1::date + 1)::text as d`, [hoje])).rows[0].d;
    await expect(baixa(finOperador, id, "pago", null, 1000)).rejects.toThrow(/data do pagamento/);
    await expect(baixa(finOperador, id, "pago", amanha, 1000)).rejects.toThrow(/não pode ser futura/);
    await expect(baixa(finOperador, id, "pago", "2026-08-31", 1000)).rejects.toThrow(/anterior à emissão/);
    await expect(baixa(finOperador, id, "pago", "2026-10-02", null)).rejects.toThrow(/valor pago/);
    await expect(baixa(finOperador, id, "pago", "2026-10-02", 0)).rejects.toThrow(/valor pago/);
    expect((await titulo(id)).estagio).toBe("importado");
    await baixa(finOperador, id, "pago", hoje, 1000); // hoje vale
    expect((await titulo(id)).estagio).toBe("pago");
  });

  it("sem data de emissão, qualquer data passada vale", async () => {
    const id = await novoTitulo("importado", null);
    expect((await baixa(finOperador, id, "pago", "2020-01-01", 1000)).rows[0].r.resultado).toBe("pago");
  });

  it("não baixa título já encerrado", async () => {
    const id = await novoTitulo();
    await baixa(finOperador, id, "pago", "2026-10-02", 1000);
    await expect(baixa(finOperador, id, "pago", "2026-10-02", 1000)).rejects.toThrow(/já está encerrado/);
    await expect(baixa(finOperador, id, "cancelado", null, null)).rejects.toThrow(/já está encerrado/);
  });
});

describe("rec_registrar_baixa: cancelado, permissões e pendências", () => {
  it("cancelado não exige data nem valor e registra o cancelamento", async () => {
    const id = await novoTitulo();
    const r = await baixa(finOperador, id, "cancelado", null, null, "NF cancelada no Consistem.");
    expect(r.rows[0].r).toMatchObject({ resultado: "cancelado", pendencias_concluidas: 1 });
    expect((await titulo(id)).estagio).toBe("cancelado");
    const i = await q(`select tipo, descricao from interacoes where referencia_id = $1`, [id]);
    expect(i.rows).toEqual([{ tipo: "cancelamento", descricao: "Título cancelado (baixa sem pagamento). NF cancelada no Consistem." }]);
  });

  it("resultado inválido é recusado", async () => {
    const id = await novoTitulo();
    await expect(baixa(finOperador, id, "talvez", null, null)).rejects.toThrow(/Resultado inválido/);
  });

  it("quem só consulta não dá baixa e nada muda", async () => {
    const id = await novoTitulo();
    await expect(baixa(finConsulta, id, "pago", "2026-10-02", 1000)).rejects.toThrow(/permissão/);
    expect((await titulo(id)).estagio).toBe("importado");
    expect((await q(`select 1 from interacoes where referencia_id = $1`, [id])).rows).toHaveLength(0);
  });

  it("pendência que é de outra pessoa não é concluída por operador (a baixa vale)", async () => {
    const id = await novoTitulo();
    await q(`update pendencias set responsavel_id = $1 where referencia_id = $2`, [outroOperador, id]);
    const r = await baixa(finOperador, id, "pago", "2026-10-02", 1000);
    expect(r.rows[0].r.pendencias_concluidas).toBe(0);
    expect((await titulo(id)).estagio).toBe("pago");
    expect((await q(`select status from pendencias where referencia_id = $1`, [id])).rows[0].status).toBe("aberta");
  });

  it("as colunas de evidência do Consistem existem e a view as enxerga", async () => {
    const id = await novoTitulo();
    await q(`update rec_titulos set consistem_pago_em = '2026-10-01', consistem_valor_pago = 1010.5, consistem_tipo_baixa = '1', consistem_verificado_em = now() where id = $1`, [id]);
    const r = await como(db, finConsulta, () => q(`select consistem_pago_em::text as d, consistem_valor_pago::float as v, consistem_tipo_baixa as t, faixa from rec_vw_titulos where id = $1`, [id]));
    expect(r.rows[0]).toEqual({ d: "2026-10-01", v: 1010.5, t: "1", faixa: "16_30" });
  });
});

describe("rec_baixar_titulos (em lote)", () => {
  const lote = (usuario: string, itens: unknown[]) => como(db, usuario, () => q(`select rec_baixar_titulos($1::jsonb) as r`, [JSON.stringify(itens)]));

  it("baixa vários de uma vez e conclui as pendências", async () => {
    const a = await novoTitulo();
    const b = await novoTitulo();
    const r = await lote(finOperador, [
      { id: a, resultado: "pago", data: "2026-10-01", valor: 1000 },
      { id: b, resultado: "pago", data: "2026-10-02", valor: 1050, descricao: "Juros." },
    ]);
    expect(r.rows[0].r).toEqual({ baixados: 2, pendencias_concluidas: 2 });
    expect((await titulo(b)).valor_pago).toBe(1050);
  });

  it("tudo ou nada: um item inválido desfaz todos", async () => {
    const a = await novoTitulo();
    const b = await novoTitulo();
    await expect(lote(finOperador, [
      { id: a, resultado: "pago", data: "2026-10-01", valor: 1000 },
      { id: b, resultado: "pago", data: null, valor: 1000 },
    ])).rejects.toThrow(/Título B\d+: Informe a data do pagamento/);
    expect((await titulo(a)).estagio).toBe("importado");
    expect((await titulo(b)).estagio).toBe("importado");
    expect((await q(`select 1 from interacoes where referencia_id = any($1::uuid[])`, [[a, b]])).rows).toHaveLength(0);
  });

  it("recusa lista vazia e mais de 100 itens", async () => {
    await expect(lote(finOperador, [])).rejects.toThrow(/pelo menos um título/);
    const muitos = Array.from({ length: 101 }, () => ({ id: "00000000-0000-0000-0000-000000000000", resultado: "cancelado" }));
    await expect(lote(finOperador, muitos)).rejects.toThrow(/No máximo 100/);
  });

  it("quem só consulta não consegue em lote", async () => {
    const a = await novoTitulo();
    await expect(lote(finConsulta, [{ id: a, resultado: "cancelado" }])).rejects.toThrow(/permissão/);
    expect((await titulo(a)).estagio).toBe("importado");
  });
});
