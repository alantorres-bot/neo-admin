// Edge Function do núcleo: conexão do GED com o Google Drive (fase A0-conexão). Só liga as peças: a lógica, testada no Vitest,
// está em _shared/ged.ts (tratarConexao / tratarDesconexao). Plano: docs/auditoria/PLANO_FASE_A0_GED_2026-10-24.md.
//
//  GET  ?state=…                  -> ida ao Google (PKCE S256).
//  GET  ?code=…&state= | ?error=  -> volta: consome o state, troca o código, confere identidade e escopos, grava no Vault.
//  POST (Authorization: Bearer <JWT do admin>) -> desconecta (revoga no Google se administrativo.ged.revogar_no_google).
//
// verify_jwt = false (config.toml): o Google volta sem JWT. Compensações: state de uso único consumido antes da troca, PKCE,
// revalidação do admin no banco, identidade e escopos conferidos, respostas genéricas. Esta função NÃO registra log.
// Segredos obrigatórios (sem fallback): GED_DRIVE_CLIENT_ID, GED_DRIVE_CLIENT_SECRET, GED_DRIVE_REDIRECT_URI, NEO_ADMIN_URL.
// Ativação só depois da revisão 4 do GED aprovada e da autorização expressa da fase A0 (deploy pelo responsável).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tratarConexao, tratarDesconexao, type RespostaGed } from "../_shared/ged.ts";

const responder = (r: RespostaGed) =>
  new Response(r.corpo ?? null, {
    status: r.status,
    headers: {
      ...(r.location ? { Location: r.location } : {}),
      "Content-Type": r.corpo?.startsWith("{") ? "application/json" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const chaveAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !chaveServico || !chaveAnon) return responder({ status: 500, corpo: "Função mal configurada." });

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const deps = {
    env: (k: string) => Deno.env.get(k),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      const { data, error } = await banco.rpc(nome, args);
      return { data, error: error ? { message: error.message } : null };
    },
    fetch: (u: string, init: RequestInit) => fetch(u, init),
    agoraSeg: () => Math.floor(Date.now() / 1000),
  };

  if (req.method === "POST") {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
    return responder(
      await tratarDesconexao({ method: req.method, jwt }, {
        ...deps,
        perfilAdmin: async (token) => {
          const usuario = createClient(url, chaveAnon, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data } = await usuario.rpc("ged_perfil_admin_atual");
          return typeof data === "string" ? data : null;
        },
        revogarNoGoogle: async () => {
          const { data } = await banco.from("configuracoes").select("valor").eq("chave", "administrativo.ged.revogar_no_google").maybeSingle();
          return data?.valor === true;
        },
      }),
    );
  }
  return responder(await tratarConexao({ method: req.method, url: req.url }, deps));
});
