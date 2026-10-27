"use server";

import { criarClienteServidor } from "@/lib/supabase/servidor";

/** O banco confere sessão, interruptor (`registrar_acessos`), formato da rota e o limite de 60 por minuto. */
export async function registrarAcesso(rota: string): Promise<void> {
  if (typeof rota !== "string") return;
  const supabase = await criarClienteServidor();
  await supabase.rpc("registrar_acesso", { p_rota: rota });
}
