import { describe, expect, it, vi } from "vitest";
import {
  aplicarMudanca,
  ausentesNaListagem,
  consultarAusente,
  criarClienteDrive,
  MIME_PASTA,
  mudancasDaArvore,
  percorrerArvore,
  resumirArvore,
  resumirRodada,
  type ArquivoDrive,
  type DocumentoIndice,
  type PastaIndice,
  type ResultadoMudanca,
} from "../../../supabase/functions/_shared/ged";

// Drive fictício em memória: id da pasta → conteúdo. Responde ao files.list e ao files.get como a API.
const pasta = (id: string, mae: string): ArquivoDrive => ({ id, name: `Pasta ${id}`, mimeType: MIME_PASTA, parents: [mae] });
const doc = (id: string, nome: string, mae: string): ArquivoDrive => ({ id, name: nome, mimeType: "application/pdf", parents: [mae], headRevisionId: "r1" });

const DRIVE: Record<string, ArquivoDrive[]> = {
  R: [pasta("A", "R"), pasta("B", "R"), doc("d0", "Na raiz.pdf", "R")],
  A: [pasta("A1", "A"), doc("d1", "Contrato.docx", "A"), doc("t1", "~WRL0006.tmp", "A")],
  A1: [pasta("A11", "A1"), doc("d2", "Contrato V2.pdf", "A1")],
  A11: [doc("d3", "Fundo.pdf", "A11")],
  B: [doc("d4", "Cartão.pdf", "B")],
};

function driveFalso(extra: Record<string, ArquivoDrive> = {}) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/files")) {
      const id = /^'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
      return new Response(JSON.stringify({ files: DRIVE[id] ?? [] }), { status: 200 });
    }
    const id = u.pathname.split("/").pop() as string;
    return extra[id]
      ? new Response(JSON.stringify(extra[id]), { status: 200 })
      : new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
  });
}
const cliente = (f = driveFalso()) => criarClienteDrive(async () => "token-ficticio", { fazerFetch: f, esperar: async () => {} });

describe("percorrerArvore", () => {
  it("percorre em largura até a profundidade máxima, sem abrir pastas além dela", async () => {
    const f = driveFalso();
    const arvore = await percorrerArvore(cliente(f), "R", { profundidadeMax: 2, maxItens: 1000 });
    expect(arvore.pastas.map((p) => [p.arquivo.id, p.profundidade])).toEqual([["A", 1], ["B", 1], ["A1", 2]]);
    expect(arvore.arquivos.map((a) => a.arquivo.id)).toEqual(["d0", "d1", "t1", "d4", "d2"]);
    expect(arvore.truncada).toBe(false);
    // A11 (profundidade 3) nunca foi listada.
    expect(f.mock.calls.some(([u]) => String(u).includes("A11"))).toBe(false);
  });

  it("para no limite de itens e marca a árvore como truncada", async () => {
    const arvore = await percorrerArvore(cliente(), "R", { profundidadeMax: 4, maxItens: 2 });
    expect(arvore.truncada).toBe(true);
    expect(arvore.pastas.length + arvore.arquivos.length).toBe(2);
  });
});

