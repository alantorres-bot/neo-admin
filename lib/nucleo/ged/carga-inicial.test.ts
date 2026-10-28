import { describe, expect, it, vi } from "vitest";
import {
  cargaInicial,
  criarClienteDrive,
  documentosParaGravar,
  linhaDocumento,
  MIME_PASTA,
  pastasParaGravar,
  revisoesParaGravar,
  type ArquivoDrive,
  type DocumentoIndice,
  type EstadoIndice,
  type PastaIndice,
  type ResultadoMudanca,
} from "../../../supabase/functions/_shared/ged";

// Drive fictício: cada pasta devolve o conteúdo em páginas de `porPagina` itens, com nextPageToken.
const pasta = (id: string, mae: string): ArquivoDrive => ({ id, name: `Pasta ${id}`, mimeType: MIME_PASTA, parents: [mae] });
const arq = (id: string, nome: string, mae: string, rev = "r1"): ArquivoDrive => ({
  id, name: nome, mimeType: "application/pdf", parents: [mae], headRevisionId: rev,
});

type Opcoes = { porPagina?: number; falharNaChamada?: number; status?: number };
function drive(conteudo: Record<string, ArquivoDrive[]>, o: Opcoes = {}) {
  const porPagina = o.porPagina ?? 2;
  let chamadas = 0;
  return vi.fn(async (url: string) => {
    chamadas++;
    if (o.falharNaChamada === chamadas) return new Response("{}", { status: o.status ?? 500 });
    const u = new URL(url);
    if (u.pathname.endsWith("/changes/startPageToken")) return new Response(JSON.stringify({ startPageToken: "inicio-1" }), { status: 200 });
    const id = /^'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
    const desde = Number(u.searchParams.get("pageToken") ?? 0);
    const itens = conteudo[id] ?? [];
    const pagina = itens.slice(desde, desde + porPagina);
    const proxima = desde + porPagina < itens.length ? { nextPageToken: String(desde + porPagina) } : {};
    return new Response(JSON.stringify({ files: pagina, ...proxima }), { status: 200 });
  });
}
const cliente = (f: ReturnType<typeof drive>) => criarClienteDrive(async () => "token-ficticio", { fazerFetch: f, esperar: async () => {} });

