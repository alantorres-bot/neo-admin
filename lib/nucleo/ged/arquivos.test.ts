import { describe, expect, it } from "vitest";
import { ehArquivoTemporario, separarVersao, sugerirSubstituicoes } from "../../../supabase/functions/_shared/ged";

describe("ehArquivoTemporario", () => {
  it("~WRL, ~$ e .tmp ficam ignorados", () => {
    expect(ehArquivoTemporario("~WRL0006.tmp")).toBe(true);
    expect(ehArquivoTemporario("~$x.docx")).toBe(true);
    expect(ehArquivoTemporario("arquivo.TMP")).toBe(true);
    expect(ehArquivoTemporario("229 - CONTRATO.docx")).toBe(false);
  });
});

describe("separarVersao", () => {
  it("reconhece V2, Rev03 e (1) no fim do nome", () => {
    expect(separarVersao("Contrato - X V2.pdf")).toEqual({ base: "contrato - x", extensao: "pdf", versao: 2 });
    expect(separarVersao("Proposta Rev03.pdf")).toMatchObject({ base: "proposta", versao: 3 });
    expect(separarVersao("Planilha (1).xlsx")).toMatchObject({ base: "planilha", versao: 1 });
    expect(separarVersao("Contrato - X.pdf")).toMatchObject({ base: "contrato - x", versao: 0 });
  });
});

describe("sugerirSubstituicoes", () => {
  const arq = (id: string, nome: string, raizId = "r1", pastaId = "p1") => ({ id, nome, raizId, pastaId });

  it("X.pdf × X V2.pdf na mesma pasta são sugeridos", () => {
    expect(sugerirSubstituicoes([arq("1", "Contrato - X.pdf"), arq("2", "Contrato - X V2.pdf")])).toEqual([
      { substitutoId: "2", substituidoId: "1" },
    ]);
  });
  it("nomes diferentes ou extensões diferentes não são", () => {
    expect(sugerirSubstituicoes([arq("1", "Contrato - X.pdf"), arq("2", "Contrato - Y V2.pdf")])).toEqual([]);
    expect(sugerirSubstituicoes([arq("1", "Contrato - X.docx"), arq("2", "Contrato - X V2.pdf")])).toEqual([]);
  });
  it("o mesmo nome em raízes diferentes nunca é sugerido como versão", () => {
    expect(sugerirSubstituicoes([arq("1", "Contrato - X.pdf", "r1"), arq("2", "Contrato - X V2.pdf", "r2")])).toEqual([]);
  });
});
