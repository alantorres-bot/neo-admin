import { describe, expect, it } from "vitest";
import {
  aplicarCorteAntecipacoes, aplicarFiltrosPendentes, dataReferencia, descreverSituacao, diasAtraso, ehDataIso, ordenarPendentes, paginar, textoBusca, totalizar,
  type ItemPendente,
} from "./pendentes";

const HOJE = "2026-10-09";
function item(p: Partial<ItemPendente> & { id: string }): ItemPendente {
  return {
    empresaId: "e1", tipo: "titulo", codLancamento: p.id, codFornecedor: "1", fornecedor: "ALUSSIN IND. E COM. METAIS LTDA", documentoFornecedor: "12.345.678/0001-95",
    numDocumento: "NF 10", emissao: "2026-09-01", vencimento: "2026-10-20", dataPagamento: null, valorDocumentoCentavos: 10_000, saldoCentavos: 10_000,
    complemento: "", codBanco: "91", categoria: "16", autorizacao: null, tratada: null, ...p,
  };
}
const antecipacao = (id: string, extra: Partial<ItemPendente> = {}) =>
  item({ id, tipo: "antecipacao", vencimento: null, emissao: "2026-10-01", fornecedor: "PERFILADOS MULTIACO", complemento: "ANTECIPAÇÃO DE COMPRA - PEDIDO 948", ...extra });
const filtro = { busca: "", tipo: "todos" as const, situacao: "todos" as const, mostrar: "pendentes" as const, vencDe: null, vencAte: null };

describe("data de referência e atraso", () => {
  it("título usa o vencimento; antecipação usa o pagamento programado ou, sem ele, a emissão", () => {
    expect(dataReferencia(item({ id: "1" }))).toBe("2026-10-20");
    expect(dataReferencia(antecipacao("2"))).toBe("2026-10-01");
    expect(dataReferencia(antecipacao("3", { dataPagamento: "2026-10-28" }))).toBe("2026-10-28");
  });
  it("atraso só em título vencido", () => {
    expect(diasAtraso(item({ id: "1", vencimento: "2026-10-01" }), HOJE)).toBe(8);
    expect(diasAtraso(item({ id: "1" }), HOJE)).toBe(0);
    expect(diasAtraso(antecipacao("2"), HOJE)).toBe(0);
  });
  it("descreve a situação", () => {
    expect(descreverSituacao(item({ id: "1", vencimento: "2026-10-08" }), HOJE)).toBe("vencido há 1 dia");
    expect(descreverSituacao(item({ id: "1", vencimento: "2026-10-09" }), HOJE)).toBe("vence hoje");
    expect(descreverSituacao(item({ id: "1", vencimento: "2026-10-10" }), HOJE)).toBe("vence amanhã");
    expect(descreverSituacao(item({ id: "1", vencimento: "2026-10-20" }), HOJE)).toBe("vence em 11 dias");
    expect(descreverSituacao(antecipacao("2", { dataPagamento: "2026-10-28" }), HOJE)).toBe("programada para 28/10");
    expect(descreverSituacao(antecipacao("2"), HOJE)).toBe("sem data de pagamento");
  });
  it("ehDataIso confere o calendário", () => {
    expect(ehDataIso("2026-10-09")).toBe(true);
    expect(ehDataIso("2026-13-01")).toBe(false);
    expect(ehDataIso("09/10/2026")).toBe(false);
  });
});

describe("corte das antecipações", () => {
  it("sem corte, tudo entra; com corte, antecipação anterior sai e título fica", () => {
    const itens = [item({ id: "t", vencimento: "2026-01-01" }), antecipacao("a1", { emissao: "2026-09-01" }), antecipacao("a2", { emissao: "2026-10-05" }), antecipacao("a3", { emissao: "2026-09-01", dataPagamento: "2026-10-02" })];
    expect(aplicarCorteAntecipacoes(itens, null).map((i) => i.id)).toEqual(["t", "a1", "a2", "a3"]);
    expect(aplicarCorteAntecipacoes(itens, "2026-10-01").map((i) => i.id)).toEqual(["t", "a2", "a3"]);
  });
});

