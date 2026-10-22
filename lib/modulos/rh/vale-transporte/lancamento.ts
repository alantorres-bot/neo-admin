// Título do vale-transporte para o Consistem, um por colaborador no mês aprovado. Regra 11 de docs/modulos/rh-vale-transporte.md.
// Fornecedor = "Nº" do VT; valor = valor do mês; vencimento = dia do pagamento; documento "VT" + MMAA; complemento
// "VALE TRANSPORTE - MM/AAAA". Os códigos (tipo "vt" + portador da empregadora/forma) vêm dos Parâmetros (lib/modulos/rh/lancamento.ts).
import type { NovoLancamentoContaPagar } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import { montarTitulo, type CodigosLancamento } from "@/lib/modulos/rh/lancamento";
import type { FormaPagamento } from "./modulo";

export type ItemTitulo = { id: string; cod_fornecedor: string; nome: string; valor: number; empregador: string; forma_pagamento: FormaPagamento };

export function montarTituloVt(e: { item: ItemTitulo; competencia: string; dataPagamento: string; hoje: string; codigos: CodigosLancamento }): NovoLancamentoContaPagar {
  return montarTitulo({ tipo: "vt", codFornecedor: e.item.cod_fornecedor, valor: e.item.valor, competencia: e.competencia, dataPagamento: e.dataPagamento, hoje: e.hoje, codigos: e.codigos });
}

/** Itens que viram título: valor > 0 e ainda sem lançamento ativo. */
export function itensALancar<T extends { id: string; valor: number }>(itens: readonly T[], comLancamentoAtivo: ReadonlySet<string>): T[] {
  return itens.filter((i) => i.valor > 0 && !comLancamentoAtivo.has(i.id));
}
