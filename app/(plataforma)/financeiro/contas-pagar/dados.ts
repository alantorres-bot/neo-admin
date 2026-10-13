import { cache } from "react";
import type { RascunhoEmMontagem } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { lerParametrosContasPagar, CHAVES_CONTAS_PAGAR, type ParametrosContasPagar } from "@/lib/modulos/financeiro/contas-pagar/parametros";
import { MODULO_CONTAS_PAGAR, type ItemPendente } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import { FUSO } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

type LinhaPendente = {
  id: string; empresa_id: string; cod_lancamento: string; tipo_lancamento: "C" | "A"; cod_fornecedor: string | null; num_documento: string | null;
  categoria_doc: string | null; cod_banco: string | null; complemento_historico: string | null; data_emissao: string | null; data_vencimento: string | null;
  data_pagamento: string | null; valor_documento: number | string; valor_atualizado: number | string; tem_bordero: boolean | null; bordero_visto_em: string | null;
  confirmado_consistem: boolean | null; confirmacao_vista_em: string | null;
  fornecedor_nome: string | null; fornecedor_documento: string | null;
  autorizacao_id: string | null; autorizacao_numero: number | null; autorizacao_codigo: string | null; autorizacao_status: "rascunho" | "autorizada" | null;
  tratada_id: string | null; tratada_motivo: string | null; tratada_em: string | null;
};

export type UltimaAtualizacao = { quando: string; novos: number; alterados: number; baixados: number } | null;
export type Pendentes = {
  itens: ItemPendente[];
  parametros: ParametrosContasPagar;
  ultima: UltimaAtualizacao;
  empresas: { id: string; nome: string }[];
  /** Rascunho em montagem de cada empresa (o mais recente em rascunho), onde Salvar parcial e Extras gravam. */
  rascunhos: RascunhoEmMontagem[];
};

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
  const [linhas, { data: configs }, { data: ultimas }, { data: empresas }, { data: rascunhosBrutos }] = await Promise.all([
    lerTudo<LinhaPendente>((de, ate) =>
      supabase.from("cap_vw_pendentes")
        .select("id, empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, categoria_doc, cod_banco, complemento_historico, data_emissao, data_vencimento, data_pagamento, valor_documento, valor_atualizado, tem_bordero, bordero_visto_em, confirmado_consistem, confirmacao_vista_em, fornecedor_nome, fornecedor_documento, autorizacao_id, autorizacao_numero, autorizacao_codigo, autorizacao_status, tratada_id, tratada_motivo, tratada_em")
        .order("id").range(de, ate), "os lançamentos"),
    supabase.from("configuracoes").select("chave, valor").in("chave", [...CHAVES_CONTAS_PAGAR]),
    supabase.from("importacoes").select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
      .eq("modulo", MODULO_CONTAS_PAGAR).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
    supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto"),
    supabase.from("cap_vw_autorizacoes").select("id, codigo, empresa_id, itens, extras, total, total_extras, caixa_disponivel, observacao")
      .eq("status", "rascunho").order("numero", { ascending: false }).limit(50),
  ]);

  // Um rascunho em montagem por empresa: o mais recente.
  const rascunhos: RascunhoEmMontagem[] = [];
  for (const r of rascunhosBrutos ?? []) {
    if (rascunhos.some((x) => x.empresaId === r.empresa_id)) continue;
    rascunhos.push({
      id: r.id as string, codigo: r.codigo as string, empresaId: r.empresa_id as string, itens: r.itens as number, extras: r.extras as number,
      totalCentavos: centavos(r.total as number | string), totalExtrasCentavos: centavos(r.total_extras as number | string),
      caixaCentavos: r.caixa_disponivel === null ? null : centavos(r.caixa_disponivel as number | string), observacao: (r.observacao as string | null) ?? null,
    });
  }

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
    autorizacao: l.autorizacao_id && l.autorizacao_numero !== null && l.autorizacao_status ? { id: l.autorizacao_id, numero: l.autorizacao_numero, codigo: l.autorizacao_codigo ?? String(l.autorizacao_numero), status: l.autorizacao_status } : null,
    tratada: l.tratada_id ? { id: l.tratada_id, motivo: l.tratada_motivo ?? "", em: l.tratada_em ?? "" } : null,
    temBordero: l.tem_bordero,
    borderoVistoEm: l.bordero_visto_em ? quandoEm(l.bordero_visto_em) : null,
    confirmadoConsistem: l.confirmado_consistem,
    confirmacaoVistaEm: l.confirmacao_vista_em ? quandoEm(l.confirmacao_vista_em) : null,
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
    rascunhos,
  };
}

// ---------------------------------------------------------------- autorizações

