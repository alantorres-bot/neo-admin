// Central de Gestão: textos do destaque gerencial. O CÁLCULO fica no banco (função `pendencia_destaque`, migration 0092),
// fonte única do indicador e da lista; aqui só se monta a frase de cada motivo e a ação recomendada.
// Regras em docs/modulos/administrativo-gestao.md, seção 5.3.
import { formatarData } from "../fila";
import type { Criticidade } from "../tipos";

export type NivelDestaque = "intervir" | "avaliar" | "acompanhar" | "normal";

export type CodigoMotivo =
  | "AGUARDA_GESTOR" | "ATRASO_RELEVANTE" | "ATRASO_SIMPLES" | "VENCE_HOJE" | "PRAZO_PROXIMO" | "IMPACTO_REGISTRADO"
  | "BLOQUEIO_RELEVANTE" | "BLOQUEADA" | "IMPEDE_OUTRA" | "PRECISA_DISTRIBUIR" | "SEM_MOVIMENTACAO" | "SEM_PRAZO_IMPORTANTE"
  | "IMPACTO_SEM_PRAZO"
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
    case "IMPACTO_SEM_PRAZO":
      return comMotivo(`Impacto ${m.impacto ? ROTULO_IMPACTO[m.impacto] : ""} registrado sem prazo: avaliar a urgência`.replace("  ", " "), m.fundamento);
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

/** Limites do destaque (configuracoes `administrativo.gestao.*`), em dias corridos. */
export type LimitesDestaque = {
  dias_prazo_proximo: number; dias_atraso_relevante: number; dias_bloqueio_relevante: number; dias_sem_movimentacao: number;
};

export const LIMITES_PADRAO: LimitesDestaque = { dias_prazo_proximo: 3, dias_atraso_relevante: 5, dias_bloqueio_relevante: 2, dias_sem_movimentacao: 5 };

/**
 * As regras do destaque como a tela as explica (página "Como a Central classifica"). O cálculo é o da função
 * `pendencia_destaque` (migrations 0092 e 0095); este texto acompanha cada regra de lá.
 */
export function regrasDoDestaque(l: LimitesDestaque): { codigo: CodigoMotivo; nivel: NivelDestaque; quando: string }[] {
  const d = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);
  return [
    { codigo: "AGUARDA_GESTOR", nivel: "intervir", quando: "O responsável pediu uma decisão do gestor e ainda não houve resposta." },
    { codigo: "ATRASO_RELEVANTE", nivel: "intervir", quando: `Atrasada há mais de ${d(l.dias_atraso_relevante)}, ou atrasada com prioridade crítica.` },
    { codigo: "IMPACTO_REGISTRADO", nivel: "intervir", quando: `Impacto financeiro, fiscal ou operacional registrado com fundamento, e prazo vencido, de hoje ou nos próximos ${d(l.dias_prazo_proximo)}.` },
    { codigo: "BLOQUEIO_RELEVANTE", nivel: "intervir", quando: `Bloqueada há mais de ${d(l.dias_bloqueio_relevante)}.` },
    { codigo: "IMPEDE_OUTRA", nivel: "intervir", quando: "Outra pendência aberta está bloqueada esperando esta." },
    { codigo: "PRECISA_DISTRIBUIR", nivel: "intervir", quando: `Sem responsável (tarefa manual ou marcada "precisa distribuir"), com prioridade alta/crítica ou prazo em até ${d(l.dias_prazo_proximo)}.` },
    { codigo: "IMPACTO_SEM_PRAZO", nivel: "avaliar", quando: "Impacto registrado, mas sem prazo: não há como dizer se é urgente." },
    { codigo: "SEM_PRAZO_IMPORTANTE", nivel: "avaliar", quando: "Prioridade alta ou crítica e sem prazo (tarefa manual ou de módulo, como um vencimento fiscal a confirmar)." },
    { codigo: "PRECISA_DISTRIBUIR", nivel: "acompanhar", quando: "Sem responsável, nos demais casos." },
    { codigo: "ATRASO_SIMPLES", nivel: "acompanhar", quando: `Atrasada há até ${d(l.dias_atraso_relevante)}, sem prioridade crítica.` },
    { codigo: "VENCE_HOJE", nivel: "acompanhar", quando: "O prazo é hoje." },
    { codigo: "PRAZO_PROXIMO", nivel: "acompanhar", quando: `Vence nos próximos ${d(l.dias_prazo_proximo)}.` },
    { codigo: "BLOQUEADA", nivel: "acompanhar", quando: `Bloqueada há até ${d(l.dias_bloqueio_relevante)}.` },
    { codigo: "SEM_MOVIMENTACAO", nivel: "acompanhar", quando: `Aberta e sem ação de uma pessoa há mais de ${d(l.dias_sem_movimentacao)}.` },
    { codigo: "AJUSTE_MANUAL", nivel: "normal", quando: "O gestor ajustou o destaque, com motivo. Prevalece sobre o cálculo, que continua visível." },
  ];
}
