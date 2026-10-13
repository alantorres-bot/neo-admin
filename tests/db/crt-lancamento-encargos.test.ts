import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let fatura: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const payload = (valor: number, complemento = "CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS") => JSON.stringify({ valorDocumento: valor, complementoHistorico: complemento, codFornecedor: 80 });
const reservar = (u: string, linhas: string[], valor: number, complemento = "CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS", corpo = payload(valor, complemento)) =>
  rpc(u, `select crt_reservar_lancamento_encargos($1, $2::uuid[], $3, $4, $5::jsonb) as id`, [fatura, linhas, valor, complemento, corpo]);
const ligar = (v: boolean) => q(`update configuracoes set valor = $1::jsonb where chave = 'financeiro.cartao.lancar_encargos_no_erp'`, [String(v)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "IOF COMPRA INTERNACIONAL", valor: 12.34, descartada: false },
    { ordem: 2, descricao: "JUROS DE MORA", valor: 50, descartada: false },
    { ordem: 3, descricao: "SUPERMERCADO", valor: 100, descartada: false },
    { ordem: 4, descricao: "Pagamento", valor: -500, descartada: true },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PF', '2026-10-10', 162.34, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
});

describe("configuração (0137)", () => {
  it("cartões com os códigos dos lançamentos manuais; código inválido é recusado; chave geral começa desligada", async () => {
    const sicredi = (await q(`select lancamento_encargos as j from crt_cartoes where codigo = 'SICREDI PF'`)).rows[0].j;
    expect(sicredi).toEqual({ codFornecedor: 80, codHistorico: 2, codPortador: 91, categoriaDoc: 17, grupoContaFluxoCaixa: 22, contaFluxoCaixa: 28, contaContabilDebito: 3473, contaContabilCredito: 2004 });
    expect((await q(`select count(*)::int as n from crt_cartoes where lancamento_encargos is null`)).rows[0].n).toBe(0);
    await expect(q(`update crt_cartoes set lancamento_encargos = lancamento_encargos - 'codHistorico' where codigo = 'INTER PF'`)).rejects.toThrow(/lancamento_encargos_ck/);
    await expect(q(`update crt_cartoes set lancamento_encargos = jsonb_set(lancamento_encargos, '{codPortador}', '1.5') where codigo = 'INTER PF'`)).rejects.toThrow(/lancamento_encargos_ck/);
    expect((await q(`select valor from configuracoes where chave = 'financeiro.cartao.lancar_encargos_no_erp'`)).rows[0].valor).toBe(false);
  });
});

