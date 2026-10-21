// Leituras do RH > Banco de horas (RLS: só a área RH). O cálculo vem das views rh_bh_saldos e rh_bh_creditos (migration 0518).
import type { SupabaseClient } from "@supabase/supabase-js";

type Cliente = SupabaseClient;

export type Saldo = {
  pessoa_id: string; nome: string; setor_id: string | null; setor: string; colaborador_id: string | null;
  saldo_controlid_min: number | null; saldo_em: string | null; saldo_min: number; vencido_min: number; vencendo_min: number;
  proximo_vencimento: string | null; limite_negativo_min: number;
};

export type Parametros = { inicio: string; validadeMeses: number; avisoDias: number; limiteNegativoMin: number };

export async function lerParametros(supabase: Cliente): Promise<Parametros> {
  const { data } = await supabase.from("configuracoes").select("chave, valor").like("chave", "rh.banco_horas.%");
  const v = Object.fromEntries((data ?? []).map((c) => [String(c.chave).replace("rh.banco_horas.", ""), c.valor as unknown]));
  return { inicio: String(v.inicio ?? "2026-04-26"), validadeMeses: Number(v.validade_meses ?? 6), avisoDias: Number(v.aviso_dias ?? 30), limiteNegativoMin: Number(v.limite_negativo_min ?? 600) };
}

export async function lerSaldos(supabase: Cliente): Promise<Saldo[]> {
  const [{ data }, { data: setores }] = await Promise.all([
    supabase.from("rh_bh_saldos").select("pessoa_id, nome, setor_id, colaborador_id, saldo_controlid_min, saldo_em, saldo_min, vencido_min, vencendo_min, proximo_vencimento, limite_negativo_min").order("nome"),
    supabase.from("rh_pt_setores").select("id, nome"),
  ]);
  const nomeSetor = new Map((setores ?? []).map((s) => [s.id as string, s.nome as string]));
  return (data ?? []).map((s) => ({ ...s, setor: nomeSetor.get(s.setor_id as string) ?? "" })) as Saldo[];
}

export async function lerPessoa(supabase: Cliente, id: string) {
  const [saldo, movimentos, creditos, pagamentos] = await Promise.all([
    supabase.from("rh_bh_saldos").select("pessoa_id, nome, cpf, setor_id, saldo_controlid_min, saldo_em, saldo_min, vencido_min, vencendo_min, proximo_vencimento").eq("pessoa_id", id).maybeSingle(),
    supabase.from("rh_bh_movimentos").select("data, positivo_min, negativo_min").eq("pessoa_id", id).or("positivo_min.gt.0,negativo_min.gt.0").order("data", { ascending: false }),
    supabase.from("rh_bh_creditos").select("data, credito, restante, vencimento").eq("pessoa_id", id).order("data"),
    supabase.from("rh_bh_pagamentos").select("id, minutos, competencia, observacao, criado_em, cancelado_em, cancelado_motivo").eq("pessoa_id", id).order("criado_em", { ascending: false }),
  ]);
  if (!saldo.data) return null;
  return {
    saldo: saldo.data as Saldo & { cpf: string },
    movimentos: (movimentos.data ?? []) as { data: string; positivo_min: number; negativo_min: number }[],
    creditos: (creditos.data ?? []) as { data: string; credito: number; restante: number; vencimento: string }[],
    pagamentos: (pagamentos.data ?? []) as { id: string; minutos: number; competencia: string; observacao: string | null; criado_em: string; cancelado_em: string | null; cancelado_motivo: string | null }[],
  };
}

export async function lerImportacoes(supabase: Cliente) {
  const { data } = await supabase.from("rh_bh_importacoes")
    .select("id, periodo_inicio, periodo_fim, arquivo_nome, pessoas, movimentos, importado_em, quem:perfis!rh_bh_importacoes_importado_por_fkey(nome)")
    .order("importado_em", { ascending: false }).limit(100);
  const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
  return (data ?? []).map(({ quem, ...i }) => ({ ...i, quem: um(quem as unknown as { nome: string } | null)?.nome ?? "" })) as {
    id: string; periodo_inicio: string; periodo_fim: string; arquivo_nome: string; pessoas: number; movimentos: number; importado_em: string; quem: string;
  }[];
}
