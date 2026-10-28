import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarMudanca,
  linhaDocumento,
  linhaPasta,
  linhaRevisao,
  pistasArquivoTrabalho,
  type DocumentoIndice,
  type PastaIndice,
} from "../../../supabase/functions/_shared/ged";

describe("pistasArquivoTrabalho (5.4.8)", () => {
  it("número no início e cliente curto no fim, sem extensão nem versão", () => {
    expect(pistasArquivoTrabalho("229 - CONTRATO DE VENDA FÔRMAS - Construtora Exemplo.docx")).toEqual({
      numeroContrato: "229",
      clienteCurto: "Construtora Exemplo",
    });
    expect(pistasArquivoTrabalho("229 - CONTRATO DE VENDA FÔRMAS - Construtora Exemplo V2.pdf").clienteCurto).toBe("Construtora Exemplo");
  });
  it("sem o padrão, não inventa pista", () => {
    expect(pistasArquivoTrabalho("CONTRATO DE VENDA FÔRMAS.docx")).toEqual({ numeroContrato: null, clienteCurto: null });
    expect(pistasArquivoTrabalho("2290 CONTRATO.docx").numeroContrato).toBeNull();
    expect(pistasArquivoTrabalho("229 - 2026.pdf")).toEqual({ numeroContrato: "229", clienteCurto: null });
  });
});

describe("linhas para o banco × modelo de dados da especificação (seção 8)", () => {
  // Colunas listadas na linha da tabela na seção 8 do GED (`nome`, `nome_x/y` vira nome_x e nome_y).
  const spec = readFileSync(join(__dirname, "../../../docs/modulos/administrativo-ged.md"), "utf8");
  function colunas(tabela: string): Set<string> {
    const linha = spec.split("\n").find((l) => l.startsWith(`| \`${tabela}\` |`));
    if (!linha) throw new Error(`Tabela ${tabela} não encontrada na especificação.`);
    const campos = linha.split("|")[2];
    const nomes = [...campos.matchAll(/`([a-z0-9_]+)(?:\/([a-z0-9_]+))?`/g)].flatMap(([, a, b]) => {
      if (!b) return [a];
      const base = a.slice(0, a.lastIndexOf("_") + 1);
      return [a, base + b];
    });
    return new Set(nomes);
  }

  const doc: DocumentoIndice = {
    driveId: "d1", pastaDriveId: "P", nome: "A.pdf", nomeNormalizado: "a.pdf", extensao: "pdf", mime: "application/pdf",
    driveRevisao: "r1", criadoNoDriveEm: null, alteradoNoDriveEm: null, tamanhoBytes: 10, md5: null, webLink: null,
    atalhoPara: null, situacao: "vigente",
  };
  const pasta: PastaIndice = { driveId: "P", maeDriveId: "R", nome: "P", profundidade: 1, situacao: "ativa" };

  it("ged_documentos: toda coluna gerada existe na especificação", () => {
    const cols = colunas("ged_documentos");
    for (const k of Object.keys(linhaDocumento(doc, { raizId: "uuid-r", pastaId: "uuid-p" }))) expect(cols.has(k), k).toBe(true);
  });
  it("ged_pastas: toda coluna gerada existe na especificação", () => {
    const cols = colunas("ged_pastas");
    for (const k of Object.keys(linhaPasta(pasta, { raizId: "uuid-r" }))) expect(cols.has(k), k).toBe(true);
  });
  it("ged_documento_revisoes: toda coluna gerada existe na especificação", () => {
    const cols = colunas("ged_documento_revisoes");
    for (const k of Object.keys(linhaRevisao(doc, "uuid-d"))) expect(cols.has(k), k).toBe(true);
    expect(() => linhaRevisao({ ...doc, driveRevisao: null }, "uuid-d")).toThrow();
  });
  it("as situações do índice são as da especificação (8 e 8.1)", () => {
    for (const s of ["vigente", "substituido", "removido_no_drive", "fora_do_escopo", "ignorado"]) expect(spec).toContain(`\`${s}\``);
    for (const s of ["ativa", "removida_no_drive", "fora_do_escopo"]) expect(spec).toContain(`\`${s}\``);
  });
  it("a linha gerada pela indexação não carrega tipo, cliente nem versão (decisões de pessoas)", () => {
    const r = aplicarMudanca(
      { fileId: "d1", file: { id: "d1", name: "A.pdf", mimeType: "application/pdf", parents: ["P"] } },
      { pastas: new Map([["P", pasta]]), documentos: new Map(), profundidadeMax: 4 },
    );
    if (r.acao !== "gravar_documento") throw new Error("esperava gravar_documento");
    const linha = linhaDocumento(r.documento, { raizId: "uuid-r", pastaId: "uuid-p" });
    for (const k of ["tipo", "tipo_situacao", "contraparte_id", "substitui_id", "modelo_situacao"]) expect(linha).not.toHaveProperty(k);
  });
});
