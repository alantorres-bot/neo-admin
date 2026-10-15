// Regras do Painel do RH (puras e testadas): saudação, etapas e checklist do fechamento da folha, variação entre meses e
// composição do valor (salários, 13º, avulsos). As leituras ficam em app/(plataforma)/rh/painel/dados.ts.
import { diferencaDias } from "@/lib/nucleo/fila";

export const MODULO_PAINEL_RH = "rh.painel";
export const ROTA_PAINEL_RH = "/rh/painel";

export type StatusFolha = "aberta" | "conferida" | "aprovada" | "paga";
export const ETAPAS_FOLHA: { status: StatusFolha; nome: string }[] = [
  { status: "aberta", nome: "Aberta" }, { status: "conferida", nome: "Conferida" }, { status: "aprovada", nome: "Aprovada" }, { status: "paga", nome: "Paga" },
];

/** "Bom dia" até 11h59, "Boa tarde" até 17h59, depois "Boa noite" (hora de Cuiabá, 0–23). */
export function saudacao(hora: number): string {
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** Dias corridos de hoje até a data (negativo = já passou). */
export const diasAte = (hoje: string, data: string) => diferencaDias(data, hoje);

/** Variação percentual de `atual` sobre `anterior` (centavos), com uma casa; null sem base de comparação. */
export function variacao(atual: number, anterior: number | null | undefined): number | null {
  if (!anterior || anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

export type Composicao = { salarios: number; decimo: number; avulso: number };
/** Partes do total em % (uma casa), somando 100 quando há valor. */
export function percentuais(c: Composicao): Composicao {
  const total = c.salarios + c.decimo + c.avulso;
  if (total <= 0) return { salarios: 0, decimo: 0, avulso: 0 };
  const p = (v: number) => Math.round((v / total) * 1000) / 10;
  const decimo = p(c.decimo), avulso = p(c.avulso);
  return { salarios: Math.round((100 - decimo - avulso) * 10) / 10, decimo, avulso };
}

export type EstadoItem = "feito" | "pendente" | "aguardando" | "depois";
export type ItemChecklist = { texto: string; estado: EstadoItem; status: string };

/** O que a folha do mês aberto já tem, para o checklist do fechamento. */
export type SituacaoFechamento = {
  empresas: string[];                 // empresas empregadoras na folha do mês
  empresasComLiquido: string[];       // empresas com algum líquido lançado (importado ou digitado)
  modelosAtivos: number;              // modelos de recibo recorrente ativos
  recorrentesGerados: number;         // recibos recorrentes já gerados no mês
  decimoLancado: boolean;             // algum 13º no mês
  status: StatusFolha;
};

const ROTULO_ESTADO: Record<EstadoItem, string> = { feito: "Feito", pendente: "Pendente", aguardando: "Aguardando escritório", depois: "Depois" };
const item = (texto: string, estado: EstadoItem, status = ROTULO_ESTADO[estado]): ItemChecklist => ({ texto, estado, status });

/**
 * Checklist do fechamento da folha (regras 4 a 9 de docs/modulos/rh-folha.md):
 * aberta → recibos recorrentes → líquidos do escritório por empresa → 13º do mês → conferência e aprovação.
 * O 13º não é obrigatório (só há quando alguém faz aniversário): sem valor, fica "aguardando escritório", nunca "pendente".
 */
export function checklistFechamento(s: SituacaoFechamento): ItemChecklist[] {
  const conferida = s.status !== "aberta";
  const faltam = s.empresas.filter((e) => !s.empresasComLiquido.includes(e));
  const empresas = s.empresas.length ? ` — ${s.empresas.map(rotuloEmpresa).join(" e ")}` : "";
  const recorrentes = s.modelosAtivos === 0
    ? item("Recibos recorrentes", "feito", "Sem modelos")
    : s.recorrentesGerados >= s.modelosAtivos
      ? item(`Recibos recorrentes (${s.modelosAtivos})`, "feito")
      : item(`Recibos recorrentes (${s.recorrentesGerados} de ${s.modelosAtivos} gerados)`, "pendente");
  const liquidos = s.empresas.length && !faltam.length
    ? item(`Líquidos do escritório${empresas}`, "feito")
    : item(`Líquidos do escritório${empresas}`, "pendente", faltam.length && faltam.length < s.empresas.length ? `Falta ${faltam.map(rotuloEmpresa).join(" e ")}` : "Pendente");
  return [
    item("Folha do mês aberta", "feito"),
    recorrentes,
    liquidos,
    s.decimoLancado ? item("13º do mês (1ª parcela dos aniversariantes)", "feito", "Lançado") : item("13º do mês (1ª parcela dos aniversariantes)", conferida ? "feito" : "aguardando", conferida ? "Sem 13º no mês" : ROTULO_ESTADO.aguardando),
    s.status === "aberta" ? item("Conferência e aprovação", "depois")
      : s.status === "conferida" ? item("Conferência e aprovação", "pendente", "Aguardando aprovação") : item("Conferência e aprovação", "feito"),
  ];
}

/** "NEO SERVIÇOS" → "Neo Serviços"; "OESTE" → "Oeste". */
export function rotuloEmpresa(empregador: string): string {
  return empregador.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

/** Índice da etapa atual (0 = aberta … 3 = paga). */
export const etapaAtual = (status: StatusFolha) => ETAPAS_FOLHA.findIndex((e) => e.status === status);
