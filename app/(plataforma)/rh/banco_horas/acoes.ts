"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailVencendo } from "@/lib/modulos/rh/banco-horas/email";
import { MODULO_BANCO_HORAS, ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSaldos } from "./dados";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function exigir(nivel: "operador" | "gestor"): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "rh", nivel) ? null : `Somente ${nivel} do RH (ou acima) pode fazer isso no banco de horas.`;
}

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor" = "operador"): Promise<{ ok: true; dados: unknown } | { ok: false; erro: string }> {
  const negado = await exigir(nivel);
  if (negado) return { ok: false, erro: negado };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_BANCO_HORAS, "layout");
  return { ok: true, dados: data };
}

// O CSV é lido no navegador (lerCsv + lerBancoHoras) e chega aqui só com o necessário; o servidor valida tudo de novo.
const esquemaImportacao = z.object({
  arquivo: z.string().trim().min(1).max(200), inicio: dataIso, fim: dataIso,
  pessoas: z.array(z.object({
    cpf: z.string().regex(/^\d{11}$/), nome: z.string().trim().min(1).max(200), idControlId: z.string().max(20),
    saldoControlIdMin: z.number().int().nullable(), saldoEm: dataIso.nullable(),
    movimentos: z.array(z.object({ data: dataIso, positivoMin: z.number().int().min(0).max(24 * 60), negativoMin: z.number().int().min(0).max(24 * 60) })).max(400),
  })).min(1).max(1000),
});

export async function importarBancoHoras(entrada: z.input<typeof esquemaImportacao>): Promise<Resultado> {
  const d = esquemaImportacao.safeParse(entrada);
  if (!d.success) return { ok: false, erro: `Arquivo inválido: ${d.error.issues[0].message}` };
  const r = await chamar("rh_bh_importar", {
    p_inicio: d.data.inicio, p_fim: d.data.fim, p_arquivo: d.data.arquivo,
    p_pessoas: d.data.pessoas.map((p) => ({
      cpf: p.cpf, nome: p.nome, id_controlid: p.idControlId, saldo_controlid_min: p.saldoControlIdMin, saldo_em: p.saldoEm,
      movimentos: p.movimentos.map((m) => ({ data: m.data, positivo_min: m.positivoMin, negativo_min: m.negativoMin })),
    })),
  });
  if (!r.ok) return r;
  const x = r.dados as { pessoas: number; movimentos_gravados: number };
  return { ok: true, aviso: `${d.data.arquivo}: ${x.pessoas} pessoa(s); ${x.movimentos_gravados} dia(s) com movimento gravado(s) ou corrigido(s).` };
}

// ---------------------------------------------------------------- fechamento do ciclo

export async function emitirFechamento(mes: string): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  if (!/^\d{4}-\d{2}$/.test(mes)) return { ok: false, erro: "Escolha o mês." };
  const r = await chamar("rh_bh_emitir_fechamento", { p_competencia: `${mes}-01` });
  return r.ok ? { ok: true, id: r.dados as string } : r;
}

export async function passoFechamento(id: string, passo: "aprovar" | "enviado" | "lancado"): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Fechamento inválido." };
  const funcao = { aprovar: "rh_bh_aprovar_fechamento", enviado: "rh_bh_marcar_enviado", lancado: "rh_bh_marcar_lancado" }[passo];
  const r = await chamar(funcao, { p_id: id }, passo === "aprovar" ? "gestor" : "operador");
  return r.ok ? { ok: true, aviso: { aprovar: "Fechamento aprovado.", enviado: "Marcado como enviado ao escritório.", lancado: "Lançado na folha: as horas saíram do saldo." }[passo] } : r;
}

export async function devolverOuCancelarFechamento(id: string, acao: "devolver" | "cancelar", motivo: string): Promise<Resultado> {
  const m = z.string().trim().min(5, "Informe o motivo.").max(300).safeParse(motivo);
  if (!m.success || !uuid.safeParse(id).success) return { ok: false, erro: m.success ? "Fechamento inválido." : m.error.issues[0].message };
  const r = await chamar(acao === "devolver" ? "rh_bh_devolver_fechamento" : "rh_bh_cancelar_fechamento", { p_id: id, p_motivo: m.data }, "gestor");
  return r.ok ? { ok: true, aviso: acao === "devolver" ? "Fechamento devolvido." : "Fechamento cancelado." } : r;
}

export async function salvarParametros(entrada: { inicio: string; validadeMeses: number; avisoDias: number; limiteNegativoMin: number }): Promise<Resultado> {
  const d = z.object({ inicio: dataIso, validadeMeses: z.number().int(), avisoDias: z.number().int(), limiteNegativoMin: z.number().int() }).safeParse(entrada);
  if (!d.success) return { ok: false, erro: "Parâmetros inválidos." };
  const r = await chamar("rh_bh_salvar_parametros", { p_inicio: d.data.inicio, p_validade: d.data.validadeMeses, p_aviso: d.data.avisoDias, p_limite: d.data.limiteNegativoMin }, "gestor");
  return r.ok ? { ok: true, aviso: "Parâmetros salvos." } : r;
}

/** Rascunho no Gmail de quem clica, ao e-mail do setor (o mesmo do RH > Ponto), com quem precisa folgar ou repor horas. */
export async function rascunhoAoLider(setorId: string): Promise<{ ok: true; url: string; aviso?: string } | { ok: false; erro: string }> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(setorId).success) return { ok: false, erro: "Setor inválido." };
  const supabase = await criarClienteServidor();
  const { data: setor } = await supabase.from("rh_pt_setores").select("nome, email, email_copia").eq("id", setorId).maybeSingle();
  if (!setor?.email) return { ok: false, erro: "O setor não tem e-mail. Confira em RH > Ponto > Setores e líderes." };
  const pessoas = (await lerSaldos(supabase)).filter((s) => s.setor_id === setorId && (s.folgar_min > 0 || s.repor_min > 0) && s.proximo_vencimento);
  if (!pessoas.length) return { ok: false, erro: "Ninguém do setor tem horas vencendo." };
  const email = emailVencendo(setor.nome as string, pessoas.map((p) => ({ nome: p.nome, folgarMin: p.folgar_min, reporMin: p.repor_min, vencimento: p.proximo_vencimento! })));

  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_BANCO_HORAS, canal: "email", destinatario: setor.email, cc: setor.email_copia, assunto: email.assunto, corpo: email.corpo, status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };
  const { data, error } = await supabase.functions.invoke("rh-bh-rascunho-gmail", { body: { mensagem_id: mensagem.id } });
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
  const r = data as { url?: string; aviso?: string } | null;
  return { ok: true, url: r?.url ?? "https://mail.google.com/mail/u/0/#drafts", aviso: r?.aviso };
}
