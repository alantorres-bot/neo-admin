// OCR do boleto que vem como IMAGEM dentro do PDF (Bradesco Net Empresa: uma figura de 720×997, sem texto). Só leitura, no
// servidor: tira a maior imagem da 1ª página (unpdf) e lê com o tesseract.js (WASM, sem programa instalado). O idioma vem do
// pacote @tesseract.js-data/eng, de dentro do node_modules — nada é baixado da internet. O resultado vira itens de texto
// posicionados (pixels), no mesmo formato do PDF com texto, para a mesma regra ler (lerBoleto em ./boleto-pdf).
// Só é importado por server actions e pelo teste de calibração (nunca por componente de cliente).
import { join } from "node:path";
import { createWorker, type Line, type Worker } from "tesseract.js";
import { extractImages, getDocumentProxy } from "unpdf";
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";

/** Altura de uma linha de texto na imagem do Bradesco (px), para a regra achar o valor abaixo de cada rótulo. */
export const ALTURA_LINHA_OCR = 12;

let trabalhador: Promise<Worker> | null = null;

/** Um único worker por processo (a 1ª leitura carrega o idioma; as seguintes reaproveitam). */
function obterTrabalhador(): Promise<Worker> {
  trabalhador ??= createWorker("eng", 1, {
    langPath: join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
    cacheMethod: "none",
  }).catch((e) => {
    trabalhador = null;
    throw e;
  });
  return trabalhador;
}

/**
 * A imagem do Bradesco é pequena (720 px de largura, letra de ~8 px): ampliada 3× o tesseract lê os rótulos e o nº do
 * documento; no tamanho original ele só acerta a linha digitável.
 */
const AMPLIACAO = 3;

/** Imagem crua (RGB/RGBA/cinza) → PGM binário em tons de cinza, ampliado (bilinear) — o leptonica do tesseract lê sem biblioteca extra. */
function emPgmAmpliado(dados: Uint8ClampedArray, largura: number, altura: number, canais: number, escala: number): Buffer {
  const cinza = new Float32Array(largura * altura);
  for (let p = 0; p < largura * altura; p++) {
    const i = p * canais;
    cinza[p] = canais >= 3 ? 0.299 * dados[i] + 0.587 * dados[i + 1] + 0.114 * dados[i + 2] : dados[i];
  }
  const L = largura * escala;
  const A = altura * escala;
  const saida = Buffer.alloc(L * A);
  for (let y = 0; y < A; y++) {
    const sy = Math.min(Math.max((y + 0.5) / escala - 0.5, 0), altura - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, altura - 1);
    const fy = sy - y0;
    for (let x = 0; x < L; x++) {
      const sx = Math.min(Math.max((x + 0.5) / escala - 0.5, 0), largura - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, largura - 1);
      const fx = sx - x0;
      const topo = cinza[y0 * largura + x0] * (1 - fx) + cinza[y0 * largura + x1] * fx;
      const base = cinza[y1 * largura + x0] * (1 - fx) + cinza[y1 * largura + x1] * fx;
      saida[y * L + x] = Math.round(topo * (1 - fy) + base * fy);
    }
  }
  return Buffer.concat([Buffer.from(`P5
${L} ${A}
255
`, "ascii"), saida]);
}

/**
 * Palavras do OCR → itens de texto: na mesma linha, palavras próximas formam uma expressão ("Nº do documento"); um vão grande
 * (colunas da ficha) começa outro item. Regra pura.
 */
export function itensDasLinhas(linhas: readonly Pick<Line, "words">[], escala = 1): ItemTexto[] {
  // Coordenadas de volta ao tamanho original da imagem (a regra usa a altura de linha em pixels da imagem original).
  const fechar = (a: { x0: number; y0: number; x1: number; textos: string[] }): ItemTexto =>
    ({ x: Math.round(a.x0 / escala), y: Math.round(a.y0 / escala), w: Math.round((a.x1 - a.x0) / escala), texto: a.textos.join(" ") });
  const itens: ItemTexto[] = [];
  for (const linha of linhas) {
    let atual: { x0: number; y0: number; x1: number; textos: string[] } | null = null;
    for (const p of linha.words) {
      const texto = p.text.trim();
      if (!texto) continue;
      const larguraLetra = (p.bbox.x1 - p.bbox.x0) / Math.max(texto.length, 1);
      if (atual && p.bbox.x0 - atual.x1 <= Math.max(larguraLetra * 2, 8 * escala)) {
        atual.textos.push(texto);
        atual.x1 = p.bbox.x1;
        continue;
      }
      if (atual) itens.push(fechar(atual));
      atual = { x0: p.bbox.x0, y0: p.bbox.y0, x1: p.bbox.x1, textos: [texto] };
    }
    if (atual) itens.push(fechar(atual));
  }
  return itens;
}

export type ResultadoOcr = { ok: true; paginas: PaginaTexto[] } | { ok: false; erro: string };

/** Lê por OCR a 1ª página de um PDF-imagem. */
export async function ocrDoPdf(dados: ArrayBuffer | Uint8Array): Promise<ResultadoOcr> {
  // Cópia própria: o pdf.js transfere (desliga) o buffer que recebe, e quem chamou pode já ter usado o mesmo arquivo.
  // (sempre Uint8Array puro: o pdf.js recusa `Buffer` do Node)
  const bytes = new Uint8Array(dados instanceof Uint8Array ? dados : new Uint8Array(dados));
  let imagem;
  try {
    const doc = await getDocumentProxy(bytes);
    const imagens = await extractImages(doc, 1);
    imagem = imagens.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  } catch (e) {
    return { ok: false, erro: `Não foi possível abrir a imagem do boleto (${(e as Error).message || "erro desconhecido"}).` };
  }
  if (!imagem || imagem.width < 300) return { ok: false, erro: "O PDF não tem texto nem imagem legível do boleto." };
  try {
    const worker = await obterTrabalhador();
    const { data } = await worker.recognize(emPgmAmpliado(imagem.data, imagem.width, imagem.height, imagem.channels, AMPLIACAO), {}, { blocks: true });
    const linhas = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return { ok: true, paginas: [{ numero: 1, largura: imagem.width, altura: imagem.height, itens: itensDasLinhas(linhas, AMPLIACAO) }] };
  } catch (e) {
    return { ok: false, erro: `A leitura da imagem do boleto falhou (${(e as Error).message || "erro desconhecido"}).` };
  }
}
