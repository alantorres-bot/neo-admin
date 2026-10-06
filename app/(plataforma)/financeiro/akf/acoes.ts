"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

const esquema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Marque pelo menos um título.").max(100, "No máximo 100 títulos de uma vez."),
  cedido: z.boolean(),
  observacao: z.string().trim().max(300).default(""),
});

/**
 * Marca (ou retira) títulos como "na AKF" à mão, quando o portador ainda não foi atualizado no Consistem. Tudo ou nada, na
 * função de banco `akf_marcar_cedido` (com a RLS de quem chama). Título cedido sai da régua de cobrança de Recebíveis.
 */
export async function marcarNaAkf(entrada: z.input<typeof esquema>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode marcar títulos." };
  const dados = esquema.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { ids, cedido, observacao } = dados.data;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("akf_marcar_cedido", { p_titulos: ids, p_cedido: cedido, p_descricao: observacao || null });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/akf");
  revalidatePath("/financeiro/recebiveis", "layout");
  const n = ids.length;
  return { ok: true, aviso: `${n} ${n === 1 ? "título" : "títulos"} ${cedido ? "marcado" + (n === 1 ? "" : "s") + " como na AKF" : "retirado" + (n === 1 ? "" : "s") + " da AKF"}.` };
}
