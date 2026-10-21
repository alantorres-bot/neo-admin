// Leituras do líder: só pelas funções do banco (o líder não lê as tabelas rh_pt_*).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatusLote, Tipo } from "@/lib/modulos/rh/ponto/modulo";

export type LoteDoLider = {
  id: string; setor: string; periodo_inicio: string; periodo_fim: string; status: StatusLote; prazo: string | null; devolvido_motivo: string | null;
  justificado_em: string | null; ocorrencias: number; justificadas: number;
};

export type OcorrenciaDoLider = {
  id: string; ordem: number; nome: string; cargo: string | null; data: string; dia_semana: string; previsto: string; marcacoes: string[]; falta: boolean;
  falta_atraso_min: number; tipo: Tipo | null; horario: string | null; observacao: string | null;
};

export async function lerLotesDoLider(supabase: SupabaseClient): Promise<LoteDoLider[]> {
  const { data } = await supabase.rpc("rh_pt_lotes_do_lider");
  return (data ?? []) as LoteDoLider[];
}

export async function lerOcorrenciasDoLider(supabase: SupabaseClient, lote: string): Promise<OcorrenciaDoLider[] | null> {
  const { data, error } = await supabase.rpc("rh_pt_ocorrencias_do_lider", { p_lote: lote });
  return error ? null : ((data ?? []) as OcorrenciaDoLider[]);
}
