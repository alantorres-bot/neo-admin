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
