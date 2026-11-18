// Identidade do módulo RH/SST > Folha de pagamento (fechamento mensal). Ver docs/modulos/rh-folha.md.
import { diaUtilAte, pagamentoDaFolha, rotuloMes } from "@/lib/modulos/rh/calendario";

export const MODULO_FOLHA = "rh.folha";
export const ROTA_FOLHA = "/rh/folha";

/** Tipo da folha (0529): a do mês ou a do 13º (1ª parcela em novembro, 2ª em dezembro), cada uma com o seu fechamento. */
export const TIPOS_FOLHA = ["mensal", "decimo_1", "decimo_2"] as const;
export type TipoFolha = (typeof TIPOS_FOLHA)[number];
export const ROTULO_TIPO_FOLHA: Record<TipoFolha, string> = { mensal: "Mensal", decimo_1: "13º 1ª parcela", decimo_2: "13º 2ª parcela" };

/** Competência da folha do 13º no ano: novembro (1ª) ou dezembro (2ª). */
export const competenciaDoDecimo = (ano: number, tipo: Exclude<TipoFolha, "mensal">) => `${ano}-${tipo === "decimo_1" ? "11" : "12"}-01`;

/** "setembro/2026" ou "13º 1ª parcela/2026" (o mesmo de rh_fp_rotulo). */
export const rotuloFolha = (competencia: string, tipo: TipoFolha) => (tipo === "mensal" ? rotuloMes(competencia) : `${ROTULO_TIPO_FOLHA[tipo]}/${competencia.slice(0, 4)}`);

/** Pagamento sugerido: mensal no 5º dia útil do mês seguinte; 13º no último dia útil até 30/11 (1ª) ou 20/12 (2ª). Sem feriados. */
export const pagamentoDe = (competencia: string, tipo: TipoFolha) =>
  tipo === "mensal" ? pagamentoDaFolha(competencia) : diaUtilAte(`${competencia.slice(0, 4)}-${tipo === "decimo_1" ? "11-30" : "12-20"}`);

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
