// Edge Function do núcleo: "Conectar meu Gmail". Cada usuário autoriza o PRÓPRIO Gmail (escopo gmail.compose: só cria
// rascunho; quem envia é a pessoa), para que e-mails como o da filial ao cliente saiam da caixa de quem os prepara.
//
// Fluxo (o navegador passa por aqui duas vezes; por isso verify_jwt = false em config.toml e a segurança é o `state`):
//  1) GET ?state=…            -> o app gerou o state (gmail_iniciar_conexao, com a sessão do usuário). Confere e manda ao Google.
//  2) GET ?code=…&state=…     -> volta do Google. Troca o código (o segredo do cliente fica só aqui), confere que a conta do
//                                 Google é a do usuário, grava o refresh token no Vault e devolve o navegador ao Neo Admin.
//     GET ?error=…&state=…    -> a pessoa recusou: volta ao Neo Admin com o aviso.
//
// Segredos: GMAIL_WEB_CLIENT_ID e GMAIL_WEB_CLIENT_SECRET (cliente OAuth "Aplicativo da Web" do projeto neo-admin-neoformas,
// com esta URL nos URIs de redirecionamento). GMAIL_WEB_REDIRECT_URI opcional (padrão: a URL desta função).
// Deploy: npx supabase functions deploy nucleo-gmail-conectar --project-ref chdszjpbtfpstjrqnmmm  (docs/GMAIL_POR_USUARIO.md)
import { createClient } from "jsr:@supabase/supabase-js@2";

const ESCOPOS = "openid email https://www.googleapis.com/auth/gmail.compose";
const DOMINIO = "neoformas.com.br";
const STATE = /^[0-9a-f]{64}$/;

const texto = (corpo: string, status = 400) => new Response(corpo, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const redirecionar = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
function comAviso(destino: string, gmail: string, motivo?: string): string {
  const u = new URL(destino);
  u.searchParams.set("gmail", gmail);
  if (motivo) u.searchParams.set("motivo", motivo.slice(0, 200));
  return u.toString();
}

/** E-mail do id_token (veio direto do endpoint de token do Google, por TLS: não precisa conferir assinatura). */
function emailDoIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const parte = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(atob(parte + "=".repeat((4 - (parte.length % 4)) % 4))) as { email?: string; email_verified?: boolean };
    return dados.email && dados.email_verified !== false ? dados.email : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return texto("Método não permitido.", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GMAIL_WEB_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMAIL_WEB_CLIENT_SECRET") ?? "";
  if (!url || !chaveServico) return texto("Função mal configurada.", 500);
  if (!clientId || !clientSecret) return texto("O Gmail por usuário ainda não está configurado (faltam GMAIL_WEB_CLIENT_ID/GMAIL_WEB_CLIENT_SECRET).", 500);
  const redirectUri = Deno.env.get("GMAIL_WEB_REDIRECT_URI") || `${url.replace(/\/+$/, "")}/functions/v1/nucleo-gmail-conectar`;

  const p = new URL(req.url).searchParams;
  const state = p.get("state") ?? "";
  if (!STATE.test(state)) return texto("Pedido inválido. Volte ao Neo Admin e clique em \"Conectar meu Gmail\".");

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conexao } = await banco.rpc("gmail_validar_conexao", { p_state: state });
  const c = conexao as { perfil_id: string; email: string; destino: string } | null;
  if (!c) return texto("A autorização expirou. Volte ao Neo Admin e clique de novo em \"Conectar meu Gmail\".");

  // Recusa no Google.
  if (p.get("error")) return redirecionar(comAviso(c.destino, "recusado"));

  const code = p.get("code");
  // 1) Ida ao Google.
  if (!code) {
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: ESCOPOS,
      access_type: "offline", prompt: "consent", login_hint: c.email, hd: DOMINIO, state,
    }).toString();
    return redirecionar(google.toString());
  }

  // 2) Volta do Google: troca o código pelo refresh token.
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
  });
  if (!resp.ok) return redirecionar(comAviso(c.destino, "erro", "O Google recusou a autorização."));
  const tokens = await resp.json() as { refresh_token?: string; id_token?: string; scope?: string };
  if (!tokens.scope?.includes("gmail.compose")) return redirecionar(comAviso(c.destino, "erro", "Marque a permissão de criar rascunhos no Gmail."));
  const email = emailDoIdToken(tokens.id_token);
  if (!email) return redirecionar(comAviso(c.destino, "erro", "O Google não informou o e-mail da conta."));

  const { error } = await banco.rpc("gmail_concluir_conexao", { p_state: state, p_email: email, p_refresh_token: tokens.refresh_token ?? "" });
  if (error) return redirecionar(comAviso(c.destino, "erro", error.message));
  return redirecionar(comAviso(c.destino, "conectado"));
});
