// Formatação compartilhada do módulo (R$ 1.234,56 e dd/mm/aaaa). Sem dependências, usada também nos textos de mensagem.

/** 123456 -> 'R$ 1.234,56' (centavos inteiros; não depende de Intl, que muda o espaço entre R$ e o número). */
export function formatarMoeda(centavos: number): string {
  const negativo = centavos < 0;
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `${negativo ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/** 'aaaa-mm-dd' -> 'dd/mm/aaaa' */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
