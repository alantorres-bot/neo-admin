// Cliente Supabase para componentes do navegador ("use client"). Chave pública + sessão do usuário.
import { createBrowserClient } from "@supabase/ssr";
import { ambienteSupabase } from "./ambiente";

export function criarClienteNavegador() {
  const { url, chave } = ambienteSupabase();
  return createBrowserClient(url, chave);
}
