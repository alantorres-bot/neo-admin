"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_PEDIDOS_RH, ROTA_PORTAL_LIDER } from "@/lib/modulos/rh/portal-lider/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true } | { ok: false; erro: string };
const uuid = z.string().uuid();

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor"): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", nivel)) return { ok: false, erro: `Somente ${nivel} do RH (ou acima) pode fazer isso.` };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível salvar. Tente novamente." };
  revalidatePath(ROTA_PEDIDOS_RH, "layout");
  revalidatePath(ROTA_PORTAL_LIDER, "layout");
  return { ok: true };
}

const atendimento = z.object({ id: uuid, status: z.enum(["em_andamento", "concluida", "recusada"]), resposta: z.string().trim().max(2000) });

export async function atender(e: z.input<typeof atendimento>): Promise<Resultado> {
  const d = atendimento.safeParse(e);
  if (!d.success) return { ok: false, erro: "Pedido inválido." };
  if (d.data.status === "recusada" && d.data.resposta.length < 5) return { ok: false, erro: "Informe ao líder o motivo da recusa." };
  return chamar("rh_ld_atender", { p_id: d.data.id, p_status: d.data.status, p_resposta: d.data.resposta || null }, "operador");
}

export async function definirLideres(setor: string, perfis: string[]): Promise<Resultado> {
  if (!uuid.safeParse(setor).success || !z.array(uuid).max(20).safeParse(perfis).success) return { ok: false, erro: "Dados inválidos." };
  return chamar("rh_ld_definir_lideres", { p_setor: setor, p_perfis: perfis }, "gestor");
}

export async function salvarEmailRh(texto: string): Promise<Resultado> {
  const emails = texto.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
  if (!emails.length || emails.length > 5) return { ok: false, erro: "Informe de 1 a 5 e-mails do RH." };
  return chamar("rh_ld_salvar_email_rh", { p_emails: emails }, "gestor");
}
