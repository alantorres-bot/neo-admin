import { describe, expect, it } from "vitest";
import {
  assuntoSolicitacao, lerValorDigitado, linhaTitulo, montarEmailSolicitacao, nomeCurto, numerarObs, observacoes, saudacao, totalCentavos,
  tratamentoDe, valorParaSolicitar, type ItemEmail,
} from "./solicitacao";

const OBS_SEM_BOLETO = "Operar com 01 dia após o vencimento e não emitir boleto.";
const efata: ItemEmail = { documento: "1335/2", cliente: "EFATA CONSTRUTORA LTDA", vencimento: "2026-10-20", valorSolicitadoCentavos: 12_000_000, valorRestanteCentavos: 12_000_000, parcial: false, semBoleto: false };
const caparao: ItemEmail = { documento: "2318", cliente: "CAPARAO HOUSE GARDEN", vencimento: "2026-10-15", valorSolicitadoCentavos: 5_000_000, valorRestanteCentavos: 5_000_000, parcial: false, semBoleto: true };
const tc: ItemEmail = { documento: "1360", cliente: "TC CONSTRUTORA", vencimento: "2026-11-05", valorSolicitadoCentavos: 20_000_000, valorRestanteCentavos: 35_000_000, parcial: true, semBoleto: false, observacao: "operar com vencimento para 20/10/2026" };
const base = { data: "2026-10-12", hora: 14, tratamento: "André/Kayza", observacaoSemBoleto: OBS_SEM_BOLETO };

describe("montarEmailSolicitacao", () => {
  it("corpo no padrão real: tratamento, saudação, linhas, total e Atenciosamente sem assinatura", () => {
    const { assunto, corpo } = montarEmailSolicitacao({ ...base, itens: [caparao, efata] });
    expect(assunto).toBe("ANTECIPAÇÕES - 12/10/2026");
    expect(corpo).toBe([
      "André/Kayza,",
      "",
      "Boa tarde!",
      "",
      "Favor operar os títulos abaixo:",
      "",
      "NF 2318 | CAPARAO HOUSE GARDEN | Venc. 15/10/2026 | R$ 50.000,00",
      "NF 1335/2 | EFATA CONSTRUTORA LTDA | Venc. 20/10/2026 | R$ 120.000,00",
      "Total: R$ 170.000,00 (2 títulos)",
      "",
      "OBS - NF 2318 - Operar com 01 dia após o vencimento e não emitir boleto.",
      "",
      "Atenciosamente,",
    ].join("\n"));
  });
  it("OBS numeradas na ordem dos títulos: sem boleto, parcial, observação do título e a geral por último", () => {
    const { corpo } = montarEmailSolicitacao({ ...base, itens: [caparao, tc], observacaoGeral: "abater a NF de R$ 17.000,00 em aberto" });
    expect(corpo.split("\n").filter((l) => l.startsWith("OBS"))).toEqual([
      "OBS 01 - NF 2318 - Operar com 01 dia após o vencimento e não emitir boleto.",
      "OBS 02 - NF 1360 - Operar R$ 200.000,00 (parcial; valor do título R$ 350.000,00).",
      "OBS 03 - NF 1360 - operar com vencimento para 20/10/2026.",
      "OBS 04 - abater a NF de R$ 17.000,00 em aberto.",
    ]);
    expect(corpo).toContain("NF 1360 | TC CONSTRUTORA | Venc. 05/11/2026 | R$ 200.000,00");
    expect(corpo).toContain("Total: R$ 250.000,00 (2 títulos)");
  });
  it("sem OBS não deixa bloco vazio; título único no singular e assunto com o cliente", () => {
    const { assunto, corpo } = montarEmailSolicitacao({ ...base, itens: [efata] });
    expect(assunto).toBe("Antecipação NF 1335/2 - EFATA");
    expect(corpo).toContain("Total: R$ 120.000,00 (1 título)\n\nAtenciosamente,");
    expect(corpo).not.toContain("OBS");
  });
  it("saudação pela hora e o corpo nunca traz assinatura", () => {
    expect(saudacao(8)).toBe("Bom dia!");
    expect(saudacao(12)).toBe("Boa tarde!");
    expect(saudacao(17)).toBe("Boa tarde!");
    expect(saudacao(19)).toBe("Boa noite!");
    const { corpo } = montarEmailSolicitacao({ ...base, hora: 9, itens: [efata] });
    expect(corpo.split("\n")[2]).toBe("Bom dia!");
    expect(corpo.endsWith("Atenciosamente,")).toBe(true);
  });
});

describe("partes", () => {
  it("tratamentoDe e nomeCurto", () => {
    expect(tratamentoDe(["André Kamil", "Kayza"])).toBe("André/Kayza");
    expect(tratamentoDe([" Kayza Silva "])).toBe("Kayza");
    expect(tratamentoDe([])).toBe("Prezados");
    expect(nomeCurto("EFATA CONSTRUTORA LTDA")).toBe("EFATA");
  });
  it("linhaTitulo, observacoes e numerarObs", () => {
    expect(linhaTitulo(tc)).toBe("NF 1360 | TC CONSTRUTORA | Venc. 05/11/2026 | R$ 200.000,00");
    expect(observacoes({ itens: [efata], observacaoSemBoleto: OBS_SEM_BOLETO })).toEqual([]);
    expect(observacoes({ itens: [{ ...efata, observacao: "já tem ponto." }], observacaoSemBoleto: OBS_SEM_BOLETO })).toEqual(["NF 1335/2 - já tem ponto."]);
    expect(numerarObs(["a"])).toEqual(["OBS - a"]);
    expect(numerarObs(["a", "b"])).toEqual(["OBS 01 - a", "OBS 02 - b"]);
    expect(numerarObs([])).toEqual([]);
  });
  it("assunto e total", () => {
    expect(assuntoSolicitacao([efata, tc], "2026-01-05")).toBe("ANTECIPAÇÕES - 05/01/2026");
    expect(totalCentavos([efata, tc])).toBe(32_000_000);
  });
});

describe("valor digitado no seletor", () => {
  it("lerValorDigitado aceita formato brasileiro e simples", () => {
    expect(lerValorDigitado("")).toBeNull();
    expect(lerValorDigitado("200.000,00")).toBe(20_000_000);
    expect(lerValorDigitado("R$ 1.234,5")).toBe(123_450);
    expect(lerValorDigitado("200000")).toBe(20_000_000);
    expect(lerValorDigitado("200000.5")).toBe(20_000_050);
    expect(lerValorDigitado("abc")).toBeUndefined();
    expect(lerValorDigitado("0")).toBeUndefined();
    expect(lerValorDigitado("-5")).toBeUndefined();
  });
  it("valorParaSolicitar: vazio ou igual ao restante = inteiro; menor = parcial; maior ou inválido = erro", () => {
    expect(valorParaSolicitar("", 35_000_000)).toEqual({ ok: true, valor: null, parcial: false });
    expect(valorParaSolicitar("350.000,00", 35_000_000)).toEqual({ ok: true, valor: null, parcial: false });
    expect(valorParaSolicitar("200.000,00", 35_000_000)).toEqual({ ok: true, valor: 200000, parcial: true });
    expect(valorParaSolicitar("400.000,00", 35_000_000)).toEqual({ ok: false, erro: "O valor passa do que resta com a Neo (R$ 350.000,00)." });
    expect(valorParaSolicitar("x", 35_000_000)).toEqual({ ok: false, erro: "Valor inválido: use números, ex.: 200.000,00." });
  });
});
