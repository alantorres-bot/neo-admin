// Leituras do módulo Folha de pagamento (RLS de quem chama; nada é gravado aqui).
import type { FormaPagamento } from "@/lib/modulos/rh/colaboradores/modulo";
import type { TipoTitulo } from "@/lib/modulos/rh/lancamento";
import type { ChaveParametro, Rubrica, TipoRecibo, Vigencia } from "@/lib/modulos/rh/folha/recibos";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export type StatusFolha = "aberta" | "conferida" | "aprovada" | "paga";
export const ROTULO_STATUS: Record<StatusFolha, string> = { aberta: "Aberta", conferida: "Conferida (aguardando aprovação)", aprovada: "Aprovada", paga: "Paga" };

export type MesFolha = {
  id: string; competencia: string; data_pagamento: string; status: StatusFolha;
  conferida_em: string | null; aprovada_em: string | null; paga_em: string | null; reaberta_em: string | null; reaberta_motivo: string | null;
  arquivo_bb_gerado_em: string | null; conferida_por_nome?: string | null; aprovada_por_nome?: string | null;
};
const COLUNAS_MES = "id, competencia, data_pagamento, status, conferida_em, aprovada_em, paga_em, reaberta_em, reaberta_motivo, arquivo_bb_gerado_em, conferida_por, aprovada_por";

