// Leituras do módulo Vale-transporte (RLS de quem chama; nada é gravado aqui).
import type { FormaPagamento } from "@/lib/modulos/rh/vale-transporte/modulo";
import { lerCodigosLancamento, type CodigosLancamento } from "@/lib/modulos/rh/vale-transporte/lancamento";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const numero = (v: number | string | null) => (v === null ? null : Number(v));

// ---------------------------------------------------------------- empresas

/** Empresas com código no Consistem (onde estão os fornecedores). */
export async function lerEmpresas(supabase: Cliente): Promise<{ id: string; nome: string }[]> {
  const { data } = await supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string }));
}

// ---------------------------------------------------------------- meses

export type StatusMes = "aberta" | "enviada" | "aprovada" | "paga";
export const ROTULO_STATUS: Record<StatusMes, string> = { aberta: "Aberto", enviada: "Enviado para aprovação", aprovada: "Aprovado", paga: "Pago" };

export type MesLinha = {
  id: string; competencia: string; dias_uteis_padrao: number; data_pagamento: string; prazo_fechamento: string; status: StatusMes; importada: boolean;
  enviada_em: string | null; aprovada_em: string | null; paga_em: string | null; reaberta_em: string | null; reaberta_motivo: string | null;
  arquivo_bb_gerado_em: string | null;
  enviada_por_nome?: string | null; aprovada_por_nome?: string | null;
};
const COLUNAS_MES = "id, competencia, dias_uteis_padrao, data_pagamento, prazo_fechamento, status, importada, enviada_em, aprovada_em, paga_em, reaberta_em, reaberta_motivo, arquivo_bb_gerado_em, enviada_por, aprovada_por";

