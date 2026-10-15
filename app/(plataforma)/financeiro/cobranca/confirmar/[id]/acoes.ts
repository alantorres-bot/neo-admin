"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { MODULO_RECEBIVEIS } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { emailConfirmacao } from "@/supabase/functions/_shared/confirmacao";
import { escolherContato } from "@/supabase/functions/_shared/contatos";
import { carregarConfirmacao } from "./dados";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };
export type ResultadoRascunho = { ok: true; url: string; anexos: number; aviso?: string } | { ok: false; erro: string };

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
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, "financeiro.cobranca", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode registrar a confirmação." };
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
  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  const r = (data ?? {}) as { pendencia_ligar?: number };
  return {
    ok: true,
    aviso: resultado === "confirmou"
      ? "Confirmação registrada."
      : r.pendencia_ligar ? "Registrado. Abri a pendência para ligar ao cliente." : "Registrado. Já existe uma pendência para ligar ao cliente.",
  };
}

/**
 * Cria o rascunho do e-mail de confirmação de pagamento no Gmail: as parcelas do vencimento mais próximo, recalculadas aqui do
 * banco com as mesmas regras da tela; o boleto de cada uma, quando existe, vai em anexo. Nunca envia: uma pessoa confere e envia.
 */
export async function criarRascunhoConfirmacao(clienteId: string, unidade: "matriz" | "contagem"): Promise<ResultadoRascunho> {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, "financeiro.cobranca", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima cria rascunhos de e-mail." };
  if (!z.string().uuid().safeParse(clienteId).success) return { ok: false, erro: "Cliente inválido." };

  const supabase = await criarClienteServidor();
  const dados = await carregarConfirmacao(supabase, clienteId, sessao.acesso.restrito ? "contagem" : unidade);
  if (!dados) return { ok: false, erro: "Cliente não encontrado." };
  if (!dados.grupo) return { ok: false, erro: "Este cliente não tem parcela a confirmar agora." };
  const contato = escolherContato(dados.contatos, ["confirmacao", "cobranca", "boleto"], "email");
  if (!contato?.email) return { ok: false, erro: "Nenhum contato do cliente tem e-mail cadastrado." };
  const email = emailConfirmacao(dados.grupo, contato.nome);

  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_RECEBIVEIS, contraparte_id: clienteId, contato_id: contato.id, canal: "email", destinatario: contato.email,
    assunto: email.assunto, corpo: email.corpo, status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };

  const { data, error } = await supabase.functions.invoke("rec-rascunho-gmail", {
    body: { mensagem_id: mensagem.id, titulo_ids: dados.grupo.titulosDoFoco.map((t) => t.id), modo: "confirmacao" },
  });
  if (error || (data && typeof data === "object" && "erro" in data)) {
    let erro = "Não foi possível criar o rascunho no Gmail.";
    const resposta = error ? (error as { context?: Response }).context : undefined;
    if (resposta && typeof resposta.json === "function") {
      try {
        const detalhe = (await resposta.json()) as { erro?: string };
        if (detalhe.erro) erro = detalhe.erro;
      } catch {
        /* mantém a mensagem genérica */
      }
    } else if (data && typeof data === "object" && "erro" in data) {
      erro = String((data as { erro: unknown }).erro);
    }
    await supabase.from("mensagens").update({ status: "descartada" }).eq("id", mensagem.id);
    return { ok: false, erro };
  }
  const r = data as { url: string; anexos: number; aviso?: string };
  revalidatePath("/financeiro/cobranca", "layout");
  return { ok: true, url: r.url, anexos: r.anexos, aviso: r.aviso };
}
