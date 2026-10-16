import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Migration 0168: "não pago" na conferência com o banco. O item autorizado e não pago fica na autorização (prova), com motivo e
// carimbo, e deixa de prender o lançamento: volta à lista de pendentes e pode entrar em outra autorização — desde que siga em
// aberto no Consistem (espelho). Desfazer é recusado se o lançamento já entrou em outra autorização ativa.

let db: PGlite;
let finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));

async function titulo(valor: number) {
  const n = ++contador;
  return (await servico(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '205', $2, '2026-10-01', '2026-10-15', $3::numeric, $3::numeric) returning id`,
    [empresa, `NP${n}`, valor],
  )).rows[0].id as string;
}

/** Autorização autorizada com os lançamentos dados e 1 extra. */
async function autorizada(lancamentos: string[]) {
  const r = (await rpc(finOperador, `select cap_criar_autorizacao($1, $2::uuid[], null, null, false, null) as r`, [empresa, lancamentos])).rows[0].r;
  await rpc(finOperador, `select cap_incluir_extra($1, 'Frete avulso', 'Transportes X', 80::numeric)`, [r.id]);
  await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
  const itens = (await q(`select id from cap_autorizacao_itens where autorizacao_id = $1 order by valor`, [r.id])).rows.map((l) => l.id as string);
  const extra = (await q(`select id from cap_autorizacao_extras where autorizacao_id = $1`, [r.id])).rows[0].id as string;
  const codigo = (await q(`select codigo from cap_autorizacoes where id = $1`, [r.id])).rows[0].codigo as string;
  return { id: r.id as string, codigo, itens, extra };
}
const conferir = (origem: string, id: string, situacao: string | null, obs: string | null = null) =>
  rpc(finOperador, `select cap_conferir($1, $2, $3, null, $4) as r`, [origem, id, situacao, obs]).then((x) => x.rows[0].r);
const pendente = (lancamento: string) =>
  rpc(finOperador, `select autorizacao_codigo, nao_pago_autorizacao_codigo from cap_vw_pendentes where id = $1`, [lancamento]).then((x) => x.rows[0]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("não pago na conferência (0168)", () => {
  it("exige motivo; marcado, o título volta à lista e a autorização conta o não pago", async () => {
    const [a, b] = [await titulo(150), await titulo(39000)];
    const m = await autorizada([a, b]);
    expect((await pendente(b)).autorizacao_codigo).toBe(m.codigo);

    await expect(conferir("item", m.itens[1], "nao_pago")).rejects.toThrow(/informe o motivo/);
    const r = await conferir("item", m.itens[1], "nao_pago", "  sem saldo, fica para amanhã ");
    expect([r.conferencia_banco, r.observacao_conferencia, r.valor_banco]).toEqual(["nao_pago", "sem saldo, fica para amanhã", null]);
    expect(r.resumo).toEqual({ itens: 3, conferidos: 0, divergentes: 0, nao_pagos: 1 });

    const p = await pendente(b);
    expect([p.autorizacao_codigo, p.nao_pago_autorizacao_codigo]).toEqual([null, m.codigo]);
    expect((await pendente(a)).autorizacao_codigo).toBe(m.codigo); // o outro continua preso

    const v = (await q(`select nao_pagos, total_nao_pago, total from cap_vw_autorizacoes where id = $1`, [m.id])).rows[0];
    expect([v.nao_pagos, Number(v.total_nao_pago), Number(v.total)]).toEqual([1, 39000, 39230]); // total autorizado não muda
    const aud = (await q(`select count(*)::int as n from auditoria where tabela = 'cap_autorizacao_itens' and registro_id = $1`, [m.itens[1]])).rows[0];
    expect(aud.n).toBeGreaterThanOrEqual(2);
  });

  it("o título devolvido entra numa nova autorização; aí o desfazer na antiga é recusado", async () => {
    const t = await titulo(500);
    const antiga = await autorizada([t]);
    await conferir("item", antiga.itens[0], "nao_pago", "não pago");
    const nova = await autorizada([t]);
    expect((await pendente(t)).autorizacao_codigo).toBe(nova.codigo);
    await expect(conferir("item", antiga.itens[0], null)).rejects.toThrow(new RegExp(`já entrou na autorização ${nova.codigo}`));
    await expect(conferir("item", antiga.itens[0], "conferido")).rejects.toThrow(/já entrou na autorização/);

    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [nova.id]);
    const r = await conferir("item", antiga.itens[0], null);
    expect(r.conferencia_banco).toBeNull();
    expect((await pendente(t)).autorizacao_codigo).toBe(antiga.codigo);
  });

  it("só volta se ainda estiver em aberto no Consistem", async () => {
    const [baixado, semSaldo] = [await titulo(100), await titulo(200)];
    const m = await autorizada([baixado, semSaldo]);
    await servico(`update cap_lancamentos set baixado_em = now() where id = $1`, [baixado]);
    await servico(`update cap_autorizacao_itens set baixado_consistem_em = current_date where lancamento_id = $1`, [baixado]);
    await servico(`update cap_lancamentos set valor_atualizado = 0 where id = $1`, [semSaldo]);
    await expect(conferir("item", m.itens[0], "nao_pago", "x")).rejects.toThrow(/não está mais em aberto no Consistem/);
    await expect(conferir("item", m.itens[1], "nao_pago", "x")).rejects.toThrow(/não está mais em aberto no Consistem/);
  });

  it("pagamento extra não aceita não pago", async () => {
    const m = await autorizada([await titulo(10)]);
    await expect(conferir("extra", m.extra, "nao_pago", "x")).rejects.toThrow(/Só títulos e antecipações/);
  });
});
