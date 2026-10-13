import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let fatura: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const corpo = (valor: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ codFornecedor: 1376, valorDocumento: valor, dataVencimento: "2026-10-23", complementoHistorico: "CARTÃO SICREDI PJ 1x — TRANSPORTE (3 LANÇ.)", ...extra });
const reservar = (u: string, linhas: string[], valor: number, extra: Record<string, unknown> = {}) =>
  rpc(u, `select crt_reservar_lancamento_agrupado($1, $2::uuid[], $3::jsonb) as lote`, [fatura, linhas, corpo(valor, extra)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "Dl Uberrides", valor: 29.67, descartada: false },
    { ordem: 2, descricao: "99", valor: 160.20, descartada: false },
    { ordem: 3, descricao: "Uber Pending", valor: 26, descartada: false },
    { ordem: 4, descricao: "J Drel Sistemas", valor: 515.25, parcela_num: 3, parcela_total: 4, descartada: false },
    { ordem: 5, descricao: "Estorno", valor: -10, descartada: false },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PJ', '2026-10-23', 721.12, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
});

describe("lançamento agrupado (0150)", () => {
  it("estabelecimento 99 com os códigos da Uber", async () => {
    const r = (await q(`select lancamento_erp, conta_fluxo from crt_estabelecimentos where padrao = '99'`)).rows[0];
    expect(r.lancamento_erp).toMatchObject({ codFornecedor: 1376, grupoContaFluxoCaixa: 13, contaFluxoCaixa: 5 });
    expect(r.conta_fluxo).toBe("Viagens e Lobby");
  });
  it("recusas: chave desligada, consulta, uma linha só, parcela, estorno, soma errada, sem fornecedor", async () => {
    const tres = [linha[1], linha[2], linha[3]];
    await expect(reservar(finOperador, tres, 215.87)).rejects.toThrow(/desligado/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
    await expect(reservar(finConsulta, tres, 215.87)).rejects.toThrow(/Somente operador/);
    await expect(reservar(finOperador, [linha[1]], 29.67)).rejects.toThrow(/duas linhas/);
    await expect(reservar(finOperador, [linha[1], linha[4]], 544.92)).rejects.toThrow(/parcelada/);
    await expect(reservar(finOperador, [linha[1], linha[5]], 19.67)).rejects.toThrow(/valor positivo/);
    await expect(reservar(finOperador, tres, 200)).rejects.toThrow(/soma das linhas \(R\$ 215,87\)/);
    await expect(reservar(finOperador, tres, 215.87, { codFornecedor: null })).rejects.toThrow(/fornecedor/);
  });
  it("um título para as três linhas; lançado casa todas; a linha não entra de novo; prova sem delete", async () => {
    const tres = [linha[1], linha[2], linha[3]];
    const lote = (await reservar(finOperador, tres, 215.87)).rows[0].lote;
    const r = (await q(`select id, tipo, valor, cardinality(linhas) as n from crt_lancamentos_erp where lote = $1`, [lote])).rows;
    expect(r).toMatchObject([{ tipo: "agrupado", valor: "215.87", n: 3 }]);
    await expect(reservar(finOperador, [linha[1], linha[2]], 189.87)).rejects.toThrow(/já foi lançada/);
    await servico(`select crt_iniciar_envio_erp($1)`, [r[0].id]);
    await servico(`select crt_concluir_lancamento_erp($1, '60001', null, null)`, [r[0].id]);
    const d = (await q(`select linhas, titulos, motivo from crt_decisoes where fatura_id = $1 and tipo = 'casar'`, [fatura])).rows[0];
    expect([...d.linhas].sort()).toEqual([...tres].sort());
    expect(d.titulos).toEqual(["60001"]);
    expect(d.motivo).toMatch(/^3 linhas lançadas num título/);
    await expect(servico(`delete from crt_lancamentos_erp where id = $1`, [r[0].id])).rejects.toThrow(/não podem ser excluídos/);
  });
});
