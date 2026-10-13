import { describe, expect, it } from "vitest";
import { montarEmailCliente, saudacaoDoDia, textoAnexos, textoPeriodo } from "./email-cliente";

describe("e-mail da filial ao cliente", () => {
  it("modelo do e-mail que a filial já manda", () => {
    const e = montarEmailCliente({
      cliente: "AQ Engenharia", nota: "002355", obra: "Muro de Arrimo - Rio Piracicaba/MG",
      periodoInicio: "2026-10-13", periodoFim: "2026-11-11", documentos: ["nota_fatura", "demonstrativo"], hora: 9,
    });
    expect(e.assunto).toBe("Faturamento AQ Engenharia - Muro de Arrimo - Rio Piracicaba/MG");
    expect(e.corpo).toBe([
      "Prezado cliente, bom dia",
      "",
      "Segue anexo Nota Fatura, boleto e demonstrativo referente ao período de faturamento 13/10 a 11/11/2026.",
      "",
      "Obra: Muro de Arrimo - Rio Piracicaba/MG",
      "",
      "Gentileza confirmar o recebimento deste e-mail.",
      "",
      "Atenciosamente,",
    ].join("\n"));
  });

  it("sem obra e sem período: usa a NF", () => {
    const e = montarEmailCliente({ cliente: "QRTZ 39", nota: "002351", obra: null, periodoInicio: null, periodoFim: null, documentos: ["nota_fatura"], hora: 15 });
    expect(e.assunto).toBe("Faturamento QRTZ 39 - NF 2351");
    expect(e.corpo.split("\n")[0]).toBe("Prezado cliente, boa tarde");
    expect(e.corpo).toContain("Segue anexo Nota Fatura e boleto referente à NF 2351.");
    expect(e.corpo).not.toContain("Obra:");
    expect(e.corpo.endsWith("Atenciosamente,")).toBe(true);
  });

  it("anexos, período e saudação", () => {
    expect(textoAnexos(["nota_fatura", "demonstrativo", "comodato", "carta_cessao"])).toBe("Nota Fatura, boleto, demonstrativo, comodato e carta de cessão de crédito");
    expect(textoPeriodo("2026-12-28", "2027-01-27")).toBe("28/12/2026 a 27/01/2027");
    expect(saudacaoDoDia(18)).toBe("boa noite");
  });
});

describe("envio antecipado e boleto depois (Fase F)", () => {
  const base = { cliente: "QRTZ 39", nota: "002351", obra: "Exclusive Bon Vivant", periodoInicio: "2026-09-12", periodoFim: "2026-10-11", hora: 9 };
  it("nota: nota fatura, demonstrativo e comodato, avisando o boleto", () => {
    const e = montarEmailCliente({ ...base, modo: "nota", documentos: ["nota_fatura", "demonstrativo", "comodato", "carta_cessao"] });
    expect(e.assunto).toBe("Faturamento QRTZ 39 - Exclusive Bon Vivant");
    expect(e.corpo).toContain("Segue anexo Nota Fatura, demonstrativo e comodato referente ao período de faturamento 12/09 a 11/10/2026.");
    expect(e.corpo).toContain("O boleto será enviado em seguida, neste mesmo e-mail.");
    expect(e.corpo).not.toContain("boleto,");
    expect(e.corpo.endsWith("Atenciosamente,")).toBe(true);
  });
  it("boleto: resposta ao primeiro e-mail", () => {
    const e = montarEmailCliente({ ...base, modo: "boleto", documentos: [], assuntoAnterior: "Faturamento QRTZ 39 - Exclusive Bon Vivant" });
    expect(e.assunto).toBe("Re: Faturamento QRTZ 39 - Exclusive Bon Vivant");
    expect(e.corpo).toContain("Segue anexo o boleto referente à NF 2351 (período de faturamento 12/09 a 11/10/2026), conforme e-mail anterior.");
    expect(montarEmailCliente({ ...base, modo: "boleto", documentos: [], assuntoAnterior: "Re: X" }).assunto).toBe("Re: X");
  });
});
