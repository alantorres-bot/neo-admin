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
export type CreditoAberto = { data: string; creditoMin: number; restanteMin: number; vencimento: string };

/**
 * Créditos em aberto pela regra "o mais antigo primeiro" (o mesmo cálculo da view rh_bh_creditos no banco): todo débito do
 * período e todo pagamento na folha consomem os créditos mais antigos. Só entram movimentos a partir de `inicio`
 * (o saldo anterior é ignorado). Saldo = créditos − débitos − pagos (pode ser negativo).
 */
export function creditosEmAberto(movimentos: readonly Movimento[], pagosMin: number, inicio: string, validadeMeses: number): { saldoMin: number; creditos: CreditoAberto[] } {
  const validos = movimentos.filter((m) => m.data >= inicio).sort((a, b) => a.data.localeCompare(b.data));
  let consumir = validos.reduce((s, m) => s + m.negativoMin, 0) + pagosMin;
  const total = validos.reduce((s, m) => s + m.positivoMin, 0);
  const creditos: CreditoAberto[] = [];
  for (const m of validos.filter((x) => x.positivoMin > 0)) {
    const consumido = Math.min(m.positivoMin, Math.max(0, consumir));
    consumir -= consumido;
    creditos.push({ data: m.data, creditoMin: m.positivoMin, restanteMin: m.positivoMin - consumido, vencimento: vencimentoDoCredito(m.data, validadeMeses) });
  }
  return { saldoMin: total - (validos.reduce((s, m) => s + m.negativoMin, 0) + pagosMin), creditos };
}

/** Separa os créditos em aberto: vencidos (vencimento antes de hoje: pagar na folha) e vencendo até hoje + `avisoDias`. */
export function situacao(creditos: readonly CreditoAberto[], hoje: string, avisoDias: number): { vencidoMin: number; vencendoMin: number; proximoVencimento: string | null } {
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) + avisoDias * 86_400_000).toISOString().slice(0, 10);
  const abertos = creditos.filter((c) => c.restanteMin > 0);
  const vencendo = abertos.filter((c) => c.vencimento >= hoje && c.vencimento <= limite);
  return {
    vencidoMin: abertos.filter((c) => c.vencimento < hoje).reduce((s, c) => s + c.restanteMin, 0),
    vencendoMin: vencendo.reduce((s, c) => s + c.restanteMin, 0),
    proximoVencimento: abertos.filter((c) => c.vencimento >= hoje).map((c) => c.vencimento).sort()[0] ?? null,
  };
}
