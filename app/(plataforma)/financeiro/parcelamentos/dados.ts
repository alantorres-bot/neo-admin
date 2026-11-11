import type { Classificacao, SituacaoGuia, SituacaoParcelamento } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Leituras da Gestão de Parcelamentos (views da migration 0189, com RLS do módulo).
type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
type Num = string | number | null;

export type Parcelamento = {
  id: string; empresa_id: string; empresa_nome: string; descricao: string; natureza: string; natureza_nome: string; origem: string;
  devedor: string | null; credor: string | null; cod_fornecedor: string | null; grupo: number | null; conta: number | null; numero: string | null;
  processo: string | null; cda: string | null; inscricao: string | null; referencia_debito: string | null; data_adesao: string | null;
  valor_original: Num; qtd_parcelas: number | null; dia_vencimento: number | null; situacao: SituacaoParcelamento; responsavel_nome: string | null;
  observacoes: string | null; chave_erp: string | null; parcelas_registradas: number; parcelas_pagas: number; total_pago: Num; total_em_aberto: Num;
  proximo_vencimento: string | null; criado_em: string;
};

export type Parcela = {
  id: string; parcelamento_id: string; parcelamento_descricao: string; competencia: string; numero: number | null; origem: string;
  situacao_guia: SituacaoGuia; empresa_id: string; empresa_nome: string; natureza: string; natureza_nome: string; cod_fornecedor: string | null;
  fornecedor_nome: string | null; grupo: number | null; conta: number | null; lancamento_id: string | null; cod_lancamento: string | null;
  tipo_lancamento: string | null; num_documento: string | null; complemento: string | null; vencimento: string | null; valor_provisionado: Num;
  valor_atualizado: Num; saldo_erp: Num; valor_pago: Num; data_pagamento: string | null; quitado_em: string | null; valor_em_aberto: Num; sumiu_em: string | null; cancelada_em: string | null;
};

export type Lancamento = {
  id: string; empresa_id: string; empresa_nome: string; cod_lancamento: string; tipo_lancamento: string; cod_fornecedor: string; nome_fornecedor: string | null;
  num_documento: string; complemento: string | null; data_vencimento: string | null; valor_documento: Num; valor_provisionado: Num; grupo: number | null;
  conta: number | null; data_pagamento: string | null; quitado_em: string | null; valor_pago: Num; valor_atualizado: Num; chave_erp: string | null; competencia: string | null; classificacao: Classificacao;
  natureza: string | null; natureza_nome: string | null; regra_nome: string | null; motivo: string | null; parcela_id: string | null;
  parcelamento_id: string | null; parcelamento_descricao: string | null; sumiu_em: string | null; virou_c_em: string | null;
};

export type Sugestao = {
  empresa_id: string; empresa_nome: string; chave_erp: string; cod_fornecedor: string; nome_fornecedor: string | null; natureza: string;
  naturezas: number; grupo: number | null; conta: number | null; lancamentos: number; primeira_competencia: string; ultima_competencia: string;
  valor_total: Num; complemento_exemplo: string | null;
};

export type Regra = {
  id: string; nome: string; empresa_id: string | null; tipos: string[] | null; fornecedores: string[] | null; grupo: number | null; conta: number | null;
  complemento_contem: string | null; natureza: string | null; excecao: boolean; prioridade: number; ativa: boolean; observacoes: string | null;
};

export type Opcao = { codigo: string; nome: string };

function falhou(o: string, error: { message: string } | null): void {
  if (error) throw new Error(`Não foi possível ler ${o}: ${error.message}`);
}

export async function listarParcelamentos(supabase: Cliente): Promise<Parcelamento[]> {
  const { data, error } = await supabase.from("par_vw_parcelamentos").select("*").order("empresa_nome").order("descricao").limit(1000);
  falhou("os parcelamentos", error);
  return (data ?? []) as Parcelamento[];
}

export async function lerParcelamento(supabase: Cliente, id: string) {
  const [{ data: p, error }, { data: parcelas, error: e2 }] = await Promise.all([
    supabase.from("par_vw_parcelamentos").select("*").eq("id", id).maybeSingle(),
    supabase.from("par_vw_parcelas").select("*").eq("parcelamento_id", id).order("competencia"),
  ]);
  falhou("o parcelamento", error ?? e2);
  return p ? { parcelamento: p as Parcelamento, parcelas: (parcelas ?? []) as Parcela[] } : null;
}

export async function listarParcelas(supabase: Cliente): Promise<Parcela[]> {
  const { data, error } = await supabase.from("par_vw_parcelas").select("*").is("cancelada_em", null).order("vencimento").limit(5000);
  falhou("as parcelas", error);
  return (data ?? []) as Parcela[];
}

/** Lançamentos do ERP por situação da classificação; "sem_parcela" = é parcelamento e ainda não está numa parcela. */
export async function listarLancamentos(supabase: Cliente, filtro: Classificacao[] | "sem_parcela"): Promise<Lancamento[]> {
  let q = supabase.from("par_vw_lancamentos").select("*");
  q = filtro === "sem_parcela" ? q.in("classificacao", ["classificado", "manual_parcelamento"]).is("parcela_id", null) : q.in("classificacao", filtro);
  const { data, error } = await q.order("cod_fornecedor").order("data_vencimento").limit(3000);
  falhou("os lançamentos", error);
  return (data ?? []) as Lancamento[];
}

export async function listarSugestoes(supabase: Cliente): Promise<Sugestao[]> {
  const { data, error } = await supabase.from("par_vw_sugestoes").select("*").order("cod_fornecedor").order("chave_erp");
  falhou("as sugestões", error);
  return (data ?? []) as Sugestao[];
}

export async function listarRegras(supabase: Cliente): Promise<Regra[]> {
  const { data, error } = await supabase.from("par_regras").select("*").order("ativa", { ascending: false }).order("prioridade").order("nome");
  falhou("as regras", error);
  return (data ?? []) as Regra[];
}

export async function listarApoio(supabase: Cliente) {
  const [{ data: naturezas }, { data: empresas }, { data: parcelamentos }, { data: rodada }, { count: aguardando }] = await Promise.all([
    supabase.from("par_naturezas").select("codigo, nome").eq("ativa", true).order("ordem"),
    supabase.from("empresas").select("id, nome_curto").eq("ativa", true).order("nome_curto"),
    supabase.from("par_parcelamentos").select("id, descricao, empresa_id").neq("situacao", "cancelado").order("descricao"),
    supabase.from("par_sincronizacoes").select("situacao, iniciada_em, concluida_em, erro, agendada").order("iniciada_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("par_lancamentos").select("id", { count: "exact", head: true }).eq("classificacao", "aguardando_detalhe"),
  ]);
  return {
    naturezas: (naturezas ?? []) as Opcao[],
    empresas: (empresas ?? []).map((e) => ({ codigo: e.id as string, nome: e.nome_curto as string })),
    parcelamentos: (parcelamentos ?? []) as { id: string; descricao: string; empresa_id: string }[],
    ultimaRodada: rodada as { situacao: string; iniciada_em: string; concluida_em: string | null; erro: string | null; agendada: boolean } | null,
    aguardandoDetalhe: aguardando ?? 0,
  };
}

export async function listarSincronizacoes(supabase: Cliente) {
  const { data, error } = await supabase.from("par_sincronizacoes").select("id, situacao, agendada, iniciada_em, concluida_em, erro, resumo").order("iniciada_em", { ascending: false }).limit(20);
  falhou("as sincronizações", error);
  return data ?? [];
}
