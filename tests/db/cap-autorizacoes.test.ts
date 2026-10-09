import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finOperador2: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

/** Lançamento em aberto no espelho (gravado como a Edge Function grava: service role). */
async function lancamento(tipo: "C" | "A" | "D", valor: number, extra: { vencimento?: string | null; pagamento?: string | null; emissao?: string; fornecedor?: string } = {}) {
  const n = ++contador;
  const r = await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, data_pagamento, valor_documento, valor_atualizado, complemento_historico)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'HIST ' || $2) returning id`,
    [empresa, `L${n}`, tipo, extra.fornecedor ?? "382", `DOC${n}`, extra.emissao ?? "2026-10-01", extra.vencimento === undefined ? (tipo === "A" ? null : "2026-10-20") : extra.vencimento, extra.pagamento ?? null, valor],
  ));
  return r.rows[0].id as string;
}
const criar = (usuario: string, ids: string[], opcoes: { observacao?: string; data?: string; autorizar?: boolean } = {}) =>
  rpc(usuario, `select cap_criar_autorizacao($1, $2::uuid[], $3, $4, $5) as r`, [empresa, ids, opcoes.observacao ?? null, opcoes.data ?? null, opcoes.autorizar ?? false]);
const status = async (id: string) => (await q(`select status, numero, autorizada_por, cancelada_por, motivo_cancelamento from cap_autorizacoes where id = $1`, [id])).rows[0];
const pendencias = async (id: string) => (await q(`select titulo, status, prazo::text as prazo, criticidade, link from pendencias where referencia_tabela = 'cap_autorizacoes' and referencia_id = $1 order by criado_em`, [id])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finOperador2 = await novoUsuario(db, "operador2@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp, cnpj) values ('Neo Teste Ltda', 'Neo', '1', '17.209.767/0001-28') returning id`)).rows[0].id;
  await como(db, "service", () => q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, documento) values ($1, '382', 'PERFILADOS MULTIACO', '02.019.067/0001-01')`, [empresa]));
});

describe("criar autorização (rascunho)", () => {
  it("operador monta o rascunho com cópia dos itens, numeração sequencial e totais por tipo", async () => {
    const t = await lancamento("C", 2525.44, { vencimento: "2026-10-15" });
    const a = await lancamento("A", 46728.9, { pagamento: "2026-10-09" });
    const r = (await criar(finOperador, [t, a], { observacao: "Pagamentos da semana" })).rows[0].r;
    expect(r).toMatchObject({ numero: 1, itens: 2, total_titulos: 2525.44, total_antecipacoes: 46728.9, status: "rascunho" });
    const itens = (await q(`select tipo, cod_lancamento, fornecedor_nome, fornecedor_documento, valor, complemento_historico, ordem from cap_autorizacao_itens where autorizacao_id = $1 order by ordem`, [r.id])).rows;
    expect(itens.map((i) => [i.tipo, i.fornecedor_nome, i.fornecedor_documento, Number(i.valor)])).toEqual([
      ["titulo", "PERFILADOS MULTIACO", "02.019.067/0001-01", 2525.44],
      ["antecipacao", "PERFILADOS MULTIACO", "02.019.067/0001-01", 46728.9],
    ]);
    expect((await status(r.id)).status).toBe("rascunho");
    const vw = (await rpc(finConsulta, `select numero, itens, titulos, antecipacoes, total, criado_por_nome, empresa_nome from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect(vw).toMatchObject({ numero: 1, itens: 2, titulos: 1, antecipacoes: 1, empresa_nome: "Neo" });
    expect(Number(vw.total)).toBe(49254.34);
    // o segundo rascunho recebe o número 2
    const t2 = await lancamento("C", 10);
    expect((await criar(finOperador, [t2])).rows[0].r.numero).toBe(2);
  });
  it("recusa: consulta, lista vazia, crédito (D), lançamento baixado e lançamento já em autorização ativa", async () => {
    const t = await lancamento("C", 10);
    await expect(criar(finConsulta, [t])).rejects.toThrow(/Somente operador/);
    await expect(criar(finOperador, [])).rejects.toThrow(/pelo menos um item/);
    const d = await lancamento("D", 10);
    await expect(criar(finOperador, [d])).rejects.toThrow(/já saiu dos abertos|não é título/);
    const baixado = await lancamento("C", 10);
    await como(db, "service", () => q(`update cap_lancamentos set baixado_em = current_date, valor_atualizado = 0 where id = $1`, [baixado]));
    await expect(criar(finOperador, [baixado])).rejects.toThrow(/já saiu dos abertos/);
    const r = (await criar(finOperador, [t])).rows[0].r;
    await expect(criar(finOperador, [t])).rejects.toThrow(new RegExp(`já está na autorização nº ${r.numero}`));
  });
  it("a tela lista o pendente com a autorização ativa; o lançamento some da lista quando a autorização é cancelada? não: volta a ficar livre", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finOperador, [t])).rows[0].r;
    const antes = (await rpc(finConsulta, `select autorizacao_numero, autorizacao_status from cap_vw_pendentes where id = $1`, [t])).rows[0];
    expect(antes).toEqual({ autorizacao_numero: r.numero, autorizacao_status: "rascunho" });
    await rpc(finOperador, `select cap_cancelar($1, 'teste')`, [r.id]);
    const depois = (await rpc(finConsulta, `select autorizacao_numero from cap_vw_pendentes where id = $1`, [t])).rows[0];
    expect(depois.autorizacao_numero).toBeNull();
    expect((await criar(finOperador, [t])).rows[0].r.status).toBe("rascunho"); // pode entrar em outra
  });
});

