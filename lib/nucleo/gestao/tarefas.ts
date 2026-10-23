// Central de Gestão: listas e rótulos das tarefas manuais (usados pela tela e pelas ações de servidor).
export const CATEGORIAS = ["tarefa", "conferencia", "lancamento", "entrega", "cobranca", "decisao", "fechamento", "outro"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  tarefa: "Tarefa", conferencia: "Conferência", lancamento: "Lançamento", entrega: "Entrega", cobranca: "Cobrança",
  decisao: "Decisão", fechamento: "Fechamento", outro: "Outro",
};

export const ACOES_PENDENCIA = [
  "iniciar", "pausar", "concluir", "cancelar", "reabrir", "assumir", "atribuir", "alterar", "bloquear", "desbloquear",
  "pedir_decisao", "responder_decisao", "destacar", "cobrar", "comentar",
] as const;
export type AcaoPendencia = (typeof ACOES_PENDENCIA)[number];

/** Módulo das tarefas que não pertencem a um módulo específico (migration 0092). */
export const MODULO_TAREFAS_GERAIS = "administrativo.gestao";

/** Máximo de pendências numa ação em lote (a fila mostra até 100 por página). */
export const LIMITE_LOTE = 100;

export type ResultadoLote = { feitas: string[]; recusadas: { id: string; erro: string }[] };

/** Aplica a ação a cada pendência, uma de cada vez: a recusa de uma (devolvida como texto) não impede as demais. */
export async function executarEmLote(ids: string[], acao: (id: string) => Promise<string | null>): Promise<ResultadoLote> {
  const resultado: ResultadoLote = { feitas: [], recusadas: [] };
  for (const id of new Set(ids)) {
    const erro = await acao(id);
    if (erro) resultado.recusadas.push({ id, erro });
    else resultado.feitas.push(id);
  }
  return resultado;
}

/** "18 atribuídas; 2 recusadas" (o detalhe das recusadas a tela mostra à parte). */
export function resumirLote({ feitas, recusadas }: ResultadoLote): string {
  const partes = [`${feitas.length} ${feitas.length === 1 ? "atribuída" : "atribuídas"}`];
  if (recusadas.length > 0) partes.push(`${recusadas.length} ${recusadas.length === 1 ? "recusada" : "recusadas"}`);
  return partes.join("; ");
}
