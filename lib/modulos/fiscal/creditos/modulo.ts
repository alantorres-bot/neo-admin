// Fiscal > Créditos tributários (Fiscal Control): constantes, papéis e rótulos. Quem protege os dados é o banco
// (fis_pode/RLS, migration 0200); aqui só se decide o que MOSTRAR (menus, botões).

export const MODULO_CREDITOS = "fiscal.creditos";
export const ROTA_CREDITOS = "/fiscal/creditos";
export const NOME_SISTEMA = "Fiscal Control";

export type Papel = "leitor" | "analista" | "revisor" | "contador" | "administrador";
export type Acao = "ler" | "lancar" | "validar" | "fechar" | "atribuir" | "reabrir" | "parametrizar";

export const ROTULO_PAPEL: Record<Papel, string> = {
  leitor: "Leitor", analista: "Analista fiscal", revisor: "Revisor", contador: "Contador", administrador: "Administrador",
};

/** Matriz de permissões (espelho de fis_pode, migration 0200). */
const MATRIZ: Record<Acao, readonly Papel[]> = {
  ler: ["leitor", "analista", "revisor", "contador", "administrador"],
  lancar: ["analista", "revisor", "contador", "administrador"],
  validar: ["revisor", "contador", "administrador"],
  fechar: ["revisor", "contador", "administrador"],
  atribuir: ["revisor", "contador", "administrador"],
  reabrir: ["revisor", "administrador"],
  parametrizar: ["administrador"],
};

export function pode(papel: Papel | null | undefined, acao: Acao): boolean {
  return !!papel && MATRIZ[acao].includes(papel);
}

export const DESCRICAO_PAPEL: Record<Papel, string> = {
  leitor: "Consulta tudo (dentro das empresas permitidas) e exporta; não altera nada.",
  analista: "Cadastra créditos, movimentações, obrigações, documentos e divergências; envia competências para revisão.",
  revisor: "Tudo do analista + valida créditos, aprova lançamentos, fecha, reconcilia e reabre competências, atribui tarefas.",
  contador: "Tudo do analista + valida créditos, aprova lançamentos, fecha e reconcilia competências (não reabre).",
  administrador: "Tudo + parâmetros fiscais (tributos, categorias, tipos, obrigações aplicáveis) e papéis dos usuários.",
};

/** Nível mínimo na área Fiscal exigido por papel (fis_nivel_do_papel). */
export const NIVEL_DO_PAPEL: Record<Papel, "consulta" | "operador" | "gestor" | "administrador"> = {
  leitor: "consulta", analista: "operador", revisor: "gestor", contador: "gestor", administrador: "administrador",
};

/** Papel efetivo: o escolhido em fis_membros se o nível da área permite; senão o derivado do nível (fis_papel_atual). */
export function papelEfetivo(nivel: "sem_acesso" | "consulta" | "operador" | "gestor" | "administrador", escolhido?: Papel | null): Papel | null {
  const ordem = ["sem_acesso", "consulta", "operador", "gestor", "administrador"];
  if (ordem.indexOf(nivel) < 1) return null;
  if (escolhido && ordem.indexOf(nivel) >= ordem.indexOf(NIVEL_DO_PAPEL[escolhido])) return escolhido;
  return ({ consulta: "leitor", operador: "analista", gestor: "revisor", administrador: "administrador" } as const)[nivel];
}

export type Validacao = "pendente" | "em_analise" | "validado" | "rejeitado" | "contestado";
export const ROTULO_VALIDACAO: Record<Validacao, string> = {
  pendente: "Pendente de validação", em_analise: "Em análise", validado: "Validado", rejeitado: "Rejeitado", contestado: "Contestado",
};

export type Disponibilidade = "disponivel" | "pendente_validacao" | "bloqueado" | "prazo_expirado" | "esgotado" | "rejeitado" | "contestado" | "arquivado";
export const ROTULO_DISPONIBILIDADE: Record<Disponibilidade, string> = {
  disponivel: "Disponível", pendente_validacao: "Indisponível (não validado)", bloqueado: "Bloqueado", prazo_expirado: "Prazo encerrado",
  esgotado: "Sem saldo", rejeitado: "Rejeitado", contestado: "Contestado", arquivado: "Arquivado",
};

export const ROTULO_CLASSE: Record<string, string> = {
  saldo_inicial: "Saldo inicial", gerado: "Crédito gerado", reconhecido: "Crédito reconhecido", ajuste: "Ajuste", utilizacao: "Utilização",
  compensacao: "Compensação", baixa: "Ressarcimento/restituição/baixa", transferencia: "Transferência", estorno: "Estorno",
};

export const ROTULO_STATUS_MOV: Record<string, string> = { pendente: "Pendente de aprovação", efetivo: "Efetivo", rejeitado: "Rejeitado" };

export type StatusObrigacao =
  | "nao_iniciada" | "em_preparacao" | "aguardando_documentos" | "em_revisao" | "aguardando_aprovacao" | "pronta_transmissao"
  | "transmitida" | "entregue_conferida" | "retificada" | "dispensada";
