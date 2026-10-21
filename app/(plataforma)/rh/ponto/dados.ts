// Leituras do RH > Ponto (com a RLS de quem chama: só a área RH lê as tabelas rh_pt_*).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatusLote, Tipo } from "@/lib/modulos/rh/ponto/modulo";

type Cliente = SupabaseClient;

export type Setor = { id: string; nome: string; responsavel_nome: string | null; email: string; email_copia: string | null; ativo: boolean };

export type Lote = {
  id: string; setor_id: string; setor: string; periodo_inicio: string; periodo_fim: string; status: StatusLote; arquivo_nome: string; prazo: string | null;
  importado_em: string; enviado_em: string | null; lembrete_em: string | null; devolvido_em: string | null; devolvido_motivo: string | null;
  justificado_em: string | null; justificado_nome: string | null; chave: string; concluido_em: string | null; cancelado_motivo: string | null;
  ocorrencias: number; justificadas: number; ajustadas: number;
};

export type Ocorrencia = {
  id: string; ordem: number; colaborador_id: string | null; nome: string; matricula: string | null; cargo: string | null; data: string; dia_semana: string;
  previsto: string; marcacoes: string[]; falta: boolean; falta_atraso_min: number; total_normais_min: number | null; extras_min: number; banco_saldo_min: number | null;
  tipo: Tipo | null; horario: string | null; observacao: string | null; justificado_em: string | null; ajustado_em: string | null; ajustado_por_nome: string | null;
};

const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function lerSetores(supabase: Cliente): Promise<Setor[]> {
  const { data } = await supabase.from("rh_pt_setores").select("id, nome, responsavel_nome, email, email_copia, ativo").order("nome");
  return (data ?? []) as Setor[];
}

const COLUNAS_LOTE = "id, setor_id, periodo_inicio, periodo_fim, status, arquivo_nome, prazo, importado_em, enviado_em, lembrete_em, devolvido_em, devolvido_motivo, justificado_em, justificado_nome, chave, concluido_em, cancelado_motivo, setor:rh_pt_setores(nome)";

type LinhaLote = Omit<Lote, "setor" | "ocorrencias" | "justificadas" | "ajustadas"> & { setor: { nome: string } | { nome: string }[] | null };

async function comContagens(supabase: Cliente, linhas: LinhaLote[]): Promise<Lote[]> {
  const ids = linhas.map((l) => l.id);
  const { data: ocs } = ids.length
    ? await supabase.from("rh_pt_ocorrencias").select("lote_id, tipo, ajustado_em").in("lote_id", ids)
    : { data: [] };
  return linhas.map((l) => {
    const minhas = (ocs ?? []).filter((o) => o.lote_id === l.id);
    const { setor, ...resto } = l;
    return {
      ...resto, setor: um(setor)?.nome ?? "",
      ocorrencias: minhas.length, justificadas: minhas.filter((o) => o.tipo).length, ajustadas: minhas.filter((o) => o.ajustado_em).length,
    };
  });
}

export async function lerLotes(supabase: Cliente, ano: number): Promise<Lote[]> {
  const { data } = await supabase.from("rh_pt_lotes").select(COLUNAS_LOTE)
    .gte("periodo_inicio", `${ano - 1}-12-01`).lte("periodo_inicio", `${ano}-12-31`)
    .order("periodo_inicio", { ascending: false }).order("importado_em", { ascending: false });
  return comContagens(supabase, (data ?? []) as unknown as LinhaLote[]);
}

export async function lerLote(supabase: Cliente, id: string): Promise<Lote | null> {
  const { data } = await supabase.from("rh_pt_lotes").select(COLUNAS_LOTE).eq("id", id).maybeSingle();
  return data ? (await comContagens(supabase, [data as unknown as LinhaLote]))[0] : null;
}

export async function lerOcorrencias(supabase: Cliente, loteId: string): Promise<Ocorrencia[]> {
  const { data } = await supabase.from("rh_pt_ocorrencias")
    .select("id, ordem, colaborador_id, nome, matricula, cargo, data, dia_semana, previsto, marcacoes, falta, falta_atraso_min, total_normais_min, extras_min, banco_saldo_min, tipo, horario, observacao, justificado_em, ajustado_em, ajustado:perfis!rh_pt_ocorrencias_ajustado_por_fkey(nome)")
    .eq("lote_id", loteId).order("ordem");
  return (data ?? []).map(({ ajustado, ...o }) => ({ ...o, ajustado_por_nome: um(ajustado as { nome: string } | { nome: string }[] | null)?.nome ?? null })) as Ocorrencia[];
}

/** Atestados/declarações anexados às ocorrências do lote (anexos do núcleo, tipo 'atestado'). */
export async function lerAtestados(supabase: Cliente, ocorrencias: readonly string[]): Promise<Map<string, { id: string; nome_arquivo: string; arquivo_path: string }[]>> {
  const mapa = new Map<string, { id: string; nome_arquivo: string; arquivo_path: string }[]>();
  if (!ocorrencias.length) return mapa;
  const { data } = await supabase.from("anexos").select("id, referencia_id, nome_arquivo, arquivo_path")
    .eq("referencia_tabela", "rh_pt_ocorrencias").in("referencia_id", [...ocorrencias]).order("enviado_em");
  for (const a of data ?? []) mapa.set(a.referencia_id as string, [...(mapa.get(a.referencia_id as string) ?? []), a as { id: string; nome_arquivo: string; arquivo_path: string }]);
  return mapa;
}

export async function lerPrazoDias(supabase: Cliente): Promise<number> {
  const { data } = await supabase.from("configuracoes").select("valor").eq("chave", "rh.ponto.prazo_dias_uteis").maybeSingle();
  const n = Number(data?.valor);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export async function lerColaboradores(supabase: Cliente): Promise<{ id: string; nome: string; ativo: boolean }[]> {
  const { data } = await supabase.from("rh_colaboradores").select("id, nome, ativo").order("nome");
  return (data ?? []) as { id: string; nome: string; ativo: boolean }[];
}
