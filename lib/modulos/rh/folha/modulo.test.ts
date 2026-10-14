import { describe, expect, it } from "vitest";
import { lerReais, valorAPagar } from "./modulo";

describe("folha: valores", () => {
  it("lê reais digitados", () => {
    expect(lerReais("1.234,56")).toBe(1234.56);
    expect(lerReais("1234,5")).toBe(1234.5);
    expect(lerReais("1234.56")).toBe(1234.56);
    expect(lerReais("R$ 5.112,46")).toBe(5112.46);
    expect(lerReais("1.234")).toBe(1234);
    expect(lerReais("")).toBe(0);
    expect(lerReais("-10")).toBeNaN();
    expect(lerReais("12a")).toBeNaN();
  });
  it("valor a pagar = soma das naturezas, em centavos", () => {
    expect(valorAPagar({ liquido: 5112.46, ferias_acrescimos: 4749.27, decimo_terceiro: 0, avulso: 0.1 })).toBe(986183);
  });
});
