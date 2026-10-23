import { describe, expect, it } from "vitest";
import type { MenuArea } from "../permissoes";
import { contextoDaTela, descreverEventoSugestao, exigeJustificativa, proximasSituacoes } from "./sugestoes";

const menu: MenuArea[] = [
  { area: { codigo: "financeiro", nome: "Financeiro", sensivel: false, ordem: 1 }, modulos: [
    { codigo: "financeiro.recebiveis", nome: "Recebíveis", rota: "/financeiro/recebiveis" },
    { codigo: "app:vigilancia", nome: "Vigilância", rota: "/apps/vigilancia", externo: true },
  ] },
];

describe("sugestões", () => {
  it("transições espelham o banco", () => {
    expect(proximasSituacoes("nova")).toEqual(["em_avaliacao", "aprovada", "nao_aprovada"]);
    expect(proximasSituacoes("concluida")).toEqual(["em_desenvolvimento"]);
    expect(exigeJustificativa("aprovada")).toBe(true);
    expect(exigeJustificativa("em_desenvolvimento")).toBe(false);
  });
  it("contexto da tela: módulo nativo, Central ou nenhum", () => {
    expect(contextoDaTela("/financeiro/recebiveis/fila", menu)).toEqual({ area: "financeiro", modulo: "financeiro.recebiveis" });
    expect(contextoDaTela("/gestao/atividades", menu)).toEqual({ area: "administrativo", modulo: "administrativo.gestao" });
    expect(contextoDaTela("/apps/vigilancia", menu)).toEqual({ area: null, modulo: null });
    expect(contextoDaTela("/inicio", menu)).toEqual({ area: null, modulo: null });
  });
  it("textos do histórico", () => {
    const base = { em: "2026-10-23T12:00:00Z", quem: "Alan" };
    expect(descreverEventoSugestao({ ...base, evento: "enviada", de: null, para: "nova", texto: null })).toBe("Enviou a sugestão");
    expect(descreverEventoSugestao({ ...base, evento: "situacao", de: "em_avaliacao", para: "aprovada", texto: "Vale a pena" }))
      .toBe("Situação: Em avaliação → Aprovada. Justificativa: Vale a pena");
    expect(descreverEventoSugestao({ ...base, evento: "comentario", de: null, para: null, texto: "Detalhe" })).toBe("Comentou: Detalhe");
  });
});
