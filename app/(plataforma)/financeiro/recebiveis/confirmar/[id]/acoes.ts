"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const esquema = z.object({
  tituloIds: z.array(z.string().uuid()).min(1, "Marque pelo menos uma parcela.").max(100),
  resultado: z.enum(["confirmou", "sem_resposta"]),
  canal: z.enum(["whatsapp", "telefone", "email", "interno"]),
  observacao: z.string().trim().max(500).default(""),
});

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

const ROTULO_CANAL = { whatsapp: "por WhatsApp", telefone: "por telefone", email: "por e-mail", interno: "por outro meio" } as const;

/**
 * Registra o resultado do contato com o cliente (função de banco `rec_registrar_confirmacao`, numa transação, com a RLS de
 * quem chama): "confirmou" passa as parcelas para "Confirmado pelo cliente"; "sem resposta" mantém o estágio e abre a
 * pendência de ligação. Nos dois casos a pendência "Confirmar pagamento" é concluída e o contato fica no histórico.
 */
export async function registrarConfirmacao(entrada: z.input<typeof esquema>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode registrar a confirmação." };
  const dados = esquema.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { tituloIds, resultado, canal, observacao } = dados.data;

  const descricao = resultado === "confirmou"
    ? `Cliente confirmou a programação do pagamento ${ROTULO_CANAL[canal]}.${observacao ? ` ${observacao}` : ""}`
    : `Sem resposta do cliente ${ROTULO_CANAL[canal]} à confirmação do pagamento.${observacao ? ` ${observacao}` : ""}`;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rec_registrar_confirmacao", { p_titulos: tituloIds, p_resultado: resultado, p_canal: canal, p_descricao: descricao });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/inicio");
  const r = (data ?? {}) as { pendencia_ligar?: number };
  return {
    ok: true,
    aviso: resultado === "confirmou"
      ? "Confirmação registrada."
      : r.pendencia_ligar ? "Registrado. Abri a pendência para ligar ao cliente." : "Registrado. Já existe uma pendência para ligar ao cliente.",
  };
}
