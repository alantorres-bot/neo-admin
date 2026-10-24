import { describe, expect, it } from "vitest";
import { avaliarCondicao, ErroConfiguracaoCondicao, type Comparacao, type Condicao } from "./condicoes";

const CAMPOS = ["tem_projeto", "valor", "data_entrega", "banco"];
const todas = (...c: Comparacao[]): Condicao => ({ todas: c });

describe("avaliarCondicao", () => {
  it("sem condição o item vale sempre", () => {
    expect(avaliarCondicao(null, {}, CAMPOS).resultado).toBe("verdadeiro");
  });

  it("todos os operadores", () => {
    const v = { tem_projeto: true, valor: 100, data_entrega: "2026-11-10", banco: "Banco Exemplo" };
    const r = (c: Condicao) => avaliarCondicao(c, v, CAMPOS).resultado;
    expect(r(todas({ campo: "tem_projeto", op: "=", valor: true }))).toBe("verdadeiro");
    expect(r(todas({ campo: "tem_projeto", op: "≠", valor: true }))).toBe("falso");
    expect(r(todas({ campo: "valor", op: ">", valor: 99 }))).toBe("verdadeiro");
    expect(r(todas({ campo: "valor", op: "≥", valor: 100 }))).toBe("verdadeiro");
    expect(r(todas({ campo: "valor", op: "<", valor: 100 }))).toBe("falso");
    expect(r(todas({ campo: "valor", op: "≤", valor: 100 }))).toBe("verdadeiro");
    expect(r(todas({ campo: "data_entrega", op: "<", valor: "2026-12-01" }))).toBe("verdadeiro");
    expect(r(todas({ campo: "banco", op: "informado" }))).toBe("verdadeiro");
    expect(r(todas({ campo: "banco", op: "nao_informado" }))).toBe("falso");
  });

  it("todas e alguma", () => {
    const v = { tem_projeto: true, valor: 10 };
    const a = { campo: "tem_projeto", op: "=", valor: true } as const;
    const b = { campo: "valor", op: ">", valor: 50 } as const;
    expect(avaliarCondicao({ todas: [a, b] }, v, CAMPOS).resultado).toBe("falso");
    expect(avaliarCondicao({ alguma: [a, b] }, v, CAMPOS).resultado).toBe("verdadeiro");
  });

  it("campo não informado dá desconhecido, não falso", () => {
    const c = todas({ campo: "valor", op: ">", valor: 50 });
    expect(avaliarCondicao(c, {}, CAMPOS)).toEqual({ resultado: "desconhecido", camposDesconhecidos: ["valor"] });
    expect(avaliarCondicao(c, { valor: null }, CAMPOS).resultado).toBe("desconhecido");
    // Em `todas`, um falso decide mesmo com outro campo desconhecido; em `alguma`, o desconhecido prevalece sobre o falso.
    const d = { campo: "tem_projeto", op: "=", valor: true } as const;
    expect(avaliarCondicao({ todas: [d, { campo: "valor", op: ">", valor: 1 }] }, { tem_projeto: false }, CAMPOS).resultado).toBe("falso");
    expect(avaliarCondicao({ alguma: [d, { campo: "valor", op: ">", valor: 1 }] }, { tem_projeto: false }, CAMPOS).resultado).toBe("desconhecido");
  });

  it("campo inexistente ou comparação sem sentido gera erro de configuração", () => {
    expect(() => avaliarCondicao(todas({ campo: "cor", op: "=", valor: "azul" }), {}, CAMPOS)).toThrow(ErroConfiguracaoCondicao);
    expect(() => avaliarCondicao(todas({ campo: "valor", op: ">", valor: "10" }), { valor: 5 }, CAMPOS)).toThrow(ErroConfiguracaoCondicao);
    expect(() => avaliarCondicao({ todas: [] }, {}, CAMPOS)).toThrow(ErroConfiguracaoCondicao);
  });
});
