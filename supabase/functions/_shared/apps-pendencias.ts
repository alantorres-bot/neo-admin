// Pendências dos aplicativos externos (Vigilância Fiscal, NEOControl) na Central de Gestão: valida o resumo que a função
// neo-admin-pendencias de cada aplicativo devolve e monta o que vai para apps_pendencias_publicar (migration 0800).
// Especificação: docs/modulos/administrativo-gestao-aplicativos.md. Lógica pura, testada em
// lib/nucleo/gestao/apps-pendencias.test.ts.

export type DetalheTipo = { rotulo: string; quantidade: number };
export type TipoLido = {
  codigo: string; titulo: string; quantidade: number; detalhe: DetalheTipo[];
  prazo: string | null; maisAntiga: string | null; caminho: string | null;
};

export type AppPendencias = { codigo: string; nome: string; responsaveis: Record<string, string> };

export type PendenciaApp = {
  chave_origem: string; titulo: string; descricao: string; prazo: string | null; prioridade: "alta" | "normal";
  responsavel_id: string | null; precisa_distribuir: boolean; link: string;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CAMINHO = /^\/[a-z0-9_\-/]{0,100}$/i;
const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= max ? v.trim() : null);
const data = (v: unknown) => (typeof v === "string" && DATA.test(v) ? v : null);
const inteiro = (v: unknown, minimo: number) => (typeof v === "number" && Number.isInteger(v) && v >= minimo && v <= 1_000_000 ? v : null);

/** Valida a resposta do aplicativo (versão 1). Tipo malformado invalida a leitura inteira: nada se encerra por engano. */
export function lerResposta(json: unknown): { ok: true; tipos: TipoLido[] } | { ok: false; erro: string } {
  if (!json || typeof json !== "object" || (json as { versao?: unknown }).versao !== 1) return { ok: false, erro: "Resposta sem versão 1." };
  const brutos = (json as { tipos?: unknown }).tipos;
  if (!Array.isArray(brutos) || brutos.length > 50) return { ok: false, erro: "Resposta sem a lista de tipos." };
  const tipos: TipoLido[] = [];
  const vistos = new Set<string>();
  for (const b of brutos as Record<string, unknown>[]) {
    const codigo = typeof b?.codigo === "string" && /^[a-z0-9_]{2,60}$/.test(b.codigo) ? b.codigo : null;
    const titulo = texto(b?.titulo, 120);
    const quantidade = inteiro(b?.quantidade, 0);
    if (!codigo || !titulo || quantidade === null || vistos.has(codigo)) return { ok: false, erro: `Tipo inválido: ${JSON.stringify(b?.codigo ?? null)}.` };
    vistos.add(codigo);
    const detalhe = (Array.isArray(b.detalhe) ? b.detalhe : []).slice(0, 10)
      .map((d: Record<string, unknown>) => ({ rotulo: texto(d?.rotulo, 60), quantidade: inteiro(d?.quantidade, 1) }))
      .filter((d): d is DetalheTipo => d.rotulo !== null && d.quantidade !== null);
    const caminho = typeof b.caminho === "string" && CAMINHO.test(b.caminho) && !b.caminho.startsWith("//") && !b.caminho.includes("..") ? b.caminho : null;
    tipos.push({ codigo, titulo, quantidade, detalhe, prazo: data(b.prazo), maisAntiga: data(b.maisAntiga), caminho });
  }
  return { ok: true, tipos };
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Uma pendência por tipo com quantidade (tipo zerado fica de fora e a publicação o encerra). Título:
 * "Vigilância Fiscal — NF de entrada com pendência: 14 (3 vencidas)". Prazo vencido = prioridade alta.
 * Sem responsável padrão: entra sem dono e marcada para distribuir.
 */
export function montarPendencias(app: AppPendencias, tipos: readonly TipoLido[], hoje: string): PendenciaApp[] {
  return tipos.filter((t) => t.quantidade > 0).map((t) => {
    const partes = t.detalhe.map((d) => `${d.quantidade} ${d.rotulo}`).join(", ");
    const responsavel = app.responsaveis[t.codigo] ?? null;
    return {
      chave_origem: `app:${app.codigo}:${t.codigo}`,
      titulo: `${app.nome} — ${t.titulo}: ${t.quantidade}${partes ? ` (${partes})` : ""}`,
      descricao: [
        t.maisAntiga ? `A mais antiga está aberta desde ${dataBr(t.maisAntiga)}.` : null,
        "Resolva no próprio aplicativo; a contagem é atualizada a cada 30 minutos.",
      ].filter(Boolean).join(" "),
      prazo: t.prazo,
      prioridade: t.prazo !== null && t.prazo < hoje ? "alta" : "normal",
      responsavel_id: responsavel,
      precisa_distribuir: responsavel === null,
      link: `/apps/${app.codigo}${t.caminho ? `?tela=${t.caminho}` : ""}`,
    };
  });
}