export type LinhaAutorizacao = {
  id: string; numero: number; codigo: string; empresa_id: string; data: string; status: "rascunho" | "autorizada" | "cancelada"; observacao: string | null;
  criado_por: string | null; criado_em: string; autorizada_por: string | null; autorizada_em: string | null; cancelada_por: string | null; cancelada_em: string | null;
  motivo_cancelamento: string | null; caixa_disponivel: number | string | null; excedente: number | string | null;
  slack_enviada_em: string | null; slack_enviada_por: string | null; slack_enviada_por_nome: string | null; slack_permalink: string | null; slack_file_id: string | null; slack_message_ts: string | null; slack_retirada_em: string | null; empresa_nome: string; empresa_razao_social: string; empresa_cnpj: string | null;
  criado_por_nome: string | null; autorizada_por_nome: string | null; cancelada_por_nome: string | null;
  itens: number; titulos: number; antecipacoes: number; total_titulos: number | string; total_antecipacoes: number | string; total: number | string; baixados: number;
  /** Itens ainda não baixados que constam confirmados no Consistem (CCFFB014). */
  confirmados: number;
  /** Pagamentos extras (fora do Consistem) ativos e sua soma; `total` já inclui. */
  extras: number; total_extras: number | string;
  /** Conferência com o banco (Fase 4e), itens + extras ativos: conferidos, divergentes e a soma dos conferidos. */
  conferidos: number; divergentes: number; total_conferido: number | string;
  excluida_em: string | null; excluida_por_nome: string | null; motivo_exclusao: string | null;
};

/** Pagamento extra da autorização (fora do Consistem). Removidos ficam na lista para o histórico. */
export type LinhaExtraAutorizacao = {
  id: string; descricao: string; favorecido: string; valor: number | string; ordem: number;
  criado_por: string | null; criado_por_nome: string | null; criado_em: string; removido_em: string | null; motivo_remocao: string | null;
  /** Conferência com o banco (Fase 4e): conferido | divergente | nulo; quem marcou e quando. */
  conferencia_banco: "conferido" | "divergente" | null; valor_banco: number | string | null; observacao_conferencia: string | null;
  conferido_banco_por: string | null; conferido_banco_por_nome: string | null; conferido_banco_em: string | null;
};

export type LinhaItemAutorizacao = {
  id: string; lancamento_id: string; tipo: "titulo" | "antecipacao"; cod_lancamento: string; cod_fornecedor: string | null; fornecedor_nome: string; fornecedor_documento: string | null;
  num_documento: string | null; categoria_doc: string | null; data_emissao: string | null; data_vencimento: string | null; data_pagamento: string | null;
  valor: number | string; valor_original: number | string | null; complemento_historico: string | null; cod_banco: string | null; cod_portador: string | null;
  cod_barras: string | null; qrcode_pix: string | null; ordem: number; removido_em: string | null; motivo_remocao: string | null; baixado_consistem_em: string | null;
  /** Data em que a sincronização viu o documento confirmado no Consistem (CCFFB014). */
  confirmado_consistem_em: string | null;
  /** Conferência com o banco (Fase 4e): conferido | divergente | nulo; quem marcou e quando. */
  conferencia_banco: "conferido" | "divergente" | null; valor_banco: number | string | null; observacao_conferencia: string | null;
  conferido_banco_por: string | null; conferido_banco_por_nome: string | null; conferido_banco_em: string | null;
  /** Do lançamento de origem: antecipação com borderô no Consistem (paga) — preenchido na leitura. */
  tem_bordero: boolean | null;
};

const COLUNAS_AUTORIZACAO = "id, numero, codigo, empresa_id, data, status, observacao, criado_por, criado_em, autorizada_por, autorizada_em, cancelada_por, cancelada_em, motivo_cancelamento, caixa_disponivel, excedente, slack_enviada_em, slack_enviada_por, slack_enviada_por_nome, slack_permalink, slack_file_id, slack_message_ts, slack_retirada_em, empresa_nome, empresa_razao_social, empresa_cnpj, criado_por_nome, autorizada_por_nome, cancelada_por_nome, itens, titulos, antecipacoes, total_titulos, total_antecipacoes, total, baixados, confirmados, extras, total_extras, conferidos, divergentes, total_conferido, excluida_em, excluida_por_nome, motivo_exclusao";

export async function listarAutorizacoes(supabase: Cliente, filtro: { status: string | null; pagina: number; porPagina: number }): Promise<{ linhas: LinhaAutorizacao[]; total: number }> {
  let consulta = supabase.from("cap_vw_autorizacoes").select(COLUNAS_AUTORIZACAO, { count: "exact" }).is("excluida_em", null).order("numero", { ascending: false })
    .range((filtro.pagina - 1) * filtro.porPagina, filtro.pagina * filtro.porPagina - 1);
  if (filtro.status) consulta = consulta.eq("status", filtro.status);
  const { data, count, error } = await consulta;
  if (error) throw new Error(`Falha ao ler as autorizações: ${error.message}`);
  return { linhas: (data ?? []) as unknown as LinhaAutorizacao[], total: count ?? 0 };
}

export type AnexoAutorizacao = { id: string; nome: string; enviadoEm: string; url: string | null };

