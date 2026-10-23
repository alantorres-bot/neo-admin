"use server";

// Avisos da Central (Slack) e envio ao ClickUp: configuração e disparo manual. Só admin geral (o banco e as funções
// também exigem).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { EVENTOS_AVISO } from "@/lib/nucleo/gestao/avisos";
import { exigirAdminGeral, exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const esquema = z.object({
  canal: z.union([z.literal(""), z.string().regex(/^[CG][A-Z0-9]{6,}$/, "ID do canal do Slack inválido (ex.: C0123ABCD).")]),
  horario: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Horário inválido (hh:mm)."),
  clickup_lista: z.union([z.literal(""), z.string().regex(/^[0-9]{4,}$/, "ID da lista do ClickUp inválido (só números).")]),
});

export async function salvarAvisos(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral();
  const entrada = esquema.safeParse({ canal: String(dados.get("canal") ?? "").trim(), horario: String(dados.get("horario") ?? ""), clickup_lista: String(dados.get("clickup_lista") ?? "").trim() });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const eventos = Object.fromEntries(EVENTOS_AVISO.map((e) => [e.codigo, dados.get(`evento_${e.codigo}`) === "on"]));
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("central_salvar_notificacoes", {
    p: { ligadas: dados.get("ligadas") === "on", eventos, canal: entrada.data.canal, horario: entrada.data.horario, clickup_lista: entrada.data.clickup_lista },
  });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath("/gestao/notificacoes");
  return { ok: true, chave: Date.now() };
}

/** Roda a rotina de lembretes/resumo e chama a função de envio (Slack) ou a do ClickUp. */
export async function enviarAgora(destino: "slack" | "clickup"): Promise<{ ok: true; resumo: string } | { ok: false; erro: string }> {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  if (destino === "slack") {
    const rotina = await supabase.rpc("central_avisos_rotina");
    if (rotina.error) return { ok: false, erro: mensagemDeErroBanco(rotina.error) };
  }
  const { data, error } = await supabase.functions.invoke(destino === "slack" ? "nucleo-notificacoes-enviar" : "nucleo-clickup-enviar", { body: { acao: "enviar" } });
  let resposta = data as Record<string, unknown> | null;
  if (error) {
    const contexto = (error as { context?: Response }).context;
    try { resposta = contexto && typeof contexto.json === "function" ? ((await contexto.json()) as Record<string, unknown>) : null; } catch { resposta = null; }
    const detalhe = resposta?.detalhe ?? resposta?.erro;
    return { ok: false, erro: detalhe ? String(detalhe) : "A função de envio não respondeu (verifique se foi publicada)." };
  }
  revalidatePath("/gestao/notificacoes");
  if (resposta?.motivo) return { ok: true, resumo: String(resposta.motivo) };
  return {
    ok: true,
    resumo: destino === "slack"
      ? `Enviados: ${resposta?.enviados ?? 0} · ignorados: ${resposta?.ignorados ?? 0} · falhas: ${resposta?.falhas ?? 0}`
      : `Tarefas criadas no ClickUp: ${resposta?.criadas ?? 0}`,
  };
}

/** Gestor marca ou desmarca "enviar ao ClickUp" numa pendência (o gatilho do banco exige gestor da área). */
export async function marcarClickup(id: string, enviar: boolean): Promise<{ ok: true } | { ok: false; erro: string }> {
  await exigirSessao();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, erro: "Pendência inválida." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("pendencias").update({ clickup_enviar: enviar }).eq("id", id).select("id");
  if (error) return { ok: false, erro: mensagemDeErroBanco(error) };
  if (!data?.length) return { ok: false, erro: "Você não tem permissão para alterar esta pendência." };
  revalidatePath(`/gestao/${id}`);
  return { ok: true };
}
