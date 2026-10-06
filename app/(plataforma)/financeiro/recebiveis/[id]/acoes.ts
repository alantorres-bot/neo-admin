"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MODULO_RECEBIVEIS, normalizarLinhaDigitavel } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { carregarFicha } from "./dados";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };

const uuid = z.string().uuid();

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

async function exigirOperador(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode fazer isto." };
  return { ok: true };
}

/** Linha digitável da parcela (opcional; o boleto é o PDF). */
export async function salvarLinhaDigitavel(tituloId: string, texto: string): Promise<Resultado> {
  if (!uuid.safeParse(tituloId).success) return { ok: false, erro: "Título inválido." };
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const linha = normalizarLinhaDigitavel(texto);
  if (!linha.ok) return linha;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("rec_titulos").update({ linha_digitavel: linha.valor }).eq("id", tituloId).select("id");
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  // A RLS esconde (e não altera) o que o usuário não pode mexer: zero linhas = sem permissão.
  if (!data || data.length === 0) return { ok: false, erro: "Você não tem permissão para alterar este título." };
  revalidatePath("/financeiro/recebiveis", "layout");
  return { ok: true };
}

const ROTULO_CANAL_ENVIO = { email: "por e-mail", whatsapp: "por WhatsApp", telefone: "por telefone", interno: "por outro meio" } as const;

const esquemaEnvio = z.object({
  tituloIds: z.array(z.string().uuid()).min(1, "Marque pelo menos uma parcela.").max(50),
  canal: z.enum(["email", "whatsapp", "telefone", "interno"]),
  contatoId: z.string().uuid().nullable(),
  observacao: z.string().trim().max(500).default(""),
});

/**
 * Marca as parcelas como enviadas: tudo numa transação do banco (`rec_marcar_boleto_enviado`, com a RLS de quem
 * chama): exige boleto anexado, muda o estágio, registra a interação e conclui a pendência quando a NF não tem mais
 * parcela aguardando. O sistema não envia nada: quem enviou registra aqui.
 */
export async function marcarBoletoEnviado(entrada: z.input<typeof esquemaEnvio>): Promise<Resultado> {
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const dados = esquemaEnvio.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { tituloIds, canal, contatoId, observacao } = dados.data;

  const supabase = await criarClienteServidor();

  // Para quem foi: nome e meio de contato, só para o histórico.
  let destino = "";
  if (contatoId) {
    const { data: contato } = await supabase.from("contatos").select("nome, email, whatsapp").eq("id", contatoId).maybeSingle();
    if (contato) {
      const meio = canal === "whatsapp" ? contato.whatsapp : canal === "email" ? contato.email : null;
      destino = ` para ${contato.nome}${meio ? ` (${meio})` : ""}`;
    }
  }
  const descricao = `Boleto enviado ${ROTULO_CANAL_ENVIO[canal]}${destino}.${observacao ? ` Obs.: ${observacao}` : ""}`;

  const { data, error } = await supabase.rpc("rec_marcar_boleto_enviado", { p_titulos: tituloIds, p_canal: canal, p_descricao: descricao });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/inicio");
  const concluidas = Number((data as { pendencias_concluidas?: number } | null)?.pendencias_concluidas ?? 0);
  return {
    ok: true,
    aviso: concluidas > 0
      ? "Pendência “Anexar boleto” concluída."
      : "Envio registrado. A pendência continua aberta (há parcelas aguardando boleto ou ela está com outra pessoa).",
  };
}

export type ResultadoRascunho = { ok: true; url: string; anexos: number; aviso?: string } | { ok: false; erro: string };

/**
 * Cria o rascunho do e-mail do boleto no Gmail, com os boletos em anexo. O texto é o mesmo que a ficha mostra.
 * 1) valida (parcelas da mensagem, todas com boleto, contato com e-mail); 2) grava a mensagem como `rascunho` com a sessão
 * do usuário (a RLS e o gatilho carimbam o autor); 3) a Edge Function `rec-rascunho-gmail` cria o rascunho (nunca envia).
 * Se o Gmail falhar, a mensagem é descartada para não ficar rascunho fantasma no Neo Admin.
 */
export async function criarRascunhoGmail(tituloId: string, contatoId: string | null): Promise<ResultadoRascunho> {
  if (!uuid.safeParse(tituloId).success) return { ok: false, erro: "Título inválido." };
  if (contatoId !== null && !uuid.safeParse(contatoId).success) return { ok: false, erro: "Contato inválido." };
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;

  const supabase = await criarClienteServidor();
  const ficha = await carregarFicha(supabase, tituloId, contatoId ?? "", { assinarLinks: false });
  if (!ficha) return { ok: false, erro: "Título não encontrado." };
  // Vale também depois do envio registrado (reenvio): a mensagem usa as parcelas que aguardam envio ou, se não há, as demais em aberto.
  if (ficha.paraMensagem.length === 0) return { ok: false, erro: "Todas as parcelas estão encerradas (pagas ou canceladas)." };
  if (ficha.paraMensagem.some((p) => !ficha.boletoDaParcela.has(p.id))) return { ok: false, erro: "Anexe o boleto de todas as parcelas da mensagem." };
  if (!ficha.contato?.email) return { ok: false, erro: "O contato escolhido não tem e-mail cadastrado." };
  if (!ficha.email || !ficha.modeloEmailId) return { ok: false, erro: "O modelo de e-mail do boleto está desativado." };

  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_RECEBIVEIS,
    contraparte_id: ficha.base.contraparte_id,
    contato_id: ficha.contato.id,
    modelo_id: ficha.modeloEmailId,
    canal: "email",
    destinatario: ficha.contato.email,
    assunto: ficha.email.assunto,
    corpo: ficha.email.corpo,
    status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };

  const { data, error } = await supabase.functions.invoke("rec-rascunho-gmail", {
    body: { mensagem_id: mensagem.id, titulo_ids: ficha.paraMensagem.map((p) => p.id) },
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
  return { ok: true, url: resultado?.url ?? "https://mail.google.com/mail/u/0/#drafts", anexos: resultado?.anexos ?? 0, aviso: resultado?.aviso };
}
