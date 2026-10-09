"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();

function revalidar(id: string) {
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  revalidatePath(`${ROTA_CONTAS_PAGAR}/autorizacoes/${id}`);
  revalidatePath("/financeiro/recebiveis/fila");
}

/** Gestor autoriza o rascunho (função de banco `cap_autorizar`): status muda e nasce a pendência de execução na Fila do dia. */
export async function autorizar(id: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode autorizar o pagamento." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Autorização inválida." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_autorizar", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(id);
  const r = (data ?? {}) as { numero?: number; itens?: number };
  return { ok: true, aviso: `Autorização nº ${r.numero} autorizada (${r.itens} ${r.itens === 1 ? "item" : "itens"}). A pendência de execução está na Fila do dia.` };
}

const esquemaMotivo = z.object({ id: uuid, motivo: z.string().trim().min(3, "Informe o motivo.").max(300, "O motivo pode ter até 300 caracteres.") });

/** Cancela (gestor; ou quem montou, enquanto rascunho). A pendência de execução é cancelada junto. Nada é apagado. */
export async function cancelar(entrada: z.input<typeof esquemaMotivo>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Sem permissão para cancelar." };
  const dados = esquemaMotivo.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_cancelar", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(dados.data.id);
  const r = (data ?? {}) as { numero?: number };
  return { ok: true, aviso: `Autorização nº ${r.numero} cancelada. Os itens voltam à lista de pendentes.` };
}

const esquemaRemover = z.object({ autorizacaoId: uuid, itemId: uuid, motivo: z.string().trim().min(3, "Informe o motivo.").max(300) });

/** Remove um item do rascunho (registro com motivo; nunca delete). */
export async function removerItem(entrada: z.input<typeof esquemaRemover>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode remover itens." };
  const dados = esquemaRemover.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_remover_item", { p_item: dados.data.itemId, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(dados.data.autorizacaoId);
  const r = (data ?? {}) as { restantes?: number };
  return { ok: true, aviso: r.restantes === 0 ? "Item removido. A autorização ficou sem itens: cancele-a ou volte à lista para gerar outra." : "Item removido do rascunho." };
}
