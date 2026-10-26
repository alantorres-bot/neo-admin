"use server";

import { revalidatePath } from "next/cache";
import { validarNomeEditado } from "@/supabase/functions/_shared/ged";
import {
  FUNCAO_ANALISE_GED, lerResultadoAnalise, mensagemPadronizacao, resumoAnalise, ROTA_PADRONIZACAO,
} from "@/lib/nucleo/ged/padronizacao";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Resultado = { ok: true; mensagem?: string } | { ok: false; erro: string };
const SO_ADMIN = mensagemPadronizacao("sem_permissao");

/** "Analisar próximos 20": a Edge Function baixa, extrai, sugere e grava; aqui só chegam contagens. Nada é renomeado no Drive. */
export async function analisarProximos(): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: SO_ADMIN };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke(FUNCAO_ANALISE_GED, { method: "POST", body: { limite: 20 } });
  if (error) {
    const corpo = await ((error as { context?: Response }).context?.json?.() as Promise<{ erro?: unknown }> | undefined)?.catch(() => null);
    return { ok: false, erro: mensagemPadronizacao(corpo?.erro) };
  }
  const r = lerResultadoAnalise(data);
  if (!r) return { ok: false, erro: mensagemPadronizacao(null) };
  revalidatePath(ROTA_PADRONIZACAO);
  return { ok: true, mensagem: resumoAnalise(r) };
}

/** Aprovar, editar (nome validado pelas regras do padrão) ou rejeitar (motivo). O banco confere o admin e grava o histórico. */
export async function decidirAnalise(documentoId: string, decisao: "aprovar" | "editar" | "rejeitar", nome: string, extensao: string, motivo: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: SO_ADMIN };
  if (!["aprovar", "editar", "rejeitar"].includes(decisao)) return { ok: false, erro: mensagemPadronizacao("decisao_invalida") };
  let nomeFinal: string | null = null;
  if (decisao === "editar") {
    nomeFinal = validarNomeEditado(nome, extensao);
    if (!nomeFinal) return { ok: false, erro: mensagemPadronizacao("nome_invalido") };
  }
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("ged_decidir_analise", {
    p_documento: documentoId, p_decisao: decisao, p_nome: nomeFinal, p_motivo: motivo.trim() || null,
  });
  if (error) return { ok: false, erro: mensagemPadronizacao(error.message) };
  revalidatePath(ROTA_PADRONIZACAO);
  return { ok: true };
}
