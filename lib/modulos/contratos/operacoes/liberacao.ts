// Contratos/Operações — liberação para faturamento e alerta "NF sem liberação"
// (docs/modulos/contratos-operacoes.md, 5.8.2 e 5.8.4; R4-P1 — Financiamento, aprovada em 24/10/2026).

import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import type { Modalidade, SituacaoObrigacao } from "./obrigacoes";

export type SituacaoContrato = "em_elaboracao" | "em_negociacao" | "aprovado" | "em_assinatura" | "assinado" | "encerrado" | "cancelado";
export type ContratoLiberacao = { tipo: "venda" | "locacao" | "servico"; situacao: SituacaoContrato; documentoAssinadoConfirmado: boolean };
export type SituacaoAutorizacao = "aguardando" | "recebida" | "validada" | "recusada" | "substituida";
export type ObrigacaoTrava = { descricao: string; situacao: SituacaoObrigacao };

export type Liberacao =
  | { resultado: "nao_se_aplica" }
  | { resultado: "liberada" }
  | { resultado: "bloqueada"; motivos: string[] };

/**
 * `ctr_faturamento_liberado`, parte pura. Liberada quando todas as obrigações de trava estão concluídas ou dispensadas.
 * No financiamento a função exige, além disso e independentemente do modelo, contrato `venda` assinado (com o documento
 * `contrato_assinado` confirmado) E autorização bancária `validada`. Modalidade sem trava (e que não é financiamento): não se aplica.
 */
export function faturamentoLiberado(
  modalidade: Modalidade,
  travas: readonly ObrigacaoTrava[],
  contratos: readonly ContratoLiberacao[],
  autorizacoes: readonly SituacaoAutorizacao[],
): Liberacao {
  const financiamento = modalidade === "financiamento";
  if (!financiamento && travas.length === 0) return { resultado: "nao_se_aplica" };

  const motivos = travas
    .filter((t) => t.situacao !== "concluida" && t.situacao !== "dispensada")
    .map((t) => `${t.descricao}: não concluída`);

  if (financiamento) {
    const assinado = contratos.some((c) => c.tipo === "venda" && c.situacao === "assinado" && c.documentoAssinadoConfirmado);
    if (!assinado) motivos.push("contrato de compra e venda não assinado");
    if (!autorizacoes.includes("validada")) motivos.push("autorização bancária não validada");
  }
  return motivos.length === 0 ? { resultado: "liberada" } : { resultado: "bloqueada", motivos };
}

export type EventoLiberacao = { em: string | Date; para: "liberada" | "bloqueada" };
export type AvaliacaoNf = "sem_alerta" | "alerta" | "conferir";

/**
 * Alerta "NF emitida sem liberação" pelo histórico de liberações (5.8.4, regra única vigente).
 * - Compara a data de emissão ('aaaa-mm-dd') com a data local de Cuiabá de cada evento.
 * - Mudança de liberação no mesmo dia da emissão: "conferir" (requisito derivado, a validar), nunca alerta automático.
 * - Liberada na data da emissão: sem alerta, mesmo que volte a bloqueada depois.
 * - Sem liberação vigente na data: alerta.
 * O marco inicial para operações cadastradas depois do fato [PENDENTE 21] não existe aqui; a rotina que usa esta função
 * nasce desligada (`contratos.operacoes.conferir_erp = false`) e assim deve ficar até a decisão [PENDENTE 31].
 */
export function avaliarNfPorHistorico(emissao: string, eventos: readonly EventoLiberacao[]): AvaliacaoNf {
  const datados = eventos
    .map((e) => ({ dia: hojeEmCuiaba(new Date(e.em)), instante: new Date(e.em).getTime(), para: e.para }))
    .sort((a, b) => a.instante - b.instante);
  if (datados.some((e) => e.dia === emissao)) return "conferir";
  const anteriores = datados.filter((e) => e.dia < emissao);
  return anteriores.at(-1)?.para === "liberada" ? "sem_alerta" : "alerta";
}
