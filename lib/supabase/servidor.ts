// Cliente Supabase para Server Components, Server Actions e Route Handlers.
// Usa a chave pública + a sessão do usuário (cookies): a RLS vale. A service role NUNCA é usada
// aqui; ela fica só nas Edge Functions (CLAUDE.md).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ambienteSupabase } from "./ambiente";

export async function criarClienteServidor() {
  const armazem = await cookies();
  const { url, chave } = ambienteSupabase();
  return createServerClient(url, chave, {
    cookies: {
      getAll: () => armazem.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) armazem.set(name, value, options);
        } catch {
          // Chamado de um Server Component (cookies são somente leitura ali).
          // Sem problema: o proxy.ts renova a sessão a cada requisição.
        }
      },
    },
  });
}
