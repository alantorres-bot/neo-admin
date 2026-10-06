"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarLinhaDigitavel } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

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
