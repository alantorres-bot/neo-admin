import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Migration 0165: compra parcelada com a NF lançada pelo total → desdobrar no Consistem (alteração do original + parcelas 2..N).

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let fatura: string, ciclo: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const antes = (valor = 2994.78, extra: Record<string, unknown> = {}) => ({ codLancamento: 40000, codFornecedor: 1345, codDocumento: "3615152/1", valorDocumento: valor, ...extra });
const alteracao = (valor = 499.13) => ({ valorDocumento: valor, codDocumento: "3615152/1", complementoHistorico: "CARTÃO UNICRED PF 6x — MP*TERABYTESHOP PARC 1/6" });
const vencimentos = ["2026-11-20", "2026-12-20", "2027-01-20", "2027-02-20", "2027-03-20"];
const parcelas = (ultima = 499.13, extra: Record<string, unknown> = {}) => vencimentos.map((v, i) => ({
  parcela: i + 2, vencimento: v,
  payload: { codFornecedor: 1345, codDocumento: `3615152/${i + 2}`, valorDocumento: i === 4 ? ultima : 499.13, dataVencimento: v, complementoHistorico: `CARTÃO UNICRED PF 6x — MP*TERABYTESHOP PARC ${i + 2}/6`, ...extra },
}));
const reservar = (u: string, l: string, opc: { antes?: unknown; alteracao?: unknown; parcelas?: unknown; cod?: string } = {}) =>
  rpc(u, `select crt_reservar_desdobramento($1, $2, $3, '{"num_documento":"3615152/1","fornecedor":"TERABYTE"}'::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) as lote`,
    [fatura, l, opc.cod ?? "40000", JSON.stringify(opc.antes ?? antes()), JSON.stringify(opc.alteracao ?? alteracao()), JSON.stringify(opc.parcelas ?? parcelas())]);
const desdobramento = (lote: string) => q(`select * from crt_desdobramentos where lote = $1`, [lote]).then((r) => r.rows[0]);
const doLote = (lote: string) => q(`select id, parcela, situacao, valor, tipo, linhas, erro from crt_lancamentos_erp where lote = $1 order by parcela`, [lote]).then((r) => r.rows);
const pendencia = () => q(`select status, descricao from pendencias where referencia_id = $1 and titulo like 'Desdobrar no Consistem%' order by criado_em desc limit 1`, [ciclo]).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "MP*TERABYTESHOP", valor: 499.13, parcela_num: 1, parcela_total: 6, descartada: false },
    { ordem: 2, descricao: "MP*TERABYTESHOP", valor: 499.13, parcela_num: 1, parcela_total: 6, descartada: false },
    { ordem: 3, descricao: "LOJA", valor: 100, parcela_num: 2, parcela_total: 3, descartada: false },
    { ordem: 4, descricao: "AVISTA", valor: 50, descartada: false },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'UNICRED PF', '2026-10-20', 1148.26, 'unicred', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  ciclo = (await q(`select ciclo_id from crt_faturas where id = $1`, [fatura])).rows[0].ciclo_id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
});

