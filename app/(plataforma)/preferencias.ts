"use server";

import { revalidatePath } from "next/cache";
import { ehChavePreferencia } from "@/lib/nucleo/preferencias";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type ResultadoPreferencia = { ok: true } | { ok: false; erro: string };

/** Grava uma preferência lógica da própria pessoa (a RLS só deixa gravar em nome de quem está logado). Só chaves conhecidas. */
export async function salvarPreferenciaBooleana(chave: string, valor: boolean): Promise<ResultadoPreferencia> {
  if (!ehChavePreferencia(chave) || typeof valor !== "boolean") return { ok: false, erro: "Preferência inválida." };
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("preferencias_usuario").upsert({ perfil_id: sessao.perfil.id, chave, valor }, { onConflict: "perfil_id,chave" });
  if (error) return { ok: false, erro: "Não foi possível salvar a preferência." };
  revalidatePath("/financeiro/recebiveis");
  return { ok: true };
}