describe("autorizar, cancelar e pendência", () => {
  it("operador não autoriza; gestor autoriza e a pendência 'Executar autorização' nasce com prazo = menor vencimento", async () => {
    const t = await lancamento("C", 100, { vencimento: "2099-01-20" });
    const a = await lancamento("A", 50, { pagamento: "2099-01-10" });
    const r = (await criar(finOperador, [t, a])).rows[0].r;
    await expect(rpc(finOperador, `select cap_autorizar($1)`, [r.id])).rejects.toThrow(/Somente gestor/);
    const ok = (await rpc(finGestor, `select cap_autorizar($1) as r`, [r.id])).rows[0].r;
    expect(ok).toMatchObject({ numero: r.numero, itens: 2, total: 150, prazo: "2099-01-10" });
    const s = await status(r.id);
    expect(s.status).toBe("autorizada");
    expect(s.autorizada_por).toBe(finGestor);
    const p = await pendencias(r.id);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ titulo: `Executar autorização de pagamento nº ${r.numero} — R$ 150,00`, status: "aberta", criticidade: "normal", link: `/financeiro/contas-pagar/autorizacoes/${r.id}` });
    // autorizar de novo não repete
    await expect(rpc(finGestor, `select cap_autorizar($1)`, [r.id])).rejects.toThrow(/já autorizada|não encontrada/);
    expect(await pendencias(r.id)).toHaveLength(1);
  });
  it("prazo no passado vira hoje e a criticidade fica alta", async () => {
    const t = await lancamento("C", 100, { vencimento: "2020-01-01" });
    const r = (await criar(finGestor, [t], { autorizar: true })).rows[0].r;
    expect(r.status).toBe("autorizada");
    const p = (await pendencias(r.id))[0];
    expect(p.criticidade).toBe("alta");
    expect(p.prazo).toBe((await q(`select (now() at time zone 'America/Cuiaba')::date::text as d`)).rows[0].d);
  });
  it("quem montou pode autorizar a própria autorização (gestor)", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finGestor, [t])).rows[0].r;
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    expect((await status(r.id)).status).toBe("autorizada");
  });
  it("cancelar: exige motivo, cancela a pendência, nada é apagado; operador cancela só o próprio rascunho", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finOperador, [t])).rows[0].r;
    await expect(rpc(finOperador, `select cap_cancelar($1, '  ')`, [r.id])).rejects.toThrow(/motivo/);
    await expect(rpc(finOperador2, `select cap_cancelar($1, 'não é meu')`, [r.id])).rejects.toThrow(/Só gestor/);
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    await expect(rpc(finOperador, `select cap_cancelar($1, 'tentando')`, [r.id])).rejects.toThrow(/Só gestor/);
    const c = (await rpc(finGestor, `select cap_cancelar($1, 'Pagamento adiado pela diretoria') as r`, [r.id])).rows[0].r;
    expect(c).toMatchObject({ numero: r.numero, pendencias_canceladas: 1 });
    const s = await status(r.id);
    expect(s).toMatchObject({ status: "cancelada", cancelada_por: finGestor, motivo_cancelamento: "Pagamento adiado pela diretoria" });
    expect((await pendencias(r.id))[0].status).toBe("cancelada");
    await expect(rpc(finGestor, `select cap_cancelar($1, 'de novo')`, [r.id])).rejects.toThrow(/já cancelada|não encontrada/);
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'cap_autorizacoes' and registro_id = $1`, [r.id])).rows[0].n).toBeGreaterThanOrEqual(3);
  });
  it("update direto de status, campos imutáveis e delete são barrados", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finOperador, [t])).rows[0].r;
    await expect(rpc(finOperador, `update cap_autorizacoes set status = 'autorizada' where id = $1`, [r.id])).rejects.toThrow(/Somente gestor/);
    await rpc(finOperador, `update cap_autorizacoes set numero = 999, observacao = 'ok' where id = $1`, [r.id]);
    expect((await status(r.id)).numero).toBe(r.numero);
    // sem política de delete, a RLS não alcança nenhuma linha; e mesmo a service role é barrada pelo gatilho
    expect((await rpc(finGestor, `delete from cap_autorizacoes where id = $1 returning id`, [r.id])).rows).toHaveLength(0);
    await expect(como(db, "service", () => q(`delete from cap_autorizacoes where id = $1`, [r.id]))).rejects.toThrow(/não podem ser excluídos/);
    await expect(como(db, "service", () => q(`delete from cap_autorizacao_itens where autorizacao_id = $1`, [r.id]))).rejects.toThrow(/não podem ser excluídos/);
    await expect(rpc(finOperador, `update cap_autorizacao_itens set valor = 1 where autorizacao_id = $1`, [r.id])).rejects.toThrow(/imutáveis/);
  });
  it("autorização sem itens (todos removidos) não pode ser autorizada", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finOperador, [t])).rows[0].r;
    const item = (await q(`select id from cap_autorizacao_itens where autorizacao_id = $1`, [r.id])).rows[0].id;
    await expect(rpc(finOperador, `select cap_remover_item($1, '')`, [item])).rejects.toThrow(/motivo/);
    expect((await rpc(finOperador, `select cap_remover_item($1, 'fornecedor pediu para segurar') as r`, [item])).rows[0].r).toEqual({ restantes: 0 });
    await expect(rpc(finGestor, `select cap_autorizar($1)`, [r.id])).rejects.toThrow(/não tem itens/);
    // o lançamento voltou a ficar livre
    expect((await rpc(finConsulta, `select autorizacao_numero from cap_vw_pendentes where id = $1`, [t])).rows[0].autorizacao_numero).toBeNull();
  });
  it("item não sai de autorização autorizada", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finGestor, [t], { autorizar: true })).rows[0].r;
    const item = (await q(`select id from cap_autorizacao_itens where autorizacao_id = $1`, [r.id])).rows[0].id;
    await expect(rpc(finGestor, `select cap_remover_item($1, 'tarde demais')`, [item])).rejects.toThrow(/rascunho/);
  });
  it("a service role anota a baixa no Consistem no item (e só isso)", async () => {
    const t = await lancamento("C", 10);
    const r = (await criar(finGestor, [t], { autorizar: true })).rows[0].r;
    await como(db, "service", () => q(`update cap_autorizacao_itens set baixado_consistem_em = current_date where lancamento_id = $1`, [t]));
    expect((await rpc(finConsulta, `select baixados from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0].baixados).toBe(1);
    await expect(como(db, "service", () => q(`update cap_autorizacao_itens set valor = 1 where lancamento_id = $1`, [t]))).rejects.toThrow(/imutáveis/);
  });
});