describe("reservar o desdobramento (0165)", () => {
  it("chave começa ligada; precisa também do lançamento no ERP; só operador", async () => {
    expect((await q(`select valor from configuracoes where chave = 'financeiro.cartao.desdobrar_no_erp'`)).rows[0].valor).toBe(true);
    await expect(reservar(finOperador, linha[1])).rejects.toThrow(/lancar_no_erp/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
    await expect(reservar(finConsulta, linha[1])).rejects.toThrow(/Somente operador/);
    await q(`update configuracoes set valor = 'false'::jsonb where chave = 'financeiro.cartao.desdobrar_no_erp'`);
    await expect(reservar(finOperador, linha[1])).rejects.toThrow(/desdobrar_no_erp/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.desdobrar_no_erp'`);
  });

  it("confere linha, título e valores", async () => {
    await expect(reservar(finOperador, linha[3])).rejects.toThrow(/parcela 1/);
    await expect(reservar(finOperador, linha[4])).rejects.toThrow(/parcela 1/);
    await expect(reservar(finOperador, linha[1], { cod: "40001" })).rejects.toThrow(/não é do título/);
    await expect(reservar(finOperador, linha[1], { antes: antes(1000) })).rejects.toThrow(/não é a compra inteira/);
    await expect(reservar(finOperador, linha[1], { alteracao: alteracao(500) })).rejects.toThrow(/alteração do título original é inválida/);
    await expect(reservar(finOperador, linha[1], { alteracao: { ...alteracao(), codPortador: 1 } })).rejects.toThrow(/só o valor, o documento e o complemento/);
    await expect(reservar(finOperador, linha[1], { parcelas: parcelas().slice(1) })).rejects.toThrow(/parcelas 2 a 6/);
    await expect(reservar(finOperador, linha[1], { parcelas: [...parcelas()].reverse() })).rejects.toThrow(/em ordem/);
    await expect(reservar(finOperador, linha[1], { parcelas: parcelas(499.15) })).rejects.toThrow(/soma das parcelas/);
    await expect(reservar(finOperador, linha[1], { parcelas: parcelas(499.13, { codFornecedor: 9 }) })).rejects.toThrow(/fornecedor do título original/);
    // A última fecha o total (arredondamento do emissor).
    const l = (await reservar(finOperador, linha[2], { cod: "40002", antes: antes(2994.8, { codLancamento: "40002" }), parcelas: parcelas(499.15) })).rows[0].lote as string;
    expect((await doLote(l)).map((x) => Number(x.valor))).toEqual([499.13, 499.13, 499.13, 499.13, 499.15]);
  });

  it("reserva: o desdobramento e as parcelas 2..6 no mesmo lote; não repete a linha nem o título", async () => {
    const lote = (await reservar(finOperador, linha[1])).rows[0].lote as string;
    const d = await desdobramento(lote);
    expect([d.cod_lancamento, d.parcelas, Number(d.valor_original), Number(d.valor_parcela), d.situacao, d.fornecedor]).toEqual(["40000", 6, 2994.78, 499.13, "reservado", "TERABYTE"]);
    const ps = await doLote(lote);
    expect(ps.map((x) => [x.parcela, x.tipo, x.situacao, x.linhas])).toEqual([2, 3, 4, 5, 6].map((k) => [k, "desdobramento", "reservado", []]));
    await expect(reservar(finOperador, linha[1])).rejects.toThrow(/já foi lançada|já tem desdobramento/);
    // A linha em desdobramento não é lançada como compra.
    await expect(rpc(finOperador, `select crt_reservar_lancamento_compra($1, $2, '[]'::jsonb)`, [fatura, linha[1]])).rejects.toThrow(/já foi lançada/);
  });
});

describe("envio (service role)", () => {
  it("parcelas só vão com o original alterado; erro na alteração derruba as parcelas e abre a pendência", async () => {
    const lote = (await q(`select lote from crt_desdobramentos where linha_id = $1 and situacao = 'reservado'`, [linha[1]])).rows[0].lote as string;
    const d = await desdobramento(lote);
    const [p2] = await doLote(lote);
    await expect(servico(`select crt_iniciar_envio_erp($1)`, [p2.id])).rejects.toThrow(/ainda não foi alterado/);
    await expect(rpc(finOperador, `select crt_iniciar_desdobramento($1)`, [d.id])).rejects.toThrow();
    await servico(`select crt_iniciar_desdobramento($1)`, [d.id]);
    await servico(`select crt_concluir_desdobramento($1, false, null, null, 'O Consistem recusou (HTTP 400): valor.')`, [d.id]);
    expect((await desdobramento(lote)).situacao).toBe("erro");
    expect((await doLote(lote)).every((x) => x.situacao === "erro" && /não foi alterado/.test(x.erro))).toBe(true);
    expect(await pendencia()).toMatchObject({ status: "aberta", descricao: expect.stringMatching(/^1 compra lançada pelo total não foi desdobrada/) });
    await expect(rpc(finOperador, `select crt_reenviar_lancamentos($1)`, [lote])).rejects.toThrow(/ainda não foi alterado/);
    await expect(servico(`delete from crt_desdobramentos where id = $1`, [d.id])).rejects.toThrow();
  });

  it("de novo: alterado → parcelas enviadas; parcela com erro reenviada; pendência fecha", async () => {
    const lote = (await reservar(finOperador, linha[1])).rows[0].lote as string;
    const d = await desdobramento(lote);
    await servico(`select crt_iniciar_desdobramento($1)`, [d.id]);
    await servico(`select crt_concluir_desdobramento($1, true, '{"valorDocumento":499.13}'::jsonb, null, null)`, [d.id]);
    expect((await pendencia()).status).toBe("concluida");
    const ps = await doLote(lote);
    for (const [i, p] of ps.entries()) {
      await servico(`select crt_iniciar_envio_erp($1)`, [p.id]);
      if (i < 3) await servico(`select crt_concluir_lancamento_erp($1, $2, null, null)`, [p.id, String(50000 + i)]);
      else await servico(`select crt_concluir_lancamento_erp($1, null, null, 'recusado')`, [p.id]);
    }
    await servico(`select crt_sincronizar_pendencia_desdobramentos($1)`, [ciclo]);
    expect(await pendencia()).toMatchObject({ status: "aberta", descricao: expect.stringMatching(/^2 parcelas do desdobramento não foram criadas/) });
    // Lançada sem decisão "casar" (a linha casa com o título original alterado).
    expect((await q(`select count(*)::int as n from crt_decisoes where fatura_id = $1`, [fatura])).rows[0].n).toBe(0);
    const novo = (await rpc(finOperador, `select crt_reenviar_lancamentos($1) as lote`, [lote])).rows[0].lote as string;
    expect((await doLote(novo)).map((x) => [x.parcela, x.tipo])).toEqual([[5, "desdobramento"], [6, "desdobramento"]]);
    for (const p of await doLote(novo)) {
      await servico(`select crt_iniciar_envio_erp($1)`, [p.id]);
      await servico(`select crt_concluir_lancamento_erp($1, $2, null, null)`, [p.id, `6${p.parcela}`]);
    }
    await rpc(finOperador, `select crt_sincronizar_pendencia_desdobramentos($1)`, [ciclo]);
    expect((await pendencia()).status).toBe("concluida");
    await expect(rpc(finConsulta, `select crt_sincronizar_pendencia_desdobramentos($1)`, [ciclo])).rejects.toThrow(/Somente operador/);
    await expect(servico(`update crt_desdobramentos set situacao = 'erro' where id = $1`, [d.id])).rejects.toThrow(/já foi alterado/);
  });

  it("falha da função (reservado) vira erro; resolver à mão libera as parcelas", async () => {
    const lote = (await q(`select lote from crt_desdobramentos where linha_id = $1 and situacao = 'reservado'`, [linha[2]])).rows[0].lote as string;
    await rpc(finOperador, `select crt_falha_desdobramento($1, 'A função não respondeu.')`, [lote]);
    const d = await desdobramento(lote);
    expect([d.situacao, d.erro]).toEqual(["erro", "A função não respondeu."]);
    await expect(rpc(finOperador, `select crt_resolver_desdobramento($1, '')`, [d.id])).rejects.toThrow(/Informe/);
    await rpc(finOperador, `select crt_resolver_desdobramento($1, 'Conferido no Consistem: título 40002 já com R$ 499,13.')`, [d.id]);
    expect((await desdobramento(lote)).situacao).toBe("alterado");
    const novo = (await rpc(finOperador, `select crt_reenviar_lancamentos($1) as lote`, [lote])).rows[0].lote as string;
    expect(await doLote(novo)).toHaveLength(5);
  });
});

describe("exclusão no Consistem registrada (0165)", () => {
  it("só gestor, só título lançado, com motivo; uma vez; libera a parcela para novo lançamento", async () => {
    const lancado = (await q(`select id from crt_lancamentos_erp where situacao = 'lancado' order by criado_em limit 1`)).rows[0].id as string;
    const erro = (await q(`select id from crt_lancamentos_erp where situacao = 'erro' limit 1`)).rows[0].id as string;
    await expect(rpc(finOperador, `select crt_registrar_exclusao_erp($1, 'duplicava a NF 3615152')`, [lancado])).rejects.toThrow(/Somente gestor/);
    await expect(rpc(finGestor, `select crt_registrar_exclusao_erp($1, 'curto')`, [lancado])).rejects.toThrow(/motivo/);
    await expect(rpc(finGestor, `select crt_registrar_exclusao_erp($1, 'duplicava a NF 3615152')`, [erro])).rejects.toThrow(/título lançado/);
    await rpc(finGestor, `select crt_registrar_exclusao_erp($1, 'duplicava a NF 3615152')`, [lancado]);
    const r = (await q(`select excluido_no_erp_em, excluido_no_erp_por_nome, motivo_exclusao_erp, situacao from crt_vw_lancamentos_erp where id = $1`, [lancado])).rows[0];
    expect([!!r.excluido_no_erp_em, r.excluido_no_erp_por_nome, r.motivo_exclusao_erp, r.situacao]).toEqual([true, expect.any(String), "duplicava a NF 3615152", "lancado"]);
    await expect(rpc(finGestor, `select crt_registrar_exclusao_erp($1, 'duplicava a NF 3615152')`, [lancado])).rejects.toThrow(/já foi registrada/);
    await expect(q(`update crt_lancamentos_erp set motivo_exclusao_erp = 'outro motivo qualquer' where id = $1`, [lancado])).rejects.toThrow(/já foi registrada/);
    await expect(q(`update crt_lancamentos_erp set excluido_no_erp_em = null, excluido_no_erp_por = null, motivo_exclusao_erp = null where id = $1`, [lancado])).rejects.toThrow(/já foi registrada/);
  });
});
