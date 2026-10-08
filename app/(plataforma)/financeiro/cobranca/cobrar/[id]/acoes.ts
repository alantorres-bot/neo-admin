"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MODULO_RECEBIVEIS } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { emailCobranca } from "@/supabase/functions/_shared/cobranca";
import { carregarCobranca } from "./dados";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };
export type ResultadoRascunho = { ok: true; url: string; anexos: number; aviso?: string } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

const esquema = z.object({
  tituloIds: z.array(z.string().uuid()).min(1, "Marque pelo menos uma parcela.").max(100),
  marco: z.union([z.literal(1), z.literal(5), z.literal(10)]),
  resultado: z.enum(["enviada", "promessa", "contestou"]),
  canal: z.enum(["whatsapp", "telefone", "email", "interno"]),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  observacao: z.string().trim().max(500).default(""),
});

/**
 * Registra o resultado da cobrança (`rec_registrar_cobranca`, numa transação, com a RLS de quem chama): "enviada" fica no
 * histórico; "promessa" pausa a régua até a data; "contestou" pausa a régua e guarda o motivo. A pendência do marco é concluída.
 * O sistema não envia a mensagem: quem enviou registra aqui.
 */
export async function registrarCobranca(entrada: z.input<typeof esquema>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode registrar a cobrança." };
  const dados = esquema.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { tituloIds, marco, resultado, canal, data, observacao } = dados.data;
  if (resultado === "promessa" && !data) return { ok: false, erro: "Informe a data prometida para o pagamento." };
  if (resultado === "contestou" && observacao.length < 5) return { ok: false, erro: "Informe o motivo da contestação." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_registrar_cobranca", {
    p_titulos: tituloIds, p_marco: marco, p_resultado: resultado, p_canal: canal, p_data_prometida: resultado === "promessa" ? data : null, p_descricao: observacao || null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/inicio");
  return {
    ok: true,
    aviso: resultado === "enviada" ? "Cobrança registrada." : resultado === "promessa" ? "Promessa registrada: a régua fica pausada até a data." : "Contestação registrada: a régua fica pausada para estes títulos.",
  };
}

/**
 * Cria o rascunho do e-mail de cobrança no Gmail (D+1 e D+10). O texto é recalculado aqui, do banco, com as mesmas regras da
 * tela; o boleto de cada parcela, quando existe, vai em anexo. Nunca envia: quem confere e envia é uma pessoa, no Gmail.
 */
export async function criarRascunhoCobranca(clienteId: string, marco: number, unidade: "matriz" | "contagem"): Promise<ResultadoRascunho> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima cria rascunhos de e-mail." };
  if (!z.string().uuid().safeParse(clienteId).success) return { ok: false, erro: "Cliente inválido." };

  const supabase = await criarClienteServidor();
  const dados = await carregarCobranca(supabase, clienteId);
  if (!dados) return { ok: false, erro: "Cliente não encontrado." };
  const grupo = dados.grupos.find((g) => g.marco === marco && g.unidade === unidade);
  if (!grupo) return { ok: false, erro: "Este marco não tem títulos a cobrar agora." };
  const email = emailCobranca(grupo, dados.hoje, dados.contatoEmail?.nome ?? "");
  if (!email) return { ok: false, erro: "Este marco da régua não tem e-mail." };
  if (!dados.contatoEmail?.email) return { ok: false, erro: "Nenhum contato do cliente tem e-mail cadastrado." };

  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_RECEBIVEIS,
    contraparte_id: clienteId,
    contato_id: dados.contatoEmail.id,
    canal: "email",
    destinatario: dados.contatoEmail.email,
    assunto: email.assunto,
    corpo: email.corpo,
    status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };

  const { data, error } = await supabase.functions.invoke("rec-rascunho-gmail", {
    body: { mensagem_id: mensagem.id, titulo_ids: grupo.titulos.map((t) => t.id), modo: "cobranca" },
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

  const resultado = data as { url?: string; anexos?: number; aviso?: string } | null;
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/cobranca", "layout");
  return { ok: true, url: resultado?.url ?? "https://mail.google.com/mail/u/0/#drafts", anexos: resultado?.anexos ?? 0, aviso: resultado?.aviso };
}
