// Parâmetros do módulo Contas a pagar lidos de `configuracoes`. Sem imports.

export const CHAVE_CORTE_ANTECIPACOES = "financeiro.contas-pagar.antecipacoes_a_partir_de";
export const CHAVES_CONTAS_PAGAR: readonly string[] = [CHAVE_CORTE_ANTECIPACOES];

export type ParametrosContasPagar = {
  /** Antecipações com data de referência anterior a esta ('aaaa-mm-dd') ficam fora da lista; null = todas entram. */
  corteAntecipacoes: string | null;
};

const ehDataIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function lerParametrosContasPagar(linhas: readonly { chave: string; valor: unknown }[]): ParametrosContasPagar {
  const corte = linhas.find((l) => l.chave === CHAVE_CORTE_ANTECIPACOES)?.valor;
  return { corteAntecipacoes: ehDataIso(corte) ? corte : null };
}
