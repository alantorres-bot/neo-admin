"use server";

// Ações do Portal do Líder. A trava de verdade é do banco (rh_ld_solicitar / rh_ld_cancelar conferem a liderança);
// aqui só se valida o formulário. O arquivo do atestado sobe pelo navegador (enviarAnexo), depois que o pedido existe.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ESQUEMAS, ROTA_PEDIDOS_RH, ROTA_PORTAL_LIDER, TIPOS } from "@/lib/modulos/rh/portal-lider/modulo";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; id: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível enviar. Tente novamente.");

const entrada = z.object({ setor: z.string().uuid(), colaborador: z.string().uuid().nullable(), tipo: z.enum(TIPOS), dados: z.record(z.string(), z.unknown()) });

export async function solicitar(e: z.input<typeof entrada>): Promise<Resultado> {
  await exigirSessao();
  const v = entrada.safeParse(e);
  if (!v.success) return { ok: false, erro: "Pedido inválido." };
  const { setor, colaborador, tipo } = v.data;
  if ((tipo === "contratacao") !== (colaborador === null)) return { ok: false, erro: tipo === "contratacao" ? "Contratação não tem funcionário." : "Escolha o funcionário." };
  const dados = ESQUEMAS[tipo].safeParse(v.data.dados);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_ld_solicitar", { p_setor: setor, p_colaborador: colaborador, p_tipo: tipo, p_dados: dados.data });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_PORTAL_LIDER, "layout");
  revalidatePath(ROTA_PEDIDOS_RH, "layout");
  return { ok: true, id: data as string };
}

export async function cancelar(id: string): Promise<Resultado> {
  await exigirSessao();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, erro: "Pedido inválido." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_ld_cancelar", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_PORTAL_LIDER, "layout");
  revalidatePath(ROTA_PEDIDOS_RH, "layout");
  return { ok: true, id };
}
