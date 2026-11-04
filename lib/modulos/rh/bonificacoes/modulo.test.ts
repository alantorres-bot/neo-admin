import { describe, expect, it } from "vitest";
import { valorBonificacao } from "./modulo";

describe("valorBonificacao", () => {
  it("é o percentual do salário, em centavos", () => {
    expect(valorBonificacao(2000, 10)).toBe(20000);
    expect(valorBonificacao(3141.78, 5)).toBe(15709);   // 157,089 → 157,09
    expect(valorBonificacao(1621, 15)).toBe(24315);
    expect(valorBonificacao(1621, 20)).toBe(32420);
  });
});
