"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { destinoSeguro } from "@/lib/nucleo/redirecionamento";

export type EstadoLogin = { erro?: string };

const esquema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
  senha: z.string().min(1, "Informe a senha."),
});

export async function entrar(_anterior: EstadoLogin, dados: FormData): Promise<EstadoLogin> {
  const entrada = esquema.safeParse({ email: dados.get("email"), senha: dados.get("senha") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: entrada.data.email, password: entrada.data.senha });
  if (error) {
    // Mensagem única para e-mail inexistente e senha errada: não revela quais e-mails existem.
    const credenciais = error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message);
    if (credenciais) return { erro: "E-mail ou senha incorretos." };
    if (error.code === "user_banned") return { erro: "Este acesso está desativado. Fale com o administrador." };
    if (error.status === 429) return { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
    return { erro: "Não foi possível entrar agora. Tente novamente." };
  }

  redirect(destinoSeguro(String(dados.get("proximo") ?? "")));
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
