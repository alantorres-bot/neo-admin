// Central de Gestão: frase de cada evento do histórico da pendência (função `pendencia_historico`, migration 0093).
import { formatarData } from "../fila";
import { ROTULO_DESTAQUE, ROTULO_PRIORIDADE, type NivelDestaque } from "./destaque";
import { ROTULO_CATEGORIA, type Categoria } from "./tarefas";
import type { Criticidade } from "../tipos";

export type EventoHistorico = { em: string; quem: string; evento: string; de: string | null; para: string | null; detalhe: string | null };

const ROTULO_STATUS: Record<string, string> = { aberta: "Aberta", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
const ou = (valor: string | null, vazio: string, rotulo: (v: string) => string = (v) => v) => (valor ? rotulo(valor) : vazio);
const categoria = (v: string) => ROTULO_CATEGORIA[v as Categoria] ?? v;
const prioridade = (v: string) => ROTULO_PRIORIDADE[v as Criticidade] ?? v;

const COMENTARIO: Record<string, string> = {
  comentario: "Comentou", observacao: "Observação", cancelamento: "Motivo do cancelamento",
  cobranca_gestor: "Cobrou andamento", resposta_gestor: "Respondeu ao pedido de decisão",
};

export function descreverEvento(e: EventoHistorico): string {
  if (e.evento.startsWith("comentario:")) {
    return `${COMENTARIO[e.evento.slice("comentario:".length)] ?? "Comentou"}: ${e.para ?? ""}`;
  }
  switch (e.evento) {
    case "criada":
      return e.detalhe === "manual" ? "Criou a tarefa" : "Pendência publicada pelo módulo";
    case "status":
      return `Situação: ${ou(e.de, "—", (v) => ROTULO_STATUS[v] ?? v)} → ${ou(e.para, "—", (v) => ROTULO_STATUS[v] ?? v)}`;
    case "responsavel_id":
      return `Responsável: ${ou(e.de, "sem responsável")} → ${ou(e.para, "sem responsável")}`;
    case "prazo":
      return `Prazo: ${ou(e.de, "sem prazo", formatarData)} → ${ou(e.para, "sem prazo", formatarData)}`;
    case "criticidade":
      return `Prioridade: ${ou(e.de, "—", prioridade)} → ${ou(e.para, "—", prioridade)}`;
    case "bloqueio_motivo":
      return e.para ? `Bloqueou: ${e.para}${e.detalhe ? " (depende de outra pendência)" : ""}` : "Desbloqueou";
    case "aguarda_gestor_motivo":
      return e.para ? `Pediu decisão do gestor: ${e.para}` : "Pedido de decisão encerrado";
    case "destaque_manual":
      return e.para ? `Ajustou o destaque para "${ROTULO_DESTAQUE[e.para as NivelDestaque] ?? e.para}"${e.detalhe ? `: ${e.detalhe}` : ""}` : "Retirou o ajuste do destaque";
    case "precisa_distribuir":
      return e.para === "true" ? 'Marcou como "precisa distribuir"' : 'Desmarcou "precisa distribuir"';
    case "categoria":
      return `Categoria: ${ou(e.de, "—", categoria)} → ${ou(e.para, "—", categoria)}`;
    case "titulo":
      return `Título alterado para "${e.para ?? ""}"`;
    case "descricao":
      return "Descrição alterada";
    default:
      return e.evento;
  }
}
