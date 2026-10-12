"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MODULO_AKF, ROTA_AKF } from "@/lib/modulos/financeiro/akf/solicitacao";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSolicitacao, montarEmailDaSolicitacao } from "./dados";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };
export type ResultadoCriacao = { ok: true; id: string; numero: number; aviso: string } | { ok: false; erro: string };
export type ResultadoRascunho = { ok: true; url: string; aviso?: string } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

async function exigirOperador(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode fazer isto." };
  return { ok: true };
}

function revalidar() {
  revalidatePath(ROTA_AKF);
  revalidatePath(`${ROTA_AKF}/solicitar`);
  revalidatePath(`${ROTA_AKF}/solicitacoes`, "layout");
  revalidatePath("/financeiro/recebiveis", "layout");
}

const esquemaItem = z.object({
  tituloId: z.string().uuid(),
  /** null = o que resta com a Neo (título inteiro); número = valor em reais (antecipação parcial). */
  valor: z.number().positive().max(999_999_999).nullable(),
  semBoleto: z.boolean(),
  observacao: z.string().trim().max(300).default(""),
});
const esquemaCriar = z.object({
  itens: z.array(esquemaItem).min(1, "Marque pelo menos um título.").max(100, "No máximo 100 títulos por solicitação."),
  observacao: z.string().trim().max(500).default(""),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/**
 * Monta a solicitação (status "rascunho") com os títulos marcados: função de banco `akf_criar_solicitacao`, numa transação,
 * com a RLS de quem chama. Valida título disponível, valor dentro do restante e título não repetido em solicitação aberta.
 */
export async function criarSolicitacao(entrada: z.input<typeof esquemaCriar>): Promise<ResultadoCriacao> {
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const dados = esquemaCriar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { itens, observacao, data } = dados.data;

  const supabase = await criarClienteServidor();
  const { data: r, error } = await supabase.rpc("akf_criar_solicitacao", {
    p_itens: itens.map((i) => ({ titulo_id: i.tituloId, valor: i.valor, sem_boleto: i.semBoleto, observacao: i.observacao || null })),
    p_observacao: observacao || null,
    p_data: data,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const resultado = r as { id: string; numero: number; itens: number };
  revalidar();
  return { ok: true, id: resultado.id, numero: resultado.numero, aviso: `Solicitação nº ${resultado.numero} montada com ${resultado.itens} ${resultado.itens === 1 ? "título" : "títulos"}.` };
}

/**
 * Cria o rascunho do e-mail da solicitação no Gmail. O texto é o mesmo que a página mostra.
 * 1) valida (solicitação em rascunho, destinatários com e-mail); 2) grava a mensagem como `rascunho` com a sessão do
 * usuário; 3) a Edge Function `akf-rascunho-gmail` cria o rascunho (nunca envia) e marca a solicitação como solicitada.
 * Se o Gmail falhar, a mensagem é descartada para não ficar rascunho fantasma no Neo Admin.
 */
export async function criarRascunhoSolicitacao(operacaoId: string): Promise<ResultadoRascunho> {
  if (!z.string().uuid().safeParse(operacaoId).success) return { ok: false, erro: "Solicitação inválida." };
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;

  const supabase = await criarClienteServidor();
  const sol = await lerSolicitacao(supabase, operacaoId);
  if (!sol) return { ok: false, erro: "Solicitação não encontrada." };
  if (sol.status !== "rascunho") return { ok: false, erro: `A solicitação nº ${sol.numero} já foi solicitada ou cancelada.` };
  if (sol.itens.length === 0) return { ok: false, erro: "A solicitação não tem títulos." };
  const email = await montarEmailDaSolicitacao(supabase, sol);
  if (email.para.length === 0) return { ok: false, erro: "Nenhum contato da AKF com e-mail e finalidade \"AKF\". Cadastre em Configurações > Contrapartes > AKF Securitizadora." };

  const parametros = await supabase.from("configuracoes").select("valor").eq("chave", "financeiro.akf.contraparte_id").maybeSingle();
  const contraparteId = typeof parametros.data?.valor === "string" ? parametros.data.valor : null;
  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_AKF, contraparte_id: contraparteId, contato_id: email.para[0].id, canal: "email",
    destinatario: email.para.map((d) => d.email).join(","), cc: email.cc.length > 0 ? email.cc.join(",") : null,
    assunto: email.assunto, corpo: email.corpo, status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };

  const { data, error } = await supabase.functions.invoke("akf-rascunho-gmail", { body: { mensagem_id: mensagem.id, operacao_id: operacaoId } });
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
  const resultado = data as { url?: string; aviso?: string } | null;
  revalidar();
  return { ok: true, url: resultado?.url ?? "https://mail.google.com/mail/u/0/#drafts", aviso: resultado?.aviso };
}

/** Cancela a solicitação (rascunho ou solicitada) com motivo; a mensagem do núcleo é descartada. Nada é apagado. */
export async function cancelarSolicitacao(entrada: { id: string; motivo: string }): Promise<Resultado> {
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const dados = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(5, "Informe o motivo do cancelamento.").max(300) }).safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("akf_cancelar_solicitacao", { p_operacao: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar();
  return { ok: true, aviso: "Solicitação cancelada." };
}
