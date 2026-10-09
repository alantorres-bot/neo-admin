import { cache } from "react";
import { lerParametrosContasPagar, CHAVES_CONTAS_PAGAR, type ParametrosContasPagar } from "@/lib/modulos/financeiro/contas-pagar/parametros";
import { MODULO_CONTAS_PAGAR, type ItemPendente } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { FUSO } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

type LinhaPendente = {
  id: string; empresa_id: string; cod_lancamento: string; tipo_lancamento: "C" | "A"; cod_fornecedor: string | null; num_documento: string | null;
  categoria_doc: string | null; cod_banco: string | null; complemento_historico: string | null; data_emissao: string | null; data_vencimento: string | null;
  data_pagamento: string | null; valor_documento: number | string; valor_atualizado: number | string;
  fornecedor_nome: string | null; fornecedor_documento: string | null;
  autorizacao_id: string | null; autorizacao_numero: number | null; autorizacao_status: "rascunho" | "autorizada" | null;
  tratada_id: string | null; tratada_motivo: string | null; tratada_em: string | null;
};

export type UltimaAtualizacao = { quando: string; novos: number; alterados: number; baixados: number } | null;
export type Pendentes = { itens: ItemPendente[]; parametros: ParametrosContasPagar; ultima: UltimaAtualizacao; empresas: { id: string; nome: string }[] };

const centavos = (v: number | string) => Math.round(Number(v) * 100);
export const quandoEm = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Lê tudo em páginas de 1000 (limite do PostgREST). */
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, oQue: string): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(`Falha ao ler ${oQue}: ${error.message}`);
    saida.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return saida;
  }
}

/** Os pendentes desta requisição (a página e as abas com contagem usam o mesmo resultado). */
export const pendentesDaRequisicao = cache(async (): Promise<Pendentes> => carregarPendentes(await criarClienteServidor()));

/**
 * Tudo o que está em aberto no espelho do Consistem (títulos C e antecipações A com saldo), com fornecedor, autorização
 * ativa e marcação de "paga fora" (view cap_vw_pendentes), mais os parâmetros do módulo e a última atualização.
 * A RLS de quem chama vale. Nada é gravado.
 */
export async function carregarPendentes(supabase: Cliente): Promise<Pendentes> {
  const [linhas, { data: configs }, { data: ultimas }, { data: empresas }] = await Promise.all([
    lerTudo<LinhaPendente>((de, ate) =>
      supabase.from("cap_vw_pendentes")
        .select("id, empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, categoria_doc, cod_banco, complemento_historico, data_emissao, data_vencimento, data_pagamento, valor_documento, valor_atualizado, fornecedor_nome, fornecedor_documento, autorizacao_id, autorizacao_numero, autorizacao_status, tratada_id, tratada_motivo, tratada_em")
        .order("id").range(de, ate), "os lançamentos"),
    supabase.from("configuracoes").select("chave, valor").in("chave", [...CHAVES_CONTAS_PAGAR]),
    supabase.from("importacoes").select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
      .eq("modulo", MODULO_CONTAS_PAGAR).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
    supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto"),
  ]);

  const itens: ItemPendente[] = linhas.map((l) => ({
    id: l.id,
    empresaId: l.empresa_id,
    tipo: l.tipo_lancamento === "A" ? "antecipacao" : "titulo",
    codLancamento: l.cod_lancamento,
    codFornecedor: l.cod_fornecedor ?? "",
    fornecedor: l.fornecedor_nome ?? (l.cod_fornecedor ? `Fornecedor ${l.cod_fornecedor}` : "(sem fornecedor)"),
    documentoFornecedor: l.fornecedor_documento,
    numDocumento: l.num_documento ?? "",
    emissao: l.data_emissao,
    vencimento: l.data_vencimento,
    dataPagamento: l.data_pagamento,
    valorDocumentoCentavos: centavos(l.valor_documento),
    saldoCentavos: centavos(l.valor_atualizado),
    complemento: l.complemento_historico ?? "",
    codBanco: l.cod_banco ?? "",
    categoria: l.categoria_doc ?? "",
    autorizacao: l.autorizacao_id && l.autorizacao_numero !== null && l.autorizacao_status ? { id: l.autorizacao_id, numero: l.autorizacao_numero, status: l.autorizacao_status } : null,
    tratada: l.tratada_id ? { id: l.tratada_id, motivo: l.tratada_motivo ?? "", em: l.tratada_em ?? "" } : null,
  }));

  const u = ultimas?.[0] as { criado_em: string; linhas_novas: number | null; linhas_alteradas: number | null; linhas_baixadas: number | null } | undefined;
  const ultima: UltimaAtualizacao = u
    ? { quando: quandoEm(u.criado_em), novos: u.linhas_novas ?? 0, alterados: u.linhas_alteradas ?? 0, baixados: u.linhas_baixadas ?? 0 }
    : null;

  return {
    itens,
    parametros: lerParametrosContasPagar((configs ?? []) as { chave: string; valor: unknown }[]),
    ultima,
    empresas: (empresas ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string })),
  };
}

