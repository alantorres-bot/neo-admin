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

/** Abas que o usuário restrito à unidade (filial) faz: anexar, baixas e régua são de Cuiabá. */
const ABAS_DA_FILIAL = new Set(["/financeiro/cobranca/enviar", "/financeiro/cobranca/confirmar", "/financeiro/cobranca/cobrar"]);
export function abasDaCobranca(restrito: boolean) {
  return restrito ? ABAS_COBRANCA.filter((a) => ABAS_DA_FILIAL.has(a.href)) : ABAS_COBRANCA;
}

/** Quantos itens há em cada aba (a soma das filas dela). */
export function contagemDasAbas(contagens: Record<Fila, number>): Record<string, number> {
  return Object.fromEntries(ABAS_COBRANCA.map((a) => [a.href, a.filas.reduce((soma, f) => soma + contagens[f], 0)]));
}

/** Primeira aba com itens (a Cobrança abre nela); sem nada pendente, a primeira. */
export function abaInicialDaCobranca(contagens: Record<Fila, number>, restrito = false): string {
  const porAba = contagemDasAbas(contagens);
  const abas = abasDaCobranca(restrito);
  return abas.find((a) => (porAba[a.href] ?? 0) > 0)?.href ?? abas[0].href;
}

export { contarFilas };
