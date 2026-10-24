import { describe, expect, it, vi } from "vitest";
import {
  aplicarMudanca,
  criarClienteDrive,
  listarPasta,
  MIME_PASTA,
  percorrerMudancas,
  type DocumentoIndice,
  type EstadoIndice,
  type MudancaDrive,
  type PastaIndice,
  type ResultadoMudanca,
} from "../../../supabase/functions/_shared/ged";

// Índice fictício: raiz R (profundidade 0) com a pasta de cliente P (1).
const pastaRaiz: PastaIndice = { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" };
const pastaCliente: PastaIndice = { driveId: "P", maeDriveId: "R", nome: "Cliente Exemplo", profundidade: 1, situacao: "ativa" };
const novoIndice = (): { pastas: Map<string, PastaIndice>; documentos: Map<string, DocumentoIndice>; profundidadeMax: number } => ({
  pastas: new Map([["R", pastaRaiz], ["P", pastaCliente]]),
  documentos: new Map(),
  profundidadeMax: 2,
});

const arquivo = (id: string, nome: string, mae = "P", extra: object = {}): MudancaDrive => ({
  fileId: id,
  file: { id, name: nome, mimeType: "application/pdf", parents: [mae], headRevisionId: "rev1", ...extra },
});

/** Aplica o resultado no índice em memória, como a Edge Function faria no banco. */
function gravar(indice: ReturnType<typeof novoIndice>, r: ResultadoMudanca) {
  if (r.acao === "gravar_pasta") indice.pastas.set(r.pasta.driveId, r.pasta);
  if (r.acao === "gravar_documento") indice.documentos.set(r.documento.driveId, r.documento);
}

describe("aplicarMudanca", () => {
  it("inserção de arquivo numa pasta indexada, com os campos do modelo de dados (seção 8)", () => {
    const r = aplicarMudanca(arquivo("d1", "Contrato Março.PDF", "P", { createdTime: "2026-10-01T12:00:00Z", size: "2048" }), novoIndice());
    expect(r).toMatchObject({
      acao: "gravar_documento",
      novo: true,
      novaRevisao: true,
      documento: {
        situacao: "vigente",
        pastaDriveId: "P",
        nomeNormalizado: "contrato marco.pdf",
        extensao: "pdf",
        criadoNoDriveEm: "2026-10-01T12:00:00Z",
        tamanhoBytes: 2048,
      },
    });
  });

  it("alteração: nova revisão é sinalizada; mesmo conteúdo não muda nada", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("d1", "Contrato.pdf"), indice));
    const r = aplicarMudanca(arquivo("d1", "Contrato.pdf", "P", { headRevisionId: "rev2" }), indice);
    expect(r).toMatchObject({ acao: "gravar_documento", novo: false, novaRevisao: true });
    gravar(indice, r);
    expect(aplicarMudanca(arquivo("d1", "Contrato.pdf", "P", { headRevisionId: "rev2" }), indice)).toEqual({ acao: "nenhuma" });
  });

  it("remoção e lixeira levam a removido_no_drive; nunca apaga", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("d1", "Contrato.pdf"), indice));
    expect(aplicarMudanca({ fileId: "d1", removed: true }, indice)).toMatchObject({ documento: { situacao: "removido_no_drive" } });
    expect(aplicarMudanca(arquivo("d1", "Contrato.pdf", "P", { trashed: true }), indice)).toMatchObject({
      documento: { situacao: "removido_no_drive" },
    });
  });

  it("mudança para fora do escopo e volta a vigente quando reaparece", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("d1", "Contrato.pdf"), indice));
    const fora = aplicarMudanca(arquivo("d1", "Contrato.pdf", "OUTRA"), indice);
    expect(fora).toMatchObject({ documento: { situacao: "fora_do_escopo" } });
    gravar(indice, fora);
    expect(aplicarMudanca(arquivo("d1", "Contrato.pdf"), indice)).toMatchObject({ documento: { situacao: "vigente" } });
  });

  it("idempotência: a mesma sequência aplicada duas vezes dá o mesmo índice", () => {
    const seq: MudancaDrive[] = [arquivo("d1", "A.pdf"), arquivo("d2", "B.pdf"), { fileId: "d1", removed: true }, arquivo("d2", "B.pdf", "OUTRA")];
    const indice = novoIndice();
    for (const m of seq) gravar(indice, aplicarMudanca(m, indice));
    const antes = JSON.stringify([...indice.documentos]);
    expect(seq.map((m) => aplicarMudanca(m, indice).acao).slice(2)).toEqual(["nenhuma", "nenhuma"]);
    for (const m of seq) gravar(indice, aplicarMudanca(m, indice));
    expect(JSON.stringify([...indice.documentos])).toBe(antes);
  });

  it("arquivo temporário fica ignorado; desconhecido removido não gera nada", () => {
    expect(aplicarMudanca(arquivo("t1", "~WRL0006.tmp"), novoIndice())).toMatchObject({ documento: { situacao: "ignorado" } });
    expect(aplicarMudanca({ fileId: "x", removed: true }, novoIndice())).toEqual({ acao: "nenhuma" });
    expect(aplicarMudanca(arquivo("x", "Fora.pdf", "OUTRA"), novoIndice())).toEqual({ acao: "nenhuma" });
  });

  it("substituído (decisão de uma pessoa) não volta a vigente pela indexação", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("d1", "Contrato.pdf"), indice));
    indice.documentos.set("d1", { ...(indice.documentos.get("d1") as DocumentoIndice), situacao: "substituido" });
    expect(aplicarMudanca(arquivo("d1", "Contrato.pdf", "P", { headRevisionId: "rev9" }), indice)).toMatchObject({
      documento: { situacao: "substituido" },
    });
    expect(aplicarMudanca({ fileId: "d1", removed: true }, indice)).toEqual({ acao: "nenhuma" });
  });

  it("pastas: entram até a profundidade máxima; a raiz não é movida pela indexação", () => {
    const indice = novoIndice();
    const sub = (id: string, mae: string): MudancaDrive => ({ fileId: id, file: { id, name: id, mimeType: MIME_PASTA, parents: [mae] } });
    const r = aplicarMudanca(sub("S", "P"), indice);
    expect(r).toMatchObject({ acao: "gravar_pasta", pasta: { profundidade: 2, situacao: "ativa" } });
    gravar(indice, r);
    expect(aplicarMudanca(sub("S2", "S"), indice)).toEqual({ acao: "nenhuma" });
    expect(aplicarMudanca({ fileId: "S", removed: true }, indice)).toMatchObject({ pasta: { situacao: "removida_no_drive" } });
    expect(aplicarMudanca({ fileId: "R", removed: true }, indice as EstadoIndice)).toEqual({ acao: "nenhuma" });
  });
});

