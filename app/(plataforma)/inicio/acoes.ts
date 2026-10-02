"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true } | { ok: false; erro: string };

const uuid = z.string().uuid();

/** Mensagens levantadas pelos gatilhos do banco (P0001) são nossas e em português; o resto é genérico. */
function mensagemDeErro(error: { code?: string; message: string }): string {
  return error.code === "P0001" ? error.message : "Não foi possível salvar. Tente novamente.";
}

async function atualizar(id: string, campos: Record<string, unknown>): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Pendência inválida." };
  await exigirSessao();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("pendencias").update(campos).eq("id", id).select("id");
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  // A RLS esconde (e não altera) o que o usuário não pode mexer: zero linhas = sem permissão.
  if (!data || data.length === 0) return { ok: false, erro: "Você não tem permissão para alterar esta pendência." };
  revalidatePath("/inicio");
  return { ok: true };
}

export async function concluirPendencia(id: string): Promise<Resultado> {
  return atualizar(id, { status: "concluida" });
}

export async function assumirPendencia(id: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  return atualizar(id, { responsavel_id: sessao.userId });
}

/** Só o gestor da área consegue (RLS + gatilho). `responsavelId` nulo deixa a pendência sem dono. */
export async function reatribuirPendencia(id: string, responsavelId: string | null): Promise<Resultado> {
  if (responsavelId !== null && !uuid.safeParse(responsavelId).success) return { ok: false, erro: "Responsável inválido." };
  return atualizar(id, { responsavel_id: responsavelId });
}
