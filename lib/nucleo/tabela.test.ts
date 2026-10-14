import { describe, expect, it } from "vitest";
import {
  detectarTipo, filtroAtivo, interpretarData, interpretarNumero, linhaPassa, normalizar, ordenarIndices, valoresDistintos,
} from "./tabela";

describe("interpretarNumero", () => {
  it("lê valores em reais e números no formato brasileiro", () => {
    expect(interpretarNumero("R$ 1.234,56")).toBe(1234.56);
    expect(interpretarNumero("R$ -12,00")).toBe(-12);
    expect(interpretarNumero("-R$ 3,10")).toBe(-3.1);
    expect(interpretarNumero("(1.000,00)")).toBe(-1000);
    expect(interpretarNumero("12,5%")).toBe(12.5);
    expect(interpretarNumero("1.234")).toBe(1234);
    expect(interpretarNumero("42")).toBe(42);
  });
  it("recusa o que não é número", () => {
    expect(interpretarNumero("12.345.678/0001-90")).toBeNull();
    expect(interpretarNumero("NF 123")).toBeNull();
    expect(interpretarNumero("1.23")).toBeNull();
    expect(interpretarNumero("")).toBeNull();
  });
});

describe("interpretarData", () => {
  it("lê dd/mm/aaaa, com hora, mm/aaaa e aaaa-mm-dd", () => {
    expect(interpretarData("05/10/2026")).toBe(Date.UTC(2026, 9, 5));
    expect(interpretarData("05/10/2026 14:30")).toBe(Date.UTC(2026, 9, 5, 14, 30));
    expect(interpretarData("10/2026")).toBe(Date.UTC(2026, 9, 1));
    expect(interpretarData("2026-10-05")).toBe(Date.UTC(2026, 9, 5));
  });
  it("recusa mês inválido e texto", () => {
    expect(interpretarData("05/13/2026")).toBeNull();
    expect(interpretarData("ontem")).toBeNull();
  });
});

describe("detectarTipo", () => {
  it("ignora células vazias e traços", () => {
    expect(detectarTipo(["01/10/2026", "—", "", "15/09/2026"])).toBe("data");
    expect(detectarTipo(["R$ 10,00", "-", "R$ 1.000,00"])).toBe("numero");
    expect(detectarTipo(["R$ 10,00", "isento"])).toBe("texto");
    expect(detectarTipo(["", "—"])).toBe("texto");
  });
});

describe("ordenarIndices", () => {
  it("ordena valores pelo número, não pelo texto", () => {
    const linhas = [["R$ 1.000,00"], ["R$ 20,00"], ["R$ 300,00"]];
    expect(ordenarIndices(linhas, 0, "asc")).toEqual([1, 2, 0]);
    expect(ordenarIndices(linhas, 0, "desc")).toEqual([0, 2, 1]);
  });
  it("ordena datas dd/mm/aaaa pela data", () => {
    const linhas = [["01/02/2026"], ["15/01/2026"], ["31/12/2025"]];
    expect(ordenarIndices(linhas, 0, "asc")).toEqual([2, 1, 0]);
  });
  it("texto sem diferenciar acento e maiúscula, com números naturais", () => {
    const linhas = [["Ágape"], ["abc"], ["Item 10"], ["Item 2"]];
    expect(ordenarIndices(linhas, 0, "asc")).toEqual([1, 0, 3, 2]);
  });
  it("vazios ficam no fim nas duas direções e o empate mantém a ordem original", () => {
    const linhas = [["—"], ["B"], ["A"], [""], ["B"]];
    expect(ordenarIndices(linhas, 0, "asc")).toEqual([2, 1, 4, 0, 3]);
    expect(ordenarIndices(linhas, 0, "desc")).toEqual([1, 4, 2, 0, 3]);
  });
});

describe("linhaPassa", () => {
  const linha = ["Construtora São José", "R$ 1.500,00", "Pendente"];
  it("busca geral em qualquer coluna, sem acento", () => {
    expect(linhaPassa(linha, {}, "sao jose")).toBe(true);
    expect(linhaPassa(linha, {}, "1.500")).toBe(true);
    expect(linhaPassa(linha, {}, "pago")).toBe(false);
  });
  it("filtro de coluna por trecho e por valores marcados", () => {
    expect(linhaPassa(linha, { 0: { texto: "JOSÉ", valores: null } }, "")).toBe(true);
    expect(linhaPassa(linha, { 2: { texto: "", valores: ["Pago"] } }, "")).toBe(false);
    expect(linhaPassa(linha, { 2: { texto: "", valores: ["Pago", "Pendente"] } }, "")).toBe(true);
    expect(linhaPassa(linha, { 2: { texto: "", valores: [] } }, "")).toBe(false);
  });
});

describe("apoio", () => {
  it("normalizar e filtroAtivo", () => {
    expect(normalizar("  Ação   Fiscal ")).toBe("acao fiscal");
    expect(filtroAtivo({ texto: " ", valores: null })).toBe(false);
    expect(filtroAtivo({ texto: "", valores: [] })).toBe(true);
  });
  it("valoresDistintos conta e ordena pelo tipo", () => {
    expect(valoresDistintos([["R$ 20,00"], ["R$ 3,00"], ["R$ 20,00"]], 0)).toEqual([
      { valor: "R$ 3,00", quantidade: 1 },
      { valor: "R$ 20,00", quantidade: 2 },
    ]);
  });
});
