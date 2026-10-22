// Central de Gestão: textos do destaque gerencial. O CÁLCULO fica no banco (função `pendencia_destaque`, migration 0092),
// fonte única do indicador e da lista; aqui só se monta a frase de cada motivo e a ação recomendada.
// Regras em docs/modulos/administrativo-gestao.md, seção 5.3.
import { formatarData } from "../fila";
import type { Criticidade } from "../tipos";

export type NivelDestaque = "intervir" | "avaliar" | "acompanhar" | "normal";

export type CodigoMotivo =
  | "AGUARDA_GESTOR" | "ATRASO_RELEVANTE" | "ATRASO_SIMPLES" | "VENCE_HOJE" | "PRAZO_PROXIMO" | "IMPACTO_REGISTRADO"
  | "BLOQUEIO_RELEVANTE" | "BLOQUEADA" | "IMPEDE_OUTRA" | "PRECISA_DISTRIBUIR" | "SEM_MOVIMENTACAO" | "SEM_PRAZO_IMPORTANTE"
  | "AJUSTE_MANUAL";

/** Motivo como o banco devolve: código, nível e os dados usados na regra. */
export type Motivo = {
  codigo: CodigoMotivo;
  nivel: NivelDestaque;
  dias?: number;
  limite?: number;
  prazo?: string | null;
  desde?: string;
  motivo?: string | null;
  impacto?: "financeiro" | "fiscal" | "operacional";
  fundamento?: string | null;
  quantidade?: number;
  prioridade?: Criticidade;
  prioridade_critica?: boolean;
  por?: string | null;
  em?: string | null;
};

export const ROTULO_DESTAQUE: Record<NivelDestaque, string> = {
  intervir: "Intervir",
  avaliar: "Avaliar",
  acompanhar: "Acompanhar",
  normal: "Normal",
};

export const ROTULO_PRIORIDADE: Record<Criticidade, string> = { critica: "Crítica", alta: "Alta", normal: "Normal" };

const ROTULO_IMPACTO = { financeiro: "financeiro", fiscal: "fiscal", operacional: "operacional" } as const;

const dias = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);
const comMotivo = (texto: string, motivo?: string | null) => (motivo ? `${texto}: ${motivo}` : texto);

/** Frase do motivo, para a tela. `nomes` traduz o id de quem fez o ajuste manual. */
export function descreverMotivo(m: Motivo, nomes?: ReadonlyMap<string, string>): string {
  switch (m.codigo) {
    case "AGUARDA_GESTOR":
      return comMotivo(`Aguarda decisão do gestor desde ${formatarData(m.desde)}`, m.motivo);
    case "ATRASO_RELEVANTE":
      return m.prioridade_critica && (m.dias ?? 0) <= (m.limite ?? 0)
        ? `Atrasada há ${dias(m.dias ?? 0)}, com prioridade crítica`
        : `Atrasada há ${dias(m.dias ?? 0)} (limite de ${dias(m.limite ?? 0)})`;
    case "ATRASO_SIMPLES":
      return `Atrasada há ${dias(m.dias ?? 0)}`;
    case "VENCE_HOJE":
      return "Vence hoje";
    case "PRAZO_PROXIMO":
      return m.dias === 1 ? `Vence amanhã (${formatarData(m.prazo)})` : `Vence em ${dias(m.dias ?? 0)} (${formatarData(m.prazo)})`;
    case "IMPACTO_REGISTRADO":
      return comMotivo(m.impacto ? `Impacto ${ROTULO_IMPACTO[m.impacto]} registrado` : "Impacto registrado", m.fundamento);
    case "BLOQUEIO_RELEVANTE":
      return comMotivo(`Bloqueada há ${dias(m.dias ?? 0)} (limite de ${dias(m.limite ?? 0)})`, m.motivo);
    case "BLOQUEADA":
      return comMotivo(m.dias === 0 ? "Bloqueada hoje" : m.dias === 1 ? "Bloqueada desde ontem" : `Bloqueada há ${dias(m.dias ?? 0)}`, m.motivo);
    case "IMPEDE_OUTRA":
      return m.quantidade === 1 ? "Impede outra pendência de avançar" : `Impede ${m.quantidade} pendências de avançar`;
    case "PRECISA_DISTRIBUIR": {
      const partes = ["Sem responsável"];
      if (m.prioridade && m.prioridade !== "normal") partes.push(`prioridade ${ROTULO_PRIORIDADE[m.prioridade].toLowerCase()}`);
      if (m.prazo) partes.push(`prazo ${formatarData(m.prazo)}`);
      return partes.join(", ");
    }
    case "SEM_MOVIMENTACAO":
      return `Sem movimentação há ${dias(m.dias ?? 0)} (limite de ${dias(m.limite ?? 0)})`;
    case "SEM_PRAZO_IMPORTANTE":
      return `Prioridade ${m.prioridade ? ROTULO_PRIORIDADE[m.prioridade].toLowerCase() : "alta"} sem prazo definido`;
    case "AJUSTE_MANUAL": {
      const quem = m.por ? nomes?.get(m.por) : undefined;
      const quando = m.em ? ` em ${formatarData(m.em)}` : "";
      return comMotivo(`Ajuste manual${quem ? ` de ${quem}` : ""}${quando} para "${ROTULO_DESTAQUE[m.nivel]}"`, m.motivo);
    }
  }
}

/**
 * Ação recomendada: só quando a regra tem uma ação certa (seção 7 da especificação). Ordem: decisão, distribuição,
 * bloqueio, atraso. Sem regra confiável, nenhuma.
 */
export function acaoRecomendada(motivos: readonly Motivo[], temResponsavel: boolean): string | null {
  const tem = (c: CodigoMotivo) => motivos.some((m) => m.codigo === c && m.nivel === "intervir");
  if (tem("AGUARDA_GESTOR")) return "Decidir o pedido do responsável";
  if (tem("PRECISA_DISTRIBUIR")) return "Atribuir um responsável";
  if (tem("BLOQUEIO_RELEVANTE") || tem("IMPEDE_OUTRA")) return "Resolver o bloqueio com o responsável";
  if (tem("ATRASO_RELEVANTE") && temResponsavel) return "Cobrar o andamento do responsável";
  return null;
}

/** Motivos que exigem intervenção primeiro; o ajuste manual por último (ele explica o nível final). */
export function ordenarMotivos(motivos: readonly Motivo[]): Motivo[] {
  const peso = (m: Motivo) => (m.codigo === "AJUSTE_MANUAL" ? 9 : { intervir: 0, avaliar: 1, acompanhar: 2, normal: 3 }[m.nivel]);
  return [...motivos].sort((a, b) => peso(a) - peso(b));
}
