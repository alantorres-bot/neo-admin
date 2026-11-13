/**
 * Exportação de imagem em alta resolução: a conta do tamanho (pura, testada) e a ponte entre a interface
 * e a cena — quem sabe desenhar a imagem grande é o componente Exportador, que vive dentro do Canvas.
 */

export type FormatoImagem = "tela" | "paisagem" | "quadrada" | "retrato";

export const NOME_FORMATO: Record<FormatoImagem, string> = {
  tela: "Como na tela",
  paisagem: "Paisagem (16:9)",
  quadrada: "Quadrada (1:1)",
  retrato: "Retrato (9:16)",
};

/** Lado maior da imagem, em pontos. */
export const QUALIDADES = [
  { id: "alta", nome: "Alta — 1920 pontos", lado: 1920 },
  { id: "muito-alta", nome: "Muito alta — 2560 pontos", lado: 2560 },
  { id: "maxima", nome: "Máxima — 3840 pontos (4K)", lado: 3840 },
] as const;

export interface TamanhoImagem {
  largura: number;
  altura: number;
}

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Largura e altura da imagem: o lado maior vale `lado` (sem passar de `limite`, o máximo que o aparelho
 * desenha de uma vez) e o outro acompanha o formato. Sempre números pares.
 */
export function tamanhoDaImagem(formato: FormatoImagem, lado: number, tela: TamanhoImagem, limite = Infinity): TamanhoImagem {
  const proporcao = formato === "paisagem" ? 16 / 9 : formato === "quadrada" ? 1 : formato === "retrato" ? 9 / 16 : tela.largura / Math.max(1, tela.altura);
  const maior = Math.max(64, Math.min(lado, limite));
  return proporcao >= 1 ? { largura: par(maior), altura: par(maior / proporcao) } : { largura: par(maior * proporcao), altura: par(maior) };
}

/** "apartamento-sala-2026-11-13-14h05.jpg": sem acento nem espaço, para qualquer aparelho aceitar. */
export function nomeDoArquivo(vista: string | undefined, agora: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  const limpo = (vista ?? "vista")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `apartamento-${limpo || "vista"}-${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}h${dois(agora.getMinutes())}.jpg`;
}

type Desenhista = (tamanho: TamanhoImagem) => Promise<Blob>;
let desenhista: Desenhista | null = null;
let limiteDoAparelho = 4096;

/** Chamado pelo Exportador (dentro do Canvas) quando a cena está pronta; `null` quando ela sai. */
export function registrarDesenhista(fn: Desenhista | null, limite?: number) {
  desenhista = fn;
  if (limite) limiteDoAparelho = limite;
}

/** Lado máximo em celular e tablet: acima disso a memória de vídeo do aparelho pode não dar conta. */
export const LIMITE_EM_CELULAR = 2560;
/** Lado máximo em computador (4K). */
export const LIMITE_EM_COMPUTADOR = 3840;

/** Maior lado que este aparelho consegue desenhar de uma vez (`toque`: aparelho de tela de toque). */
export const limiteDeImagem = (toque: boolean) => Math.min(limiteDoAparelho, toque ? LIMITE_EM_CELULAR : LIMITE_EM_COMPUTADOR);

/** Qualidades que fazem sentido neste aparelho (a 4K só aparece onde cabe). */
export const qualidadesDisponiveis = (toque: boolean) => QUALIDADES.filter((q) => q.lado <= limiteDeImagem(toque));

/** Desenha a vista atual no tamanho pedido e devolve a imagem (JPEG). */
export function gerarImagem(tamanho: TamanhoImagem): Promise<Blob> {
  if (!desenhista) return Promise.reject(new Error("A cena ainda não está pronta."));
  return desenhista(tamanho);
}