const RAIZ: PastaIndice = { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" };
const indiceVazio = (profundidadeMax = 2): EstadoIndice => ({ pastas: new Map([["R", RAIZ]]), documentos: new Map(), profundidadeMax });

/** Aplica os resultados num índice em memória, como a gravação faria. */
function aplicar(indice: EstadoIndice, resultados: readonly ResultadoMudanca[]): EstadoIndice {
  const pastas = new Map(indice.pastas);
  const documentos = new Map(indice.documentos);
  for (const r of resultados) {
    if (r.acao === "gravar_pasta") pastas.set(r.pasta.driveId, r.pasta);
    if (r.acao === "gravar_documento") documentos.set(r.documento.driveId, r.documento);
  }
  return { ...indice, pastas, documentos };
}

const CONTEUDO: Record<string, ArquivoDrive[]> = {
  R: [pasta("A", "R"), arq("d1", "229 - CONTRATO DE VENDA - Cliente Exemplo.docx", "R"), arq("d2", "Proposta.pdf", "R"), arq("t1", "~$rascunho.docx", "R")],
  A: [pasta("A1", "A"), arq("d3", "Sem padrão algum.pdf", "A"), arq("d4", "Cartão de CNPJ.pdf", "A")],
  A1: [pasta("FUNDO", "A1"), arq("d5", "Contrato V2.pdf", "A1")],
  FUNDO: [arq("d6", "Além da profundidade.pdf", "FUNDO")],
};

describe("cargaInicial", () => {
  it("várias páginas por pasta: lê tudo, devolve o token e o resumo", async () => {
    const f = drive(CONTEUDO, { porPagina: 2 });
    const r = await cargaInicial(cliente(f), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    expect(r.completa).toBe(true);
    expect(r.startPageToken).toBe("inicio-1");
    expect(r.resumo).toEqual({ novos: 5, alterados: 0, removidos: 0, ignorados: 1, pastas: 2 });
    // R tem 4 itens em páginas de 2: a pasta R foi pedida duas vezes.
    expect(f.mock.calls.filter(([u]) => new URL(String(u)).searchParams.get("q")?.startsWith("'R' in parents"))).toHaveLength(2);
  });

  it("token é pedido ANTES da listagem", async () => {
    const f = drive(CONTEUDO);
    await cargaInicial(cliente(f), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("/changes/startPageToken");
  });

  it("pasta além da profundidade máxima e seus arquivos ficam fora; temporário fica ignorado", async () => {
    const r = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(2), { maxItens: 1000 });
    const ids = r.resultados.map((x) => (x.acao === "gravar_pasta" ? x.pasta.driveId : x.acao === "gravar_documento" ? x.documento.driveId : ""));
    expect(ids).not.toContain("FUNDO");
    expect(ids).not.toContain("d6");
    expect(r.resultados.find((x) => x.acao === "gravar_documento" && x.documento.driveId === "t1")).toMatchObject({ documento: { situacao: "ignorado" } });
  });

  it("limite atingido: devolve o lido, sem token e sem nenhuma remoção, mesmo com índice anterior maior", async () => {
    const anterior = aplicar(indiceVazio(), (await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 })).resultados);
    const r = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, anterior, { maxItens: 3 });
    expect(r.completa).toBe(false);
    expect(r.startPageToken).toBeNull();
    expect(r.resumo.removidos).toBe(0);
    expect(r.resultados.every((x) => x.acao !== "gravar_documento" || x.documento.situacao !== "removido_no_drive")).toBe(true);
  });

  it("falha numa página intermediária: lança, não devolve token; repetir depois recupera e é idempotente", async () => {
    await expect(
      cargaInicial(cliente(drive(CONTEUDO, { falharNaChamada: 3, status: 403 })), { driveId: "R" }, indiceVazio(), { maxItens: 1000 }),
    ).rejects.toMatchObject({ status: 403 });

    const primeira = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    const indice = aplicar(indiceVazio(), primeira.resultados);
    const segunda = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indice, { maxItens: 1000 });
    expect(segunda.resultados).toEqual([]);
    expect(segunda.resumo).toEqual({ novos: 0, alterados: 0, removidos: 0, ignorados: 0, pastas: 0 });
  });

  it("erro transitório (5xx) numa página é repetido e a carga conclui", async () => {
    const r = await cargaInicial(cliente(drive(CONTEUDO, { falharNaChamada: 2, status: 503 })), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    expect(r.completa).toBe(true);
  });

  it("revisões: arquivo novo gera revisão; arquivo repetido em duas pastas não duplica; revisão igual não regrava", async () => {
    const conteudo = { R: [pasta("A", "R"), arq("d1", "A.pdf", "R")], A: [arq("d1", "A.pdf", "R")] };
    const primeira = await cargaInicial(cliente(drive(conteudo)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    const docs = primeira.resultados.filter((x) => x.acao === "gravar_documento");
    expect(docs).toHaveLength(1);
    expect(revisoesParaGravar(primeira.resultados, () => "uuid-d1")).toHaveLength(1);

    const indice = aplicar(indiceVazio(), primeira.resultados);
    const nova = { R: [pasta("A", "R"), arq("d1", "A.pdf", "R", "r2")], A: [] };
    const segunda = await cargaInicial(cliente(drive(nova)), { driveId: "R" }, indice, { maxItens: 1000 });
    expect(revisoesParaGravar(segunda.resultados, () => "uuid-d1")).toEqual([
      expect.objectContaining({ documento_id: "uuid-d1", drive_revisao: "r2" }),
    ]);
  });

  it("raiz fora do índice é recusada antes de qualquer chamada", async () => {
    const f = drive(CONTEUDO);
    await expect(cargaInicial(cliente(f), { driveId: "X" }, indiceVazio(), { maxItens: 10 })).rejects.toThrow("profundidade 0");
    expect(f).not.toHaveBeenCalled();
  });

  it("Drive compartilhado: o driveId vai no pedido do token e na listagem", async () => {
    const f = drive(CONTEUDO);
    await cargaInicial(cliente(f), { driveId: "R", driveIdCompartilhado: "DRV" }, indiceVazio(), { maxItens: 1000 });
    expect(f.mock.calls.every(([u]) => String(u).includes("driveId=DRV"))).toBe(true);
  });
});

describe("gravação em três passos", () => {
  it("pastas, documentos com o id da pasta e revisões com o id do documento; colunas do modelo", async () => {
    const r = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    expect(pastasParaGravar(r.resultados, "uuid-raiz").map((p) => p.drive_id)).toEqual(["A", "A1"]);
    const docs = documentosParaGravar(r.resultados, "uuid-raiz", (id) => `uuid-${id}`);
    expect(docs.find((d) => d.drive_id === "d5")).toMatchObject({ raiz_id: "uuid-raiz", pasta_id: "uuid-A1", situacao: "vigente" });
    expect(Object.keys(docs[0])).toEqual(Object.keys(linhaDocumento({} as DocumentoIndice, { raizId: "", pastaId: "" })));
  });

  it("sem o id interno, para e não cita IDs do Drive na mensagem", async () => {
    const r = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    expect(() => documentosParaGravar(r.resultados, "uuid-raiz", () => undefined)).toThrow(/^Sem o id interno de uma pasta/);
    let mensagem = "";
    try {
      revisoesParaGravar(r.resultados, () => undefined);
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toMatch(/^Sem o id interno de um documento/);
    expect(mensagem).not.toMatch(/\b(d\d|t1|A1?|R)\b/);
  });
});

describe("sugestões ficam fora da carga (5.4.8, 5.11.5)", () => {
  it("nem os resultados nem as linhas trazem número de contrato, cliente, tipo, versão ou vínculo", async () => {
    const r = await cargaInicial(cliente(drive(CONTEUDO)), { driveId: "R" }, indiceVazio(), { maxItens: 1000 });
    const texto = JSON.stringify([r, documentosParaGravar(r.resultados, "u", (id) => id)]);
    for (const campo of ["numeroContrato", "clienteCurto", "contraparte", "tipo_situacao", "\"tipo\"", "substitui", "vinculo"]) {
      expect(texto).not.toContain(campo);
    }
    // O nome com padrão de contrato entra como documento comum, sem nada confirmado.
    expect(r.resultados.find((x) => x.acao === "gravar_documento" && x.documento.driveId === "d1")).toMatchObject({
      documento: { situacao: "vigente" },
    });
  });
});
