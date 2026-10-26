// GED — busca da Central de Documentos (/documentos, especificação 7.1). Regras puras: o filtro de linhas é a RLS do banco
// (ged_pode_ler_raiz, 0804/0806); aqui só se monta o padrão de busca e se organiza o que voltou. Tipo, cliente e vínculos são da A2.
import { normalizarTexto } from "@/supabase/functions/_shared/ged";

export const LIMITE_BUSCA = 200;
export const FINALIDADES_BUSCA = { todas: "Todas", elaboracao: "Elaboração", dossie_cliente: "Dossiê de clientes" } as const;
export type FiltroFinalidade = keyof typeof FINALIDADES_BUSCA;

export const lerFinalidade = (v: unknown): FiltroFinalidade =>
  typeof v === "string" && Object.hasOwn(FINALIDADES_BUSCA, v) ? (v as FiltroFinalidade) : "todas";

/** Padrão do `ilike` sobre `nome_normalizado`: mesmo texto normalizado da indexação, com `%` e `_` do usuário escapados. */
export function padraoBusca(texto: unknown): string | null {
  const t = typeof texto === "string" ? normalizarTexto(texto).slice(0, 100) : "";
  if (t.length < 2) return null;
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type LinhaBusca = { id: string; nome: string; nome_normalizado: string; raiz_id: string };

/** 5.2.5: o mesmo nome em raízes diferentes é marcado (informativo), nunca fundido nem escondido. */
export function idsComMesmoNomeEmOutraRaiz(linhas: readonly LinhaBusca[]): Set<string> {
  const raizesPorNome = new Map<string, Set<string>>();
  for (const l of linhas) raizesPorNome.set(l.nome_normalizado, (raizesPorNome.get(l.nome_normalizado) ?? new Set()).add(l.raiz_id));
  return new Set(linhas.filter((l) => (raizesPorNome.get(l.nome_normalizado)?.size ?? 0) > 1).map((l) => l.id));
}

/**
 * Atalho "Documentos" no trilho: módulo administrativo.ged ativo, usuário não restrito à unidade e pelo menos uma raiz ativa que ele
 * lê (a lista vem da projeção ged_raizes, que já aplica ged_pode_ler_raiz). Sem isso, nada aparece no menu.
 */
export function mostrarAtalhoDocumentos(
  modulos: readonly { codigo: string; ativo: boolean }[], restrito: boolean, raizes: readonly { situacao: string }[] | null,
): boolean {
  if (restrito || !modulos.some((m) => m.codigo === "administrativo.ged" && m.ativo)) return false;
  return (raizes ?? []).some((r) => r.situacao === "ativa");
}

/** Link do Drive só se for do próprio Google (o valor vem do índice, não do usuário, mas a tela não confia). */
export const linkDoDrive = (url: unknown): string | null =>
  typeof url === "string" && /^https:\/\/(drive|docs)\.google\.com\//.test(url) ? url : null;
