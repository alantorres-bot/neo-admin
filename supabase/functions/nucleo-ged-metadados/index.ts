// Edge Function do núcleo: primeira leitura controlada do Drive do GED — só METADADOS (nome, tipo, data, tamanho) do que a conta
// conectada já enxerga, com limite fixo (3 páginas de 100). Só liga as peças: a lógica, testada no Vitest, está em
// _shared/ged.ts (tratarConsultaMetadados). Migration: 0802_ged_metadados.sql.
//
//  POST (Authorization: Bearer <JWT do admin geral>) -> { itens, limite_atingido, por_tipo, amostra[20] }
//
// Sem download, sem conteúdo, sem índice, sem escrita no Drive (o cliente só faz GET na Drive API v3). Cada consulta vai para a
// auditoria (quem, quantos itens, resultado). O log tem só o resultado e a contagem: nunca nome de arquivo, token ou e-mail.
// Segredos: os mesmos da nucleo-ged-conectar (GED_DRIVE_CLIENT_ID, GED_DRIVE_CLIENT_SECRET, GED_DRIVE_REDIRECT_URI, NEO_ADMIN_URL).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tratarConsultaMetadados, type RespostaGed } from "../_shared/ged.ts";

const responder = (r: RespostaGed) =>
  new Response(r.corpo ?? null, {
    status: r.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const chaveAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !chaveServico || !chaveAnon) return responder({ status: 500, corpo: JSON.stringify({ erro: "nao_configurada" }) });

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  return responder(
    await tratarConsultaMetadados({ method: req.method, jwt }, {
      env: (k: string) => Deno.env.get(k),
      rpc: async (nome: string, args: Record<string, unknown>) => {
        const { data, error } = await banco.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      fetch: (u: string, init: RequestInit) => fetch(u, init),
      agoraSeg: () => Math.floor(Date.now() / 1000),
      perfilAdmin: async (token) => {
        const usuario = createClient(url, chaveAnon, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data } = await usuario.rpc("ged_perfil_admin_atual");
        return typeof data === "string" ? data : null;
      },
      log: (m) => console.log(m),
    }),
  );
});