export async function lerMeses(supabase: Cliente, ano: number): Promise<MesLinha[]> {
  const { data } = await supabase.from("rh_vt_competencias").select(COLUNAS_MES).gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`).order("competencia");
  return (data ?? []) as MesLinha[];
}

export async function lerMes(supabase: Cliente, id: string): Promise<MesLinha | null> {
  const { data } = await supabase.from("rh_vt_competencias").select(COLUNAS_MES).eq("id", id).maybeSingle();
  if (!data) return null;
  const ids = [data.enviada_por, data.aprovada_por].filter(Boolean) as string[];
  const { data: perfis } = ids.length ? await supabase.from("perfis").select("id, nome").in("id", ids) : { data: [] };
  const nome = new Map((perfis ?? []).map((p) => [p.id as string, p.nome as string]));
  return { ...(data as MesLinha), enviada_por_nome: data.enviada_por ? nome.get(data.enviada_por) ?? null : null, aprovada_por_nome: data.aprovada_por ? nome.get(data.aprovada_por) ?? null : null };
}

export type ItemLinha = {
  id: string; colaborador_id: string; empresa_id: string; empregador: string; cod_fornecedor: string; nome: string; cpf: string | null; agencia: string | null; conta: string | null;
  forma_pagamento: FormaPagamento; tarifa: number | null; valor_fixo: number | null; passagens_dia: number;
  dias_uteis: number; faltas: number; atestados: number; extras: number;
  ferias_inicio: string | null; ferias_fim: string | null; afastamento_inicio: string | null; afastamento_fim: string | null;
  abat_dias: number; abat_valor: number; abat_motivo: string | null; sem_vt: boolean; sem_vt_motivo: string | null; observacao: string | null;
  dias_ferias: number; dias_afastamento: number; dias_pagos: number; valor: number; pix_pago_em: string | null; importado: boolean;
};
const COLUNAS_ITEM = "id, colaborador_id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, tarifa, valor_fixo, passagens_dia, dias_uteis, faltas, atestados, extras, ferias_inicio, ferias_fim, afastamento_inicio, afastamento_fim, abat_dias, abat_valor, abat_motivo, sem_vt, sem_vt_motivo, observacao, dias_ferias, dias_afastamento, dias_pagos, valor, pix_pago_em, importado";

type ItemBruto = Omit<ItemLinha, "tarifa" | "valor_fixo" | "abat_valor" | "valor"> & { tarifa: number | string | null; valor_fixo: number | string | null; abat_valor: number | string; valor: number | string };

export async function lerItens(supabase: Cliente, competenciaId: string): Promise<ItemLinha[]> {
  const { data } = await supabase.from("rh_vt_itens").select(COLUNAS_ITEM).eq("competencia_id", competenciaId).order("empregador").order("nome");
  return ((data ?? []) as ItemBruto[]).map((i) => ({ ...i, tarifa: numero(i.tarifa), valor_fixo: numero(i.valor_fixo), abat_valor: Number(i.abat_valor), valor: Number(i.valor) }));
}

/** Totais de cada mês do ano (para a grade de meses). */
export async function totaisDoAno(supabase: Cliente, competenciaIds: string[]): Promise<Map<string, { pessoas: number; total: number; fopag: number; pix: number }>> {
  const m = new Map<string, { pessoas: number; total: number; fopag: number; pix: number }>();
  if (!competenciaIds.length) return m;
  const { data } = await supabase.from("rh_vt_itens").select("competencia_id, forma_pagamento, valor").in("competencia_id", competenciaIds);
  for (const i of data ?? []) {
    const t = m.get(i.competencia_id as string) ?? { pessoas: 0, total: 0, fopag: 0, pix: 0 };
    const v = Math.round(Number(i.valor) * 100);
    if (v > 0) t.pessoas++;
    t.total += v;
    if (i.forma_pagamento === "fopag") t.fopag += v; else t.pix += v;
    m.set(i.competencia_id as string, t);
  }
  for (const t of m.values()) { t.total /= 100; t.fopag /= 100; t.pix /= 100; }
  return m;
}

/** Resumo do ano: valor por colaborador e mês. */
export async function lerResumoAno(supabase: Cliente, ano: number): Promise<{ meses: MesLinha[]; linhas: { colaborador_id: string; cod_fornecedor: string; nome: string; valores: Record<string, number> }[] }> {
  const meses = await lerMeses(supabase, ano);
  if (!meses.length) return { meses, linhas: [] };
  const { data } = await supabase.from("rh_vt_itens").select("competencia_id, colaborador_id, cod_fornecedor, nome, valor").in("competencia_id", meses.map((m) => m.id));
  const competenciaDe = new Map(meses.map((m) => [m.id, m.competencia]));
  const porPessoa = new Map<string, { colaborador_id: string; cod_fornecedor: string; nome: string; valores: Record<string, number> }>();
  for (const i of data ?? []) {
    const p = porPessoa.get(i.colaborador_id as string) ?? { colaborador_id: i.colaborador_id as string, cod_fornecedor: i.cod_fornecedor as string, nome: i.nome as string, valores: {} };
    p.valores[competenciaDe.get(i.competencia_id as string)!] = Number(i.valor);
    p.nome = i.nome as string;
    porPessoa.set(p.colaborador_id, p);
  }
  return { meses, linhas: [...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) };
}

// ---------------------------------------------------------------- Consistem

export type LancamentoVtLinha = { id: string; item_id: string; lote: string; situacao: "reservado" | "enviando" | "lancado" | "erro"; cod_lancamento_erp: string | null; erro: string | null; valor: number; criado_em: string };

export async function lerLancamentos(supabase: Cliente, competenciaId: string): Promise<LancamentoVtLinha[]> {
  const { data } = await supabase.from("rh_vt_lancamentos_erp").select("id, item_id, lote, situacao, cod_lancamento_erp, erro, valor, criado_em").eq("competencia_id", competenciaId).order("criado_em");
  return ((data ?? []) as (LancamentoVtLinha & { valor: string | number })[]).map((l) => ({ ...l, valor: Number(l.valor) }));
}

export const CHAVE_LANCAR = "rh.vale_transporte.lancar_no_erp";
export const CHAVE_CODIGOS = "rh.vale_transporte.lancamento";

export async function lerParametros(supabase: Cliente): Promise<{ ligado: boolean; codigos: CodigosLancamento | null; bruto: Record<string, unknown> | null }> {
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", [CHAVE_LANCAR, CHAVE_CODIGOS]);
  const valor = (k: string) => (data ?? []).find((c) => c.chave === k)?.valor;
  const bruto = valor(CHAVE_CODIGOS);
  return { ligado: valor(CHAVE_LANCAR) === true, codigos: lerCodigosLancamento(bruto), bruto: bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : null };
}
