import { describe, expect, it } from "vitest";
import { classificarTipo, ErroRegraTipo, prepararRegras, type DocumentoClassificavel } from "./tipos";

// Regras ILUSTRATIVAS da 5.5, só para teste; as reais vêm do catálogo [PENDENTE 6].
const regras = prepararRegras([
  { tipo: "proposta_comercial", expressao: "^\\d{2}\\.\\d{3} ?[vl]\\b", prioridade: 10 },
  { tipo: "contrato_assinado", expressao: "assinad", prioridade: 20 },
  { tipo: "contrato_minuta", expressao: "^\\d+ - contrato", prioridade: 30, finalidade: "elaboracao", funcaoPasta: "trabalho" },
  { tipo: "contrato_minuta", expressao: "minuta", prioridade: 40 },
  { tipo: "cartao_cnpj", expressao: "cartao (de )?cnpj", prioridade: 50 },
  { tipo: "aditamento", expressao: "aditament|aditivo", prioridade: 60 },
]);
const doc = (nome: string, extra: Partial<DocumentoClassificavel> = {}): DocumentoClassificavel => ({
  nome, finalidade: "dossie_cliente", funcaoPasta: null, tipo: null, tipoSituacao: "sem_tipo", ...extra,
});

describe("classificarTipo", () => {
  it("o exemplo 26.199 V Rev03 vira proposta_comercial", () => {
    expect(classificarTipo(doc("26.199 V Rev03 - x.pdf"), regras)).toEqual({ tipo: "proposta_comercial", tipoSituacao: "sugerido" });
  });
  it("prioridade: a primeira regra que casa vence", () => {
    expect(classificarTipo(doc("Minuta aditivo assinada.pdf"), regras).tipo).toBe("contrato_assinado");
    expect(classificarTipo(doc("Minuta do aditivo.pdf"), regras).tipo).toBe("contrato_minuta");
  });
  it("nome sem regra: sem_tipo", () => {
    expect(classificarTipo(doc("foto da obra.jpg"), regras)).toEqual({ tipo: null, tipoSituacao: "sem_tipo" });
  });
  it("tipo confirmado nunca é alterado", () => {
    expect(classificarTipo(doc("Cartão de CNPJ.pdf", { tipo: "outro", tipoSituacao: "confirmado" }), regras)).toEqual({
      tipo: "outro",
      tipoSituacao: "confirmado",
    });
  });
  it("PDF em pasta de trabalho nunca é sugerido como contrato_assinado", () => {
    const d = doc("229 - CONTRATO DE VENDA assinado.pdf", { finalidade: "elaboracao", funcaoPasta: "trabalho" });
    expect(classificarTipo(d, regras).tipo).toBe("contrato_minuta");
  });
  it("a raiz limita a sugestão: elaboração não sugere boleto; dossiê não sugere modelo", () => {
    const comBoleto = prepararRegras([{ tipo: "boleto", expressao: "boleto", prioridade: 1 }, { tipo: "modelo_contrato", expressao: "modelo", prioridade: 2 }]);
    expect(classificarTipo(doc("boleto parcela 1.pdf", { finalidade: "elaboracao" }), comBoleto).tipoSituacao).toBe("sem_tipo");
    expect(classificarTipo(doc("boleto parcela 1.pdf"), comBoleto).tipo).toBe("boleto");
    expect(classificarTipo(doc("modelo antigo.docx"), comBoleto).tipoSituacao).toBe("sem_tipo");
  });
  it("PROVISÓRIO [PENDENTE 6]: a lista cadastral do assistente também não é sugerida na elaboração", () => {
    expect(classificarTipo(doc("Cartão de CNPJ.pdf", { finalidade: "elaboracao" }), regras).tipoSituacao).toBe("sem_tipo");
  });
  it("arquivo em pasta de modelos vira modelo_contrato não avaliado", () => {
    expect(classificarTipo(doc("CONTRATO DE VENDA.docx", { finalidade: "elaboracao", funcaoPasta: "modelos" }), regras)).toEqual({
      tipo: "modelo_contrato",
      tipoSituacao: "sugerido",
      modeloSituacao: "nao_avaliado",
    });
  });
  it("expressão inválida é erro de configuração", () => {
    expect(() => prepararRegras([{ tipo: "x", expressao: "(", prioridade: 1 }])).toThrow(ErroRegraTipo);
  });
});
