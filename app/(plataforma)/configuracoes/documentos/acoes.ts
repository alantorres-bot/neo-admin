"use server";

import { revalidatePath } from "next/cache";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import type { ConsultaMetadados } from "@/supabase/functions/_shared/ged";
import {
  FUNCAO_CONEXAO_GED,
  FUNCAO_METADADOS_GED,
  lerConsultaMetadados,
  mensagemConsultaMetadados,
  mensagemDesconexao,
  mensagemErroInicio,
  ROTA_CONEXAO_GED,
  urlInicioConexaoGed,
  validarContaGed,
  type Aviso,
  type SituacaoConexaoGed,
} from "@/lib/nucleo/ged/conexao-tela";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const SO_ADMIN = "Só o administrador geral conecta ou desconecta o Google Drive do GED.";

/**
 * "Conectar Google Drive": gera o state no banco (ged_iniciar_conexao, que também confere o admin) com o destino FIXO desta tela
 * e devolve a URL da Edge Function, que leva ao Google. Nenhum parâmetro de destino vem do navegador.
 */
export async function iniciarConexaoGed(): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: SO_ADMIN };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("ged_iniciar_conexao", { p_destino: ROTA_CONEXAO_GED });
  if (error) return { ok: false, erro: mensagemErroInicio(error) };
  const url = urlInicioConexaoGed(process.env.NEXT_PUBLIC_SUPABASE_URL, data);
  return url ? { ok: true, url } : { ok: false, erro: "Não foi possível iniciar a conexão. Tente de novo." };
}

/**
 * Grava a conta dedicada (administrativo.ged.conta) pelo mesmo caminho dos outros parâmetros: RLS configuracoes_admin
 * (só admin geral) e auditoria do núcleo (antes e depois). D-TROCA: só sem conexão ativa; na dúvida (situação ilegível), recusa.
 */
export async function definirContaGed(texto: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: "Só o administrador geral configura a conta do GED." };
  const validada = validarContaGed(texto);
  if (!validada.ok) return validada;
  const supabase = await criarClienteServidor();
  const situacao = await supabase.rpc("ged_situacao_conexao");
  if (situacao.error) return { ok: false, erro: "Não foi possível conferir a conexão atual. Tente de novo." };
  const atual = (situacao.data as SituacaoConexaoGed[] | null)?.[0];
  if (atual && atual.situacao !== "desconectada") return { ok: false, erro: "Desconecte o Google Drive antes de trocar a conta." };
  const { data, error } = await supabase.from("configuracoes").update({ valor: validada.conta })
    .eq("chave", "administrativo.ged.conta").select("chave");
  if (error) return { ok: false, erro: mensagemDeErroBanco(error) };
  if (!data?.length) return { ok: false, erro: "Parâmetro não encontrado: aplique a migration 0801." };
  revalidatePath(ROTA_CONEXAO_GED);
  return { ok: true };
}

/**
 * "Desconectar": chama a Edge Function com o JWT do usuário (ela confere o admin no banco, revoga no Google se
 * administrativo.ged.revogar_no_google estiver ligada e desconecta localmente sempre).
 */
export async function desconectarGed(): Promise<({ ok: true } & Aviso) | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: SO_ADMIN };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke(FUNCAO_CONEXAO_GED, { method: "POST" });
  if (error) return { ok: false, erro: "Não foi possível desconectar agora. Tente de novo." };
  revalidatePath(ROTA_CONEXAO_GED);
  return { ok: true, ...mensagemDesconexao((data as { revogacao?: unknown } | null)?.revogacao) };
}

/**
 * Primeira leitura controlada do Drive: só metadados (nome, tipo, data, tamanho), com limite fixo na Edge Function. A função
 * confere o admin no banco, renova o acesso com o token do Vault e registra a consulta na auditoria.
 */
export async function consultarMetadadosGed(): Promise<{ ok: true; consulta: ConsultaMetadados } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) return { ok: false, erro: mensagemConsultaMetadados("sem_permissao") };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke(FUNCAO_METADADOS_GED, { method: "POST" });
  if (error) {
    const corpo = await ((error as { context?: Response }).context?.json?.() as Promise<{ erro?: unknown }> | undefined)?.catch(() => null);
    return { ok: false, erro: mensagemConsultaMetadados(corpo?.erro) };
  }
  const consulta = lerConsultaMetadados(data);
  return consulta ? { ok: true, consulta } : { ok: false, erro: mensagemConsultaMetadados(null) };
}