describe("antecipações tratadas e corte", () => {
  it("marca antecipação como paga fora (motivo obrigatório; só tipo A; não em autorização ativa), some da lista e pode ser desfeita", async () => {
    const a = await lancamento("A", 500);
    const t = await lancamento("C", 10);
    await expect(rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, '')`, [a])).rejects.toThrow(/motivo/);
    await expect(rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, 'x')`, [t])).rejects.toThrow(/Só antecipações/);
    await expect(rpc(finConsulta, `select cap_marcar_antecipacao_tratada($1, 'x')`, [a])).rejects.toThrow(/row-level security|permissão/);
    const m = (await rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, 'Paga em 02/10 pelo borderô 123') as r`, [a])).rows[0].r;
    expect((await rpc(finConsulta, `select tratada_id, tratada_motivo from cap_vw_pendentes where id = $1`, [a])).rows[0]).toMatchObject({ tratada_id: m.id, tratada_motivo: "Paga em 02/10 pelo borderô 123" });
    await expect(criar(finOperador, [a])).rejects.toThrow(/marcada como já paga/);
    await expect(rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, 'de novo')`, [a])).rejects.toThrow(/já está marcada/);
    await rpc(finOperador, `select cap_desfazer_antecipacao_tratada($1, 'engano')`, [m.id]);
    expect((await rpc(finConsulta, `select tratada_id from cap_vw_pendentes where id = $1`, [a])).rows[0].tratada_id).toBeNull();
    const r = (await criar(finOperador, [a])).rows[0].r;
    await expect(rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, 'x')`, [a])).rejects.toThrow(new RegExp(`autorização nº ${r.numero}`));
  });
  it("data de corte: só gestor altera; antecipação anterior ao corte não entra", async () => {
    await expect(rpc(finOperador, `select cap_salvar_parametros('{"financeiro.contas-pagar.antecipacoes_a_partir_de": "2026-10-01"}')`)).rejects.toThrow(/Somente gestor/);
    await expect(rpc(finGestor, `select cap_salvar_parametros('{"financeiro.contas-pagar.antecipacoes_a_partir_de": "01/10/2026"}')`)).rejects.toThrow(/Data inválida/);
    await expect(rpc(finGestor, `select cap_salvar_parametros('{"outra": 1}')`)).rejects.toThrow(/não permitido/);
    await rpc(finGestor, `select cap_salvar_parametros('{"financeiro.contas-pagar.antecipacoes_a_partir_de": "2026-10-01"}')`);
    expect((await q(`select valor from configuracoes where chave = 'financeiro.contas-pagar.antecipacoes_a_partir_de'`)).rows[0].valor).toBe("2026-10-01");
    const antiga = await lancamento("A", 100, { pagamento: "2026-09-15", emissao: "2026-09-15" });
    const nova = await lancamento("A", 100, { pagamento: "2026-10-05" });
    await expect(criar(finOperador, [antiga])).rejects.toThrow(/anterior à data de corte/);
    expect((await criar(finOperador, [nova])).rows[0].r.itens).toBe(1);
    await rpc(finGestor, `select cap_salvar_parametros('{"financeiro.contas-pagar.antecipacoes_a_partir_de": null}')`);
  });
});
