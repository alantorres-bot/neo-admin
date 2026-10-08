import { contarFilas, type Fila } from "@/lib/modulos/financeiro/recebiveis/tarefas";

/** Abas da Cobrança, na ordem do trabalho: falta boleto, falta enviar, falta confirmar, cobrar, baixas e a regra. */
export const ABAS_COBRANCA: { href: string; rotulo: string; filas: readonly Fila[] }[] = [
  { href: "/financeiro/cobranca/anexar", rotulo: "Boletos a anexar", filas: ["anexar"] },
  { href: "/financeiro/cobranca/enviar", rotulo: "A enviar", filas: ["enviar", "dados"] },
  { href: "/financeiro/cobranca/confirmar", rotulo: "Confirmar pagamento", filas: ["confirmar"] },
  { href: "/financeiro/cobranca/cobrar", rotulo: "Cobrar", filas: ["cobrar"] },
  { href: "/financeiro/cobranca/baixas", rotulo: "Baixas a conferir", filas: ["baixa"] },
  { href: "/financeiro/cobranca/regra", rotulo: "Regra de cobrança", filas: [] },
];

/** Quantos itens há em cada aba (a soma das filas dela). */
export function contagemDasAbas(contagens: Record<Fila, number>): Record<string, number> {
  return Object.fromEntries(ABAS_COBRANCA.map((a) => [a.href, a.filas.reduce((soma, f) => soma + contagens[f], 0)]));
}

/** Primeira aba com itens (a Cobrança abre nela); sem nada pendente, a primeira. */
export function abaInicialDaCobranca(contagens: Record<Fila, number>): string {
  const porAba = contagemDasAbas(contagens);
  return ABAS_COBRANCA.find((a) => (porAba[a.href] ?? 0) > 0)?.href ?? ABAS_COBRANCA[0].href;
}

export { contarFilas };
