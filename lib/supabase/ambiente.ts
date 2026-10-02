// As variáveis NEXT_PUBLIC_* precisam ser lidas literalmente (process.env.NEXT_PUBLIC_X) para o
// Next embuti-las no código do navegador; por isso não dá para ler por nome dinâmico.
export function ambienteSupabase(): { url: string; chave: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) {
    throw new Error(
      "Supabase não configurado: preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local (modelo em .env.example).",
    );
  }
  return { url, chave };
}
