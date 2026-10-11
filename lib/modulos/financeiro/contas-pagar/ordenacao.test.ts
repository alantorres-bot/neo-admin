import { describe, expect, it } from "vitest";
import { alternarOrdem, ehColunaPendentes, ehDirecao, ordenar } from "./ordenacao";

type Linha = { nome: string; valor: number | null; data: string | null };
const linhas: Linha[] = [
  { nome: "Ômega", valor: 300, data: "2026-10-20" },
  { nome: "acofer", valor: 50, data: null },
  { nome: "Beta 10", valor: null, data: "2026-09-01" },
  { nome: "Beta 2", valor: 50, data: "2026-12-31" },
];
const por = (l: Linha, c: "nome" | "valor" | "data") => l[c];

describe("ordenação pelas colunas", () => {
  it("alternarOrdem: nova coluna começa crescente; a mesma coluna inverte", () => {
    expect(alternarOrdem(null, "nome")).toEqual({ coluna: "nome", direcao: "asc" });
    expect(alternarOrdem({ coluna: "nome", direcao: "asc" }, "nome")).toEqual({ coluna: "nome", direcao: "desc" });
    expect(alternarOrdem({ coluna: "nome", direcao: "desc" }, "nome")).toEqual({ coluna: "nome", direcao: "asc" });
    expect(alternarOrdem({ coluna: "nome", direcao: "desc" }, "valor")).toEqual({ coluna: "valor", direcao: "asc" });
  });
  it("texto em ordem alfabética sem distinguir acento/caixa e com números naturais (Beta 2 antes de Beta 10)", () => {
    expect(ordenar(linhas, { coluna: "nome", direcao: "asc" }, por).map((l) => l.nome)).toEqual(["acofer", "Beta 2", "Beta 10", "Ômega"]);
    expect(ordenar(linhas, { coluna: "nome", direcao: "desc" }, por).map((l) => l.nome)).toEqual(["Ômega", "Beta 10", "Beta 2", "acofer"]);
  });
  it("número do menor ao maior; empate mantém a ordem de entrada; nulo sempre por último", () => {
    expect(ordenar(linhas, { coluna: "valor", direcao: "asc" }, por).map((l) => l.nome)).toEqual(["acofer", "Beta 2", "Ômega", "Beta 10"]);
    expect(ordenar(linhas, { coluna: "valor", direcao: "desc" }, por).map((l) => l.nome)).toEqual(["Ômega", "acofer", "Beta 2", "Beta 10"]);
  });
  it("data ISO ordena por data; sem ordem devolve cópia na ordem original", () => {
    expect(ordenar(linhas, { coluna: "data", direcao: "asc" }, por).map((l) => l.data)).toEqual(["2026-09-01", "2026-10-20", "2026-12-31", null]);
    expect(ordenar(linhas, null, por)).toEqual(linhas);
    expect(ordenar(linhas, null, por)).not.toBe(linhas);
  });
  it("validadores", () => {
    expect(ehDirecao("asc")).toBe(true);
    expect(ehDirecao("cima")).toBe(false);
    expect(ehColunaPendentes("saldo")).toBe(true);
    expect(ehColunaPendentes("emissao")).toBe(false);
  });
});
