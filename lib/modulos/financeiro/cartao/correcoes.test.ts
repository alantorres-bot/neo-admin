import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import type { TituloPagar } from "./conciliacao";
import { alteracaoTrocarCartao, avisosDoTitulo, trocarCartaoNoComplemento } from "./correcoes";

const NUBANK = CARTOES_TESTE.find((c) => c.codigo === "NUBANK PF")!;
const PICPAY = CARTOES_TESTE.find((c) => c.codigo === "PICPAY PF")!;
const titulo = (complemento: string, vencimento: string, extra: Partial<TituloPagar> = {}): TituloPagar => ({
  id: "t", codLancamento: "1", numeroTitulo: "1/1", fornecedor: "X", vencimento, complemento, tipoTitulo: "", valorCentavos: 100, ...extra,
});
const base = { cartoes: CARTOES_TESTE, contasInativas: new Set(["16/18"]) };

describe("avisos dos conciliados", () => {
  it("vencimento fora da fatura e do dia do cartão; o deslocado para o dia útil e o nominal passam", () => {
    const e = { ...base, cartao: NUBANK, vencimentoFatura: "2026-10-27" };
    expect(avisosDoTitulo(titulo("CARTAO NUBANK - PASSAGENS 4X", "2026-10-28"), e).map((a) => a.tipo)).toEqual(["vencimento"]);
    expect(avisosDoTitulo(titulo("CARTAO NUBANK - PASSAGENS 4X", "2026-10-27"), e)).toEqual([]);
    const sicredi = { ...base, cartao: CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!, vencimentoFatura: "2026-10-13" };
    expect(avisosDoTitulo(titulo("CARTAO SICREDI PF - X", "2026-10-10"), sicredi)).toEqual([]);   // dia nominal 10
    expect(avisosDoTitulo(titulo("CARTAO NUBANK - X", "2026-10-30", { antecipacao: true }), e)).toEqual([]);
  });
  it("conta de fluxo inativa, complemento acima de 60 e cartão de outro banco", () => {
    const e = { ...base, cartao: PICPAY, vencimentoFatura: "2026-10-26" };
    const avisos = avisosDoTitulo(titulo(`CARTÃO SICREDI PJ 1x — TQS ${"X".repeat(40)}`, "2026-10-26"), { ...e, fluxo: { grupo: 16, conta: 18 } });
    expect(avisos.map((a) => a.tipo)).toEqual(["cartao", "fluxo_inativo", "complemento_longo"]);
    expect(avisos[1].texto).toMatch(/16\/18 inativa/);
  });
});

describe("trocar o cartão no complemento", () => {
  it("troca só o trecho do cartão e mantém o resto", () => {
    expect(trocarCartaoNoComplemento("CARTÃO SICREDI PJ 1x — TQS INFORMAT", CARTOES_TESTE, "PicPay PF")).toEqual({ ok: true, complemento: "CARTÃO PICPAY PF 1x — TQS INFORMAT" });
    expect(trocarCartaoNoComplemento("CRATAO NUBANK - PASSAGENS 3X", CARTOES_TESTE, "Inter PF")).toEqual({ ok: true, complemento: "CARTÃO INTER PF - PASSAGENS 3X" });
    expect(trocarCartaoNoComplemento("COMPRA CARTAO PIC PAY 6 X", CARTOES_TESTE, "Nubank PF")).toEqual({ ok: true, complemento: "COMPRA CARTÃO NUBANK PF 6 X" });
    expect(trocarCartaoNoComplemento("CARTAO SICRED, HOTEL", CARTOES_TESTE, "Nubank PF")).toEqual({ ok: true, complemento: "CARTÃO NUBANK PF, HOTEL" });
  });
  it("corta em 60; sem a palavra CARTÃO ou sem o banco, pede correção à mão", () => {
    const r = trocarCartaoNoComplemento(`CARTAO INTER - ${"HOTEL ".repeat(15)}`, CARTOES_TESTE, "Sicredi PJ");
    expect(r.ok && r.complemento.length).toBeLessThanOrEqual(60);
    expect(trocarCartaoNoComplemento("PASSAGENS 3X", CARTOES_TESTE, "X")).toMatchObject({ ok: false, erro: /palavra CARTÃO/ });
    expect(trocarCartaoNoComplemento("CARTAO - PASSAGENS", CARTOES_TESTE, "X")).toMatchObject({ ok: false, erro: /nome do cartão/ });
  });
  it("alteração completa: complemento, vencimento da fatura, banco e histórico do cartão", () => {
    expect(alteracaoTrocarCartao({ complemento: "CARTÃO SICREDI PJ 1x — TQS INFORMAT" }, { cartoes: CARTOES_TESTE, nomeCartao: "PICPAY PF", vencimentoFatura: "2026-10-26", portadorFatura: 996, historicoFatura: null }))
      .toEqual({ ok: true, alteracao: { complementoHistorico: "CARTÃO PICPAY PF 1x — TQS INFORMAT", dataVencimento: "2026-10-26", codPortador: 996 } });
  });
});
