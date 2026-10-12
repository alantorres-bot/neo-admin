// Ciclo mensal do cartão (empresa + cartão + competência = mês do vencimento nominal). Espelha o calendário de
// supabase/migrations/0134_crt_ciclos.sql (crt_calendario, crt_competencia_do_vencimento). Ver docs/modulos/financeiro-cartao.md.
import type { CartaoInfo } from "./cartoes";

export const SITUACOES = ["aguardando_fatura", "em_conciliacao", "fechada", "paga"] as const;
export type SituacaoCiclo = (typeof SITUACOES)[number];

export const ROTULO_SITUACAO: Record<SituacaoCiclo, string> = {
  aguardando_fatura: "Aguardando fatura",
  em_conciliacao: "Em conciliação",
  fechada: "Fechada",
  paga: "Paga",
};

/** Classes de cor da situação (borda, fundo, texto) nas grades e selos. */
export const CLASSE_SITUACAO: Record<SituacaoCiclo, string> = {
  aguardando_fatura: "border-amber-300 bg-amber-50 text-amber-900",
  em_conciliacao: "border-sky-300 bg-sky-50 text-sky-900",
  fechada: "border-emerald-300 bg-emerald-50 text-emerald-900",
  paga: "border-grade bg-cabecalho text-muted-foreground",
};

const pad = (n: number) => String(n).padStart(2, "0");
const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** 'AAAA-MM-DD' do dia `dia` no mês `mes` (1–12, pode passar do intervalo: rola o ano), limitado ao fim do mês. */
function diaDoMes(ano: number, mes: number, dia: number): string {
  const a = ano + Math.floor((mes - 1) / 12);
  const m = ((((mes - 1) % 12) + 12) % 12) + 1;
  return `${a}-${pad(m)}-${pad(Math.min(dia, diasNoMes(a, m)))}`;
}

/** Vencimento nominal e fechamento de uma competência ('AAAA-MM-01'): fechamento é o último antes do vencimento. */
export function cicloDaCompetencia(c: Pick<CartaoInfo, "diaFechamento" | "diaVencimento">, competencia: string): { vencimento: string; fechamento: string } {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const vencimento = diaDoMes(ano, mes, c.diaVencimento);
  let fechamento = diaDoMes(ano, mes, c.diaFechamento);
  if (fechamento >= vencimento) fechamento = diaDoMes(ano, mes - 1, c.diaFechamento);
  return { vencimento, fechamento };
}

const emDias = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/** Competência de um vencimento efetivo (o emissor desloca para o dia útil): o mês cujo vencimento nominal fica mais perto. */
export function competenciaDoVencimento(diaVencimento: number, vencimento: string): string {
  const ano = Number(vencimento.slice(0, 4));
  const mes = Number(vencimento.slice(5, 7));
  const candidatos = [-1, 0, 1].map((d) => diaDoMes(ano, mes + d, 1));
  return candidatos
    .map((c) => ({ c, dist: Math.abs(emDias(diaDoMes(+c.slice(0, 4), +c.slice(5, 7), diaVencimento)) - emDias(vencimento)) }))
    .sort((a, b) => a.dist - b.dist || a.c.localeCompare(b.c))[0].c;
}

/** Competência `n` meses depois (ou antes, se negativo). */
export const somarMeses = (competencia: string, n: number) => diaDoMes(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)) + n, 1);

/** "2026-10-01" → "10/2026". */
export const rotuloCompetencia = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/** As `n` competências até a de `ate` ('AAAA-MM-DD'), da mais antiga para a mais nova. */
export function competenciasAte(ate: string, n: number): string[] {
  const ano = Number(ate.slice(0, 4));
  const mes = Number(ate.slice(5, 7));
  return Array.from({ length: n }, (_, i) => diaDoMes(ano, mes - (n - 1 - i), 1));
}

export type Apuracao = { itensALancar: number; residuoCentavos: number };

/** Regra para fechar o mês: nada a lançar e diferença não justificada zero. Devolve o motivo do bloqueio, ou null. */
export function bloqueioDoFechamento(a: Apuracao): string | null {
  if (a.itensALancar > 0) return `Ainda há ${a.itensALancar} ${a.itensALancar === 1 ? "item" : "itens"} da fatura sem título no Consistem e sem justificativa.`;
  if (a.residuoCentavos !== 0) return "A diferença não justificada precisa ser zero.";
  return null;
}
