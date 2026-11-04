"use server";

// Ações do Portal do Líder. A trava de verdade é do banco (rh_ld_solicitar / rh_ld_cancelar conferem a liderança);
// aqui só se valida o formulário. O arquivo do atestado sobe pelo navegador (enviarAnexo), depois que o pedido existe.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailDoPedido, ESQUEMAS, ROTA_PEDIDOS_RH, ROTA_PORTAL_LIDER, TIPOS } from "@/lib/modulos/rh/portal-lider/modulo";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerPortal, meusSetores } from "./dados";

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

/**
 * Envia o pedido por e-mail ao RH, do Gmail do próprio líder (Edge rh-ld-enviar-email, 0527). Chamada logo depois de criar o
 * pedido (e de subir o atestado) e pelo botão "Reenviar e-mail" quando falhou. O pedido já está gravado de qualquer jeito.
 */
export async function enviarEmail(setor: string, id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  await exigirSessao();
  if (!z.string().uuid().safeParse(setor).success || !z.string().uuid().safeParse(id).success) return { ok: false, erro: "Pedido inválido." };
  const supabase = await criarClienteServidor();
  const [setores, { pedidos }] = await Promise.all([meusSetores(supabase), lerPortal(supabase, setor)]);
  const pedido = pedidos.find((p) => p.id === id);
  const nomeSetor = setores.find((s) => s.id === setor)?.nome;
  if (!pedido || !nomeSetor) return { ok: false, erro: "Pedido não encontrado." };
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const texto = emailDoPedido({ tipo: pedido.tipo, dados: pedido.dados, pessoa: pedido.pessoa ?? "", setor: nomeSetor, link: `${base}${ROTA_PEDIDOS_RH}/${id}` });
  const { data, error } = await supabase.functions.invoke("rh-ld-enviar-email", { body: { pedido_id: id, ...texto } });
  revalidatePath(ROTA_PORTAL_LIDER, "layout");
  if (!error && !(data && typeof data === "object" && "erro" in data)) return { ok: true };
  let erro = "Não foi possível enviar o e-mail ao RH.";
  const resposta = error ? (error as { context?: Response }).context : undefined;
  try {
    if (resposta && typeof resposta.json === "function") erro = ((await resposta.json()) as { erro?: string }).erro ?? erro;
    else if (data && typeof data === "object" && "erro" in data) erro = String((data as { erro: unknown }).erro);
  } catch { /* mantém a mensagem genérica */ }
  return { ok: false, erro };
}
