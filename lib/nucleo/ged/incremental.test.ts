import { describe, expect, it, vi } from "vitest";
import {
  aplicarPaginaNoIndice,
  criarClienteDrive,
  documentosParaGravar,
  MIME_PASTA,
  percorrerMudancas,
  resumirRodada,
  type DocumentoIndice,
  type MudancaDrive,
  type PastaIndice,
  type ResultadoMudanca,
} from "../../../supabase/functions/_shared/ged";

// Banco fictício: o índice gravado só muda quando a "gravação" da página dá certo.
type Indice = { pastas: Map<string, PastaIndice>; documentos: Map<string, DocumentoIndice>; profundidadeMax: number };
const RAIZ: PastaIndice = { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" };
const novoBanco = () => ({ pastas: new Map([["R", RAIZ]]), documentos: new Map<string, DocumentoIndice>(), token: "t1" });

const arq = (id: string, nome: string, mae: string): MudancaDrive => ({
  fileId: id,
  file: { id, name: nome, mimeType: "application/pdf", parents: [mae], headRevisionId: "r1" },
});
const pastaNova: MudancaDrive = { fileId: "P", file: { id: "P", name: "Cliente Exemplo", mimeType: MIME_PASTA, parents: ["R"] } };

// Três páginas: pasta nova + arquivo dentro dela; arquivo temporário; remoção.
const PAGINAS: Record<string, object> = {
  t1: { changes: [pastaNova, arq("d1", "Contrato.pdf", "P")], nextPageToken: "t2" },
  t2: { changes: [arq("t9", "~$aberto.docx", "P"), arq("d2", "Fora.pdf", "OUTRA")], nextPageToken: "t3" },
  t3: { changes: [{ fileId: "d1", removed: true }], newStartPageToken: "t4" },
};
const fetchFalso = () =>
  vi.fn(async (url: string) => {
    const token = new URL(url).searchParams.get("pageToken") ?? "";
    return new Response(JSON.stringify(PAGINAS[token]), { status: 200 });
  });

/** Uma rodada como a Edge Function faria: aplica cada página numa cópia, "grava" e só no fim guarda o token. */
async function rodada(banco: ReturnType<typeof novoBanco>, falharNaGravacaoDaPagina?: number) {
  const cliente = criarClienteDrive(async () => "token-ficticio", { fazerFetch: fetchFalso() });
  const todos: ResultadoMudanca[] = [];
  let pagina = 0;
  const r = await percorrerMudancas(cliente, banco.token, async (mudancas) => {
    pagina++;
    const copia: Indice = { pastas: new Map(banco.pastas), documentos: new Map(banco.documentos), profundidadeMax: 3 };
    const resultados = aplicarPaginaNoIndice(mudancas, copia);
    documentosParaGravar(resultados, "uuid-raiz", (id) => (copia.pastas.has(id) ? `uuid-${id}` : undefined));
    if (pagina === falharNaGravacaoDaPagina) throw new Error("falha simulada na gravação");
    banco.pastas = copia.pastas; // "commit" da página
    banco.documentos = copia.documentos;
    todos.push(...resultados);
  }, { maxItens: 5000 });
  banco.token = r.proximoToken; // só depois de todas as páginas
  return todos;
}

describe("rodada incremental", () => {
  it("aplica as páginas em ordem: pasta nova antes do arquivo dela; temporário ignorado; fora do escopo nada; remoção", async () => {
    const banco = novoBanco();
    const resultados = await rodada(banco);
    expect(banco.pastas.get("P")?.situacao).toBe("ativa");
    expect(banco.documentos.get("t9")?.situacao).toBe("ignorado");
    expect(banco.documentos.has("d2")).toBe(false);
    expect(banco.documentos.get("d1")?.situacao).toBe("removido_no_drive");
    expect(banco.token).toBe("t4");
    expect(resumirRodada(resultados)).toEqual({ novos: 1, alterados: 0, removidos: 1, ignorados: 1, pastas: 1 });
  });

  it("falha na gravação da 2ª página: token não avança; repetir do mesmo token recupera sem duplicar", async () => {
    const banco = novoBanco();
    await expect(rodada(banco, 2)).rejects.toThrow("falha simulada");
    expect(banco.token).toBe("t1");
    expect(banco.pastas.has("P")).toBe(true); // a 1ª página foi gravada
    expect(banco.documentos.has("t9")).toBe(false); // a 2ª não

    await rodada(banco);
    expect(banco.token).toBe("t4");
    expect([...banco.documentos.keys()].sort()).toEqual(["d1", "t9"]);
    expect(banco.documentos.get("d1")?.situacao).toBe("removido_no_drive");
  });

  it("repetir uma rodada já gravada (mesmas páginas) termina no mesmo estado", async () => {
    // Reprocessar repete os passos (d1 volta na página 1 e sai de novo na 3); o que a 5.3.3 exige é o estado final igual.
    const banco = novoBanco();
    await rodada(banco);
    const antes = JSON.stringify([[...banco.pastas], [...banco.documentos]]);
    banco.token = "t1";
    await rodada(banco);
    expect(JSON.stringify([[...banco.pastas], [...banco.documentos]])).toBe(antes);
    expect(banco.token).toBe("t4");
  });
});
