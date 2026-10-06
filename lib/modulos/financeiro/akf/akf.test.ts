import { describe, expect, it } from "vitest";
import {
  abertoNaAkf, clienteSemBoleto, disponivelParaAntecipar, estaNaAkf, normalizarTexto, vencidoNaAkf, type DadosAkf,
} from "../../../../supabase/functions/_shared/akf";

const t = (extra: Partial<DadosAkf> = {}): DadosAkf => ({ estagio: "boleto_enviado", faixa: "a_vencer", cedido: false, contestado: false, codPortador: "91", ...extra });

describe("normalizarTexto e clienteSemBoleto", () => {
  it("tira acento, maiúsculas e espaços repetidos", () => {
    expect(normalizarTexto("  Construtora  Capão  ")).toBe("CONSTRUTORA CAPAO");
  });
  it("casa por trecho do nome (termos da lista do Gestor AKF)", () => {
    const termos = ["MIP", "MB", "JANEIRO", "CAPARAO", "HOUSE GARDEN", "QRTZ 39"];
    expect(clienteSemBoleto("MIP ENGENHARIA LTDA", termos)).toBe(true);
    expect(clienteSemBoleto("Caparaó Empreendimentos", ["CAPARAO"])).toBe(true);
    expect(clienteSemBoleto("HOUSE   GARDEN SPE", termos)).toBe(true);
    expect(clienteSemBoleto("LUZAY EMPREENDIMENTOS", termos)).toBe(false);
  });
  it("termo vazio nunca casa", () => {
    expect(clienteSemBoleto("QUALQUER", ["", "  "])).toBe(false);
  });
});

describe("estaNaAkf", () => {
  it("cedido marcado ou portador 998", () => {
    expect(estaNaAkf(t())).toBe(false);
    expect(estaNaAkf(t({ cedido: true }))).toBe(true);
    expect(estaNaAkf(t({ codPortador: "998" }))).toBe(true);
    expect(estaNaAkf(t({ codPortador: "237" }))).toBe(false);
  });
});

describe("disponivelParaAntecipar", () => {
  it("a vencer, fora da AKF, sem contestação, em estágio normal", () => {
    for (const estagio of ["importado", "aguardando_boleto", "boleto_enviado", "confirmado_cliente"]) expect(disponivelParaAntecipar(t({ estagio }))).toBe(true);
  });
  it("não é disponível: vencido, na AKF, contestado, promessa, renegociação, jurídico, encerrado", () => {
    expect(disponivelParaAntecipar(t({ faixa: "01_15" }))).toBe(false);
    expect(disponivelParaAntecipar(t({ cedido: true }))).toBe(false);
    expect(disponivelParaAntecipar(t({ codPortador: "998" }))).toBe(false);
    expect(disponivelParaAntecipar(t({ contestado: true }))).toBe(false);
    for (const estagio of ["promessa", "em_renegociacao", "juridico", "pago", "cancelado"]) expect(disponivelParaAntecipar(t({ estagio }))).toBe(false);
    expect(disponivelParaAntecipar(t({ faixa: "encerrado", estagio: "pago" }))).toBe(false);
  });
});

describe("abertoNaAkf e vencidoNaAkf", () => {
  it("na AKF e a vencer: aberto, não vencido", () => {
    expect(abertoNaAkf(t({ cedido: true }))).toBe(true);
    expect(vencidoNaAkf(t({ cedido: true }))).toBe(false);
  });
  it("na AKF e vencido: aberto e vencido", () => {
    expect(abertoNaAkf(t({ cedido: true, faixa: "31_60" }))).toBe(true);
    expect(vencidoNaAkf(t({ codPortador: "998", faixa: "60_mais" }))).toBe(true);
  });
  it("encerrado nunca conta", () => {
    expect(abertoNaAkf(t({ cedido: true, faixa: "encerrado", estagio: "pago" }))).toBe(false);
    expect(vencidoNaAkf(t({ cedido: true, faixa: "encerrado", estagio: "pago" }))).toBe(false);
  });
  it("fora da AKF não conta", () => {
    expect(abertoNaAkf(t({ faixa: "16_30" }))).toBe(false);
  });
});
