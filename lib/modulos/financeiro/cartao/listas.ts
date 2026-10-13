// Listas do Consistem (migration 0143): categorias de fornecedor e contas do fluxo de caixa (grupo × item).
export type ContaFluxo = { grupo: number; grupo_descricao: string; item: number; descricao: string; ativa: boolean };
export type CategoriaFornecedor = { codigo: number; descricao: string };
export type ListasConsistem = { categorias: CategoriaFornecedor[]; contasFluxo: ContaFluxo[] };

/** Rótulo "22/26 · Rep. Locação a Terceiro" (ou o par de números, se a conta não está na lista). */
export function rotuloContaFluxo(contas: readonly ContaFluxo[], grupo?: number | null, item?: number | null): string {
  if (!grupo || !item) return "";
  const c = contas.find((x) => x.grupo === grupo && x.item === item);
  return c ? `${grupo}/${item} · ${c.descricao}` : `${grupo}/${item}`;
}
