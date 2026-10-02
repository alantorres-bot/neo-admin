/** Só aceita caminho interno ("/x"); recusa "//x", "/\x", URLs completas e vazio (open redirect). */
export function destinoSeguro(destino: string | null | undefined, padrao = "/inicio"): string {
  if (!destino || !destino.startsWith("/") || destino.startsWith("//") || destino.startsWith("/\\")) return padrao;
  if (/[\u0000-\u001f]/.test(destino)) return padrao;
  return destino;
}
