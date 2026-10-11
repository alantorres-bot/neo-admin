/** Só aceita caminho interno ("/x"); recusa "//x", "/\x", URLs completas e vazio (open redirect). */
export function destinoSeguro(destino: string | null | undefined, padrao = "/inicio"): string {
  if (!destino || !destino.startsWith("/") || destino.startsWith("//") || destino.startsWith("/\\")) return padrao;
  if (/[\u0000-\u001f]/.test(destino)) return padrao;
  return destino;
}

/**
 * Origem pública da requisição ("https://host"), para montar URLs de retorno do login.
 * Respeita o proxy do Cloud Run (`x-forwarded-proto` / `x-forwarded-host`); em localhost assume http.
 */
export function origemDaRequisicao(cabecalhos: { get(nome: string): string | null }): string {
  const primeiro = (nome: string) => cabecalhos.get(nome)?.split(",")[0].trim() || null;
  const host = primeiro("x-forwarded-host") ?? primeiro("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const protocolo = primeiro("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${protocolo}://${host}`;
}
