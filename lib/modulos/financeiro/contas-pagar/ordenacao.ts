// Ordenação pelo título das colunas (grades do módulo Contas a pagar). Regras puras, sem imports; testado em ordenacao.test.ts.
// Clicar numa coluna ordena crescente; clicar de novo inverte. Valores nulos ficam sempre por último.

export type Direcao = "asc" | "desc";
export type Ordem<C extends string> = { coluna: C; direcao: Direcao };

export const ehDirecao = (v: string): v is Direcao => v === "asc" || v === "desc";

/** Mesma coluna inverte a direção; outra coluna começa crescente. */
export function alternarOrdem<C extends string>(atual: Ordem<C> | null, coluna: C): Ordem<C> {
  if (atual && atual.coluna === coluna) return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
  return { coluna, direcao: "asc" };
}

export type ValorOrdenavel = string | number | null | undefined;

const comparar = (a: ValorOrdenavel, b: ValorOrdenavel): number => {
  const na = a === null || a === undefined || a === "";
  const nb = b === null || b === undefined || b === "";
  if (na && nb) return 0;
  if (na) return 1; // nulo por último, em qualquer direção
  if (nb) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
};

/**
 * Ordena uma cópia da lista pela coluna e direção, estável (empates mantêm a ordem de entrada). `valorDe` devolve o valor da
 * coluna para cada item: texto (ordem alfabética), número (do menor ao maior) ou data ISO 'aaaa-mm-dd' (como texto, já ordena).
 */
export function ordenar<T, C extends string>(itens: readonly T[], ordem: Ordem<C> | null, valorDe: (item: T, coluna: C) => ValorOrdenavel): T[] {
  if (!ordem) return [...itens];
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  return itens
    .map((item, posicao) => ({ item, posicao, valor: valorDe(item, ordem.coluna) }))
    .sort((x, y) => {
      const nx = x.valor === null || x.valor === undefined || x.valor === "";
      const ny = y.valor === null || y.valor === undefined || y.valor === "";
      if (nx || ny) return comparar(x.valor, y.valor) || x.posicao - y.posicao; // nulos por último sem inverter
      return sinal * comparar(x.valor, y.valor) || x.posicao - y.posicao;
    })
    .map((x) => x.item);
}

/** Colunas ordenáveis da lista "Autorizar pagamento". */
export const COLUNAS_PENDENTES = ["tipo", "fornecedor", "documento", "vencimento", "valor", "saldo", "historico"] as const;
export type ColunaPendentes = (typeof COLUNAS_PENDENTES)[number];
export const ehColunaPendentes = (v: string): v is ColunaPendentes => (COLUNAS_PENDENTES as readonly string[]).includes(v);

/** Colunas ordenáveis das tabelas Títulos/Antecipações da autorização. */
export const COLUNAS_ITENS = ["fornecedor", "documento", "data", "historico", "valor"] as const;
export type ColunaItens = (typeof COLUNAS_ITENS)[number];
