import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0176: correções pela API (trocar cartão, acertar vencimento, trocar conta de fluxo) — reserva, envio e prova.
let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, faturaPic: string, cicloPic: string, cicloSic: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const reservar = (u: string, cod: string, tipo: string, alteracao: unknown, fatura = faturaPic) =>
  rpc(u, `select crt_reservar_correcao($1, $2, '10/1', $3::crt_tipo_correcao, $4::jsonb) as id`, [fatura, cod, tipo, JSON.stringify(alteracao)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([{ ordem: 1, descricao: "TQS*TQSSTORE", valor: 620, descartada: false }]);
  faturaPic = (await rpc(finOperador, `select crt_importar_fatura($1, 'PICPAY PF', '2026-10-26', 620, 'picpay', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  cicloPic = (await q(`select ciclo_id from crt_faturas where id = $1`, [faturaPic])).rows[0].ciclo_id;
  // Sicredi PJ 10/2026 já fechado com o título 245104 entre os conciliados.
  const faturaSic = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PJ', '2026-10-23', 100, 'sicredi', 'f.pdf', $2::jsonb) as id`,
    [empresa, JSON.stringify([{ ordem: 1, descricao: "LOJA", valor: 100, descartada: false }])])).rows[0].id;
  cicloSic = (await q(`select ciclo_id from crt_faturas where id = $1`, [faturaSic])).rows[0].ciclo_id;
  const foto = JSON.stringify({ resultado: { conciliados: [{ titulo: { codLancamento: "245104" }, titulosExtras: [] }, { titulo: { codLancamento: "1" }, titulosExtras: [{ codLancamento: "245200" }] }] } });
  await rpc(finGestor, `select crt_fechar_ciclo($1, $2::jsonb, 0, 0, 100, 100, null)`, [cicloSic, foto]);
});

describe("chave e reserva", () => {
  it("começa ligada; consulta não corrige; desligada recusa", async () => {
    expect((await q(`select valor from configuracoes where chave = 'financeiro.cartao.corrigir_no_erp'`)).rows[0].valor).toBe(true);
    await expect(reservar(finConsulta, "300", "vencimento", { dataVencimento: "2026-10-26" })).rejects.toThrow(/Somente operador/);
    await q(`update configuracoes set valor = 'false'::jsonb where chave = 'financeiro.cartao.corrigir_no_erp'`);
    await expect(reservar(finOperador, "300", "vencimento", { dataVencimento: "2026-10-26" })).rejects.toThrow(/desligadas/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.corrigir_no_erp'`);
  });

  it("cada tipo altera só os seus campos; conta de fluxo precisa estar ativa", async () => {
    await expect(reservar(finOperador, "300", "vencimento", { dataVencimento: "26/10/2026" })).rejects.toThrow(/só a data de vencimento/);
    await expect(reservar(finOperador, "300", "vencimento", { dataVencimento: "2026-10-26", valorDocumento: 1 })).rejects.toThrow(/só a data de vencimento/);
    const inativa = (await q(`select grupo, item from cap_contas_fluxo where not ativa limit 1`)).rows[0];
    const ativa = (await q(`select grupo, item from cap_contas_fluxo where ativa limit 1`)).rows[0];
    await expect(reservar(finOperador, "300", "conta_fluxo", { grupoContaFluxoCaixa: inativa.grupo, contaFluxoCaixa: inativa.item })).rejects.toThrow(/inativa/);
    const id = (await reservar(finOperador, "300", "conta_fluxo", { grupoContaFluxoCaixa: ativa.grupo, contaFluxoCaixa: ativa.item })).rows[0].id;
    expect(id).toBeTruthy();
    await expect(reservar(finGestor, "300", "conta_fluxo", { grupoContaFluxoCaixa: ativa.grupo, contaFluxoCaixa: ativa.item })).rejects.toThrow(/em andamento/);
    await expect(reservar(finOperador, "301", "cartao", { complementoHistorico: "X".repeat(61) })).rejects.toThrow(/1 a 60/);
    await expect(reservar(finOperador, "301", "cartao", { complementoHistorico: "CARTÃO PICPAY PF 1x — TQS", valorDocumento: 1 })).rejects.toThrow(/só o complemento/);
  });

  it("trocar cartão recusa título do fechamento vigente de outro cartão (mês fechado)", async () => {
    const alt = { complementoHistorico: "CARTÃO PICPAY PF 1x — TQS INFORMAT", dataVencimento: "2026-10-26", codPortador: 996 };
    await expect(reservar(finOperador, "245104", "cartao", alt)).rejects.toThrow(/SICREDI PJ 10\/2026/);
    await expect(reservar(finOperador, "245200", "cartao", alt)).rejects.toThrow(/fechamento do SICREDI PJ/);
    expect((await reservar(finOperador, "245999", "cartao", alt)).rows[0].id).toBeTruthy();
  });
});

describe("envio e prova", () => {
  it("só a service role envia; conclui com antes/depois; imutável e sem delete; mês fechado não aceita reserva", async () => {
    const id = (await reservar(finOperador, "400", "vencimento", { dataVencimento: "2026-10-26" })).rows[0].id;
    await expect(rpc(finOperador, `select crt_iniciar_correcao($1)`, [id])).rejects.toThrow(/permission denied/);
    expect((await servico(`select (crt_iniciar_correcao($1)).situacao as s`, [id])).rows[0].s).toBe("enviando");
    await servico(`select crt_concluir_correcao($1, true, '{"dataVencimento":"2026-10-28"}'::jsonb, '{"dataVencimento":"2026-10-26"}'::jsonb, null, null)`, [id]);
    const r = (await rpc(finConsulta, `select situacao, criado_por_nome, antes->>'dataVencimento' as a, depois->>'dataVencimento' as d from crt_vw_correcoes_erp where id = $1`, [id])).rows[0];
    expect(r).toEqual({ situacao: "corrigido", criado_por_nome: "operador", a: "2026-10-28", d: "2026-10-26" });
    await expect(servico(`update crt_correcoes_erp set erro = 'x' where id = $1`, [id])).rejects.toThrow(/já foi concluída/);
    await expect(servico(`delete from crt_correcoes_erp where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    // Uma nova correção do mesmo título e tipo é aceita depois da anterior concluída.
    expect((await reservar(finOperador, "400", "vencimento", { dataVencimento: "2026-10-26" })).rows[0].id).toBeTruthy();
    await rpc(finGestor, `select crt_fechar_ciclo($1, '{}'::jsonb, 0, 0, 620, 620, null)`, [cicloPic]);
    await expect(reservar(finOperador, "500", "vencimento", { dataVencimento: "2026-10-26" })).rejects.toThrow(/mês desta fatura está fechada|reabra/);
  });
});
