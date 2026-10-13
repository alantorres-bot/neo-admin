// Leituras do módulo Cartão de crédito (RLS de quem chama; nada é gravado aqui).
import { cache } from "react";
import type { CartaoInfo, RegraCartao } from "@/lib/modulos/financeiro/cartao/cartoes";
import { conciliar, doDicionario, type DecisaoItem, type Estabelecimento, type LinhaFatura, type ResultadoConciliacao, type TipoDecisao, type TituloPagar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { MODULO_CARTAO, type CodigoLeitor } from "@/lib/modulos/financeiro/cartao/modulo";
import { selecionarTitulos, type LancamentoEspelho, type OutroTitulo } from "@/lib/modulos/financeiro/cartao/selecao-titulos";
import { somarDias } from "@/lib/modulos/financeiro/cartao/texto";
import { encargosALancar, lerConfigEncargos, montarTituloEncargos, type NovoLancamentoContaPagar, type TituloEncargos } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import type { CategoriaFornecedor, ContaFluxo, ListasConsistem } from "@/lib/modulos/financeiro/cartao/listas";
import { lerCampos, padraoSugerido, sugestaoDaLinha, type EstabelecimentoCodigos, type Sugestao } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { JANELA_VENCIMENTO } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { FUSO } from "@/lib/nucleo/fila";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import type { SituacaoCiclo } from "@/lib/modulos/financeiro/cartao/ciclos";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const centavos = (v: number | string) => Math.round(Number(v) * 100);
export const quandoEm = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// ---------------------------------------------------------------- cartões e dicionário

export type CartaoLinha = {
  codigo: string; nome: string; banco: string; tipo_pessoa: "PF" | "PJ"; dia_fechamento: number; dia_vencimento: number; tipo_titulo: number | null;
  leitor: CodigoLeitor; pasta_faturas: string | null; ativo: boolean; observacao: string | null;
  /** Códigos do Consistem do título de encargos (crt_cartoes.lancamento_encargos). */
  lancamento_encargos: Record<string, number> | null;
  /** Padrões do cartão para o título de compra (portador, categoria, histórico, conta contábil de crédito). */
  lancamento_compras: Record<string, number> | null;
};
const COLUNAS_CARTAO = "codigo, nome, banco, tipo_pessoa, dia_fechamento, dia_vencimento, tipo_titulo, leitor, pasta_faturas, ativo, observacao, lancamento_encargos, lancamento_compras";

export async function lerCartoes(supabase: Cliente): Promise<CartaoLinha[]> {
  const { data, error } = await supabase.from("crt_cartoes").select(COLUNAS_CARTAO).order("codigo");
  if (error) throw new Error(`Falha ao ler os cartões: ${error.message}`);
  return (data ?? []) as CartaoLinha[];
}
export const paraCartaoInfo = (c: CartaoLinha): CartaoInfo => ({
  codigo: c.codigo, nome: c.nome, banco: c.banco, tipoPessoa: c.tipo_pessoa, diaFechamento: c.dia_fechamento, diaVencimento: c.dia_vencimento, tipoTitulo: c.tipo_titulo,
});

export type EstabelecimentoLinha = {
  id: string; padrao: string; categoria: string; conta_fluxo: string | null; ativo: boolean;
  /** Sugestão de códigos do Consistem para a compra deste estabelecimento (fornecedor, histórico, fluxo, contas). */
  lancamento_erp: Record<string, number> | null;
  /** Marketplace: a nota é do vendedor; sem fornecedor próprio nem botão Lançar (casa pelo valor). */
  marketplace: boolean;
  /** Genérico (posto, restaurante...): sem fornecedor fixo; escolhido ou cadastrado em cada compra. */
  fornecedor_por_compra: boolean;
};
export async function lerEstabelecimentos(supabase: Cliente): Promise<EstabelecimentoLinha[]> {
  const { data, error } = await supabase.from("crt_estabelecimentos").select("id, padrao, categoria, conta_fluxo, ativo, lancamento_erp, marketplace, fornecedor_por_compra").order("padrao").limit(2000);
  if (error) throw new Error(`Falha ao ler o dicionário: ${error.message}`);
  return (data ?? []) as EstabelecimentoLinha[];
}

export async function lerEmpresas(supabase: Cliente): Promise<{ id: string; nome: string }[]> {
  const { data } = await supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string }));
}

// ---------------------------------------------------------------- faturas

