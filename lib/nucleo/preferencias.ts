// Preferências por usuário (tabela `preferencias_usuario`, migration 0111). Cada pessoa lê e grava só as próprias (a RLS
// garante). As chaves conhecidas ficam aqui, para a ação de gravação não aceitar texto livre da tela.
import type { SupabaseClient } from "@supabase/supabase-js";

export const PREFERENCIAS = {
  /** Carteira de recebíveis: ocultar os vencidos há mais de 90 dias. */
  recebiveisOcultarVencidos90: "recebiveis.ocultar_vencidos_90",
} as const;

export type ChavePreferencia = (typeof PREFERENCIAS)[keyof typeof PREFERENCIAS];

export const ehChavePreferencia = (v: string): v is ChavePreferencia => (Object.values(PREFERENCIAS) as string[]).includes(v);

/** Lê uma preferência lógica (sim/não). Sem registro, ou se a leitura falhar, vale o padrão: a tela nunca quebra por isso. */
export async function lerPreferenciaBooleana(supabase: SupabaseClient, chave: ChavePreferencia, padrao = false): Promise<boolean> {
  const { data, error } = await supabase.from("preferencias_usuario").select("valor").eq("chave", chave).maybeSingle();
  if (error || !data) return padrao;
  return typeof data.valor === "boolean" ? data.valor : padrao;
}