describe("percorrerMudancas", () => {
  const pagina = (corpo: object) => new Response(JSON.stringify(corpo), { status: 200 });

  it("várias páginas: aplica todas e só então devolve o newStartPageToken", async () => {
    const paginas = [
      { changes: [{ fileId: "a" }], nextPageToken: "t2" },
      { changes: [{ fileId: "b" }], nextPageToken: "t3" },
      { changes: [{ fileId: "c" }], newStartPageToken: "novo" },
    ];
    const f = vi.fn(async () => pagina(paginas.shift() as object));
    const aplicadas: string[] = [];
    const r = await percorrerMudancas(criarClienteDrive(async () => "t", { fazerFetch: f }), "t1", async (ms) => {
      aplicadas.push(...ms.map((m) => m.fileId));
    }, { maxItens: 5000 });
    expect(r).toEqual({ proximoToken: "novo", completa: true, itens: 3 });
    expect(aplicadas).toEqual(["a", "b", "c"]);
    expect(String((f.mock.calls[1] as unknown[])[0])).toContain("pageToken=t2");
  });

  it("falha no meio: lança e não devolve token novo", async () => {
    const paginas = [{ changes: [{ fileId: "a" }], nextPageToken: "t2" }, { changes: [{ fileId: "b" }], nextPageToken: "t3" }];
    const f = vi.fn(async () => pagina(paginas.shift() as object));
    let chamadas = 0;
    await expect(
      percorrerMudancas(criarClienteDrive(async () => "t", { fazerFetch: f }), "t1", async () => {
        if (++chamadas === 2) throw new Error("falha ao gravar");
      }, { maxItens: 5000 }),
    ).rejects.toThrow("falha ao gravar");
  });

  it("limite por rodada: para depois da página e devolve o token da seguinte", async () => {
    const paginas = [{ changes: [{ fileId: "a" }, { fileId: "b" }], nextPageToken: "t2" }];
    const f = vi.fn(async () => pagina(paginas.shift() as object));
    const r = await percorrerMudancas(criarClienteDrive(async () => "t", { fazerFetch: f }), "t1", async () => {}, { maxItens: 2 });
    expect(r).toEqual({ proximoToken: "t2", completa: false, itens: 2 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("aplicarMudanca — casos adicionais", () => {
  it("temporário renomeado para nome normal passa a vigente", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("t1", "~$Contrato.docx"), indice));
    expect(indice.documentos.get("t1")?.situacao).toBe("ignorado");
    expect(aplicarMudanca(arquivo("t1", "Contrato.docx"), indice)).toMatchObject({ documento: { situacao: "vigente" } });
  });

  it("várias pastas-mãe: basta uma indexada", () => {
    const m: MudancaDrive = { fileId: "d1", file: { id: "d1", name: "A.pdf", mimeType: "application/pdf", parents: ["OUTRA", "P"] } };
    expect(aplicarMudanca(m, novoIndice())).toMatchObject({ documento: { pastaDriveId: "P", situacao: "vigente" } });
  });

  it("atalho guarda o destino", () => {
    const m = arquivo("a1", "Atalho", "P", { mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: "alvo" } });
    expect(aplicarMudanca(m, novoIndice())).toMatchObject({ documento: { atalhoPara: "alvo" } });
  });

  it("pasta já indexada e sem mudança: nenhuma; pasta-mãe removida tira a filha do escopo", () => {
    const indice = novoIndice();
    const sub: MudancaDrive = { fileId: "S", file: { id: "S", name: "S", mimeType: MIME_PASTA, parents: ["P"] } };
    gravar(indice, aplicarMudanca(sub, indice));
    expect(aplicarMudanca(sub, indice)).toEqual({ acao: "nenhuma" });
    gravar(indice, aplicarMudanca({ fileId: "P", removed: true }, indice));
    expect(aplicarMudanca(sub, indice)).toMatchObject({ pasta: { situacao: "fora_do_escopo" } });
  });

  it("mudança sem arquivo e sem removed é tratada como remoção, nunca como inserção", () => {
    const indice = novoIndice();
    gravar(indice, aplicarMudanca(arquivo("d1", "A.pdf"), indice));
    expect(aplicarMudanca({ fileId: "d1" }, indice)).toMatchObject({ documento: { situacao: "removido_no_drive" } });
  });
});

describe("percorrerMudancas — repetição e parâmetros", () => {
  it("429 numa página do meio é repetido e a rodada termina normalmente", async () => {
    const respostas = [
      new Response(JSON.stringify({ changes: [{ fileId: "a" }], nextPageToken: "t2" }), { status: 200 }),
      new Response("{}", { status: 429 }),
      new Response(JSON.stringify({ changes: [{ fileId: "b" }], newStartPageToken: "novo" }), { status: 200 }),
    ];
    const f = vi.fn(async () => respostas.shift() as Response);
    const cliente = criarClienteDrive(async () => "t", { fazerFetch: f, esperar: async () => {} });
    const r = await percorrerMudancas(cliente, "t1", async () => {}, { maxItens: 5000, driveId: "DRV" });
    expect(r).toEqual({ proximoToken: "novo", completa: true, itens: 2 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("driveId=DRV");
  });

  it("resposta sem token de continuação é erro, e o token não avança", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ changes: [] }), { status: 200 }));
    const cliente = criarClienteDrive(async () => "t", { fazerFetch: f });
    await expect(percorrerMudancas(cliente, "t1", async () => {}, { maxItens: 10 })).rejects.toThrow("sem token de continuação");
  });
});

describe("listarPasta", () => {
  it("junta as páginas do files.list e recusa ID com caracteres estranhos", async () => {
    const paginas = [{ files: [{ id: "1" }], nextPageToken: "p2" }, { files: [{ id: "2" }] }];
    const f = vi.fn(async () => new Response(JSON.stringify(paginas.shift()), { status: 200 }));
    const cliente = criarClienteDrive(async () => "t", { fazerFetch: f });
    expect((await listarPasta(cliente, "PastaExemplo_1")).map((a) => a.id)).toEqual(["1", "2"]);
    await expect(listarPasta(cliente, "x' or name contains 'a")).rejects.toThrow("ID de pasta inválido.");
  });
});
