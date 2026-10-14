// Calendário do RH: vale-transporte (docs/modulos/rh-vale-transporte.md, regras 1, 7 e 13) e folha (docs/modulos/rh-folha.md, regra 2). Dia útil = segunda a sexta; feriados
// não são considerados nesta versão (o RH ajusta os dias úteis da competência à mão). Datas ISO "AAAA-MM-DD", sem fuso.

const MS_DIA = 86_400_000;
const paraData = (iso: string) => new Date(`${iso}T00:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);
const ehDiaUtil = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** "2026-11" ou "2026-11-15" → "2026-11-01". */
export function inicioDoMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(mes);
  if (!m) throw new Error(`Mês inválido: ${mes}`);
  return `${m[1]}-${m[2]}-01`;
}

export function fimDoMes(mes: string): string {
  const ini = paraData(inicioDoMes(mes));
  return paraIso(new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0)));
}

/** Soma meses a um 1º dia de mês. */
export function somarMeses(mes: string, n: number): string {
  const ini = paraData(inicioDoMes(mes));
  return paraIso(new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + n, 1)));
}

/** Dias úteis (seg–sex) no intervalo fechado [inicio, fim]; 0 se vazio. */
export function diasUteisEntre(inicio: string, fim: string): number {
  let n = 0;
  for (let t = paraData(inicio).getTime(), f = paraData(fim).getTime(); t <= f; t += MS_DIA) if (ehDiaUtil(new Date(t))) n++;
  return n;
}

export function diasUteisDoMes(mes: string): number {
  return diasUteisEntre(inicioDoMes(mes), fimDoMes(mes));
}

/** Dias úteis de um período (férias, afastamento) que caem dentro do mês. Período incompleto → 0. */
export function diasUteisDoPeriodoNoMes(inicio: string | null, fim: string | null, mes: string): number {
  if (!inicio || !fim || fim < inicio) return 0;
  const a = inicio > inicioDoMes(mes) ? inicio : inicioDoMes(mes);
  const b = fim < fimDoMes(mes) ? fim : fimDoMes(mes);
  return b < a ? 0 : diasUteisEntre(a, b);
}

export function ultimoDiaUtil(mes: string): string {
  let d = paraData(fimDoMes(mes));
  while (!ehDiaUtil(d)) d = new Date(d.getTime() - MS_DIA);
  return paraIso(d);
}

/** n-ésimo dia útil do mês (1 = primeiro). Ex.: 5º dia útil de outubro/2026 = 07/10/2026. */
export function enesimoDiaUtil(mes: string, n: number): string {
  let d = paraData(inicioDoMes(mes));
  for (let i = 0; ; d = new Date(d.getTime() + MS_DIA)) if (ehDiaUtil(d) && ++i >= Math.max(n, 1)) return paraIso(d);
}

/** Folha do mês M: paga no 5º dia útil de M+1. */
export const pagamentoDaFolha = (competencia: string) => enesimoDiaUtil(somarMeses(competencia, 1), 5);

/** Volta `n` dias úteis a partir de uma data (que não conta). */
export function voltarDiasUteis(data: string, n: number): string {
  let d = paraData(data);
  for (let i = 0; i < n; ) {
    d = new Date(d.getTime() - MS_DIA);
    if (ehDiaUtil(d)) i++;
  }
  return paraIso(d);
}

/** Competência = mês do VT (M+1): paga no último dia útil do mês anterior; fechamento 2 dias úteis antes do pagamento. */
export function prazosDaCompetencia(competencia: string): { pagamento: string; fechamento: string } {
  const pagamento = ultimoDiaUtil(somarMeses(competencia, -1));
  return { pagamento, fechamento: voltarDiasUteis(pagamento, 2) };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-11-01" → "novembro/2026". */
export function rotuloMes(competencia: string): string {
  const d = paraData(inicioDoMes(competencia));
  return `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}
export const nomeDoMes = (competencia: string) => MESES[paraData(inicioDoMes(competencia)).getUTCMonth()];
