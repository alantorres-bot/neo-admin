import { cache } from "react";
import { lerParametrosContasPagar, CHAVES_CONTAS_PAGAR, type ParametrosContasPagar } from "@/lib/modulos/financeiro/contas-pagar/parametros";
import { MODULO_CONTAS_PAGAR, type ItemPendente } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { FUSO } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

type LinhaLancamento = {
  id: string; empresa_id: string; cod_lancamento: string; tipo_lancamento: "C" | "A"; cod_fornecedor: string | null; num_documento: string | null;
  categoria_doc: string | null; cod_banco: string | null; complemento_historico: string | null; data_emissao: string | null; data_vencimento: string | null;
  data_pagamento: string | null; valor_documento: number | string; valor_atualizado: number | string;
};
type LinhaFornecedor = { empresa_id: string; cod_fornecedor: string; nome: string; documento: string | null };

export type UltimaAtualizacao = { quando: string; novos: number; alterados: number; baixados: number } | null;
export type Pendentes = { itens: ItemPendente[]; parametros: ParametrosContasPagar; ultima: UltimaAtualizacao; empresas: { id: string; nome: string }[] };

const centavos = (v: number | string) => Math.round(Number(v) * 100);

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

/** Os pendentes desta requisição (a página e, no futuro, as abas com contagem usam o mesmo resultado). */
export const pendentesDaRequisicao = cache(async (): Promise<Pendentes> => carregarPendentes(await criarClienteServidor()));

/**
 * Tudo o que está em aberto no espelho do Consistem (títulos C e antecipações A com saldo), com nome do fornecedor, mais os
 * parâmetros do módulo e a última atualização. A RLS de quem chama vale. Nada é gravado.
 */
export async function carregarPendentes(supabase: Cliente): Promise<Pendentes> {
  const [lancamentos, fornecedores, { data: configs }, { data: ultimas }, { data: empresas }] = await Promise.all([
    lerTudo<LinhaLancamento>((de, ate) =>
      supabase.from("cap_lancamentos")
        .select("id, empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, categoria_doc, cod_banco, complemento_historico, data_emissao, data_vencimento, data_pagamento, valor_documento, valor_atualizado")
        .in("tipo_lancamento", ["C", "A"]).is("baixado_em", null).gt("valor_atualizado", 0).order("id").range(de, ate), "os lançamentos"),
    lerTudo<LinhaFornecedor>((de, ate) =>
      supabase.from("cap_fornecedores").select("empresa_id, cod_fornecedor, nome, documento").order("id").range(de, ate), "os fornecedores"),
    supabase.from("configuracoes").select("chave, valor").in("chave", [...CHAVES_CONTAS_PAGAR]),
    supabase.from("importacoes").select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
      .eq("modulo", MODULO_CONTAS_PAGAR).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
    supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto"),
  ]);

  const nomeDo = new Map(fornecedores.map((f) => [`${f.empresa_id}|${f.cod_fornecedor}`, f]));
  const itens: ItemPendente[] = lancamentos.map((l) => {
    const f = l.cod_fornecedor ? nomeDo.get(`${l.empresa_id}|${l.cod_fornecedor}`) : undefined;
    return {
      id: l.id,
      tipo: l.tipo_lancamento === "A" ? "antecipacao" : "titulo",
      codLancamento: l.cod_lancamento,
      codFornecedor: l.cod_fornecedor ?? "",
      fornecedor: f?.nome ?? (l.cod_fornecedor ? `Fornecedor ${l.cod_fornecedor}` : "(sem fornecedor)"),
      documentoFornecedor: f?.documento ?? null,
      numDocumento: l.num_documento ?? "",
      emissao: l.data_emissao,
      vencimento: l.data_vencimento,
      dataPagamento: l.data_pagamento,
      valorDocumentoCentavos: centavos(l.valor_documento),
      saldoCentavos: centavos(l.valor_atualizado),
      complemento: l.complemento_historico ?? "",
      codBanco: l.cod_banco ?? "",
      categoria: l.categoria_doc ?? "",
    };
  });

  const u = ultimas?.[0] as { criado_em: string; linhas_novas: number | null; linhas_alteradas: number | null; linhas_baixadas: number | null } | undefined;
  const ultima: UltimaAtualizacao = u
    ? {
      quando: new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(u.criado_em)),
      novos: u.linhas_novas ?? 0, alterados: u.linhas_alteradas ?? 0, baixados: u.linhas_baixadas ?? 0,
    }
    : null;

  return {
    itens,
    parametros: lerParametrosContasPagar((configs ?? []) as { chave: string; valor: unknown }[]),
    ultima,
    empresas: (empresas ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string })),
  };
}
