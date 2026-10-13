"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const esquema = z.object({ contraparteId: z.string().uuid(), exige: z.boolean() });

/** Marca o cliente que pede a carta de cessão de crédito quando o título é cedido à AKF (migration 0147). */
export async function definirCartaCessao(entrada: z.input<typeof esquema>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima altera o cadastro do cliente." };
  const dados = esquema.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: "Dados inválidos." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_cliente_definir_carta_cessao", { p_contraparte: dados.data.contraparteId, p_exige: dados.data.exige });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível salvar. Tente novamente." };
  revalidatePath(`/financeiro/recebiveis/clientes/${dados.data.contraparteId}`);
  revalidatePath("/financeiro/filial", "layout");
  return { ok: true, aviso: dados.data.exige ? "Cliente marcado: a carta de cessão entra no kit quando o título for cedido." : "Marca retirada: a carta de cessão deixa de ser exigida." };
}
