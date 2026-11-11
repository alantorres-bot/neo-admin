// Gestão de Parcelamentos (docs/modulos/financeiro-parcelamentos.md, migration 0189): rótulos e formatos das telas.
// As regras de classificação e associação ficam no banco (par_classificar / par_associar), testadas em tests/db/par-parcelamentos.

export const MODULO_PARCELAMENTOS = "financeiro.parcelamentos";
export const ROTA_PARCELAMENTOS = "/financeiro/parcelamentos";

export const SITUACOES = ["ativo", "suspenso", "rescindido", "encerrado", "cancelado"] as const;
export type SituacaoParcelamento = (typeof SITUACOES)[number];
export const ROTULO_SITUACAO: Record<SituacaoParcelamento, string> = {
  ativo: "Ativo", suspenso: "Suspenso", rescindido: "Rescindido", encerrado: "Encerrado", cancelado: "Cancelado",
};

export type Classificacao = "aguardando_detalhe" | "pendente" | "classificado" | "sem_regra" | "ignorado" | "manual_parcelamento" | "manual_ignorado";
export const ROTULO_CLASSIFICACAO: Record<Classificacao, string> = {
  aguardando_detalhe: "Aguardando conta de fluxo", pendente: "Pendente", classificado: "Pela regra", sem_regra: "Sem regra (para análise)", ignorado: "Exceção: não é parcelamento",
  manual_parcelamento: "Manual: parcelamento", manual_ignorado: "Manual: não é parcelamento",
};

export type SituacaoGuia = "nao_solicitada" | "pendente_emissao" | "em_emissao" | "emitida" | "necessita_atualizacao" | "indisponivel" | "cancelada";
export const ROTULO_GUIA: Record<SituacaoGuia, string> = {
  nao_solicitada: "Não solicitada", pendente_emissao: "Pendente de emissão", em_emissao: "Em emissão", emitida: "Emitida",
  necessita_atualizacao: "Necessita atualização", indisponivel: "Indisponível", cancelada: "Cancelada",
};

export const ROTULO_ORIGEM: Record<string, string> = { CONTAS_PAGAR: "Contas a Pagar", MANUAL: "Manual" };

/** "2026-11" → "11/2026". */
export const formatarCompetencia = (c: string | null | undefined): string => (c && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5)}/${c.slice(0, 4)}` : "—");

/** Valor numeric do Postgres (texto ou número em reais) → centavos inteiros; nulo continua nulo. */
export const emCentavos = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Math.round(Number((Number(v) * 100).toFixed(6))));

/** Grupo/conta de fluxo do Consistem como aparece no ERP ("20/17"). */
export const contaFluxo = (grupo: number | null, conta: number | null): string => (grupo && conta ? `${grupo}/${conta}` : "—");