export type FaturaLinha = {
  id: string; empresa_id: string; cartao: string; vencimento: string; total_informado: number | string; soma_linhas: number | string; linhas_lidas: number;
  linhas_descartadas: number; leitor: string; arquivo_nome: string | null; observacao: string | null; status: "importada" | "cancelada";
  importado_por: string | null; importado_em: string; cancelado_por: string | null; cancelado_em: string | null; motivo_cancelamento: string | null;
  ciclo_id: string | null;
  empresa_nome: string; cartao_nome: string; cartao_banco: string; importado_por_nome: string | null; cancelado_por_nome: string | null;
};
const COLUNAS_FATURA = "id, empresa_id, cartao, vencimento, total_informado, soma_linhas, linhas_lidas, linhas_descartadas, leitor, arquivo_nome, observacao, status, importado_por, importado_em, cancelado_por, cancelado_em, motivo_cancelamento, ciclo_id, empresa_nome, cartao_nome, cartao_banco, importado_por_nome, cancelado_por_nome";

export async function listarFaturas(supabase: Cliente, filtro: { status: "importada" | "cancelada" | null; cartao: string | null }): Promise<FaturaLinha[]> {
  let consulta = supabase.from("crt_vw_faturas").select(COLUNAS_FATURA).order("vencimento", { ascending: false }).order("importado_em", { ascending: false }).limit(300);
  if (filtro.status) consulta = consulta.eq("status", filtro.status);
  if (filtro.cartao) consulta = consulta.eq("cartao", filtro.cartao);
  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao ler as faturas: ${error.message}`);
  return (data ?? []) as unknown as FaturaLinha[];
}

export type LinhaFaturaBanco = {
  id: string; ordem: number; pagina: number | null; data_compra: string | null; descricao: string; valor: number | string; parcela_num: number | null;
  parcela_total: number | null; descartada: boolean; motivo_descarte: string | null; texto_origem: string | null;
};

export async function lerFatura(supabase: Cliente, id: string): Promise<{ fatura: FaturaLinha; linhas: LinhaFaturaBanco[] } | null> {
  const [{ data: f, error: erroF }, { data: linhas, error: erroL }] = await Promise.all([
    supabase.from("crt_vw_faturas").select(COLUNAS_FATURA).eq("id", id).maybeSingle(),
    supabase.from("crt_fatura_linhas").select("id, ordem, pagina, data_compra, descricao, valor, parcela_num, parcela_total, descartada, motivo_descarte, texto_origem").eq("fatura_id", id).order("ordem").limit(2000),
  ]);
  if (erroF) throw new Error(`Falha ao ler a fatura: ${erroF.message}`);
  if (erroL) throw new Error(`Falha ao ler as linhas da fatura: ${erroL.message}`);
  if (!f) return null;
  return { fatura: f as unknown as FaturaLinha, linhas: (linhas ?? []) as LinhaFaturaBanco[] };
}

/**
 * Títulos (tipo C) com vencimento na janela da fatura, direto da API do Consistem (Edge Function, ação só de leitura
 * `titulos_vencimento`), com QUALQUER saldo: no fechamento do cartão os títulos entram num borderô e ficam sem saldo, por isso
 * não estão no espelho. Lança erro se a função falhar (quem chama cai para o espelho).
 */
export async function lerTitulosDoConsistem(supabase: Cliente, empresaId: string, vencimento: string): Promise<LancamentoEspelho[]> {
  const { data, error } = await supabase.functions.invoke("cap-sincronizar-consistem", {
    body: { acao: "titulos_vencimento", empresaId, ini: somarDias(vencimento, -JANELA_VENCIMENTO), fim: somarDias(vencimento, JANELA_VENCIMENTO) },
  });
  if (error) {
    let mensagem = error.message;
    const resposta = (error as { context?: Response }).context;
    if (resposta && typeof resposta.json === "function") {
      try { mensagem = ((await resposta.json()) as { erro?: string }).erro ?? mensagem; } catch { /* mantém */ }
    }
    throw new Error(mensagem);
  }
  const lista = (data as { titulos?: (Omit<LancamentoEspelho, "id" | "baixado_em"> & { cod_lancamento: string })[] } | null)?.titulos;
  if (!Array.isArray(lista)) throw new Error("A consulta ao Consistem não devolveu títulos.");
  return lista.map((t) => ({ ...t, id: `api:${t.cod_lancamento}`, baixado_em: null }));
}

/** Títulos (tipo C) com vencimento e antecipações (tipo A) com pagamento na janela da fatura, do espelho (plano B). */
export async function lerLancamentosDaJanela(supabase: Cliente, empresaId: string, vencimento: string): Promise<LancamentoEspelho[]> {
  const de = somarDias(vencimento, -JANELA_VENCIMENTO);
  const ate = somarDias(vencimento, JANELA_VENCIMENTO);
  const colunas = "id, cod_lancamento, tipo_lancamento, num_documento, cod_fornecedor, complemento_historico, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor_documento, valor_atualizado, baixado_em, tem_bordero";
  const [{ data, error }, { data: antecipacoes, error: erroA }] = await Promise.all([
    supabase.from("cap_lancamentos").select(colunas).eq("empresa_id", empresaId).eq("tipo_lancamento", "C").gte("data_vencimento", de).lte("data_vencimento", ate).order("data_vencimento").limit(3000),
    supabase.from("cap_lancamentos").select(colunas).eq("empresa_id", empresaId).eq("tipo_lancamento", "A").gte("data_pagamento", de).lte("data_pagamento", ate).limit(500),
  ]);
  if (error || erroA) throw new Error(`Falha ao ler os títulos do espelho: ${(error ?? erroA)!.message}`);
  const lista = [
    ...((data ?? []) as LancamentoEspelho[]),
    // Antecipação: a data de pagamento faz o papel do vencimento na janela da fatura.
    ...((antecipacoes ?? []) as (LancamentoEspelho & { data_pagamento: string | null })[]).map((a) => ({ ...a, data_vencimento: a.data_pagamento })),
  ];
  const codigos = [...new Set(lista.map((l) => l.cod_fornecedor).filter((c): c is string => !!c))];
  const nomes = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += 200) {
    const { data: f } = await supabase.from("cap_fornecedores").select("cod_fornecedor, nome").eq("empresa_id", empresaId).in("cod_fornecedor", codigos.slice(i, i + 200));
    for (const x of f ?? []) nomes.set(x.cod_fornecedor as string, x.nome as string);
  }
  return lista.map((l) => ({ ...l, fornecedor_nome: l.cod_fornecedor ? nomes.get(l.cod_fornecedor) ?? null : null }));
}

export type Conciliacao = {
  fatura: FaturaLinha;
  linhas: LinhaFaturaBanco[];
  cartao: CartaoLinha;
  resultado: ResultadoConciliacao;
  outros: OutroTitulo[];
  /** Título no valor exato da fatura (fatura lançada como título único), quando existe. */
  tituloDaFatura: TituloPagar | null;
  ultimaSincronizacao: string | null;
  /** De onde vieram os títulos: a API do Consistem (com os títulos do borderô) ou o espelho (plano B, só os com saldo). */
  origemTitulos: "consistem" | "espelho";
  /** Por que caiu para o espelho, quando caiu. */
  avisoOrigem: string | null;
  /** Todas as decisões da fatura (ativas e desfeitas), para a aba Decisões. */
  decisoesHistorico: DecisaoLinha[];
};

export type DecisaoLinha = {
  id: string; tipo: TipoDecisao; linhas: string[]; titulos: string[]; categoria: string | null; conta_fluxo: string | null; motivo: string | null;
  criado_por_nome: string | null; criado_em: string; desfeito_por_nome: string | null; desfeito_em: string | null; motivo_desfazer: string | null;
};

export const paraDecisaoItem = (d: DecisaoLinha): DecisaoItem => ({
  id: d.id, tipo: d.tipo, linhas: d.linhas, titulos: d.titulos, categoria: d.categoria, contaFluxo: d.conta_fluxo, motivo: d.motivo,
  autor: d.criado_por_nome, em: d.criado_em,
});

/** Conciliação calculada na hora: fatura + linhas + títulos da janela no espelho + dicionário. */
export const conciliacaoDaRequisicao = cache(async (id: string): Promise<Conciliacao | null> => {
  const supabase = await criarClienteServidor();
  const lida = await lerFatura(supabase, id);
  if (!lida) return null;
  const { fatura, linhas } = lida;
  const [cartoes, dicionario, lancamentos, { data: ultima }, { data: decisoesBrutas, error: erroDecisoes }, regras] = await Promise.all([
    lerCartoes(supabase), lerEstabelecimentos(supabase),
    lerTitulosDoConsistem(supabase, fatura.empresa_id, fatura.vencimento)
      .then((l) => ({ lista: l, origem: "consistem" as const, aviso: null as string | null }))
      .catch(async (e: Error) => ({ lista: await lerLancamentosDaJanela(supabase, fatura.empresa_id, fatura.vencimento), origem: "espelho" as const, aviso: e.message })),
    supabase.from("importacoes").select("criado_em").eq("modulo", "financeiro.contas-pagar").eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
    supabase.from("crt_vw_decisoes").select("id, tipo, linhas, titulos, categoria, conta_fluxo, motivo, criado_por_nome, criado_em, desfeito_por_nome, desfeito_em, motivo_desfazer")
      .eq("fatura_id", id).order("criado_em").limit(1000),
    lerRegras(supabase),
  ]);
  if (erroDecisoes) throw new Error(`Falha ao ler as decisões da fatura: ${erroDecisoes.message}`);
  const decisoesHistorico = (decisoesBrutas ?? []) as DecisaoLinha[];
  const cartao = cartoes.find((c) => c.codigo === fatura.cartao);
  if (!cartao) throw new Error(`Cartão ${fatura.cartao} não encontrado no cadastro.`);
  const infos = cartoes.map(paraCartaoInfo);
  const selecao = selecionarTitulos(lancamentos.lista, paraCartaoInfo(cartao), infos, fatura.vencimento, {
    janela: JANELA_VENCIMENTO, totalCentavos: centavos(fatura.total_informado), regras: regras.map(paraRegraCartao),
  });
  const linhasUteis: LinhaFatura[] = linhas.filter((l) => !l.descartada).map((l) => ({
    id: l.id, ordem: l.ordem, dataCompra: l.data_compra, descricao: l.descricao, valorCentavos: centavos(l.valor), parcelaNum: l.parcela_num, parcelaTotal: l.parcela_total,
  }));
  const estabelecimentos: Estabelecimento[] = dicionario.filter((e) => e.ativo).map((e) => ({ padrao: e.padrao, categoria: e.categoria, contaFluxo: e.conta_fluxo }));
  const resultado = conciliar({
    cartao: paraCartaoInfo(cartao), cartoes: infos, vencimento: fatura.vencimento, totalInformadoCentavos: centavos(fatura.total_informado),
    linhas: linhasUteis, titulos: selecao.doCartao, estabelecimentos,
    decisoes: decisoesHistorico.filter((d) => !d.desfeito_em).map(paraDecisaoItem), titulosExtras: selecao.outros.map((o) => o.titulo),
    antecipacoes: selecao.antecipacoes,
  });
  // Antecipações candidatas que não casaram: vão para a aba "Outros títulos" (podem ser casadas à mão).
  const usadas = new Set(resultado.conciliados.flatMap((c) => [c.titulo, ...(c.titulosExtras ?? [])]).map((t) => t.id));
  const antecipacoesSobrando: OutroTitulo[] = selecao.antecipacoes.filter((a) => !usadas.has(a.id))
    .map((titulo) => ({ titulo, situacao: "ambiguo" as const, detalhe: `Antecipação paga em ${titulo.vencimento ? titulo.vencimento.split("-").reverse().join("/") : "?"}, sem o cartão no texto: se for desta fatura, use Decidir › Casar` }));
  const u = ultima?.[0] as { criado_em: string } | undefined;
  return { fatura, linhas, cartao, resultado, outros: [...selecao.outros, ...antecipacoesSobrando], tituloDaFatura: selecao.tituloDaFatura, ultimaSincronizacao: u ? quandoEm(u.criado_em) : null,
    origemTitulos: lancamentos.origem, avisoOrigem: lancamentos.aviso, decisoesHistorico };
});

// ---------------------------------------------------------------- encargos lançados no Consistem (0137)

export type LancamentoErpLinha = {
  id: string; fatura_id: string; situacao: "reservado" | "enviando" | "lancado" | "erro"; valor: number | string; complemento: string; linhas: string[];
  payload: NovoLancamentoContaPagar; cod_lancamento_erp: string | null; erro: string | null; criado_por: string | null; criado_por_nome: string | null; criado_em: string;
  enviado_em: string | null; concluido_em: string | null; resolvido_por_nome: string | null; motivo_resolucao: string | null;
  tipo: "encargos" | "compra" | "agrupado"; lote: string; linha_origem: string | null; linha_descricao: string | null; parcela: number | null; parcelas: number | null; vencimento: string | null;
};

export type QuadroEncargos = {
  /** Chave geral financeiro.cartao.lancar_encargos_no_erp. */
  ligado: boolean;
  /** O mês da fatura está em conciliação (só então se lança). */
  mesAberto: boolean;
  titulo: TituloEncargos;
  fornecedorNome: string | null;
  /** Lançamento ativo do mês (reservado, enviando ou lançado), se houver. */
  ativo: LancamentoErpLinha | null;
  historico: LancamentoErpLinha[];
};

/** Encargos a lançar da fatura, o título que seria enviado e os lançamentos já feitos no mês. */
export async function lerEncargos(supabase: Cliente, c: Conciliacao): Promise<QuadroEncargos> {
  const ciclo = c.fatura.ciclo_id;
  const [{ data: config }, { data: lancs, error }, { data: cic }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", CHAVE_LANCAR_NO_ERP).maybeSingle(),
    ciclo
      ? supabase.from("crt_vw_lancamentos_erp").select("id, fatura_id, situacao, valor, complemento, linhas, payload, cod_lancamento_erp, erro, criado_por, criado_por_nome, criado_em, enviado_em, concluido_em, resolvido_por_nome, motivo_resolucao, tipo, lote, linha_origem, linha_descricao, parcela, parcelas, vencimento")
        .eq("ciclo_id", ciclo).eq("tipo", "encargos").order("criado_em", { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    ciclo ? supabase.from("crt_ciclos").select("fechamento, situacao").eq("id", ciclo).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error(`Falha ao ler os lançamentos de encargos: ${error.message}`);
  const historico = (lancs ?? []) as LancamentoErpLinha[];
  const ativo = historico.find((l) => l.situacao !== "erro") ?? null;
  const jaLancadas = new Set(historico.filter((l) => l.situacao !== "erro").flatMap((l) => l.linhas));
  const cfg = lerConfigEncargos(c.cartao.lancamento_encargos);
  const titulo = montarTituloEncargos({
    nomeCartao: c.cartao.nome, config: cfg, linhas: encargosALancar(c.resultado, jaLancadas),
    fechamento: (cic as { fechamento: string } | null)?.fechamento ?? null, vencimento: c.fatura.vencimento,
  });
  const nomes = cfg ? await nomesDosFornecedores(supabase, [String(cfg.codFornecedor)]) : new Map<string, string>();
  const mesAberto = (cic as { situacao: string } | null)?.situacao === "em_conciliacao" && c.fatura.status === "importada";
  return { ligado: (config as { valor: unknown } | null)?.valor === true, mesAberto, titulo, fornecedorNome: cfg ? nomes.get(String(cfg.codFornecedor)) ?? null : null, ativo, historico };
}

// ---------------------------------------------------------------- compras lançadas no Consistem (0138)

export const CHAVE_LANCAR_NO_ERP = "financeiro.cartao.lancar_no_erp";
/** Naturezas de "A lançar" que podem virar título de compra pelo painel. */
export const NATUREZAS_COMPRA = ["Despesa sem nota fiscal", "Não identificado", "Parcela não desdobrada"] as const;

export type PropostaCompra = { sugestao: Sugestao; padraoLembrar: string; fornecedorNome: string | null; categoria: string };
export type QuadroCompras = {
  ligado: boolean;
  mesAberto: boolean;
  empresaId: string;
  /** Competência do mês da fatura (AAAA-MM-01). */
  competencia: string | null;
  /** Fechamento do mês da fatura (emissão do título agrupado). */
  fechamento: string | null;
  /** Conta contábil de crédito padrão do cartão (fornecedores): não pode ir no débito. */
  creditoPadrao: number | null;
  vencimentoFatura: string;
  cartao: CartaoInfo;
  /** Sugestão por linha que pode ser lançada (id da linha → proposta). */
  propostas: Record<string, PropostaCompra>;
  /** Títulos de compra do mês (todos os lotes, mais novos primeiro). */
  lancamentos: LancamentoErpLinha[];
  /** Linhas de marketplace (id da linha → estabelecimento): sem botão Lançar, casam pelo valor da nota. */
  marketplace: Record<string, string>;
  /** Cadastro do fornecedor "Outros" (endereço fixo, categoria e grupo sugeridos); nulo = não configurado. */
  cadastro: CadastroOutros | null;
  /** Categorias de fornecedor e contas de fluxo (listas). */
  listas: ListasConsistem;
};

export type CadastroOutros = { endereco: string; numero: string; bairro: string; cep: string; cidade: string; estado: string; codCategoria: number; codGrupo: number };

/** Categorias de fornecedor e contas do fluxo de caixa do Consistem (listas das telas). */
export async function lerListasConsistem(supabase: Cliente): Promise<ListasConsistem> {
  const [{ data: categorias }, { data: contas }] = await Promise.all([
    supabase.from("cap_categorias_fornecedor").select("codigo, descricao").order("codigo"),
    supabase.from("cap_contas_fluxo").select("grupo, grupo_descricao, item, descricao, ativa").order("grupo").order("item"),
  ]);
  return { categorias: (categorias ?? []) as CategoriaFornecedor[], contasFluxo: (contas ?? []) as ContaFluxo[] };
}

/** Configuração do fornecedor "Outros" (financeiro.cartao.fornecedor_outros). */
export async function lerCadastroOutros(supabase: Cliente): Promise<CadastroOutros | null> {
  const { data } = await supabase.from("configuracoes").select("valor").eq("chave", "financeiro.cartao.fornecedor_outros").maybeSingle();
  const v = (data as { valor: Partial<CadastroOutros> } | null)?.valor;
  return v && v.endereco && v.cep && v.codCategoria && v.codGrupo ? (v as CadastroOutros) : null;
}

/** Compras sem título que podem ser lançadas no Consistem, a sugestão de cada uma e os lançamentos já feitos no mês. */
export async function lerCompras(supabase: Cliente, c: Conciliacao): Promise<QuadroCompras> {
  const ciclo = c.fatura.ciclo_id;
  const [{ data: config }, { data: lancs, error }, { data: cic }, estabelecimentos, cadastro, listas] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", CHAVE_LANCAR_NO_ERP).maybeSingle(),
    ciclo
      ? supabase.from("crt_vw_lancamentos_erp").select("id, fatura_id, situacao, valor, complemento, linhas, payload, cod_lancamento_erp, erro, criado_por, criado_por_nome, criado_em, enviado_em, concluido_em, resolvido_por_nome, motivo_resolucao, tipo, lote, linha_origem, linha_descricao, parcela, parcelas, vencimento")
        .eq("ciclo_id", ciclo).in("tipo", ["compra", "agrupado"]).order("criado_em", { ascending: false }).order("parcela").limit(500)
      : Promise.resolve({ data: [], error: null }),
    ciclo ? supabase.from("crt_ciclos").select("competencia, fechamento, situacao").eq("id", ciclo).maybeSingle() : Promise.resolve({ data: null }),
    lerEstabelecimentos(supabase),
    lerCadastroOutros(supabase),
    lerListasConsistem(supabase),
  ]);
  if (error) throw new Error(`Falha ao ler os lançamentos de compras: ${error.message}`);
  const lancamentos = (lancs ?? []) as LancamentoErpLinha[];
  const emLancamento = new Set(lancamentos.filter((l) => l.situacao !== "erro").flatMap((l) => [l.linha_origem, ...(l.linhas ?? [])]));
  const ativos = estabelecimentos.filter((e) => e.ativo);
  const estabs: EstabelecimentoCodigos[] = ativos.map((e) => ({ padrao: e.padrao, lancamentoErp: lerCampos(e.lancamento_erp) }));
  const marketplace: Record<string, string> = {};
  const padroesCartao = lerCampos(c.cartao.lancamento_compras);
  const propostas: Record<string, PropostaCompra> = {};
  for (const a of c.resultado.aLancar) {
    if (a.justificativa || a.linha.valorCentavos <= 0 || emLancamento.has(a.linha.id) || !(NATUREZAS_COMPRA as readonly string[]).includes(a.natureza)) continue;
    const mkt = doDicionario(a.linha.descricao, ativos);
    if (mkt?.marketplace) { marketplace[a.linha.id] = mkt.padrao; continue; }
    const sugestao = sugestaoDaLinha(a.linha.descricao, estabs, padroesCartao);
    propostas[a.linha.id] = { sugestao, padraoLembrar: sugestao.padrao ?? padraoSugerido(a.linha.descricao), fornecedorNome: null, categoria: a.categoria };
  }
  const codigos = [...new Set(Object.values(propostas).map((p) => p.sugestao.campos.codFornecedor).filter((x): x is number => x !== undefined).map(String))];
  if (codigos.length) {
    const { data: f } = await supabase.from("cap_fornecedores").select("cod_fornecedor, nome").eq("empresa_id", c.fatura.empresa_id).in("cod_fornecedor", codigos);
    const nomes = new Map((f ?? []).map((x) => [String(x.cod_fornecedor), x.nome as string]));
    for (const p of Object.values(propostas)) if (p.sugestao.campos.codFornecedor) p.fornecedorNome = nomes.get(String(p.sugestao.campos.codFornecedor)) ?? null;
  }
  const cc = cic as { competencia: string; fechamento: string; situacao: string } | null;
  return {
    ligado: (config as { valor: unknown } | null)?.valor === true, mesAberto: cc?.situacao === "em_conciliacao" && c.fatura.status === "importada",
    empresaId: c.fatura.empresa_id, competencia: cc?.competencia ?? null, fechamento: cc?.fechamento ?? null, creditoPadrao: padroesCartao.contaContabilCredito ?? null, vencimentoFatura: c.fatura.vencimento, cartao: paraCartaoInfo(c.cartao), propostas, lancamentos,
    marketplace, cadastro, listas,
  };
}

// ---------------------------------------------------------------- regras fornecedor → cartão (cópia do Neo Fiscal)

export type RegraLinha = { id: string; cod_fornecedor: string; cartao: string; parcelas_padrao: number; vigencia_ini: string; vigencia_fim: string | null; sincronizado_em: string };

export async function lerRegras(supabase: Cliente): Promise<RegraLinha[]> {
  const { data, error } = await supabase.from("crt_regras_fornecedor").select("id, cod_fornecedor, cartao, parcelas_padrao, vigencia_ini, vigencia_fim, sincronizado_em")
    .order("cod_fornecedor").order("vigencia_ini").limit(5000);
  // Sem a migration 0136 a tabela não existe: a conciliação segue sem a regra.
  if (error) return [];
  return (data ?? []) as RegraLinha[];
}
export const paraRegraCartao = (r: RegraLinha): RegraCartao => ({
  codFornecedor: r.cod_fornecedor, cartao: r.cartao, parcelasPadrao: r.parcelas_padrao, vigenciaIni: r.vigencia_ini, vigenciaFim: r.vigencia_fim,
});

/** Nomes dos fornecedores (espelho do contas a pagar) para a lista de regras. */
export async function nomesDosFornecedores(supabase: Cliente, codigos: string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += 200) {
    const { data } = await supabase.from("cap_fornecedores").select("cod_fornecedor, nome").in("cod_fornecedor", codigos.slice(i, i + 200));
    for (const f of data ?? []) nomes.set(f.cod_fornecedor as string, f.nome as string);
  }
  return nomes;
}

export async function ultimaSincronizacaoRegras(supabase: Cliente): Promise<{ quando: string; novas: number; alteradas: number; removidas: number } | null> {
  const { data } = await supabase.from("importacoes").select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
    .eq("modulo", MODULO_CARTAO).eq("tipo", "regras_fornecedor_cartao").order("criado_em", { ascending: false }).limit(1);
  const u = data?.[0] as { criado_em: string; linhas_novas: number | null; linhas_alteradas: number | null; linhas_baixadas: number | null } | undefined;
  return u ? { quando: quandoEm(u.criado_em), novas: u.linhas_novas ?? 0, alteradas: u.linhas_alteradas ?? 0, removidas: u.linhas_baixadas ?? 0 } : null;
}

// ---------------------------------------------------------------- ciclos (cartão × mês)

export type CicloLinha = {
  id: string; empresa_id: string; cartao: string; competencia: string; fechamento: string; vencimento_nominal: string; situacao: SituacaoCiclo;
  fatura_id: string | null; apurado_em: string | null; itens_a_lancar: number | null; diferenca: number | string | null; residuo: number | string | null;
  provisorio_cod_lancamento: string | null; fechada_por: string | null; fechada_em: string | null; paga_em: string | null; paga_por_cod_lancamento: string | null;
  criado_em: string; empresa_nome: string; cartao_nome: string; cartao_banco: string; total_fatura: number | string | null; fatura_arquivo: string | null;
  fatura_importada_em: string | null; fechada_por_nome: string | null;
};
const COLUNAS_CICLO = "id, empresa_id, cartao, competencia, fechamento, vencimento_nominal, situacao, fatura_id, apurado_em, itens_a_lancar, diferenca, residuo, provisorio_cod_lancamento, fechada_por, fechada_em, paga_em, paga_por_cod_lancamento, criado_em, empresa_nome, cartao_nome, cartao_banco, total_fatura, fatura_arquivo, fatura_importada_em, fechada_por_nome";

/** Cria os ciclos que já fecharam (idempotente; a mesma função roda no pg_cron diário). Falha não impede a tela. */
export async function gerarCiclos(supabase: Cliente): Promise<string | null> {
  const { error } = await supabase.rpc("crt_gerar_ciclos");
  return error ? error.message : null;
}

export async function listarCiclos(supabase: Cliente, filtro: { de?: string; ate?: string; cartao?: string | null }): Promise<CicloLinha[]> {
  let consulta = supabase.from("crt_vw_ciclos").select(COLUNAS_CICLO).order("competencia", { ascending: false }).order("cartao").limit(1000);
  if (filtro.de) consulta = consulta.gte("competencia", filtro.de);
  if (filtro.ate) consulta = consulta.lte("competencia", filtro.ate);
  if (filtro.cartao) consulta = consulta.eq("cartao", filtro.cartao);
  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao ler os meses dos cartões: ${error.message}`);
  return (data ?? []) as unknown as CicloLinha[];
}

