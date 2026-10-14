// Identidade do módulo RH/SST > Folha de pagamento (fechamento mensal). Ver docs/modulos/rh-folha.md.

export const MODULO_FOLHA = "rh.folha";
export const ROTA_FOLHA = "/rh/folha";

/** Partes do valor a pagar no mês (regra 4). As três primeiras vêm da folha do escritório; o avulso é fora dela. */
export const NATUREZAS = ["liquido", "ferias_acrescimos", "decimo_terceiro", "avulso"] as const;
export type Natureza = (typeof NATUREZAS)[number];
export const ROTULO_NATUREZA: Record<Natureza, string> = {
  liquido: "Líquido", ferias_acrescimos: "Férias/acréscimos", decimo_terceiro: "13º", avulso: "Avulso",
};

/** Valor a pagar em centavos (a mesma soma da coluna gerada rh_fp_itens.valor). */
export const valorAPagar = (v: Record<Natureza, number>) => NATUREZAS.reduce((s, n) => s + Math.round((v[n] || 0) * 100), 0);

/** Valor digitado em reais: "1.234,56" / "1234,56" / "1234.56" / "R$ 1.234" → número; vazio → 0; inválido ou negativo → NaN. */
export function lerReais(texto: string): number {
  const s = texto.replace(/R\$|\s/g, "");
  if (!s) return 0;
  const milhar = /,/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s);   // "1.234" é mil duzentos e trinta e quatro
  const n = Number(milhar ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 && /^[\d.,]+$/.test(s) ? Math.round(n * 100) / 100 : NaN;
}