export const ROTULO_STATUS_OBRIGACAO: Record<StatusObrigacao, string> = {
  nao_iniciada: "Não iniciada", em_preparacao: "Em preparação", aguardando_documentos: "Aguardando documentos", em_revisao: "Em revisão",
  aguardando_aprovacao: "Aguardando aprovação", pronta_transmissao: "Pronta para transmissão", transmitida: "Transmitida (a conferir)",
  entregue_conferida: "Entregue e conferida", retificada: "Retificada", dispensada: "Dispensada",
};
export const STATUS_OBRIGACAO_FINAIS: readonly StatusObrigacao[] = ["transmitida", "entregue_conferida", "retificada", "dispensada"];
/** Próximas situações oferecidas na tela a partir da atual (o banco confere de novo). */
export function proximasSituacoes(atual: StatusObrigacao): StatusObrigacao[] {
  if (atual === "transmitida") return ["entregue_conferida"];
  if (["entregue_conferida", "retificada", "dispensada"].includes(atual)) return [];
  return (["nao_iniciada", "em_preparacao", "aguardando_documentos", "em_revisao", "aguardando_aprovacao", "pronta_transmissao", "dispensada"] as StatusObrigacao[])
    .filter((s) => s !== atual).concat(atual === "pronta_transmissao" ? ["transmitida"] : []);
}

export const ROTULO_STATUS_PERIODO: Record<string, string> = { aberto: "Aberta", em_revisao: "Em revisão", fechado: "Fechada" };
export const ROTULO_STATUS_DIVERGENCIA: Record<string, string> = {
  aberta: "Aberta", em_analise: "Em análise", justificada: "Justificada", resolvida: "Resolvida", cancelada: "Cancelada",
};
export const ROTULO_TIPO_TAREFA: Record<string, string> = {
  tarefa: "Tarefa", solicitacao_documento: "Solicitação de documento", revisao_apuracao: "Revisão de apuração", aprovacao: "Aprovação",
};
export const ROTULO_STATUS_TAREFA: Record<string, string> = { aberta: "Aberta", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
export const ROTULO_FONTE: Record<string, string> = {
  apuracao_oficial: "Apuração oficial", declaracao: "Declaração", periodo_anterior: "Período anterior", perdcomp: "PER/DCOMP", erp: "ERP", outro: "Outro",
};
export const ROTULO_NATUREZA: Record<string, string> = {
  escritural: "Escritural (saldo de apuração)", pagamento_indevido: "Pagamento indevido/a maior", saldo_negativo: "Saldo negativo",
  retencao: "Retenção", judicial: "Judicial", administrativo: "Administrativo", outro: "Outro",
};
export const ROTULO_FORMA: Record<string, string> = {
  deducao: "Dedução na apuração", compensacao: "Compensação", ressarcimento: "Ressarcimento", restituicao: "Restituição", transferencia: "Transferência",
};

/** Regras da conciliação (fis_verificar, migration 0203): o que cada uma confere. */
export const REGRAS: Record<string, { nome: string; explica: string }> = {
  R01_TRANSPORTE: { nome: "Transporte de saldo", explica: "Saldo final congelado de uma competência fechada ≠ saldo inicial congelado do mês seguinte." },
  R01_RECONCILIAR: { nome: "Reconciliação pendente", explica: "Um lançamento numa competência anterior mudou o saldo transportado de uma competência já fechada." },
  R02_DUPLICIDADE: { nome: "Possível duplicidade", explica: "Mesmo crédito, tipo, competência e valor em mais de um lançamento efetivo." },
  R03_SEM_DOCUMENTO: { nome: "Sem origem documentada", explica: "Crédito sem nenhum documento vigente vinculado." },
  R04_SALDO_NEGATIVO: { nome: "Utilizado acima do saldo", explica: "Saldo negativo em alguma competência (dado fora das regras)." },
  R04_SEM_VALIDACAO: { nome: "Utilizado sem validação", explica: "Utilizações/compensações em crédito que hoje não está validado." },
  R05_SEM_RECIBO: { nome: "Declaração sem recibo", explica: "Obrigação transmitida/conferida sem recibo ou protocolo vinculado." },
  R06_COMPENSACAO_SEM_PROTOCOLO: { nome: "Compensação sem protocolo", explica: "Compensação efetiva sem número de protocolo/PER-DCOMP." },
  R07_DOCUMENTACAO_PENDENTE: { nome: "Documentação pendente", explica: "Faltam documentos exigidos pela categoria do crédito." },
  R08_FECHADO_COM_DIVERGENCIA: { nome: "Fechado com divergência", explica: "Competência fechada com divergência aberta." },
  R09_SALDO_OFICIAL: { nome: "Diferença com a apuração oficial", explica: "Saldo calculado ≠ saldo informado na apuração oficial." },
  R10_SALDO_DECLARADO: { nome: "Diferença com a declaração", explica: "Saldo calculado ≠ saldo informado em declaração." },
  R11_PRAZO_APROVEITAMENTO: { nome: "Prazo de aproveitamento", explica: "Crédito com saldo e prazo parametrizado vencido ou a vencer em 90 dias." },
  R12_OBRIGACAO_ATRASADA: { nome: "Obrigação atrasada", explica: "Vencimento passou e a obrigação não foi transmitida nem dispensada." },
  R13_VENCIMENTO_A_CONFIRMAR: { nome: "Vencimento a confirmar", explica: "Sem regra de vencimento validada: a data precisa ser confirmada." },
};

export const ROTULO_SEVERIDADE: Record<string, string> = { critica: "Crítica", alta: "Alta", media: "Média", info: "Informativa" };

/** Aviso fixo das telas: o sistema é ferramenta de gestão, não conclusão jurídica. */
export const AVISO_RESPONSABILIDADE =
  "Ferramenta de gestão e rastreabilidade. Formas de utilização, prazos e documentos exigidos são parâmetros cadastrados e devem ser validados pelo contador responsável; o sistema não presume que um saldo seja juridicamente utilizável.";
