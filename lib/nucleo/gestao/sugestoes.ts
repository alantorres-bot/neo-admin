// Central de Gestão > Sugestões de melhoria: situações, transições e textos (regras puras).
// As transições espelham o gatilho `fn_sugestoes_regras` (migration 0096); quem decide é o banco.
import type { MenuArea } from "../permissoes";

export const SITUACOES_SUGESTAO = ["nova", "em_avaliacao", "aprovada", "nao_aprovada", "em_desenvolvimento", "concluida"] as const;
export type SituacaoSugestao = (typeof SITUACOES_SUGESTAO)[number];
export type PrioridadeSugestao = "alta" | "normal" | "baixa";

export const ROTULO_SITUACAO_SUGESTAO: Record<SituacaoSugestao, string> = {
  nova: "Nova", em_avaliacao: "Em avaliação", aprovada: "Aprovada", nao_aprovada: "Não aprovada",
  em_desenvolvimento: "Em desenvolvimento", concluida: "Concluída",
};
export const ROTULO_PRIORIDADE_SUGESTAO: Record<PrioridadeSugestao, string> = { alta: "Alta", normal: "Normal", baixa: "Baixa" };

const TRANSICOES: Record<SituacaoSugestao, SituacaoSugestao[]> = {
  nova: ["em_avaliacao", "aprovada", "nao_aprovada"],
  em_avaliacao: ["aprovada", "nao_aprovada"],
  aprovada: ["em_desenvolvimento", "nao_aprovada"],
  nao_aprovada: ["em_avaliacao"],
  em_desenvolvimento: ["concluida", "aprovada"],
  concluida: ["em_desenvolvimento"],
};

/** Para onde a sugestão pode ir a partir da situação atual (só avaliador muda). */
export function proximasSituacoes(atual: SituacaoSugestao): SituacaoSugestao[] {
  return TRANSICOES[atual];
}

/** Aprovar e não aprovar exigem justificativa. */
export const exigeJustificativa = (s: SituacaoSugestao) => s === "aprovada" || s === "nao_aprovada";

/** Área e módulo da tela em que a pessoa está (para o "Sugerir melhoria" já vir preenchido). */
export function contextoDaTela(caminho: string, menu: readonly MenuArea[]): { area: string | null; modulo: string | null } {
  for (const { area, modulos } of menu) {
    const m = modulos.find((x) => !x.externo && (caminho === x.rota || caminho.startsWith(x.rota + "/")));
    if (m) return { area: area.codigo, modulo: m.codigo };
  }
  if (caminho === "/gestao" || caminho.startsWith("/gestao/")) return { area: "administrativo", modulo: "administrativo.gestao" };
  return { area: null, modulo: null };
}

export type EventoSugestao = { em: string; quem: string; evento: string; de: string | null; para: string | null; texto: string | null };

export function descreverEventoSugestao(e: EventoSugestao): string {
  const rotulo = (v: string | null) => (v ? (ROTULO_SITUACAO_SUGESTAO[v as SituacaoSugestao] ?? v) : "—");
  if (e.evento === "enviada") return "Enviou a sugestão";
  if (e.evento === "comentario") return `Comentou: ${e.texto ?? ""}`;
  return `Situação: ${rotulo(e.de)} → ${rotulo(e.para)}${e.texto ? `. Justificativa: ${e.texto}` : ""}`;
}
