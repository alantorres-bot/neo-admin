/**
 * Entregar um arquivo gerado pelo app (a imagem exportada) para a pessoa guardar.
 * - Na página publicada (Artifact do Claude) o arquivo passa pela capacidade `downloads`: a pessoa confirma e o
 *   aparelho salva. A página nunca baixa nada por conta própria.
 * - Fora dela (npm run dev, vite preview) vale o download comum do navegador.
 */

interface Downloads {
  save(pedido: { filename: string; data: Blob }): Promise<{ status: string }>;
}

export type ResultadoSalvar =
  /** Entregue ao aparelho. */
  | "salvo"
  /** A pessoa disse não na confirmação: nada a fazer. */
  | "recusado"
  /** Não há como salvar por aqui: resta tocar e segurar a imagem. */
  | "indisponivel";

const claude = () => (globalThis as { claude?: { use?: (nome: string) => Promise<unknown> } }).claude;

/** Estamos dentro de uma página publicada do Claude? (lá o download direto não é permitido) */
export const emPaginaPublicada = () => typeof claude()?.use === "function";

export async function salvarArquivo(blob: Blob, nome: string): Promise<ResultadoSalvar> {
  const c = claude();
  if (typeof c?.use === "function") {
    let downloads: Downloads | null = null;
    try {
      downloads = (await c.use("downloads")) as Downloads | null;
    } catch {
      downloads = null;
    }
    if (!downloads) return "indisponivel";
    try {
      await downloads.save({ filename: nome, data: blob });
      return "salvo";
    } catch (e) {
      return (e as { code?: string })?.code === "declined" ? "recusado" : "indisponivel";
    }
  }
  // navegador comum: link de download
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return "salvo";
  } catch {
    return "indisponivel";
  }
}
