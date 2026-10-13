import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Migration 0162: troca do portador dos títulos da fatura do cartão no Consistem ao fechar o mês (código por cartão).

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, fatura: string, ciclo: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const titulos = (...cods: string[]) => JSON.stringify(cods.map((c) => ({ cod_lancamento: c, num_documento: `D${c}`, fornecedor: "LOJA", valor: 10.5, portador_atual: 91 })));
const reservar = (u: string, ...cods: string[]) => rpc(u, `select crt_reservar_trocas($1, $2::jsonb) as lote`, [ciclo, titulos(...cods)]);
const troca = (cod: string) => q(`select * from crt_trocas_portador where ciclo_id = $1 and cod_lancamento = $2`, [ciclo, cod]).then((r) => r.rows[0]);
const pendencia = () => q(`select status, descricao from pendencias where referencia_id = $1 and titulo like 'Trocar o banco dos títulos%' order by criado_em desc limit 1`, [ciclo]).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([{ ordem: 1, descricao: "LOJA", valor: 21, descartada: false }]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PJ', '2026-10-23', 21, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  ciclo = (await q(`select ciclo_id from crt_faturas where id = $1`, [fatura])).rows[0].ciclo_id;
});

describe("troca do portador da fatura (0162)", () => {
  it("coluna no cartão (só gestor altera) e chave começa desligada", async () => {
    expect((await q(`select valor from configuracoes where chave = 'financeiro.cartao.trocar_portador_no_erp'`)).rows[0].valor).toBe(false);
    // Códigos carregados pela 0163 (planilha de portadores do Consistem).
    expect((await q(`select string_agg(codigo || '=' || portador_fatura, ',' order by codigo) as c from crt_cartoes`)).rows[0].c)
      .toBe("INTER PF=993,INTER PJ=997,ITAU PJ=990,NUBANK PF=991,PICPAY PF=996,SICREDI PF=995,SICREDI PJ=992,UNICRED PF=994");
    await rpc(finOperador, `update crt_cartoes set portador_fatura = 501 where codigo = 'SICREDI PJ'`); // RLS: não altera
    expect((await q(`select portador_fatura from crt_cartoes where codigo = 'SICREDI PJ'`)).rows[0].portador_fatura).toBe(992);
    await expect(q(`update crt_cartoes set portador_fatura = 0 where codigo = 'SICREDI PJ'`)).rejects.toThrow(/portador_fatura_ck/);
    await rpc(finGestor, `update crt_cartoes set portador_fatura = 501 where codigo = 'SICREDI PJ'`);
    expect((await q(`select portador_fatura from crt_cartoes where codigo = 'SICREDI PJ'`)).rows[0].portador_fatura).toBe(501);
  });

  it("reserva: chave ligada, operador, mês fechado, cartão com código", async () => {
    await expect(reservar(finOperador, "33626")).rejects.toThrow(/desligada/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.trocar_portador_no_erp'`);
    await expect(reservar(finConsulta, "33626")).rejects.toThrow(/Somente operador/);
    await expect(reservar(finOperador, "33626")).rejects.toThrow(/mês fechado/);
    await rpc(finGestor, `select crt_fechar_ciclo($1, '{}'::jsonb, 0, 0, 21, 21, null)`, [ciclo]);
    await q(`update crt_cartoes set portador_fatura = null where codigo = 'SICREDI PJ'`);
    await expect(reservar(finOperador, "33626")).rejects.toThrow(/não tem o código do banco/);
    await q(`update crt_cartoes set portador_fatura = 501 where codigo = 'SICREDI PJ'`);
    await expect(reservar(finOperador, "12a")).rejects.toThrow(/Código de lançamento inválido/);
  });

  it("um título por mês; trocado fica; erro entra no lote novo e a pendência abre e fecha", async () => {
    const lote = (await reservar(finOperador, "33626", "33627")).rows[0].lote as string;
    expect(lote).toBeTruthy();
    expect((await reservar(finOperador, "33626")).rows[0].lote).toBeTruthy(); // reservado de novo (envio abandonado): novo lote
    const a = await troca("33626");
    const b = await troca("33627");
    expect([a.portador_anterior, a.portador_novo, a.situacao, a.num_documento]).toEqual([91, 501, "reservado", "D33626"]);

    // Usuário não envia (só a service role).
    await expect(rpc(finOperador, `select crt_iniciar_troca($1)`, [a.id])).rejects.toThrow();
    await servico(`select crt_iniciar_troca($1)`, [a.id]);
    await servico(`select crt_concluir_troca($1, true, 91, 2, '{"codPortador":91}'::jsonb, '{"codPortador":501}'::jsonb, null, null)`, [a.id]);
    await servico(`select crt_iniciar_troca($1)`, [b.id]);
    await servico(`select crt_concluir_troca($1, false, 91, 2, null, null, null, 'O Consistem recusou (HTTP 400).')`, [b.id]);
    expect((await troca("33626")).situacao).toBe("trocado");
    expect((await troca("33627")).erro).toMatch(/recusou/);
    const p = await pendencia();
    expect(p.status).toBe("aberta");
    expect(p.descricao).toMatch(/1 título da fatura não teve o banco trocado para 501/);

    await expect(servico(`update crt_trocas_portador set situacao = 'erro' where cod_lancamento = '33626'`)).rejects.toThrow(/já foi trocado/);
    await expect(servico(`delete from crt_trocas_portador where cod_lancamento = '33626'`)).rejects.toThrow();

    const novo = (await reservar(finOperador, "33626", "33627")).rows[0].lote as string;
    expect((await troca("33626")).situacao).toBe("trocado");
    const b2 = await troca("33627");
    expect([b2.situacao, b2.lote, b2.erro]).toEqual(["reservado", novo, null]);
    await servico(`select crt_iniciar_troca($1)`, [b2.id]);
    await servico(`select crt_concluir_troca($1, true, 91, 2, null, null, null, null)`, [b2.id]);
    expect((await troca("33627")).tentativas).toBe(2);
    expect((await pendencia()).status).toBe("concluida");
    expect((await reservar(finOperador, "33626", "33627")).rows[0].lote).toBeNull(); // nada a fazer
  });

  it("falha do envio pelo painel: reservados viram erro e abrem a pendência", async () => {
    const lote = (await reservar(finOperador, "33700")).rows[0].lote as string;
    await rpc(finOperador, `select crt_falha_trocas($1, 'A função não respondeu.')`, [lote]);
    expect((await troca("33700")).situacao).toBe("erro");
    expect((await pendencia()).status).toBe("aberta");
  });

  it("histórico da fatura (0164): o cartão ganha outro histórico e o trocado volta à fila só por isso", async () => {
    expect((await q(`select historico_fatura from crt_cartoes where codigo = 'SICREDI PJ'`)).rows[0].historico_fatura).toBe(80);
    expect((await troca("33626")).historico_novo).toBe(80);
    await q(`update crt_cartoes set historico_fatura = 81 where codigo = 'SICREDI PJ'`);
    const lote = (await reservar(finOperador, "33626")).rows[0].lote as string;
    const t = await troca("33626");
    expect([t.situacao, t.historico_novo, t.lote]).toEqual(["reservado", 81, lote]);
    await servico(`select crt_iniciar_troca($1)`, [t.id]);
    await servico(`select crt_concluir_troca($1, false, 992, 2, null, null, null, 'recusado')`, [t.id]);
    expect((await troca("33626")).historico_anterior).toBe(2);
    expect((await pendencia()).descricao).toMatch(/banco trocado para 501 e o histórico para 8[01]/);
    // Trocado com o mesmo alvo não volta (nem por update direto).
    await expect(servico(`update crt_trocas_portador set situacao = 'reservado' where cod_lancamento = '33627'`)).rejects.toThrow(/já foi trocado/);
  });
});
