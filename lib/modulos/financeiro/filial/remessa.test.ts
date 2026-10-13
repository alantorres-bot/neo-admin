import { describe, expect, it } from "vitest";
import { assuntoDaRemessa, divergencias, lerParcelasInformadas, linhaDoItem, linkGmail, LIMITE_LINK, montarAviso, type ItemAviso } from "./remessa";

const item = (nota: string, cliente: string, parcelas: [string, number][], aceita = true): ItemAviso => ({
  nota, cliente, aceitaBoletoFactoring: aceita, parcelas: parcelas.map(([vencimento, valorCentavos]) => ({ vencimento, valorCentavos })),
});
const LINK = "https://admin.neoformas.com.br/financeiro/filial/remessas/3";
const PARA = ["admcuiaba@neoformas.com.br", "daline.alves@neoformas.com.br"];

describe("aviso da remessa", () => {
  it("assunto no padrão dos e-mails da filial", () => {
    expect(assuntoDaRemessa(3, "2026-10-08")).toBe("FATURAS MG - OUTUBRO 2026 - REMESSA nº 3");
    expect(assuntoDaRemessa(12, "2027-03-01")).toBe("FATURAS MG - MARÇO 2027 - REMESSA nº 12");
  });

  it("linha por NF com vencimentos e valores", () => {
    expect(linhaDoItem(item("002351", "QRTZ 39", [["2026-11-10", 1_234_56]]))).toBe("- NF 2351 - QRTZ 39 - venc. 10/11/2026 - R$ 1.234,56");
    expect(linhaDoItem(item("002352", "HERMES", [["2026-11-10", 100_00], ["2026-12-10", 100_00]])))
      .toBe("- NF 2352 - HERMES - venc. 10/11/2026 - R$ 100,00; venc. 10/12/2026 - R$ 100,00");
    expect(linhaDoItem(item("002353", "JANEIRO", []))).toBe("- NF 2353 - JANEIRO - vencimento e valor a conferir na nota");
  });

  it("corpo: relação ordenada, total, OBS dos sem factoring, link e 'Atenciosamente,' sem assinatura", () => {
    const a = montarAviso({
      numero: 3, data: "2026-10-08", link: LINK, para: PARA,
      itens: [item("002353", "JANEIRO - CARBON", [["2026-11-09", 500_00]], false), item("002351", "QRTZ 39", [["2026-11-10", 1_000_00]], false), item("002352", "HERMES", [["2026-11-12", 250_00]])],
    });
    expect(a.assunto).toBe("FATURAS MG - OUTUBRO 2026 - REMESSA nº 3");
    expect(a.corpo).toContain("remessa nº 3, 3 notas, total R$ 1.750,00");
    expect(a.corpo.indexOf("NF 2351")).toBeLessThan(a.corpo.indexOf("NF 2352"));
    expect(a.corpo).toContain("não aceitam boleto de factoring:\n- NF 2351 - QRTZ 39\n- NF 2353 - JANEIRO - CARBON");
    expect(a.corpo).toContain(LINK);
    expect(a.corpo.endsWith("Atenciosamente,")).toBe(true);
  });

  it("sem cliente sem factoring, não há OBS", () => {
    const a = montarAviso({ numero: 1, data: "2026-10-08", link: LINK, para: PARA, itens: [item("002352", "HERMES", [["2026-11-12", 250_00]])] });
    expect(a.corpo).not.toContain("OBS.");
    expect(a.corpo).toContain("1 nota, total R$ 250,00");
  });

  it("link do Gmail completo quando cabe; resumido quando a relação é longa", () => {
    const curto = montarAviso({ numero: 1, data: "2026-10-08", link: LINK, para: PARA, itens: [item("002352", "HERMES", [["2026-11-12", 250_00]])] });
    const r1 = linkGmail(curto, LINK);
    expect(r1.resumido).toBe(false);
    expect(r1.url.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=admcuiaba%40neoformas.com.br%2Cdaline.alves%40neoformas.com.br&su=FATURAS")).toBe(true);
    expect(decodeURIComponent(r1.url.split("body=")[1])).toBe(curto.corpo);

    const longo = montarAviso({
      numero: 2, data: "2026-10-08", link: LINK, para: PARA,
      itens: Array.from({ length: 40 }, (_, i) => item(String(2300 + i).padStart(6, "0"), `CLIENTE COM NOME BEM LONGO ${i}`, [["2026-11-12", 250_00]])),
    });
    const r2 = linkGmail(longo, LINK);
    expect(r2.resumido).toBe(true);
    expect(r2.url.length).toBeLessThanOrEqual(LIMITE_LINK);
    expect(decodeURIComponent(r2.url.split("body=")[1])).toContain(LINK);
  });
});

describe("divergências nota × Consistem", () => {
  const t = (documento: string, vencimento: string, valorCentavos: number) => ({ documento, vencimento, valorCentavos });
  const p = (vencimento: string, valorCentavos: number) => ({ vencimento, valorCentavos });

  it("confere", () => {
    expect(divergencias([p("2026-11-10", 1_000_00)], [t("4002351U", "2026-11-10", 1_000_00)])).toEqual([]);
  });
  it("sem dado de um dos lados, não compara", () => {
    expect(divergencias([], [t("4002351U", "2026-11-10", 1_000_00)])).toEqual([]);
    expect(divergencias([p("2026-11-10", 1_000_00)], [])).toEqual([]);
  });
  it("vencimento e valor diferentes", () => {
    expect(divergencias([p("2026-11-10", 1_000_00)], [t("4002351U", "2026-11-11", 1_000_10)]))
      .toEqual(["Total da nota R$ 1.000,00 × Consistem R$ 1.000,10.", "4002351U: vencimento na nota 10/11/2026 × Consistem 11/11/2026."]);
  });
  it("número de parcelas diferente", () => {
    expect(divergencias([p("2026-11-10", 500_00), p("2026-12-10", 500_00)], [t("4002351U", "2026-11-10", 1_000_00)]))
      .toEqual(["A nota tem 2 parcelas e o Consistem, 1."]);
  });
  it("mesma soma, valores trocados entre parcelas", () => {
    expect(divergencias([p("2026-11-10", 400_00), p("2026-12-10", 600_00)], [t("4002351A", "2026-11-10", 600_00), t("4002351B", "2026-12-10", 400_00)]))
      .toEqual(["4002351A: valor na nota R$ 400,00 × Consistem R$ 600,00.", "4002351B: valor na nota R$ 600,00 × Consistem R$ 400,00."]);
  });
});

describe("lerParcelasInformadas", () => {
  it("jsonb do banco → centavos", () => {
    expect(lerParcelasInformadas([{ vencimento: "2026-11-10", valor: 1234.56 }, { vencimento: "2026-12-10", valor: "10.1" }]))
      .toEqual([{ vencimento: "2026-11-10", valorCentavos: 1_234_56 }, { vencimento: "2026-12-10", valorCentavos: 10_10 }]);
    expect(lerParcelasInformadas(null)).toEqual([]);
    expect(lerParcelasInformadas([{ x: 1 }])).toEqual([]);
  });
});
