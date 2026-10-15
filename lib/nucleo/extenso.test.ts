import { describe, expect, it } from "vitest";
import { reaisPorExtenso } from "./extenso";

describe("valor por extenso", () => {
  it("valores dos recibos", () => {
    expect(reaisPorExtenso(474927)).toBe("quatro mil setecentos e quarenta e nove reais e vinte e sete centavos");
    expect(reaisPorExtenso(373475)).toBe("três mil setecentos e trinta e quatro reais e setenta e cinco centavos");
    expect(reaisPorExtenso(49117)).toBe("quatrocentos e noventa e um reais e dezessete centavos");
    expect(reaisPorExtenso(19789575)).toBe("cento e noventa e sete mil oitocentos e noventa e cinco reais e setenta e cinco centavos");
  });
  it("casos de borda", () => {
    expect(reaisPorExtenso(100)).toBe("um real");
    expect(reaisPorExtenso(1)).toBe("um centavo");
    expect(reaisPorExtenso(10000)).toBe("cem reais");
    expect(reaisPorExtenso(110000)).toBe("mil e cem reais");
    expect(reaisPorExtenso(102000)).toBe("mil e vinte reais");
    expect(reaisPorExtenso(200000)).toBe("dois mil reais");
    expect(reaisPorExtenso(100000000)).toBe("um milhão de reais");
    expect(reaisPorExtenso(0)).toBe("zero real");
  });
});
