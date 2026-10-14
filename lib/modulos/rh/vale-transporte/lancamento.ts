// Título do vale-transporte para o Consistem (PUT financeiro/v10/lancamentoContasPagar), um por colaborador no mês aprovado.
// Regra 11 de docs/modulos/rh-vale-transporte.md. Fornecedor = "Nº" do VT; valor = valor do mês; vencimento = dia do pagamento;
// emissão/entrada = dia do lançamento; documento = "VT" + MMAA; códigos (histórico, portador, categoria, fluxo, contas contábeis)
// vêm dos Parâmetros do módulo: nada é inventado aqui. A reserva (rh_vt_reservar_lancamentos) confere tudo de novo no banco.
import type { NovoLancamentoContaPagar } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import type { FormaPagamento } from "./modulo";

export const CAMPOS_LANCAMENTO = ["codHistorico", "codPortador", "categoriaDoc", "grupoContaFluxoCaixa", "contaFluxoCaixa", "contaContabilDebito", "contaContabilCredito"] as const;
export type CodigosLancamento = Record<(typeof CAMPOS_LANCAMENTO)[number], number>;
export const ROTULO_CAMPO_LANCAMENTO: Record<keyof CodigosLancamento, string> = {
  codHistorico: "Histórico", codPortador: "Portador", categoriaDoc: "Categoria do documento", grupoContaFluxoCaixa: "Grupo da conta de fluxo",
  contaFluxoCaixa: "Conta de fluxo", contaContabilDebito: "Conta contábil de débito", contaContabilCredito: "Conta contábil de crédito",
};

const MAX_COMPLEMENTO = 70;
const ROTULO_FORMA_TITULO: Record<FormaPagamento, string> = { fopag: "FOPAG", pix_neo_formas: "PIX NEO FORMAS", pix_neo_servicos: "PIX NEO SERVICOS" };

/** Códigos gravados nos Parâmetros; nulos se faltar algum (inteiro positivo) ou se débito = crédito. */
export function lerCodigosLancamento(json: unknown): CodigosLancamento | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const cfg = {} as CodigosLancamento;
  for (const k of CAMPOS_LANCAMENTO) {
    const v = typeof o[k] === "string" ? Number(o[k]) : o[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
    cfg[k] = v;
  }
  return cfg.contaContabilDebito === cfg.contaContabilCredito ? null : cfg;
}

export type ItemTitulo = { id: string; cod_fornecedor: string; nome: string; valor: number; forma_pagamento: FormaPagamento };

export function complementoVt(competencia: string, forma: FormaPagamento): string {
  const texto = `VALE TRANSPORTE ${rotuloMes(competencia).toUpperCase()} - ${ROTULO_FORMA_TITULO[forma]}`;
  return texto.slice(0, MAX_COMPLEMENTO);
}

export const documentoVt = (competencia: string) => `VT${competencia.slice(5, 7)}${competencia.slice(2, 4)}`;

export function montarTituloVt(e: { item: ItemTitulo; competencia: string; dataPagamento: string; hoje: string; codigos: CodigosLancamento }): NovoLancamentoContaPagar {
  const c = e.codigos;
  return {
    codFornecedor: Number(e.item.cod_fornecedor), categoriaDoc: c.categoriaDoc, codDocumento: documentoVt(e.competencia), codPortador: c.codPortador,
    dataEmissao: e.hoje, dataEntrada: e.hoje, dataVencimento: e.dataPagamento, valorDocumento: Math.round(e.item.valor * 100) / 100,
    codHistorico: c.codHistorico, complementoHistorico: complementoVt(e.competencia, e.item.forma_pagamento),
    grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
    dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
  };
}

/** Itens que viram título: valor > 0 e ainda sem lançamento ativo. */
export function itensALancar<T extends ItemTitulo>(itens: readonly T[], comLancamentoAtivo: ReadonlySet<string>): T[] {
  return itens.filter((i) => i.valor > 0 && !comLancamentoAtivo.has(i.id));
}

const inteiroPositivo = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Códigos lidos do detalhe de um título já lançado no Consistem (modelo); o que não vier fica de fora para o gestor digitar. */
export function codigosDoModelo(detalhe: Record<string, unknown>): Partial<CodigosLancamento> {
  const contab = (detalhe.dadosContabilidade && typeof detalhe.dadosContabilidade === "object" ? detalhe.dadosContabilidade : {}) as Record<string, unknown>;
  const achado: Partial<CodigosLancamento> = {
    codHistorico: inteiroPositivo(detalhe.codHistorico),
    codPortador: inteiroPositivo(detalhe.codPortador ?? detalhe.codBanco),
    categoriaDoc: inteiroPositivo(detalhe.categoriaDoc),
    grupoContaFluxoCaixa: inteiroPositivo(detalhe.grupoContaFluxoCaixa),
    contaFluxoCaixa: inteiroPositivo(detalhe.contaFluxoCaixa),
    contaContabilDebito: inteiroPositivo(contab.contaContabilDebito ?? detalhe.contaContabilDebito),
    contaContabilCredito: inteiroPositivo(contab.contaContabilCredito ?? detalhe.contaContabilCredito),
  };
  return Object.fromEntries(Object.entries(achado).filter(([, v]) => v !== undefined)) as Partial<CodigosLancamento>;
}
