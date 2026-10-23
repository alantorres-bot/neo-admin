import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import { montarTituloVt } from "@/lib/modulos/rh/vale-transporte/lancamento";

let db: PGlite;
let rhOperador: string, rhGestor: string;
let comp: string;
let itens: Linha[];

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const codigos = { codHistorico: 3, codPortador: 91, categoriaDoc: 17, grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, contaContabilDebito: 3101, contaContabilCredito: 2101 };
const vt = { codHistorico: 3, grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, contaContabilDebito: 3101, contaContabilCredito: 2101 };
const parametros = { categoriaDoc: 17, tipos: { vt }, portadores: [{ empregador: "oeste", forma: "pix", codPortador: 91, conta: "Conta Oeste" }] };
const salvarParametros = (usuario: string, p: unknown, vtLigado = false) => rpc(usuario, `select rh_salvar_parametros_lancamento($1::jsonb, $2, false)`, [JSON.stringify(p), vtLigado]);
const titulo = (i: Linha, mudar: Record<string, unknown> = {}) => ({
  item_id: i.id,
  payload: { ...montarTituloVt({ item: { id: i.id as string, cod_fornecedor: i.cod_fornecedor as string, nome: i.nome as string, valor: Number(i.valor), empregador: "OESTE", forma_pagamento: "pix" },
    competencia: "2026-11-01", dataPagamento: "2026-10-30", hoje: "2026-10-29", codigos }), ...mudar },
});
const reservar = (usuario: string, titulos: unknown[]) => rpc(usuario, `select rh_vt_reservar_lancamentos($1, $2::jsonb) as lote`, [comp, JSON.stringify(titulos)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  for (const cod of ["660", "658"]) {
    await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, tarifa) values ($1, 'OESTE', $2, 'PESSOA ' || $2::text, 'pix', 4.95)`, [empresa, cod]);
  }
  comp = (await rpc(rhOperador, `select rh_vt_abrir_competencia('2026-11-01', 21) as id`)).rows[0].id;
  itens = (await q(`select id, cod_fornecedor, nome, valor from rh_vt_itens where competencia_id = $1 order by cod_fornecedor`, [comp])).rows;
});

describe("contas a pagar no Consistem (0503)", () => {
  it("parâmetros (0521): só gestor; códigos completos por tipo; débito ≠ crédito; portador; não liga sem códigos", async () => {
    await expect(salvarParametros(rhOperador, parametros)).rejects.toThrow(/gestor/);
    await expect(salvarParametros(rhGestor, { ...parametros, tipos: { vt: { ...vt, contaFluxoCaixa: undefined } } })).rejects.toThrow(/todos os códigos do tipo vt/);
    await expect(salvarParametros(rhGestor, { ...parametros, tipos: { vt: { ...vt, contaContabilCredito: 3101 } } })).rejects.toThrow(/mesma/);
    await expect(salvarParametros(rhGestor, { ...parametros, tipos: { outro: vt } })).rejects.toThrow(/desconhecido/);
    await expect(salvarParametros(rhGestor, { ...parametros, portadores: [{ empregador: "OESTE", forma: "pix_neo_formas", codPortador: 91 }] })).rejects.toThrow(/Cada portador/);
    await expect(salvarParametros(rhGestor, { ...parametros, portadores: [...parametros.portadores, { empregador: "Oeste ", forma: "pix", codPortador: 92 }] })).rejects.toThrow(/repetido/);
    await expect(salvarParametros(rhGestor, { ...parametros, tipos: {} }, true)).rejects.toThrow(/antes de ligar/);
    await salvarParametros(rhGestor, parametros);
    expect((await q(`select rh_codigos_titulo('vt', 'Oeste', 'pix_neo_formas') as c`)).rows[0].c).toEqual(codigos);   // forma antiga = PIX
    expect((await q(`select rh_codigos_titulo('vt', 'OESTE', 'fopag') as c, rh_codigos_titulo('salario', 'OESTE', 'pix') as s`)).rows[0]).toEqual({ c: null, s: null });
  });

  it("reservar: só com a chave ligada e mês aprovado; confere valor, fornecedor e códigos", async () => {
    await expect(reservar(rhOperador, [titulo(itens[0])])).rejects.toThrow(/desligado/);
    await salvarParametros(rhGestor, parametros, true);
    await expect(reservar(rhOperador, [titulo(itens[0])])).rejects.toThrow(/esta ação não vale/);
    await rpc(rhOperador, `select rh_vt_enviar($1)`, [comp]);
    await rpc(rhGestor, `select rh_vt_aprovar($1)`, [comp]);
    await expect(reservar(rhOperador, [titulo(itens[0], { valorDocumento: 999 })])).rejects.toThrow(/não confere/);
    await expect(reservar(rhOperador, [titulo(itens[0], { codPortador: 1 })])).rejects.toThrow(/mudaram nos Parâmetros/);
    const lote = (await reservar(rhOperador, itens.map((i) => titulo(i)))).rows[0].lote;
    const r = (await q(`select ordem, situacao, valor::text from rh_vt_lancamentos_erp where lote = $1 order by ordem`, [lote])).rows;
    expect(r).toEqual([{ ordem: 1, situacao: "reservado", valor: "207.90" }, { ordem: 2, situacao: "reservado", valor: "207.90" }]);
    await expect(reservar(rhOperador, [titulo(itens[0])])).rejects.toThrow(/já foi lançado/);
  });

  it("envio: lançado com código; erro; payload imutável; reabrir recusa com título no Consistem", async () => {
    const [a, b] = (await q(`select id from rh_vt_lancamentos_erp order by ordem`)).rows.map((l) => l.id as string);
    await q(`select rh_vt_iniciar_envio_erp($1)`, [a]);
    await expect(q(`select rh_vt_iniciar_envio_erp($1)`, [a])).rejects.toThrow(/já enviado/);
    await q(`select rh_vt_concluir_lancamento_erp($1, '40001', '{}'::jsonb, null)`, [a]);
    await q(`select rh_vt_iniciar_envio_erp($1)`, [b]);
    await q(`select rh_vt_concluir_lancamento_erp($1, null, '{}'::jsonb, 'Fornecedor inativo')`, [b]);
    expect((await q(`select situacao::text, cod_lancamento_erp, erro from rh_vt_lancamentos_erp order by ordem`)).rows).toEqual([
      { situacao: "lancado", cod_lancamento_erp: "40001", erro: null }, { situacao: "erro", cod_lancamento_erp: null, erro: "Fornecedor inativo" },
    ]);
    await expect(q(`update rh_vt_lancamentos_erp set payload = '{}' where id = $1`, [a])).rejects.toThrow(/imutável/);
    await expect(rpc(rhGestor, `select rh_vt_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/1 título/);
    // o item com erro pode ser reservado de novo
    const lote2 = (await reservar(rhOperador, [titulo(itens[1])])).rows[0].lote;
    expect(lote2).toBeTruthy();
  });

  it("incerto resolvido à mão com o código conferido", async () => {
    const id = (await q(`select id from rh_vt_lancamentos_erp where situacao = 'reservado'`)).rows[0].id;
    await q(`select rh_vt_iniciar_envio_erp($1)`, [id]);
    await expect(rpc(rhOperador, `select rh_vt_resolver_lancamento($1, '40002', 'x')`, [id])).rejects.toThrow(/o que foi conferido/);
    await rpc(rhOperador, `select rh_vt_resolver_lancamento($1, '40002', 'achei no Consistem')`, [id]);
    expect((await q(`select situacao::text, cod_lancamento_erp, resolvido_por from rh_vt_lancamentos_erp where id = $1`, [id])).rows[0]).toEqual({ situacao: "lancado", cod_lancamento_erp: "40002", resolvido_por: rhOperador });
  });

  it("cancelar (0523): só gestor, com motivo, só de lançado; libera reabrir e lançar de novo; preserva a resolução", async () => {
    const lancados = (await q(`select id, cod_lancamento_erp from rh_vt_lancamentos_erp where situacao = 'lancado' order by cod_lancamento_erp`)).rows;
    expect(lancados.map((l) => l.cod_lancamento_erp)).toEqual(["40001", "40002"]);
    const [a, b] = lancados.map((l) => l.id as string);
    const erro = (await q(`select id from rh_vt_lancamentos_erp where situacao = 'erro' limit 1`)).rows[0].id;
    await expect(rpc(rhOperador, `select rh_vt_cancelar_lancamento($1, 'excluído no Consistem')`, [a])).rejects.toThrow(/gestor/);
    await expect(rpc(rhGestor, `select rh_vt_cancelar_lancamento($1, 'x')`, [a])).rejects.toThrow(/motivo/);
    await expect(rpc(rhGestor, `select rh_vt_cancelar_lancamento($1, 'excluído no Consistem')`, [erro])).rejects.toThrow(/Só um título lançado/);
    await expect(q(`update rh_vt_lancamentos_erp set situacao = 'cancelado' where id = $1`, [a])).rejects.toThrow(/data e motivo/);
    await rpc(rhGestor, `select rh_vt_cancelar_lancamento($1, 'excluído no Consistem em 23/10')`, [a]);
    await expect(rpc(rhGestor, `select rh_vt_reabrir($1, 'teste')`, [comp])).rejects.toThrow(/1 título/);
    await rpc(rhGestor, `select rh_vt_cancelar_lancamento($1, 'excluído no Consistem em 23/10')`, [b]);
    expect((await q(`select situacao::text, cancelado_por, motivo_cancelamento, resolvido_por from rh_vt_lancamentos_erp where id = $1`, [b])).rows[0])
      .toEqual({ situacao: "cancelado", cancelado_por: rhGestor, motivo_cancelamento: "excluído no Consistem em 23/10", resolvido_por: rhOperador });
    await expect(rpc(rhGestor, `select rh_vt_cancelar_lancamento($1, 'de novo')`, [a])).rejects.toThrow(/Só um título lançado/);
    await expect(q(`update rh_vt_lancamentos_erp set situacao = 'lancado' where id = $1`, [a])).rejects.toThrow(/inválida/);
    await rpc(rhGestor, `select rh_vt_reabrir($1, 'título excluído no Consistem')`, [comp]);
    expect((await q(`select status from rh_vt_competencias where id = $1`, [comp])).rows[0].status).toBe("aberta");
  });
});
