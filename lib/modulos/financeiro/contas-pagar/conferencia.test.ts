import { describe, expect, it } from "vitest";
import { ehSituacaoConferencia, filtrarConferencia, filtrarPorSituacao, interpretarBusca, podeConferir, podeMarcarNaoPago, resumirConferencia, type LinhaConferencia } from "./conferencia";

const linha = (p: Partial<LinhaConferencia>): LinhaConferencia => ({
  origem: "item", id: "x", tipo: "titulo", nome: "Fornecedor", documento: "1", data: "2026-10-20", historico: "",
  valorCentavos: 10000, situacao: null, valorBancoCentavos: null, observacao: null, conferidoPorNome: null, conferidoEm: null, ...p,
});

describe("interpretarBusca", () => {
  it("lê valores no padrão brasileiro", () => {
    expect(interpretarBusca("150")).toMatchObject({ centavos: 15000, inteiro: true });
    expect(interpretarBusca("150,00")).toMatchObject({ centavos: 15000, inteiro: false });
    expect(interpretarBusca("150,9")).toMatchObject({ centavos: 15090, inteiro: false });
    expect(interpretarBusca("1.234,56")).toMatchObject({ centavos: 123456, inteiro: false });
    expect(interpretarBusca("1.234")).toMatchObject({ centavos: 123400, inteiro: true });
    expect(interpretarBusca("R$ 150,00")).toMatchObject({ centavos: 15000, inteiro: false });
    expect(interpretarBusca("1234,56")).toMatchObject({ centavos: 123456 });
  });
  it("o que não é valor vira texto sem acento", () => {
    expect(interpretarBusca("  Gonçalves ")).toEqual({ centavos: null, inteiro: false, texto: "goncalves" });
    expect(interpretarBusca("12766/2").centavos).toBeNull();
    expect(interpretarBusca("")).toEqual({ centavos: null, inteiro: false, texto: "" });
  });
});

describe("filtrarConferencia", () => {
  const lista = [
    linha({ id: "a", valorCentavos: 15000, nome: "Acofer" }),
    linha({ id: "b", valorCentavos: 15090, nome: "Barraforte", documento: "12766/2" }),
    linha({ id: "c", valorCentavos: 115000, nome: "Gonçalves" }),
    linha({ id: "d", valorCentavos: 9000, nome: "Delta", situacao: "divergente", valorBancoCentavos: 15000 }),
  ];
  const ids = (t: string) => filtrarConferencia(lista, interpretarBusca(t)).map((l) => l.id);
  it("sem vírgula casa a parte inteira (inclusive o valor do banco do divergente), não 1.150", () => {
    expect(ids("150")).toEqual(["a", "b", "d"]);
  });
  it("com vírgula casa o valor exato", () => {
    expect(ids("150,90")).toEqual(["b"]);
    expect(ids("1.150,00")).toEqual(["c"]);
  });
  it("texto procura em nome, documento e histórico, sem acento", () => {
    expect(ids("goncal")).toEqual(["c"]);
    expect(ids("12766")).toEqual(["b"]); // número sem casar valor cai no texto do documento
    expect(ids("")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resumirConferencia e filtros", () => {
  const lista = [
    linha({ valorCentavos: 10000, situacao: "conferido" }),
    linha({ valorCentavos: 20000, situacao: "divergente", valorBancoCentavos: 21000 }),
    linha({ valorCentavos: 5000, situacao: "divergente" }),
    linha({ valorCentavos: 3000 }),
    linha({ valorCentavos: 3900000, situacao: "nao_pago", observacao: "sem saldo" }),
  ];
  it("conta e soma por situação, com a diferença dos divergentes", () => {
    const r = resumirConferencia(lista);
    expect(r.total).toEqual({ quantidade: 5, centavos: 3938000 });
    expect(r.conferidos).toEqual({ quantidade: 1, centavos: 10000 });
    expect(r.divergentes).toEqual({ quantidade: 2, centavos: 25000 });
    expect(r.faltam).toEqual({ quantidade: 1, centavos: 3000 });
    expect(r.naoPagos).toEqual({ quantidade: 1, centavos: 3900000 });
    expect(r.diferencaCentavos).toBe(1000);
    expect(r.concluida).toBe(false);
    expect(resumirConferencia(lista.slice(0, 3)).concluida).toBe(true);
    expect(resumirConferencia([lista[0], lista[4]]).concluida).toBe(true); // não pago conta como resolvido
    expect(resumirConferencia([]).concluida).toBe(false);
  });
  it("filtra por situação", () => {
    expect(filtrarPorSituacao(lista, "faltam")).toHaveLength(1);
    expect(filtrarPorSituacao(lista, "conferidos")).toHaveLength(1);
    expect(filtrarPorSituacao(lista, "divergentes")).toHaveLength(2);
    expect(filtrarPorSituacao(lista, "nao_pagos")).toHaveLength(1);
    expect(filtrarPorSituacao(lista, "todos")).toHaveLength(5);
  });
  it("não pago só em item do Consistem", () => {
    expect(ehSituacaoConferencia("nao_pago")).toBe(true);
    expect(podeMarcarNaoPago(linha({ origem: "item" }))).toBe(true);
    expect(podeMarcarNaoPago(linha({ origem: "extra", tipo: "extra" }))).toBe(false);
  });
  it("só autorizada e operador ou acima", () => {
    expect(podeConferir("autorizada", true)).toBe(true);
    expect(podeConferir("autorizada", false)).toBe(false);
    expect(podeConferir("rascunho", true)).toBe(false);
  });
});
