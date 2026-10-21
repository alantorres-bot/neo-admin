// Identidade e regras do RH/SST > Banco de horas (saldo e vencimento). Ver docs/modulos/rh-banco-horas.md.
// Ciclo do ponto = da folha: de 26 a 25. O crédito vence no fim do ciclo em que nasceu + validade (6 meses):
// crédito de 10/05 → ciclo 26/04–25/05 → vence em 25/11 (entra na folha de novembro). Datas ISO "AAAA-MM-DD", sem fuso.

export const MODULO_BANCO_HORAS = "rh.banco_horas";
export const ROTA_BANCO_HORAS = "/rh/banco_horas";
/** Último dia do ciclo do ponto e da folha. */
export const DIA_CORTE = 25;

const iso = (a: number, m: number, d: number) => new Date(Date.UTC(a, m, d)).toISOString().slice(0, 10);

/** Fim do ciclo (dia 25) que contém a data: até o dia 25, o do próprio mês; do 26 em diante, o do mês seguinte. */
export function fimDoCiclo(data: string): string {
  const [a, m, d] = data.split("-").map(Number);
  return iso(a, d > DIA_CORTE ? m : m - 1, DIA_CORTE);
}

/** Vencimento de um crédito: fim do ciclo de origem + `meses`. */
export function vencimentoDoCredito(data: string, meses: number): string {
  const [a, m] = fimDoCiclo(data).split("-").map(Number);
  return iso(a, m - 1 + meses, DIA_CORTE);
}

/** Início do ciclo (dia 26) que termina em `fim`. */
export function inicioDoCiclo(fim: string): string {
  const [a, m] = fim.split("-").map(Number);
  return iso(a, m - 2, DIA_CORTE + 1);
}

export type Movimento = { data: string; positivoMin: number; negativoMin: number };
/** Horas acertadas na folha pelo fechamento do ciclo: entram na conta no dia 25 da competência. */
export type LancamentoFolha = { competencia: string; tipo: "pago" | "descontado"; minutos: number };
/** Item em aberto: +1 = horas a folgar (a empresa deve), −1 = horas a repor (o funcionário deve). */
export type ItemAberto = { data: string; sinal: 1 | -1; restanteMin: number; vencimento: string };

/**
 * Fila do banco de horas nos dois sentidos (o mesmo cálculo de rh_bh_em_aberto no banco), em ordem de data:
 * hora a mais abate primeiro a hora a menos mais antiga e vice-versa; o que sobra fica em aberto e vence no fim do ciclo de
 * origem + validade. "Pago" na folha conta como hora a menos (consome os créditos mais antigos, os vencidos) e "descontado" como
 * hora a mais. Só entram movimentos a partir de `inicio` (o saldo anterior é ignorado). Saldo = soma dos itens com sinal.
 */
export function emAberto(movimentos: readonly Movimento[], lancamentos: readonly LancamentoFolha[], inicio: string, validadeMeses: number): { saldoMin: number; itens: ItemAberto[] } {
  const eventos = [
    ...movimentos.filter((m) => m.data >= inicio && m.positivoMin !== m.negativoMin).map((m) => ({ data: m.data, valor: m.positivoMin - m.negativoMin, ordem: 0 })),
    ...lancamentos.map((l) => ({ data: `${l.competencia.slice(0, 7)}-${DIA_CORTE}`, valor: l.tipo === "pago" ? -l.minutos : l.minutos, ordem: 1 })),
  ].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem);
  const fila: ItemAberto[] = [];
  for (const e of eventos) {
    const sinal = e.valor > 0 ? 1 : -1;
    let resto = Math.abs(e.valor);
    for (const item of fila) {
      if (resto === 0) break;
      if (item.sinal === sinal || item.restanteMin === 0) continue;
      const usado = Math.min(item.restanteMin, resto);
      item.restanteMin -= usado;
      resto -= usado;
    }
    if (resto > 0) fila.push({ data: e.data, sinal, restanteMin: resto, vencimento: vencimentoDoCredito(e.data, validadeMeses) });
  }
  const itens = fila.filter((i) => i.restanteMin > 0);
  return { saldoMin: itens.reduce((s, i) => s + i.sinal * i.restanteMin, 0), itens };
}

/**
 * Situação na data `hoje`: vencidos (vencimento antes de hoje) a pagar (+) ou a descontar (−) no fechamento, e o que vence até
 * hoje + `avisoDias` (folgar ou repor).
 */
export function situacao(itens: readonly ItemAberto[], hoje: string, avisoDias: number) {
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) + avisoDias * 86_400_000).toISOString().slice(0, 10);
  const soma = (f: (i: ItemAberto) => boolean) => itens.filter(f).reduce((s, i) => s + i.restanteMin, 0);
  const vencendo = (i: ItemAberto) => i.vencimento >= hoje && i.vencimento <= limite;
  return {
    pagarMin: soma((i) => i.sinal === 1 && i.vencimento < hoje),
    descontarMin: soma((i) => i.sinal === -1 && i.vencimento < hoje),
    folgarMin: soma((i) => i.sinal === 1 && vencendo(i)),
    reporMin: soma((i) => i.sinal === -1 && vencendo(i)),
    proximoVencimento: itens.filter((i) => i.vencimento >= hoje).map((i) => i.vencimento).sort()[0] ?? null,
  };
}
