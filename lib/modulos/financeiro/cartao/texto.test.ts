import { describe, expect, it } from "vitest";
import { brl, diasEntre, normalizar, paraCentavos, paraIso, semelhanca, somarDias } from "./texto";

describe("paraCentavos", () => {
  it("lê os formatos das faturas e do Excel", () => {
    expect(paraCentavos("1.234,56")).toBe(123_456);
    expect(paraCentavos("R$ 78.528,72")).toBe(7_852_872);
    expect(paraCentavos("-R$ 91.374,55")).toBe(-9_137_455);
    expect(paraCentavos("R$ -50,00")).toBe(-5_000);
    expect(paraCentavos("−50,00")).toBe(-5_000);
    expect(paraCentavos("(50,00)")).toBe(-5_000);
    expect(paraCentavos("179357.82")).toBe(17_935_782);
    expect(paraCentavos("1.234")).toBe(123_400);
    expect(paraCentavos(28013.79)).toBe(2_801_379);
    expect(paraCentavos("")).toBeNull();
    expect(paraCentavos("abc")).toBeNull();
  });
});

describe("brl e datas", () => {
  it("formata sem R$ e lê dd/mm/aaaa", () => {
    expect(brl(123_456)).toBe("1.234,56");
    expect(brl(-5_000)).toBe("-50,00");
    expect(paraIso("10/10/2026")).toBe("2026-10-10");
    expect(paraIso("2026-10-10")).toBe("2026-10-10");
    expect(paraIso("27/set")).toBeNull();
    expect(diasEntre("2026-10-10", "2026-10-15")).toBe(5);
    expect(somarDias("2026-10-10", -5)).toBe("2026-10-05");
  });
});

describe("semelhanca (Ratcliff/Obershelp, como SequenceMatcher.ratio)", () => {
  it("igual = 1, nada em comum = 0, parecido no meio", () => {
    expect(semelhanca("Shock Metais", "SHOCK METAIS")).toBe(1);
    expect(semelhanca("abc", "xyz")).toBe(0);
    // valores do Python: SequenceMatcher(None, "EBW*NUVIAGENS - NUPAY - PARCELA 3/8", "CARTAO NUBANK - VIAGENS EBW").ratio() ≈ 0.42
    const s = semelhanca("EBW*NuViagens - NuPay - Parcela 3/8", "CARTAO NUBANK - VIAGENS EBW");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.5);
    expect(semelhanca("IOF DE VOLTA DE COMPRA X", "COMPRA X")).toBeGreaterThan(0.45);
  });
  it("normaliza acento e caixa", () => {
    expect(normalizar("  Café   com Açúcar ")).toBe("CAFE COM ACUCAR");
  });
});
