// Comercial / Pedidos: regras da carteira (puras e testadas). Valores em centavos inteiros; datas 'aaaa-mm-dd' (Cuiabá).
import { diferencaDias } from "@/lib/nucleo/fila";
import { pedidoAtrasado, SITUACAO_PEDIDO } from "@/supabase/functions/_shared/consistem-comercial";

export { MODULO_PEDIDOS, ROTA_PEDIDOS } from "@/supabase/functions/_shared/consistem-comercial";
export { pedidoAtrasado };

export const rotuloSituacao = (s: string) => SITUACAO_PEDIDO[s] ?? `Situação ${s}`;

/** Ainda pode faturar: tem saldo e não está cancelado nem faturado total. */
export const pedidoAberto = (p: { situacao: string; valor_saldo: number }) => p.valor_saldo > 0 && p.situacao !== "9" && p.situacao !== "6";

/** Dias de atraso da previsão de faturamento (0 se não está atrasado). */
export function diasAtraso(p: { situacao: string; valor_saldo: number; data_prev_fat: string | null }, hoje: string): number {
  return pedidoAtrasado(p, hoje) ? diferencaDias(hoje, p.data_prev_fat!) : 0;
}

export const emCentavos = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Math.round(Number(v) * 100));

type PedidoPrevisao = { situacao: string; valor_saldo: number; data_prev_fat: string | null };
export type Faixa = { rotulo: string; inicio: string | null; fim: string | null; pedidos: number; saldoCentavos: number };

/** Segunda-feira da semana de `iso`. */
function segunda(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const recuo = (d.getUTCDay() + 6) % 7; // domingo=6, segunda=0
  return new Date(d.getTime() - recuo * 86_400_000).toISOString().slice(0, 10);
}
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Previsão de faturamento dos pedidos em aberto (saldo a faturar):
 *   atrasados  previsão antes de hoje
 *   semanas    esta semana (de hoje até domingo) e as próximas `semanas - 1`, de segunda a domingo
 *   meses      o que vem depois das semanas, por mês da previsão
 *   semPrevisao pedidos abertos sem data de previsão
 */
export function previsaoFaturamento(pedidos: PedidoPrevisao[], hoje: string, semanas = 6) {
  const abertos = pedidos.filter(pedidoAberto);
  const somar = (lista: PedidoPrevisao[]) => ({ pedidos: lista.length, saldoCentavos: lista.reduce((s, p) => s + emCentavos(p.valor_saldo), 0) });

  const atrasados: Faixa = { rotulo: "Atrasados", inicio: null, fim: somarDias(hoje, -1), ...somar(abertos.filter((p) => p.data_prev_fat !== null && p.data_prev_fat < hoje)) };
  const faixasSemana: Faixa[] = [];
  let inicio = hoje;
  for (let i = 0; i < semanas; i++) {
    const fim = somarDias(segunda(inicio), 6);
    const daFaixa = abertos.filter((p) => p.data_prev_fat !== null && p.data_prev_fat >= inicio && p.data_prev_fat <= fim);
    faixasSemana.push({ rotulo: i === 0 ? "Esta semana" : `${ddmm(inicio)} a ${ddmm(fim)}`, inicio, fim, ...somar(daFaixa) });
    inicio = somarDias(fim, 1);
  }
  const depois = abertos.filter((p) => p.data_prev_fat !== null && p.data_prev_fat >= inicio);
  const porMes = new Map<string, PedidoPrevisao[]>();
  for (const p of depois) porMes.set(p.data_prev_fat!.slice(0, 7), [...(porMes.get(p.data_prev_fat!.slice(0, 7)) ?? []), p]);
  const meses: Faixa[] = [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, lista]) => ({
    rotulo: `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`, inicio: null, fim: null, ...somar(lista),
  }));
  const semPrevisao: Faixa = { rotulo: "Sem previsão", inicio: null, fim: null, ...somar(abertos.filter((p) => p.data_prev_fat === null)) };
  return { atrasados, semanas: faixasSemana, meses, semPrevisao, total: somar(abertos) };
}

/** Parcela de NF: paga, vencida (sem pagamento e vencimento passado) ou a vencer. */
export function situacaoParcela(p: { data_vencimento: string | null; data_pagamento: string | null }, hoje: string): "paga" | "vencida" | "a_vencer" {
  if (p.data_pagamento) return "paga";
  return p.data_vencimento !== null && p.data_vencimento < hoje ? "vencida" : "a_vencer";
}
