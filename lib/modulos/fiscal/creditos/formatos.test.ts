import { describe, expect, it } from "vitest";
import { centavos, competencia, decimal, lerCompetencia, lerData, lerValor, moeda, somar, somarMeses } from "./formatos";

describe("valores (centavos inteiros, sem arredondar em silêncio)", () => {
  it("lê o padrão brasileiro", () => {
    expect(lerValor("1.234,56")).toEqual({ ok: true, centavos: 123456 });
    expect(lerValor("1234,5")).toEqual({ ok: true, centavos: 123450 });
    expect(lerValor("R$ 12.345.678,90")).toEqual({ ok: true, centavos: 1234567890 });
    expect(lerValor("1.234")).toEqual({ ok: true, centavos: 123400 });
    expect(lerValor("1234.56")).toEqual({ ok: true, centavos: 123456 });
    expect(lerValor(1234.56)).toEqual({ ok: true, centavos: 123456 });
  });
  it("recusa mais de 2 casas, negativo, zero e lixo", () => {
    expect(lerValor("10,005").ok).toBe(false);
    expect(lerValor(0.105).ok).toBe(false);
    expect(lerValor("-5,00").ok).toBe(false);
    expect(lerValor("-5,00", { permitirNegativo: true })).toEqual({ ok: true, centavos: -500 });
    expect(lerValor("0").ok).toBe(false);
    expect(lerValor("12a").ok).toBe(false);
    expect(lerValor("").ok).toBe(false);
  });
  it("aceita imprecisão binária de planilha e soma exato", () => {
    expect(lerValor(0.1 + 0.2)).toEqual({ ok: true, centavos: 30 });
    expect(somar([10, 20, 1])).toBe(31);
    expect(decimal(somar([centavos("0.10"), centavos("0.20")]))).toBe("0.30");
  });
  it("formata e converte", () => {
    expect(moeda(123456)).toBe("R$ 1.234,56");
    expect(moeda(-5)).toBe("-R$ 0,05");
    expect(centavos("6999.70")).toBe(699970);
    expect(centavos("-0.5")).toBe(-50);
    expect(centavos(1500)).toBe(150000);
    expect(decimal(-123456)).toBe("-1234.56");
  });
});

describe("datas e competências", () => {
  it("lê dd/mm/aaaa e recusa datas impossíveis", () => {
    expect(lerData("31/01/2025")).toBe("2025-01-31");
    expect(lerData("31/02/2025")).toBeNull();
    expect(lerData("2025-02-28")).toBe("2025-02-28");
  });
  it("competência MM/AAAA e virada de ano", () => {
    expect(lerCompetencia("1/2025")).toBe("2025-01-01");
    expect(lerCompetencia("2025-12")).toBe("2025-12-01");
    expect(lerCompetencia("13/2025")).toBeNull();
    expect(competencia("2025-03-01")).toBe("03/2025");
    expect(somarMeses("2025-12-01", 1)).toBe("2026-01-01");
    expect(somarMeses("2026-01-01", -1)).toBe("2025-12-01");
  });
});