export async function lerAutorizacao(supabase: Cliente, id: string): Promise<{ autorizacao: LinhaAutorizacao; itens: LinhaItemAutorizacao[]; extras: LinhaExtraAutorizacao[]; anexos: AnexoAutorizacao[]; confirmacaoVistaEm: string | null } | null> {
  const [{ data: a, error: erroA }, { data: itens, error: erroI }, { data: extrasBrutos, error: erroX }, { data: anexosBrutos }] = await Promise.all([
    supabase.from("cap_vw_autorizacoes").select(COLUNAS_AUTORIZACAO).eq("id", id).maybeSingle(),
    supabase.from("cap_autorizacao_itens")
      .select("id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento, num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original, complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem, removido_em, motivo_remocao, baixado_consistem_em, confirmado_consistem_em, conferencia_banco, valor_banco, observacao_conferencia, conferido_banco_por, conferido_banco_em")
      .eq("autorizacao_id", id).order("ordem").limit(1000),
    supabase.from("cap_autorizacao_extras").select("id, descricao, favorecido, valor, ordem, criado_por, criado_em, removido_em, motivo_remocao, conferencia_banco, valor_banco, observacao_conferencia, conferido_banco_por, conferido_banco_em").eq("autorizacao_id", id).order("ordem").limit(200),
    supabase.from("anexos").select("id, arquivo_path, nome_arquivo, enviado_em")
      .eq("modulo", MODULO_CONTAS_PAGAR).eq("referencia_tabela", "cap_autorizacoes").eq("referencia_id", id).order("enviado_em", { ascending: false }).limit(20),
  ]);
  if (erroA) throw new Error(`Falha ao ler a autorização: ${erroA.message}`);
  if (erroI) throw new Error(`Falha ao ler os itens: ${erroI.message}`);
  if (erroX) throw new Error(`Falha ao ler os pagamentos extras: ${erroX.message}`);
  if (!a) return null;
  const extras = (extrasBrutos ?? []).map((x) => ({ ...(x as Omit<LinhaExtraAutorizacao, "criado_por_nome" | "conferido_banco_por_nome">), criado_por_nome: null as string | null, conferido_banco_por_nome: null as string | null }));
  // Link assinado de 15 min para cada anexo (o bucket é privado; a RLS do Storage decide).
  // Antecipação do item já tem borderô (paga) no espelho? Aviso na página: o item deveria sair do rascunho.
  const lista = (itens ?? []) as unknown as LinhaItemAutorizacao[];
  // Também a última verificação da confirmação no Consistem (legenda "verificado em …" do cartão Confirmados).
  const idsLanc = lista.map((i) => i.lancamento_id);
  const borderoDe = new Map<string, boolean | null>();
  let confirmacaoVistaEm: string | null = null;
  if (idsLanc.length > 0) {
    const { data: lancs } = await supabase.from("cap_lancamentos").select("id, tipo_lancamento, tem_bordero, confirmacao_vista_em").in("id", idsLanc);
    for (const l of lancs ?? []) {
      if (l.tipo_lancamento === "A") borderoDe.set(l.id as string, (l.tem_bordero as boolean | null) ?? null);
      const vista = l.confirmacao_vista_em as string | null;
      if (vista && (!confirmacaoVistaEm || vista > confirmacaoVistaEm)) confirmacaoVistaEm = vista;
    }
  }
  for (const i of lista) i.tem_bordero = borderoDe.get(i.lancamento_id) ?? null;
  // Nomes de quem incluiu cada extra e de quem marcou a conferência com o banco.
  const idsPerfis = [...new Set([...extras.flatMap((x) => [x.criado_por, x.conferido_banco_por]), ...lista.map((i) => i.conferido_banco_por)].filter((v): v is string => !!v))];
  if (idsPerfis.length > 0) {
    const { data: perfis } = await supabase.from("perfis").select("id, nome").in("id", idsPerfis);
    const nomeDe = new Map((perfis ?? []).map((p) => [p.id as string, p.nome as string]));
    for (const x of extras) {
      x.criado_por_nome = x.criado_por ? nomeDe.get(x.criado_por) ?? null : null;
      x.conferido_banco_por_nome = x.conferido_banco_por ? nomeDe.get(x.conferido_banco_por) ?? null : null;
    }
    for (const i of lista) i.conferido_banco_por_nome = i.conferido_banco_por ? nomeDe.get(i.conferido_banco_por) ?? null : null;
  }
  const anexos: AnexoAutorizacao[] = await Promise.all((anexosBrutos ?? []).map(async (x) => {
    const r = await urlAssinadaAnexo(supabase, x.arquivo_path as string, 900);
    return { id: x.id as string, nome: x.nome_arquivo as string, enviadoEm: quandoEm(x.enviado_em as string), url: r.ok ? r.url : null };
  }));
  return { autorizacao: a as unknown as LinhaAutorizacao, itens: lista, extras, anexos, confirmacaoVistaEm: confirmacaoVistaEm ? quandoEm(confirmacaoVistaEm) : null };
}
