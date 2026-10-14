// Leituras do módulo Folha de pagamento (RLS de quem chama; nada é gravado aqui).
import type { FormaPagamento } from "@/lib/modulos/rh/colaboradores/modulo";
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

/** Totais de cada mês do ano, por empresa empregadora. */
export async function totaisDoAno(supabase: Cliente, ids: string[]): Promise<Map<string, { pessoas: number; total: number; porEmpresa: Record<string, number> }>> {
  const m = new Map<string, { pessoas: number; total: number; porEmpresa: Record<string, number> }>();
  if (!ids.length) return m;
  const { data } = await supabase.from("rh_fp_itens").select("competencia_id, empregador, valor").in("competencia_id", ids);
  for (const i of data ?? []) {
    const t = m.get(i.competencia_id as string) ?? { pessoas: 0, total: 0, porEmpresa: {} };
    const c = Math.round(Number(i.valor) * 100);
    if (c > 0) t.pessoas++;
    t.total += c;
    t.porEmpresa[i.empregador as string] = (t.porEmpresa[i.empregador as string] ?? 0) + c;
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
