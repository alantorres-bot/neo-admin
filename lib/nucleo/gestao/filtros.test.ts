import { describe, expect, it } from "vitest";
import { escaparBusca, filtrosParaBanco, hrefCentral, lerFiltros, temFiltro } from "./filtros";

const UUID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

describe("lerFiltros", () => {
  it("aceita os valores válidos e ignora o resto", () => {
    const r = lerFiltros({
      area: "financeiro", modulo: "financeiro.contas-pagar", responsavel: UUID, situacao: "bloqueada", prioridade: "alta",
      destaque: "intervir", origem: "manual", prazo_de: "2026-10-01", prazo_ate: "2026-10-31", busca: "  boleto  ", recorte: "atrasadas", pagina: "3",
    }, true);
    expect(r).toEqual({
      visao: "gestao", pagina: 3,
      filtros: { area: "financeiro", modulo: "financeiro.contas-pagar", responsavel: UUID, situacao: "bloqueada", prioridade: "alta",
        destaque: "intervir", origem: "manual", prazo_de: "2026-10-01", prazo_ate: "2026-10-31", busca: "boleto", recorte: "atrasadas" },
    });
    const ruim = lerFiltros({ area: "fin;drop", responsavel: "fulano", situacao: "x", prazo_de: "2026-13-45", recorte: "tudo", pagina: "-1" }, true);
    expect(ruim).toEqual({ visao: "gestao", pagina: 1, filtros: {} });
  });

  it("quem não é gestor fica na visão 'minhas'; gestor pode pedir 'minhas'", () => {
    expect(lerFiltros({ visao: "gestao" }, false).visao).toBe("minhas");
    expect(lerFiltros({}, true).visao).toBe("gestao");
    expect(lerFiltros({ visao: "minhas" }, true).visao).toBe("minhas");
  });

  it("aceita 'sem' como responsável e corta a busca em 100 caracteres", () => {
    expect(lerFiltros({ responsavel: "sem" }, true).filtros.responsavel).toBe("sem");
    expect(lerFiltros({ busca: "a".repeat(300) }, true).filtros.busca).toHaveLength(100);
  });
});

describe("busca", () => {
  it("escapa os curingas do ILIKE", () => {
    expect(escaparBusca("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(filtrosParaBanco({ busca: "50%", area: "fiscal" })).toEqual({ busca: "50\\%", area: "fiscal" });
  });
});

describe("hrefCentral", () => {
  it("mantém os filtros, aplica as mudanças e omite a página 1", () => {
    expect(hrefCentral("gestao", { area: "rh" }, { recorte: "hoje" })).toBe("/gestao?visao=gestao&area=rh&recorte=hoje");
    expect(hrefCentral("minhas", { area: "rh", recorte: "hoje" }, { recorte: undefined, pagina: 1 })).toBe("/gestao?visao=minhas&area=rh");
    expect(hrefCentral("gestao", {}, { pagina: 2 })).toBe("/gestao?visao=gestao&pagina=2");
  });

  it("temFiltro ignora o recorte", () => {
    expect(temFiltro({ recorte: "hoje" })).toBe(false);
    expect(temFiltro({ busca: "x" })).toBe(true);
  });
});
