"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { NIVEIS } from "@/lib/nucleo/permissoes";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** Chama a Edge Function (única que usa a service role). Devolve a mensagem de erro dela, quando houver. */
async function chamarGestaoUsuarios(corpo: Record<string, unknown>): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("nucleo-gerir-usuarios", { body: corpo });
  if (error) {
    let mensagem = "Não foi possível concluir a operação.";
    const resposta = (error as { context?: Response }).context;
    if (resposta && typeof resposta.json === "function") {
      try {
        const detalhe = (await resposta.json()) as { erro?: string };
        if (detalhe.erro) mensagem = detalhe.erro;
      } catch {
        /* mantém a mensagem genérica */
      }
    }
    return { ok: false, erro: mensagem };
  }
  if (data && typeof data === "object" && "erro" in data) return { ok: false, erro: String((data as { erro: unknown }).erro) };
  return { ok: true };
}

const esquemaNovo = z.object({
  nome: z.string().trim().min(2, "Informe o nome."),
  email: z.string().trim().email("E-mail inválido."),
  senha: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export async function criarUsuario(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral();
  const entrada = esquemaNovo.safeParse({ nome: dados.get("nome"), email: dados.get("email"), senha: dados.get("senha") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const r = await chamarGestaoUsuarios({ acao: "criar_usuario", ...entrada.data });
  if (!r.ok) return { erro: r.erro };
  revalidatePath("/configuracoes/usuarios");
  return { ok: true, chave: Date.now() };
}

export async function redefinirSenha(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral();
  const entrada = z.object({ id: z.string().uuid(), senha: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.") })
    .safeParse({ id: dados.get("id"), senha: dados.get("senha") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const r = await chamarGestaoUsuarios({ acao: "redefinir_senha", ...entrada.data });
  if (!r.ok) return { erro: r.erro };
  return { ok: true, chave: Date.now() };
}

const esquemaPermissoes = z.object({ id: z.string().uuid(), nivel: z.enum(NIVEIS as unknown as [string, ...string[]]) });

/**
 * Grava, de uma vez, o nível do usuário em cada área, se é administrador geral e se está ativo.
 * Permissões e admin_geral passam pela RLS (só admin_geral escreve). Ativar/desativar vai pela
 * Edge Function, que também bloqueia o login no Auth.
 */
export async function salvarUsuario(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirAdminGeral();
  const id = z.string().uuid().safeParse(dados.get("id"));
  if (!id.success) return { erro: "Usuário inválido." };

  const linhas: { perfil_id: string; area: string; nivel: string }[] = [];
  for (const area of sessao.areas) {
    const nivel = esquemaPermissoes.safeParse({ id: id.data, nivel: dados.get(`nivel_${area.codigo}`) });
    if (!nivel.success) return { erro: `Nível inválido para ${area.nome}.` };
    linhas.push({ perfil_id: id.data, area: area.codigo, nivel: nivel.data.nivel });
  }

  const supabase = await criarClienteServidor();
  const alvoEhEuMesmo = id.data === sessao.userId;
  const adminGeral = dados.get("admin_geral") === "on";
  const ativo = dados.get("ativo") === "on";

  if (alvoEhEuMesmo && (!adminGeral || !ativo)) return { erro: "Você não pode remover o seu próprio acesso de administrador nem se desativar." };

  const permissoes = await supabase.from("permissoes").upsert(linhas, { onConflict: "perfil_id,area" });
  if (permissoes.error) return { erro: mensagemDeErroBanco(permissoes.error) };

  const perfil = await supabase.from("perfis").update({ admin_geral: adminGeral }).eq("id", id.data).select("id, ativo");
  if (perfil.error) return { erro: mensagemDeErroBanco(perfil.error) };
  const atual = perfil.data?.[0];
  if (!atual) return { erro: "Usuário não encontrado." };

  if (atual.ativo !== ativo) {
    const r = await chamarGestaoUsuarios({ acao: "definir_ativo", id: id.data, ativo });
    if (!r.ok) return { erro: r.erro };
  }

  revalidatePath("/configuracoes/usuarios");
  return { ok: true, chave: Date.now() };
}
