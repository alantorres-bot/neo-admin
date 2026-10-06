import { describe, expect, it } from "vitest";
import { descricaoPossivelBaixa, evidenciaDePago, indexarPagos } from "../../../supabase/functions/_shared/consistem-receber";

const pago = (extra: Record<string, unknown> = {}) => ({
  codTitulo: "1001237G", dataPagamento: "2026-10-02", tipoBaixa: "1", valorTitulo: "10000.00", valorJuros: "0.00", valorDesconto: "0.00", ...extra,
});

describe("evidenciaDePago", () => {
  it("lê data, valor e tipo de baixa", () => {
    expect(evidenciaDePago(pago())).toEqual({ pagoEm: "2026-10-02", valorCentavos: 1_000_000, tipoBaixa: "1" });
  });
  it("valor = título + juros − desconto", () => {
    expect(evidenciaDePago(pago({ valorJuros: "150.50", valorDesconto: "50.00" }))?.valorCentavos).toBe(1_010_050);
  });
  it("aceita número JSON e timestamp na data", () => {
    expect(evidenciaDePago(pago({ valorTitulo: 2500.5, valorJuros: 0, valorDesconto: null, dataPagamento: "2026-10-02T00:00:00" }))).toEqual({ pagoEm: "2026-10-02", valorCentavos: 250_050, tipoBaixa: "1" });
  });
  it.each([[""], ["0"], [null], ["0001-01-01"], ["0001-01-01T00:00:00"], ["lixo"]])("sem data de pagamento válida (%j) não é evidência", (d) => {
    expect(evidenciaDePago(pago({ dataPagamento: d }))).toBeNull();
  });
  it("se juros e desconto zeram o valor, fica o valor do título", () => {
    expect(evidenciaDePago(pago({ valorDesconto: "10000.00" }))?.valorCentavos).toBe(1_000_000);
  });
});

describe("indexarPagos", () => {
  it("indexa por codTitulo e ignora registros sem código ou sem data", () => {
    const m = indexarPagos([pago(), pago({ codTitulo: "" }), pago({ codTitulo: "X", dataPagamento: "0" })]);
    expect([...m.keys()]).toEqual(["1001237G"]);
  });
  it("título pago em mais de uma data: vale o pagamento mais recente", () => {
    const m = indexarPagos([pago({ dataPagamento: "2026-09-01", valorTitulo: "100.00" }), pago({ dataPagamento: "2026-10-02", valorTitulo: "200.00" }), pago({ dataPagamento: "2026-08-01", valorTitulo: "50.00" })]);
    expect(m.get("1001237G")).toMatchObject({ pagoEm: "2026-10-02", valorCentavos: 20_000 });
  });
  it("espaços no código não atrapalham", () => {
    expect(indexarPagos([pago({ codTitulo: "  A1 " })]).has("A1")).toBe(true);
  });
});

describe("descricaoPossivelBaixa", () => {
  it("sem evidência, avisa que não consta como pago e orienta", () => {
    const d = descricaoPossivelBaixa(null, 1_000_000);
    expect(d).toContain("NÃO consta na lista de pagos");
    expect(d).toContain("cancelado ou renegociado");
  });
  it("com evidência, mostra data, valor e tipo", () => {
    const d = descricaoPossivelBaixa({ pagoEm: "2026-10-02", valorCentavos: 1_000_000, tipoBaixa: "1" }, 1_000_000);
    expect(d).toBe("O Consistem informa pagamento em 02/10/2026, no valor de R$ 10.000,00, tipo de baixa 1. Confirme em Baixas a conferir: nada é baixado sozinho.");
  });
  it("valor diferente do título é sinalizado", () => {
    const d = descricaoPossivelBaixa({ pagoEm: "2026-10-02", valorCentavos: 1_010_050, tipoBaixa: "" }, 1_000_000);
    expect(d).toContain("o título é de R$ 10.000,00; a diferença é juros ou desconto, confira");
    expect(d).not.toContain("tipo de baixa");
  });
});
