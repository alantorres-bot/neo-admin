"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type EstadoSenha = { ok?: boolean; erro?: string; chave?: number };

const esquema = z
  .object({
    senha: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
    confirmacao: z.string(),
  })
  .refine((v) => v.senha === v.confirmacao, { message: "A confirmação não confere com a senha.", path: ["confirmacao"] });

export async function alterarSenha(_anterior: EstadoSenha, dados: FormData): Promise<EstadoSenha> {
  const sessao = await exigirSessao({ permitirTrocaPendente: true });
  const eraObrigatoria = sessao.perfil.deve_trocar_senha;
  const entrada = esquema.safeParse({ senha: dados.get("senha"), confirmacao: dados.get("confirmacao") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.updateUser({ password: entrada.data.senha });
  if (error) {
    if (error.code === "same_password") return { erro: "A nova senha precisa ser diferente da atual." };
    if (error.code === "weak_password") return { erro: "Senha fraca. Use letras e números, com pelo menos 8 caracteres." };
    return { erro: "Não foi possível alterar a senha. Entre novamente e tente de novo." };
  }
  // O gatilho do banco libera o acesso assim que a senha muda no Auth (migration 0005).
  if (eraObrigatoria) redirect("/inicio");
  return { ok: true, chave: Date.now() };
}
