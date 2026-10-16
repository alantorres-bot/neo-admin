import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Migration 0160: conferência dos pagamentos com o banco (Fase 4e). Depois de autorizada, operador ou gestor marca cada item
// (títulos, antecipações e extras) como conferido ou divergente; o gatilho carimba quem/quando e o resto segue imutável.

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));

async function titulo(valor: number) {
  const n = ++contador;
  return (await servico(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '205', $2, '2026-10-01', '2026-10-20', $3::numeric, $3::numeric) returning id`,
    [empresa, `F${n}`, valor],
  )).rows[0].id as string;
}

/** Autorização com 2 títulos e 1 extra; autorizada se pedido. Devolve ids da autorização, itens (por valor) e extra. */
async function montar(autorizar: boolean) {
  const [a, b] = [await titulo(150), await titulo(1234.56)];
  const r = (await rpc(finOperador, `select cap_criar_autorizacao($1, $2::uuid[], null, null, false, null) as r`, [empresa, [a, b]])).rows[0].r;
  await rpc(finOperador, `select cap_incluir_extra($1, 'Frete avulso', 'Transportes X', 80::numeric)`, [r.id]);
  if (autorizar) await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
  const itens = (await q(`select id from cap_autorizacao_itens where autorizacao_id = $1 order by valor`, [r.id])).rows.map((l) => l.id as string);
  const extra = (await q(`select id from cap_autorizacao_extras where autorizacao_id = $1`, [r.id])).rows[0].id as string;
  return { id: r.id as string, itens, extra };
}
const conferir = (usuario: string, origem: string, id: string, situacao: string | null, valor: number | null = null, obs: string | null = null) =>
  rpc(usuario, `select cap_conferir($1, $2, $3, $4::numeric, $5) as r`, [origem, id, situacao, valor, obs]).then((x) => x.rows[0].r);
const resumo = (id: string) =>
  rpc(finConsulta, `select itens + extras as n, conferidos, divergentes, total_conferido from cap_vw_autorizacoes where id = $1`, [id]).then((x) => x.rows[0]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("conferência com o banco (0160)", () => {
  it("operador confere item e extra; o gatilho carimba quem e quando; a view conta", async () => {
    const m = await montar(true);
    const r = await conferir(finOperador, "item", m.itens[0], "conferido");
    expect(r.conferencia_banco).toBe("conferido");
    expect(r.resumo).toEqual({ itens: 3, conferidos: 1, divergentes: 0, nao_pagos: 0 });
    await conferir(finGestor, "extra", m.extra, "conferido");
    const i = (await q(`select conferido_banco_por, conferido_banco_em is not null as em from cap_autorizacao_itens where id = $1`, [m.itens[0]])).rows[0];
    expect([i.conferido_banco_por, i.em]).toEqual([finOperador, true]);
    const e = (await q(`select conferido_banco_por from cap_autorizacao_extras where id = $1`, [m.extra])).rows[0];
    expect(e.conferido_banco_por).toBe(finGestor);
    const v = await resumo(m.id);
    expect([v.n, v.conferidos, v.divergentes, Number(v.total_conferido)]).toEqual([3, 2, 0, 230]);
  });

  it("divergente exige valor do banco ou observação; conferido limpa o valor do banco", async () => {
    const m = await montar(true);
    await expect(conferir(finOperador, "item", m.itens[1], "divergente")).rejects.toThrow(/valor que está no banco ou uma observação/);
    const d = await conferir(finOperador, "item", m.itens[1], "divergente", 1250.1, "  juros de atraso  ");
    expect([d.conferencia_banco, Number(d.valor_banco), d.observacao_conferencia]).toEqual(["divergente", 1250.1, "juros de atraso"]);
    expect((await resumo(m.id)).divergentes).toBe(1);
    const c = await conferir(finOperador, "item", m.itens[1], "conferido", 999);
    expect([c.conferencia_banco, c.valor_banco]).toEqual(["conferido", null]);
  });

  it("desmarcar limpa tudo e fica na auditoria", async () => {
    const m = await montar(true);
    await conferir(finOperador, "item", m.itens[0], "conferido");
    const r = await conferir(finOperador, "item", m.itens[0], null);
    expect([r.conferencia_banco, r.conferido_banco_em]).toEqual([null, null]);
    const aud = (await q(`select count(*)::int as n from auditoria where tabela = 'cap_autorizacao_itens' and registro_id = $1`, [m.itens[0]])).rows[0];
    expect(aud.n).toBeGreaterThanOrEqual(3); // inclusão + marcar + desmarcar
  });

  it("só vale para autorização autorizada e item não removido", async () => {
    const rasc = await montar(false);
    await expect(conferir(finOperador, "item", rasc.itens[0], "conferido")).rejects.toThrow(/só vale para autorização autorizada/);
    await expect(conferir(finOperador, "extra", rasc.extra, "conferido")).rejects.toThrow(/só vale para autorização autorizada/);

    const removido = await montar(false);
    await rpc(finOperador, `select cap_remover_item($1, 'saiu')`, [removido.itens[0]]);
    await rpc(finGestor, `select cap_autorizar($1)`, [removido.id]);
    await expect(conferir(finOperador, "item", removido.itens[0], "conferido")).rejects.toThrow(/removido da autorização/);

    const canc = await montar(true);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [canc.id]);
    await expect(conferir(finOperador, "item", canc.itens[0], "conferido")).rejects.toThrow(/só vale para autorização autorizada/);
  });

  it("consulta não confere; demais colunas seguem imutáveis; carimbo não é forjável", async () => {
    const m = await montar(true);
    await expect(conferir(finConsulta, "item", m.itens[0], "conferido")).rejects.toThrow(/operador ou gestor/);
    await expect(rpc(finOperador, `update cap_autorizacao_itens set valor = 1, conferencia_banco = 'conferido' where id = $1`, [m.itens[0]])).rejects.toThrow(/imutáveis/);
    await rpc(finOperador, `update cap_autorizacao_itens set conferencia_banco = 'conferido', conferido_banco_por = $2, conferido_banco_em = '2020-01-01' where id = $1`, [m.itens[0], finGestor]);
    const i = (await q(`select conferido_banco_por, conferido_banco_em > now() - interval '1 minute' as agora from cap_autorizacao_itens where id = $1`, [m.itens[0]])).rows[0];
    expect([i.conferido_banco_por, i.agora]).toEqual([finOperador, true]);
    await expect(conferir(finOperador, "item", m.itens[0], "pago")).rejects.toThrow(/inválida/);
  });

  it("a sincronização (service role) continua anotando baixa sem mexer na conferência", async () => {
    const m = await montar(true);
    await conferir(finOperador, "item", m.itens[0], "conferido");
    await servico(`update cap_autorizacao_itens set baixado_consistem_em = current_date where id = $1`, [m.itens[0]]);
    const i = (await q(`select conferencia_banco, baixado_consistem_em is not null as baixado from cap_autorizacao_itens where id = $1`, [m.itens[0]])).rows[0];
    expect([i.conferencia_banco, i.baixado]).toEqual(["conferido", true]);
  });
});