describe("reservar, enviar e concluir", () => {
  it("desligado recusa; consulta não lança; valor e linhas conferidos", async () => {
    await expect(reservar(finOperador, [linha[1], linha[2]], 62.34)).rejects.toThrow(/desligado/);
    await ligar(true);
    await expect(reservar(finConsulta, [linha[1], linha[2]], 62.34)).rejects.toThrow(/Somente operador/);
    await expect(reservar(finOperador, [linha[1], linha[2]], 60)).rejects.toThrow(/não confere com a soma/);
    await expect(reservar(finOperador, [linha[1], linha[4]], 12.34)).rejects.toThrow(/descartada/);
    await expect(reservar(finOperador, [linha[1], linha[2]], 62.34, "CARTÃO X", payload(62.34, "OUTRO"))).rejects.toThrow(/não confere com o valor e o complemento/);
    await expect(reservar(finOperador, [], 0)).rejects.toThrow(/Nenhuma linha/);
  });
  it("linha com decisão de justificar não entra", async () => {
    const d = (await rpc(finOperador, `select crt_registrar_decisao($1, 'justificar', array[$2]::uuid[], '{}', null, null, 'já pago') as id`, [fatura, linha[2]])).rows[0].id;
    await expect(reservar(finOperador, [linha[1], linha[2]], 62.34)).rejects.toThrow(/já tem decisão/);
    await rpc(finOperador, `select crt_desfazer_decisao($1, 'engano')`, [d]);
  });
  it("um lançamento ativo por mês; só a service role envia; erro libera nova tentativa", async () => {
    const id = (await reservar(finOperador, [linha[1], linha[2]], 62.34)).rows[0].id;
    await expect(reservar(finGestor, [linha[1], linha[2]], 62.34)).rejects.toThrow(/já tem lançamento de encargos/);
    await expect(rpc(finOperador, `select crt_iniciar_envio_encargos($1)`, [id])).rejects.toThrow(/permission denied/);
    expect((await servico(`select (crt_iniciar_envio_encargos($1)).situacao as s`, [id])).rows[0].s).toBe("enviando");
    await expect(servico(`select crt_iniciar_envio_encargos($1)`, [id])).rejects.toThrow(/já enviado/);
    await servico(`select crt_concluir_lancamento_encargos($1, null, '{"mensagem":"Fornecedor inválido"}'::jsonb, 'Consistem HTTP 400: Fornecedor inválido')`, [id]);
    expect((await q(`select situacao, erro from crt_lancamentos_erp where id = $1`, [id])).rows[0]).toEqual({ situacao: "erro", erro: "Consistem HTTP 400: Fornecedor inválido" });
    await expect(servico(`select crt_concluir_lancamento_encargos($1, '1', null, null)`, [id])).rejects.toThrow(/não está em envio/);
  });
  it("lançado grava o código e casa as linhas com o título; prova imutável e sem delete", async () => {
    const id = (await reservar(finGestor, [linha[1], linha[2]], 62.34)).rows[0].id;
    await servico(`select crt_iniciar_envio_encargos($1)`, [id]);
    await servico(`select crt_concluir_lancamento_encargos($1, '40001', '{"codLancamento":40001}'::jsonb, null)`, [id]);
    expect((await q(`select situacao, cod_lancamento_erp from crt_lancamentos_erp where id = $1`, [id])).rows[0]).toEqual({ situacao: "lancado", cod_lancamento_erp: "40001" });
    const casar = (await rpc(finConsulta, `select tipo, linhas, titulos, criado_por_nome, motivo from crt_vw_decisoes where fatura_id = $1 and tipo = 'casar' and desfeito_em is null`, [fatura])).rows;
    expect(casar).toHaveLength(1);
    expect(casar[0]).toMatchObject({ titulos: ["40001"], criado_por_nome: "gestor" });
    expect([...casar[0].linhas].sort()).toEqual([linha[1], linha[2]].sort());
    expect(casar[0].motivo).toMatch(/lançamento 40001 \(R\$ 62,34\)/);
    await expect(servico(`update crt_lancamentos_erp set valor = 1 where id = $1`, [id])).rejects.toThrow(/imutável/);
    await expect(servico(`update crt_lancamentos_erp set situacao = 'erro' where id = $1`, [id])).rejects.toThrow(/inválida|concluído/);
    await expect(servico(`delete from crt_lancamentos_erp where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    await expect(reservar(finOperador, [linha[3]], 100)).rejects.toThrow(/no Consistem \(40001\)/);
    expect((await rpc(finConsulta, `select count(*)::int as n from crt_vw_lancamentos_erp`)).rows[0].n).toBe(2);
  });
});

describe("resposta incerta resolvida à mão", () => {
  it("enviando sem resposta: operador informa o código conferido (ou que não foi criado), com motivo", async () => {
    // O mês do primeiro banco já tem lançamento; aqui um banco novo, com outro cartão.
    const db2 = await criarBanco();
    const op = await novoUsuario(db2, "op@neo.com", { financeiro: "operador" });
    const empresa = (await db2.query<Linha>(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
    await db2.query(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_encargos_no_erp'`);
    const ls = JSON.stringify([{ ordem: 1, descricao: "IOF", valor: 10, descartada: false }]);
    const f = (await como(db2, op, () => db2.query<Linha>(`select crt_importar_fatura($1, 'INTER PJ', '2026-10-10', 10, 'generico', 'f.pdf', $2::jsonb) as id`, [empresa, ls]))).rows[0].id;
    const l1 = (await db2.query<Linha>(`select id from crt_fatura_linhas where fatura_id = $1`, [f])).rows[0].id;
    const p = JSON.stringify({ valorDocumento: 10, complementoHistorico: "C" });
    const res = (sql: string, args: unknown[]) => como(db2, op, () => db2.query<Linha>(sql, args));
    const a = (await res(`select crt_reservar_lancamento_encargos($1, array[$2]::uuid[], 10, 'C', $3::jsonb) as id`, [f, l1, p])).rows[0].id;
    await como(db2, "service", () => db2.query(`select crt_iniciar_envio_encargos($1)`, [a]));
    await expect(res(`select crt_resolver_lancamento_encargos($1, '123', '')`, [a])).rejects.toThrow(/o que foi conferido/);
    await expect(res(`select crt_resolver_lancamento_encargos($1, 'abc', 'conferido')`, [a])).rejects.toThrow(/só números/);
    await res(`select crt_resolver_lancamento_encargos($1, null, 'não aparece no Consistem')`, [a]);
    expect((await db2.query<Linha>(`select situacao, motivo_resolucao from crt_lancamentos_erp where id = $1`, [a])).rows[0]).toEqual({ situacao: "erro", motivo_resolucao: "não aparece no Consistem" });
    const b = (await res(`select crt_reservar_lancamento_encargos($1, array[$2]::uuid[], 10, 'C', $3::jsonb) as id`, [f, l1, p])).rows[0].id;
    await res(`select crt_resolver_lancamento_encargos($1, '777', 'achei no Consistem: lançamento 777')`, [b]);
    expect((await db2.query<Linha>(`select situacao, cod_lancamento_erp from crt_lancamentos_erp where id = $1`, [b])).rows[0]).toEqual({ situacao: "lancado", cod_lancamento_erp: "777" });
    expect((await db2.query<Linha>(`select titulos from crt_decisoes where fatura_id = $1 and tipo = 'casar'`, [f])).rows[0].titulos).toEqual(["777"]);
    await expect(res(`select crt_resolver_lancamento_encargos($1, null, 'de novo')`, [b])).rejects.toThrow(/sem resposta/);
    await db2.close();
  });
});
