// Contratos/Operações — motor de obrigações, parte pura (docs/modulos/contratos-operacoes.md, 5.4).
// Só o que a especificação aprovou: criar/manter/cancelar pela condição (5.4.4), dependências concluídas ou dispensadas
// (5.4.6) e as validações de ativação do modelo (5.4.3). O efeito de uma dependência CANCELADA, a reativação e a
// reabertura (O-1 a O-4, AF-16) NÃO têm regra aprovada: aparecem como "sem_regra" e nada é decidido aqui.

import { avaliarCondicao, type Condicao, type ValorCampo } from "./condicoes";

export const MODALIDADES = ["entrega_futura", "financiamento", "avulsa", "locacao"] as const;
export type Modalidade = (typeof MODALIDADES)[number];

/** Modalidades com `exige_contrato = true` (5.2). */
export const MODALIDADES_COM_CONTRATO: readonly Modalidade[] = ["entrega_futura", "financiamento", "locacao"];

export const SITUACOES_OBRIGACAO = ["bloqueada", "aberta", "concluida", "dispensada", "cancelada"] as const;
export type SituacaoObrigacao = (typeof SITUACOES_OBRIGACAO)[number];

export type ItemModelo = {
  id: string;
  tipo: string;
  descricao: string;
  condicao: Condicao | null;
  dependencias: string[];
  travaFaturamento: boolean;
};

export type ObrigacaoExistente = { itemId: string; situacao: SituacaoObrigacao };

export type AcaoObrigacao =
  | { acao: "criar"; itemId: string }
  | { acao: "manter"; itemId: string }
  | { acao: "cancelar"; itemId: string; motivo: string }
  | { acao: "aguardar_condicao"; itemId: string; campos: string[] }
  | { acao: "sem_regra"; itemId: string; motivo: string }
  | { acao: "nenhuma"; itemId: string };

export type Plano = { acoes: AcaoObrigacao[]; informarCondicao: string[] };

const ATIVAS: readonly SituacaoObrigacao[] = ["bloqueada", "aberta", "concluida", "dispensada"];

/**
 * Planeja as obrigações de uma operação a partir do modelo vigente (5.4.4). Não grava nada: a função SQL aplica o plano.
 * `informarCondicao` lista os campos que precisam de `informar_condicao` (sem repetir os que já têm uma aberta).
 */
export function planejarObrigacoes(
  itens: readonly ItemModelo[],
  valores: Readonly<Record<string, ValorCampo>>,
  camposValidos: readonly string[],
  existentes: readonly ObrigacaoExistente[],
  camposJaPedidos: readonly string[] = [],
): Plano {
  const acoes: AcaoObrigacao[] = [];
  const campos = new Set<string>();

  for (const item of itens) {
    const atual = existentes.find((o) => o.itemId === item.id && ATIVAS.includes(o.situacao));
    const { resultado, camposDesconhecidos } = avaliarCondicao(item.condicao, valores, camposValidos);

    if (resultado === "verdadeiro") {
      if (atual) acoes.push({ acao: "manter", itemId: item.id });
      else if (existentes.some((o) => o.itemId === item.id && o.situacao === "cancelada")) {
        // Reativação: a proposta da 15.5, item 4, não está aprovada.
        acoes.push({ acao: "sem_regra", itemId: item.id, motivo: "item cancelado voltou a valer: reativação sem regra aprovada (O-1 a O-4)" });
      } else acoes.push({ acao: "criar", itemId: item.id });
    } else if (resultado === "falso") {
      if (atual?.situacao === "aberta") {
        acoes.push({ acao: "cancelar", itemId: item.id, motivo: `deixou de se aplicar: ${item.descricao}` });
      } else if (atual?.situacao === "bloqueada") {
        acoes.push({ acao: "sem_regra", itemId: item.id, motivo: "obrigação bloqueada deixou de se aplicar (O-1 a O-4, AF-16)" });
      } else {
        // Concluída ou dispensada fica como está: o histórico nunca é sobrescrito (R4-P5).
        acoes.push(atual ? { acao: "manter", itemId: item.id } : { acao: "nenhuma", itemId: item.id });
      }
    } else if (atual) {
      acoes.push({ acao: "sem_regra", itemId: item.id, motivo: "condição passou a desconhecida com a obrigação já criada" });
    } else {
      acoes.push({ acao: "aguardar_condicao", itemId: item.id, campos: camposDesconhecidos });
      camposDesconhecidos.forEach((c) => campos.add(c));
    }
  }

  return { acoes, informarCondicao: [...campos].filter((c) => !camposJaPedidos.includes(c)) };
}

/**
 * Situação das dependências de uma obrigação (5.4.6): concluída e dispensada contam como resolvidas.
 * Dependência cancelada: "sem_regra" (AF-16) — não é tratada como resolvida nem como pendente.
 */
export function situacaoDependencias(dependencias: readonly SituacaoObrigacao[]): "resolvidas" | "pendentes" | "sem_regra" {
  if (dependencias.some((s) => s === "cancelada")) return "sem_regra";
  return dependencias.every((s) => s === "concluida" || s === "dispensada") ? "resolvidas" : "pendentes";
}

function temCiclo(itens: readonly ItemModelo[]): boolean {
  const mapa = new Map(itens.map((i) => [i.id, i.dependencias]));
  const estado = new Map<string, "visitando" | "feito">();
  const visitar = (id: string): boolean => {
    if (estado.get(id) === "feito") return false;
    if (estado.get(id) === "visitando") return true;
    estado.set(id, "visitando");
    const ciclo = (mapa.get(id) ?? []).some(visitar);
    estado.set(id, "feito");
    return ciclo;
  };
  return itens.some((i) => visitar(i.id));
}

/**
 * Validações de ativação do modelo (5.4.3, `ctr_validar_modelo`). Devolve a lista de erros; vazia = pode ativar.
 * As exigências extras propostas na R4-P1 item 2 (trava em `obter_assinaturas`, não dispensável) estão "a validar" e não entram.
 */
export function validarModelo(modalidade: Modalidade, itens: readonly ItemModelo[], tiposAtivos: readonly string[]): string[] {
  const erros: string[] = [];
  const ids = new Set(itens.map((i) => i.id));

  for (const i of itens) {
    if (!tiposAtivos.includes(i.tipo)) erros.push(`O item "${i.descricao}" cita um tipo de obrigação inativo ou inexistente (${i.tipo}).`);
    for (const d of i.dependencias) if (!ids.has(d)) erros.push(`O item "${i.descricao}" depende de um item que não está no modelo.`);
  }
  if (temCiclo(itens)) erros.push("Há ciclo nas dependências do modelo.");

  if (MODALIDADES_COM_CONTRATO.includes(modalidade) && !itens.some((i) => i.tipo === "obter_assinaturas")) {
    erros.push("A modalidade exige contrato: o modelo precisa de um item de assinaturas.");
  }
  if (modalidade === "financiamento") {
    if (!itens.some((i) => i.tipo === "obter_assinaturas" && i.condicao === null)) {
      erros.push("Financiamento: o item de assinaturas tem de valer sempre (sem condição).");
    }
    if (!itens.some((i) => i.tipo === "aguardar_autorizacao_bancaria" && i.condicao === null && i.travaFaturamento)) {
      erros.push("Financiamento: a autorização bancária tem de valer sempre e travar o faturamento.");
    }
  }
  return erros;
}