describe("carga inicial pela árvore", () => {
  it("as mudanças da árvore aplicadas em ordem montam o índice inteiro, e reaplicar não muda nada", async () => {
    const arvore = await percorrerArvore(cliente(), "R", { profundidadeMax: 2, maxItens: 1000 });
    const pastas = new Map<string, PastaIndice>([["R", { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" }]]);
    const documentos = new Map<string, DocumentoIndice>();
    const indice = { pastas, documentos, profundidadeMax: 2 };
    const resultados: ResultadoMudanca[] = [];
    for (const m of mudancasDaArvore(arvore)) {
      const r = aplicarMudanca(m, indice);
      resultados.push(r);
      if (r.acao === "gravar_pasta") pastas.set(r.pasta.driveId, r.pasta);
      if (r.acao === "gravar_documento") documentos.set(r.documento.driveId, r.documento);
    }
    expect([...pastas.keys()].sort()).toEqual(["A", "A1", "B", "R"]);
    expect(documentos.get("t1")?.situacao).toBe("ignorado");
    expect(resumirRodada(resultados)).toEqual({ novos: 4, alterados: 0, removidos: 0, ignorados: 1, pastas: 3 });
    expect(mudancasDaArvore(arvore).every((m) => aplicarMudanca(m, indice).acao === "nenhuma")).toBe(true);
  });
});

describe("resumirArvore (verificação, 5.2.4.1)", () => {
  it("contagens por nível, subpastas de 1º e 2º nível, extensões e temporários", async () => {
    const r = resumirArvore(await percorrerArvore(cliente(), "R", { profundidadeMax: 2, maxItens: 1000 }));
    expect(r.porNivel).toEqual([
      { profundidade: 0, pastas: 0, arquivos: 1 },
      { profundidade: 1, pastas: 2, arquivos: 3 },
      { profundidade: 2, pastas: 1, arquivos: 1 },
    ]);
    expect(r.subpastasNivel1).toEqual(["Pasta A", "Pasta B"]);
    expect(r.subpastasNivel2).toEqual(["Pasta A1"]);
    expect(r.extensoes[0]).toEqual({ extensao: "pdf", quantidade: 3 });
    expect(r.temporarios).toEqual(["~WRL0006.tmp"]);
    expect(r.truncada).toBe(false);
  });
});

describe("reconciliação (5.3.4)", () => {
  const indiceCom = (docs: DocumentoIndice[]) => ({
    pastas: new Map<string, PastaIndice>([
      ["R", { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" }],
      ["A", { driveId: "A", maeDriveId: "R", nome: "Pasta A", profundidade: 1, situacao: "ativa" }],
    ]),
    documentos: new Map(docs.map((d) => [d.driveId, d])),
    profundidadeMax: 2,
  });
  const indexado = (id: string, situacao: DocumentoIndice["situacao"] = "vigente"): DocumentoIndice => ({
    driveId: id, pastaDriveId: "A", nome: `${id}.pdf`, nomeNormalizado: `${id}.pdf`, extensao: "pdf", mime: "application/pdf",
    driveRevisao: "r1", criadoNoDriveEm: null, alteradoNoDriveEm: null,
    tamanhoBytes: null, md5: null, webLink: null, atalhoPara: null, situacao,
  });

  it("aponta só os indexados que sumiram da listagem (sem a raiz e sem os já removidos)", async () => {
    const arvore = await percorrerArvore(cliente(), "R", { profundidadeMax: 2, maxItens: 1000 });
    const indice = indiceCom([indexado("d1"), indexado("sumiu"), indexado("velho", "removido_no_drive"), indexado("subst", "substituido")]);
    expect(ausentesNaListagem(arvore, indice)).toEqual(["sumiu"]);
  });

  it("listagem truncada não serve para reconciliar", async () => {
    const arvore = await percorrerArvore(cliente(), "R", { profundidadeMax: 2, maxItens: 1 });
    expect(() => ausentesNaListagem(arvore, indiceCom([indexado("d1")]))).toThrow("Listagem incompleta");
  });

  it("ausente consultado: 404 vira removido; movido para fora vira fora do escopo", async () => {
    const indice = indiceCom([indexado("apagado"), indexado("movido")]);
    const c = cliente(driveFalso({ movido: doc("movido", "movido.pdf", "OUTRA") }));
    expect(aplicarMudanca(await consultarAusente(c, "apagado"), indice)).toMatchObject({ documento: { situacao: "removido_no_drive" } });
    expect(aplicarMudanca(await consultarAusente(c, "movido"), indice)).toMatchObject({ documento: { situacao: "fora_do_escopo" } });
  });

  it("erro que não é 404 não vira remoção", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(consultarAusente(cliente(f), "x")).rejects.toMatchObject({ status: 403 });
    await expect(consultarAusente(cliente(f), "x/../y")).rejects.toThrow("ID de arquivo inválido.");
  });
});
