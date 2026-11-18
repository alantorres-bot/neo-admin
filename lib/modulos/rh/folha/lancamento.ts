// Títulos da folha no Consistem: um por pessoa × tipo com valor no mês aprovado (regra 10 de docs/modulos/rh-folha.md; 0521).
// Líquido → salário; férias/acréscimos → férias; avulso → avulso; 13º → o tipo da folha do 13º (0529) ou, nas folhas mensais antigas,
// 1ª parcela (2ª na folha de dezembro).
import type { TipoTitulo } from "@/lib/modulos/rh/lancamento";
import type { TipoFolha } from "./modulo";

export type ValoresItem = { id: string; liquido: number; ferias_acrescimos: number; decimo_terceiro: number; avulso: number };
export type TituloItem = { item_id: string; tipo: TipoTitulo; valor: number };

export const tipoDoDecimo = (competencia: string, folha: TipoFolha = "mensal"): TipoTitulo =>
  folha !== "mensal" ? folha : competencia.slice(5, 7) === "12" ? "decimo_2" : "decimo_1";

export function titulosDoItem(i: ValoresItem, competencia: string, folha: TipoFolha = "mensal"): TituloItem[] {
  const partes: [TipoTitulo, number][] = [["salario", i.liquido], ["ferias", i.ferias_acrescimos], [tipoDoDecimo(competencia, folha), i.decimo_terceiro], ["avulso", i.avulso]];
  return partes.filter(([, v]) => v > 0).map(([tipo, valor]) => ({ item_id: i.id, tipo, valor }));
}

/** Títulos do mês ainda sem lançamento ativo (chave "item:tipo"). */
export function titulosALancar(itens: readonly ValoresItem[], competencia: string, ativos: ReadonlySet<string>, folha: TipoFolha = "mensal"): TituloItem[] {
  return itens.flatMap((i) => titulosDoItem(i, competencia, folha)).filter((t) => !ativos.has(`${t.item_id}:${t.tipo}`));
}