export type FechamentoLinha = {
  id: string; versao: number; fatura_id: string; resultado: FotoFechamento; total_fatura: number | string; total_titulos: number | string;
  provisorio_cod_lancamento: string | null; fechado_por: string | null; fechado_em: string; reaberto_por: string | null; reaberto_em: string | null;
  motivo_reabertura: string | null; fechado_por_nome: string | null; reaberto_por_nome: string | null; planilha_url: string | null; planilha_nome: string | null;
};

/** O que fica congelado no fechamento (prova): o resultado da conciliação e o contexto da tela naquele momento. */
export type FotoFechamento = {
  resultado: ResultadoConciliacao;
  outros: OutroTitulo[];
  tituloDaFatura: TituloPagar | null;
  origemTitulos: "consistem" | "espelho";
};

export async function lerCiclo(supabase: Cliente, id: string): Promise<{ ciclo: CicloLinha; fechamentos: FechamentoLinha[]; faturas: FaturaLinha[] } | null> {
  const [{ data: c, error }, { data: fs }, { data: fats }] = await Promise.all([
    supabase.from("crt_vw_ciclos").select(COLUNAS_CICLO).eq("id", id).maybeSingle(),
    supabase.from("crt_fechamentos").select("id, versao, fatura_id, resultado, total_fatura, total_titulos, provisorio_cod_lancamento, fechado_por, fechado_em, reaberto_por, reaberto_em, motivo_reabertura")
      .eq("ciclo_id", id).order("versao", { ascending: false }),
    supabase.from("crt_vw_faturas").select(COLUNAS_FATURA).eq("ciclo_id", id).order("importado_em", { ascending: false }),
  ]);
  if (error) throw new Error(`Falha ao ler o mês do cartão: ${error.message}`);
  if (!c) return null;
  const brutos = (fs ?? []) as unknown as Omit<FechamentoLinha, "fechado_por_nome" | "reaberto_por_nome" | "planilha_url" | "planilha_nome">[];
  const idsPerfis = [...new Set(brutos.flatMap((f) => [f.fechado_por, f.reaberto_por]).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (idsPerfis.length > 0) {
    const { data: perfis } = await supabase.from("perfis").select("id, nome").in("id", idsPerfis);
    for (const p of perfis ?? []) nomes.set(p.id as string, p.nome as string);
  }
  const { data: anexos } = brutos.length > 0
    ? await supabase.from("anexos").select("referencia_id, arquivo_path, nome_arquivo").eq("modulo", MODULO_CARTAO).eq("referencia_tabela", "crt_fechamentos").in("referencia_id", brutos.map((f) => f.id))
    : { data: [] };
  const fechamentos: FechamentoLinha[] = await Promise.all(brutos.map(async (f) => {
    const anexo = (anexos ?? []).find((a) => a.referencia_id === f.id);
    const url = anexo ? await urlAssinadaAnexo(supabase, anexo.arquivo_path as string, 900) : null;
    return {
      ...f, fechado_por_nome: f.fechado_por ? nomes.get(f.fechado_por) ?? null : null, reaberto_por_nome: f.reaberto_por ? nomes.get(f.reaberto_por) ?? null : null,
      planilha_url: url && url.ok ? url.url : null, planilha_nome: (anexo?.nome_arquivo as string | undefined) ?? null,
    };
  }));
  return { ciclo: c as unknown as CicloLinha, fechamentos, faturas: (fats ?? []) as unknown as FaturaLinha[] };
}

/** Grava a apuração do ciclo em conciliação (mantém as pendências Conciliar/Fechar). Falha não derruba a tela. */
export async function registrarApuracao(supabase: Cliente, cicloId: string, c: Conciliacao): Promise<void> {
  await supabase.rpc("crt_registrar_apuracao", {
    p_ciclo: cicloId, p_itens: c.resultado.pendentes, p_diferenca: c.resultado.diferencaCentavos / 100, p_residuo: c.resultado.residuoCentavos / 100,
    p_provisorio: c.tituloDaFatura ? codigoDoLancamento(c.tituloDaFatura) : null,
  });
}

/** Código do lançamento no Consistem do título (id "api:<cod>" quando veio da API; no espelho, o número do documento não serve). */
export function codigoDoLancamento(t: TituloPagar): string | null {
  return t.id.startsWith("api:") ? t.id.slice(4) : t.codLancamento ?? null;
}

export { MODULO_CARTAO };
