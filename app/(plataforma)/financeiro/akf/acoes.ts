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

const esquemaParcial = z.object({
  tituloId: z.string().uuid(),
  valor: z.number().positive("Informe o valor antecipado.").max(999_999_999, "Valor alto demais."),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento da parte antecipada."),
  dataOperacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  observacao: z.string().trim().max(300).default(""),
});

/**
 * Antecipação PARCIAL de um título (o Consistem não desdobra o título em Contas a Receber): registra a parte na AKF, com o
 * valor e o vencimento dela, e o que resta fica disponível na carteira. Função de banco `akf_desdobrar_titulo`, com a RLS de quem chama.
 */
export async function desdobrarTitulo(entrada: z.input<typeof esquemaParcial>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode registrar antecipações." };
  const dados = esquemaParcial.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { tituloId, valor, vencimento, dataOperacao, observacao } = dados.data;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("akf_desdobrar_titulo", {
    p_titulo: tituloId, p_valor: valor, p_vencimento: vencimento, p_data_operacao: dataOperacao, p_descricao: observacao || null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/akf");
  revalidatePath("/financeiro/recebiveis", "layout");
  return { ok: true, aviso: "Antecipação parcial registrada." };
}

/** Encerra uma parte antecipada (recompra, liquidação ou lançamento errado). O motivo é obrigatório e fica no histórico. */
export async function encerrarParte(entrada: { id: string; motivo: string }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode encerrar antecipações." };
  const dados = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(5, "Informe o motivo do encerramento.").max(300) }).safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("akf_encerrar_desdobramento", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/akf");
  revalidatePath("/financeiro/recebiveis", "layout");
  return { ok: true, aviso: "Antecipação parcial encerrada." };
}

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