export async function lerMeses(supabase: Cliente, ano: number): Promise<MesFolha[]> {
  const { data } = await supabase.from("rh_fp_competencias").select(COLUNAS_MES).gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`).order("competencia");
  return (data ?? []) as MesFolha[];
}

export async function lerMes(supabase: Cliente, id: string): Promise<MesFolha | null> {
  const { data } = await supabase.from("rh_fp_competencias").select(COLUNAS_MES).eq("id", id).maybeSingle();
  if (!data) return null;
  const ids = [data.conferida_por, data.aprovada_por].filter(Boolean) as string[];
  const { data: perfis } = ids.length ? await supabase.from("perfis").select("id, nome").in("id", ids) : { data: [] };
  const nome = new Map((perfis ?? []).map((p) => [p.id as string, p.nome as string]));
  return { ...(data as MesFolha), conferida_por_nome: data.conferida_por ? nome.get(data.conferida_por) ?? null : null, aprovada_por_nome: data.aprovada_por ? nome.get(data.aprovada_por) ?? null : null };
}

export type ItemFolha = {
  id: string; colaborador_id: string; empregador: string; cod_fornecedor: string; matricula_escritorio: string | null; nome: string;
  cpf: string | null; agencia: string | null; conta: string | null; forma_pagamento: FormaPagamento;
  liquido: number; ferias_acrescimos: number; decimo_terceiro: number; avulso: number; avulso_motivo: string | null; observacao: string | null;
  valor: number; pix_pago_em: string | null;
};
const COLUNAS_ITEM = "id, colaborador_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta, forma_pagamento, liquido, ferias_acrescimos, decimo_terceiro, avulso, avulso_motivo, observacao, valor, pix_pago_em";
const NUMERICOS = ["liquido", "ferias_acrescimos", "decimo_terceiro", "avulso", "valor"] as const;

export async function lerItens(supabase: Cliente, competenciaId: string): Promise<ItemFolha[]> {
  const { data } = await supabase.from("rh_fp_itens").select(COLUNAS_ITEM).eq("competencia_id", competenciaId).order("empregador").order("nome");
  return ((data ?? []) as Record<string, unknown>[]).map((i) => ({ ...i, ...Object.fromEntries(NUMERICOS.map((k) => [k, Number(i[k])])) }) as ItemFolha);
}

export type TotaisMesFolha = { pessoas: number; total: number; porEmpresa: Record<string, number>; decimo: number; avulso: number };

/** Totais de cada mês do ano (centavos): folha do escritório (líquido + férias) por empresa empregadora, 13º e avulso à parte;
 *  empresas + 13º + avulso = total (como a planilha do RH). */
export async function totaisDoAno(supabase: Cliente, ids: string[]): Promise<Map<string, TotaisMesFolha>> {
  const m = new Map<string, TotaisMesFolha>();
  if (!ids.length) return m;
  const { data } = await supabase.from("rh_fp_itens").select("competencia_id, empregador, liquido, ferias_acrescimos, decimo_terceiro, avulso, valor").in("competencia_id", ids);
  const cent = (v: unknown) => Math.round(Number(v) * 100);
  for (const i of data ?? []) {
    const t = m.get(i.competencia_id as string) ?? { pessoas: 0, total: 0, porEmpresa: {}, decimo: 0, avulso: 0 };
    const c = cent(i.valor);
    if (c > 0) t.pessoas++;
    t.total += c;
    t.decimo += cent(i.decimo_terceiro);
    t.avulso += cent(i.avulso);
    t.porEmpresa[i.empregador as string] = (t.porEmpresa[i.empregador as string] ?? 0) + cent(i.liquido) + cent(i.ferias_acrescimos);
    m.set(i.competencia_id as string, t);
  }
  return m;
}

export type ImportacaoLinha = { id: string; empregador: string; calculo: string; natureza: string; arquivo_nome: string | null; pessoas: number; total: number; aplicadas: number; ligadas: number; sem_cadastro: { codigo: string; nome: string; valor: number }[]; importado_em: string; importado_por_nome: string | null };

/** Arquivos do escritório importados no mês (mais novo primeiro). */
export async function lerImportacoes(supabase: Cliente, competenciaId: string): Promise<ImportacaoLinha[]> {
  const { data } = await supabase.from("rh_fp_importacoes").select("id, empregador, calculo, natureza, arquivo_nome, pessoas, total, aplicadas, ligadas, sem_cadastro, importado_em, importado_por").eq("competencia_id", competenciaId).order("importado_em", { ascending: false });
  const ids = [...new Set((data ?? []).map((i) => i.importado_por).filter(Boolean))] as string[];
  const { data: perfis } = ids.length ? await supabase.from("perfis").select("id, nome").in("id", ids) : { data: [] };
  const nome = new Map((perfis ?? []).map((p) => [p.id as string, p.nome as string]));
  return (data ?? []).map((i) => ({ ...(i as Omit<ImportacaoLinha, "total" | "importado_por_nome">), total: Number(i.total), importado_por_nome: i.importado_por ? nome.get(i.importado_por) ?? null : null }));
}

// ---------------------------------------------------------------- Consistem (0521)

export type LancamentoFolhaLinha = { id: string; item_id: string; tipo: TipoTitulo; lote: string; situacao: "reservado" | "enviando" | "lancado" | "erro"; cod_lancamento_erp: string | null; erro: string | null; valor: number; criado_em: string };

export async function lerLancamentos(supabase: Cliente, competenciaId: string): Promise<LancamentoFolhaLinha[]> {
  const { data } = await supabase.from("rh_fp_lancamentos_erp").select("id, item_id, tipo, lote, situacao, cod_lancamento_erp, erro, valor, criado_em").eq("competencia_id", competenciaId).order("criado_em");
  return ((data ?? []) as (LancamentoFolhaLinha & { valor: string | number })[]).map((l) => ({ ...l, valor: Number(l.valor) }));
}

// ---------------------------------------------------------------- recibos avulsos (0514)


export async function lerRubricas(supabase: Cliente, soAtivas = true): Promise<(Rubrica & { ordem: number; ativo: boolean })[]> {
  let q = supabase.from("rh_fp_rubricas").select("codigo, descricao, natureza, forma, parametro, pct_campo, ordem, ativo").order("ordem");
  if (soAtivas) q = q.eq("ativo", true);
  const { data } = await q;
  return (data ?? []) as (Rubrica & { ordem: number; ativo: boolean })[];
}

export async function lerVigencias(supabase: Cliente): Promise<Vigencia[]> {
  const { data } = await supabase.from("rh_parametros").select("chave, valor, vigente_desde").order("chave").order("vigente_desde");
  return (data ?? []).map((v) => ({ chave: v.chave as ChaveParametro, valor: Number(v.valor), vigente_desde: v.vigente_desde as string }));
}

export type PessoaRecibo = { id: string; cod_fornecedor: string; nome: string; empregador: string; cpf: string | null; funcao: string | null; salario: number | null; insalubridade_pct: number; adicional_noturno_pct: number; ativo: boolean };

export async function lerPessoasRecibo(supabase: Cliente): Promise<PessoaRecibo[]> {
  const { data } = await supabase.from("rh_colaboradores").select("id, cod_fornecedor, nome, empregador, cpf, funcao, salario, insalubridade_pct, adicional_noturno_pct, ativo")
    .not("cod_fornecedor", "is", null).order("nome");   // sem nº de fornecedor (cadastro a completar) não entra na folha
  return (data ?? []).map((p) => ({ ...(p as PessoaRecibo), salario: p.salario === null ? null : Number(p.salario) }));
}

export type LinhaRecibo = { ordem: number; rubrica: string; descricao: string; natureza: "provento" | "desconto"; referencia: number; valor: number };
export type Recibo = {
  id: string; competencia: string; colaborador_id: string; tipo: TipoRecibo; salario: number | null; funcao: string | null; insalubridade_pct: number; adicional_noturno_pct: number;
  periodo_inicio: string | null; periodo_fim: string | null; mensagem: string | null; proventos: number; descontos: number; total: number;
  cancelado: boolean; cancelado_motivo: string | null; criado_em: string; linhas: LinhaRecibo[];
  nome: string; cod_fornecedor: string; cpf: string | null; empregador: string;
};

/** Recibos de uma competência (ou um recibo pelo id), com linhas e dados da pessoa. */
export async function lerRecibos(supabase: Cliente, filtro: { competencia?: string; id?: string; incluirCancelados?: boolean }): Promise<Recibo[]> {
  let q = supabase.from("rh_fp_recibos").select("id, competencia, colaborador_id, tipo, salario, funcao, insalubridade_pct, adicional_noturno_pct, periodo_inicio, periodo_fim, mensagem, proventos, descontos, total, cancelado, cancelado_motivo, criado_em").order("criado_em");
  if (filtro.competencia) q = q.eq("competencia", filtro.competencia);
  if (filtro.id) q = q.eq("id", filtro.id);
  if (!filtro.incluirCancelados) q = q.eq("cancelado", false);
  const { data } = await q;
  const recibos = data ?? [];
  if (!recibos.length) return [];
  const [{ data: linhas }, { data: pessoas }] = await Promise.all([
    supabase.from("rh_fp_recibo_linhas").select("recibo_id, ordem, rubrica, descricao, natureza, referencia, valor").in("recibo_id", recibos.map((r) => r.id)).order("ordem"),
    supabase.from("rh_colaboradores").select("id, nome, cod_fornecedor, cpf, empregador").in("id", [...new Set(recibos.map((r) => r.colaborador_id))]),
  ]);
  const pessoa = new Map((pessoas ?? []).map((p) => [p.id as string, p]));
  return recibos.map((r) => {
    const p = pessoa.get(r.colaborador_id as string);
    return {
      ...(r as Omit<Recibo, "linhas" | "nome" | "cod_fornecedor" | "cpf" | "empregador">),
      salario: r.salario === null ? null : Number(r.salario), proventos: Number(r.proventos), descontos: Number(r.descontos), total: Number(r.total),
      linhas: (linhas ?? []).filter((l) => l.recibo_id === r.id).map((l) => ({ ...(l as LinhaRecibo), referencia: Number(l.referencia), valor: Number(l.valor) })),
      nome: (p?.nome as string) ?? "", cod_fornecedor: (p?.cod_fornecedor as string) ?? "", cpf: (p?.cpf as string | null) ?? null, empregador: (p?.empregador as string) ?? "",
    } as Recibo;
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type Modelo = { colaborador_id: string; linhas: { rubrica: string; referencia: number; valor?: number | null }[]; ativo: boolean };
export async function lerModelos(supabase: Cliente): Promise<Modelo[]> {
  const { data } = await supabase.from("rh_fp_recibo_modelos").select("colaborador_id, linhas, ativo");
  return (data ?? []) as Modelo[];
}
