// Extração dos itens de texto posicionados de um PDF de fatura (unpdf = pdf.js sem DOM; roda no servidor). Só leitura.
// Aceita a senha do PDF (Inter e Itaú enviam a fatura criptografada); a senha não é guardada em lugar nenhum.
// Só é importado por server actions e pelo teste de calibração (nunca por componente de cliente).
import { getDocumentProxy } from "unpdf";
import type { PaginaTexto } from "./leitores/tipos";

export type ResultadoExtracao = { ok: true; paginas: PaginaTexto[] } | { ok: false; erro: string; precisaSenha?: boolean };

const MAX_PAGINAS = 40;

export async function extrairPaginasDoPdf(dados: ArrayBuffer | Uint8Array, senha?: string | null): Promise<ResultadoExtracao> {
  // pdf.js recusa `Buffer` do Node: entrega sempre um Uint8Array puro (vista sobre os mesmos bytes).
  const bytes = dados instanceof Uint8Array ? new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength) : new Uint8Array(dados);
  let doc;
  try {
    doc = await getDocumentProxy(bytes, senha ? { password: senha } : undefined);
  } catch (e) {
    const nome = (e as { name?: string }).name ?? "";
    const mensagem = (e as Error).message ?? "";
    if (nome === "PasswordException" || /password/i.test(mensagem)) {
      return { ok: false, precisaSenha: true, erro: senha ? "A senha do PDF está errada." : "Este PDF é protegido por senha: informe a senha da fatura." };
    }
    if (/Invalid PDF|InvalidPDF/i.test(nome + mensagem)) return { ok: false, erro: "O arquivo não é um PDF válido." };
    return { ok: false, erro: `Não foi possível abrir o PDF (${mensagem || nome || "erro desconhecido"}).` };
  }
  try {
    if (doc.numPages > MAX_PAGINAS) return { ok: false, erro: `O PDF tem ${doc.numPages} páginas; o limite é ${MAX_PAGINAS}.` };
    const paginas: PaginaTexto[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const vp = pagina.getViewport({ scale: 1 });
      const conteudo = await pagina.getTextContent();
      type ItemPdf = { str: string; transform: number[]; width: number };
      const itens = (conteudo.items as unknown as (ItemPdf | { type: string })[])
        .filter((i): i is ItemPdf => "str" in i && typeof i.str === "string" && i.str.trim() !== "")
        .map((i) => ({
          x: Math.round(i.transform[4] * 10) / 10,
          y: Math.round((vp.height - i.transform[5]) * 10) / 10,
          w: Math.round(i.width * 10) / 10,
          texto: i.str,
        }));
      paginas.push({ numero: n, largura: Math.round(vp.width), altura: Math.round(vp.height), itens });
    }
    if (paginas.every((p) => p.itens.length === 0)) return { ok: false, erro: "O PDF não tem texto (parece digitalizado como imagem). O módulo não lê imagens." };
    return { ok: true, paginas };
  } finally {
    // libera o worker do pdf.js (o proxy do unpdf pode não expor destroy)
    const d = doc as unknown as { destroy?: () => Promise<void> | void; cleanup?: () => void };
    if (typeof d.destroy === "function") await d.destroy();
    else if (typeof d.cleanup === "function") d.cleanup();
  }
}