// ---------------------------------------------------------------- autorizações

export type LinhaAutorizacao = {
  id: string; numero: number; empresa_id: string; data: string; status: "rascunho" | "autorizada" | "cancelada"; observacao: string | null;
  criado_por: string | null; criado_em: string; autorizada_por: string | null; autorizada_em: string | null; cancelada_por: string | null; cancelada_em: string | null;
  motivo_cancelamento: string | null; empresa_nome: string; empresa_razao_social: string; empresa_cnpj: string | null;
  criado_por_nome: string | null; autorizada_por_nome: string | null; cancelada_por_nome: string | null;
  itens: number; titulos: number; antecipacoes: number; total_titulos: number | string; total_antecipacoes: number | string; total: number | string; baixados: number;
};

export type LinhaItemAutorizacao = {
  id: string; lancamento_id: string; tipo: "titulo" | "antecipacao"; cod_lancamento: string; cod_fornecedor: string | null; fornecedor_nome: string; fornecedor_documento: string | null;
  num_documento: string | null; categoria_doc: string | null; data_emissao: string | null; data_vencimento: string | null; data_pagamento: string | null;
  valor: number | string; valor_original: number | string | null; complemento_historico: string | null; cod_banco: string | null; cod_portador: string | null;
  cod_barras: string | null; qrcode_pix: string | null; ordem: number; removido_em: string | null; motivo_remocao: string | null; baixado_consistem_em: string | null;
};

const COLUNAS_AUTORIZACAO = "id, numero, empresa_id, data, status, observacao, criado_por, criado_em, autorizada_por, autorizada_em, cancelada_por, cancelada_em, motivo_cancelamento, empresa_nome, empresa_razao_social, empresa_cnpj, criado_por_nome, autorizada_por_nome, cancelada_por_nome, itens, titulos, antecipacoes, total_titulos, total_antecipacoes, total, baixados";

export async function listarAutorizacoes(supabase: Cliente, filtro: { status: string | null; pagina: number; porPagina: number }): Promise<{ linhas: LinhaAutorizacao[]; total: number }> {
  let consulta = supabase.from("cap_vw_autorizacoes").select(COLUNAS_AUTORIZACAO, { count: "exact" }).order("numero", { ascending: false })
    .range((filtro.pagina - 1) * filtro.porPagina, filtro.pagina * filtro.porPagina - 1);
  if (filtro.status) consulta = consulta.eq("status", filtro.status);
  const { data, count, error } = await consulta;
  if (error) throw new Error(`Falha ao ler as autorizações: ${error.message}`);
  return { linhas: (data ?? []) as unknown as LinhaAutorizacao[], total: count ?? 0 };
}

export async function lerAutorizacao(supabase: Cliente, id: string): Promise<{ autorizacao: LinhaAutorizacao; itens: LinhaItemAutorizacao[] } | null> {
  const [{ data: a, error: erroA }, { data: itens, error: erroI }] = await Promise.all([
    supabase.from("cap_vw_autorizacoes").select(COLUNAS_AUTORIZACAO).eq("id", id).maybeSingle(),
    supabase.from("cap_autorizacao_itens")
      .select("id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento, num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original, complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem, removido_em, motivo_remocao, baixado_consistem_em")
      .eq("autorizacao_id", id).order("ordem").limit(1000),
  ]);
  if (erroA) throw new Error(`Falha ao ler a autorização: ${erroA.message}`);
  if (erroI) throw new Error(`Falha ao ler os itens: ${erroI.message}`);
  if (!a) return null;
  return { autorizacao: a as unknown as LinhaAutorizacao, itens: (itens ?? []) as unknown as LinhaItemAutorizacao[] };
}
