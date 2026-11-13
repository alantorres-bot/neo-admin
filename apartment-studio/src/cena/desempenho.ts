/**
 * Vigia de desempenho do modo realista (funções puras, testadas). Enquanto a pessoa gira ou anda, a cena
 * redesenha um quadro atrás do outro; se o aparelho não dá conta, o modo realista é desligado sozinho
 * e um aviso explica como religar.
 */

/** Quadros seguidos analisados de cada vez. */
export const AMOSTRAS = 24;
/** Intervalo acima do qual a pessoa parou de mexer: a contagem recomeça (a não ser que o quadro seguinte já estivesse pedido). */
export const PAUSA_MS = 700;
/** Teto de uma amostra: um quadro travado por muitos segundos conta como muito lento, não distorce a conta. */
export const TETO_MS = 5000;
/** Mediana do tempo por quadro acima da qual o aparelho está lento demais (≈ 8 quadros por segundo). */
export const LIMITE_MS = 125;

export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
}

/**
 * Acumula o intervalo entre dois quadros e diz se já dá para concluir que está lento.
 * `emSequencia`: o quadro anterior já tinha pedido este (a cena estava em movimento) — então o intervalo é
 * tempo de desenho, por maior que seja; sem isso, um intervalo longo é só a pessoa parada.
 * Devolve a nova lista de amostras (vazia depois de uma pausa ou de uma conclusão).
 */
export function registrarQuadro(amostras: number[], intervaloMs: number, emSequencia = false): { amostras: number[]; lento: boolean } {
  if (!emSequencia && intervaloMs > PAUSA_MS) return { amostras: [], lento: false };
  const novas = [...amostras, Math.min(intervaloMs, TETO_MS)];
  if (novas.length < AMOSTRAS) return { amostras: novas, lento: false };
  // mediana, e não média: um quadro isolado demorado (carregar uma textura) não conta
  return { amostras: [], lento: mediana(novas) > LIMITE_MS };
}