describe("filtros", () => {
  const itens = [
    item({ id: "v", vencimento: "2026-10-01" }),
    item({ id: "f", vencimento: "2026-10-20", fornecedor: "HYDRO EXTRUSION", codFornecedor: "642", documentoFornecedor: "99.999.999/0001-91", numDocumento: "577082/1" }),
    antecipacao("a", { dataPagamento: "2026-10-15" }),
  ];
  it("mostrar: pendentes esconde quem já está em autorização ativa ou foi tratado; todos inclui", () => {
    const lista = [item({ id: "livre" }), item({ id: "aut", autorizacao: { id: "a", numero: 3, status: "rascunho" } }), antecipacao("trat", { tratada: { id: "t", motivo: "borderô 1", em: "2026-10-01" } })];
    expect(aplicarFiltrosPendentes(lista, filtro, HOJE).map((i) => i.id)).toEqual(["livre"]);
    expect(aplicarFiltrosPendentes(lista, { ...filtro, mostrar: "todos" }, HOJE).map((i) => i.id)).toEqual(["livre", "aut", "trat"]);
  });
  it("por tipo", () => {
    expect(aplicarFiltrosPendentes(itens, { ...filtro, tipo: "titulos" }, HOJE).map((i) => i.id)).toEqual(["v", "f"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, tipo: "antecipacoes" }, HOJE).map((i) => i.id)).toEqual(["a"]);
  });
  it("por situação: vencidos só títulos vencidos; a vencer tira os vencidos e mantém antecipações", () => {
    expect(aplicarFiltrosPendentes(itens, { ...filtro, situacao: "vencidos" }, HOJE).map((i) => i.id)).toEqual(["v"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, situacao: "a_vencer" }, HOJE).map((i) => i.id)).toEqual(["f", "a"]);
  });
  it("por período da data de referência", () => {
    expect(aplicarFiltrosPendentes(itens, { ...filtro, vencDe: "2026-10-10", vencAte: "2026-10-16" }, HOJE).map((i) => i.id)).toEqual(["a"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, vencAte: "2026-10-15" }, HOJE).map((i) => i.id)).toEqual(["v", "a"]);
  });
  it("busca sem acento por fornecedor, código, documento, CNPJ só dígitos e histórico", () => {
    expect(aplicarFiltrosPendentes(itens, { ...filtro, busca: "hydro" }, HOJE).map((i) => i.id)).toEqual(["f"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, busca: "642" }, HOJE).map((i) => i.id)).toEqual(["f"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, busca: "577082" }, HOJE).map((i) => i.id)).toEqual(["f"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, busca: "99999999000191" }, HOJE).map((i) => i.id)).toEqual(["f"]);
    expect(aplicarFiltrosPendentes(itens, { ...filtro, busca: "antecipacao pedido 948" }, HOJE).map((i) => i.id)).toEqual(["a"]);
    expect(textoBusca(itens[1])).toContain("99999999000191");
  });
});

describe("ordem, totais e paginação", () => {
  it("ordena por data de referência (vencidos primeiro), fornecedor, e sem data por último", () => {
    const itens = [antecipacao("sem", { emissao: null }), item({ id: "b", vencimento: "2026-10-20", fornecedor: "B" }), item({ id: "a", vencimento: "2026-10-20", fornecedor: "A" }), item({ id: "v", vencimento: "2026-09-30" }), antecipacao("ant", { dataPagamento: "2026-10-10" })];
    expect(ordenarPendentes(itens).map((i) => i.id)).toEqual(["v", "ant", "a", "b", "sem"]);
  });
  it("totais por tipo, geral e vencidos", () => {
    const t = totalizar([item({ id: "1", saldoCentavos: 100, vencimento: "2026-10-01" }), item({ id: "2", saldoCentavos: 250 }), antecipacao("3", { saldoCentavos: 1_000 })], HOJE);
    expect(t).toEqual({ titulos: { quantidade: 2, centavos: 350 }, antecipacoes: { quantidade: 1, centavos: 1_000 }, geral: { quantidade: 3, centavos: 1_350 }, vencidos: { quantidade: 1, centavos: 100 } });
  });
  it("pagina com limites", () => {
    const itens = Array.from({ length: 7 }, (_, i) => i);
    expect(paginar(itens, 2, 3)).toEqual({ pagina: 2, totalPaginas: 3, itens: [3, 4, 5] });
    expect(paginar(itens, 9, 3).pagina).toBe(3);
    expect(paginar([], 1, 3)).toEqual({ pagina: 1, totalPaginas: 1, itens: [] });
  });
});
