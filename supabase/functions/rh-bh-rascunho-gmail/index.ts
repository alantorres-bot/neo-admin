// Edge Function do RH > Banco de horas: cria, no Gmail de QUEM CHAMA, o RASCUNHO do e-mail ao líder do setor com quem tem
// crédito vencendo (para programar a compensação). Nunca envia: só drafts.create (gmail.compose). A pessoa confere e envia.
//
// Chamada pela ação de servidor da tela de saldos, depois de gravar a mensagem como `rascunho` com a sessão do usuário.
// Corpo (JSON): { mensagem_id }
// Quem pode: operador do módulo rh.banco_horas, autor da mensagem, com o Gmail conectado (nucleo-gmail-conectar).
// Segredos: GMAIL_WEB_CLIENT_ID, GMAIL_WEB_CLIENT_SECRET.
// Deploy: npx supabase functions deploy rh-bh-rascunho-gmail --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { criarRascunho, GmailErro, montarMime, obterAccessToken } from "../_shared/gmail.ts";

const MODULO = "rh.banco_horas";
const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization");
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GMAIL_WEB_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMAIL_WEB_CLIENT_SECRET") ?? "";
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);
  if (!clientId || !clientSecret) return responder({ erro: "O Gmail por usuário ainda não está configurado neste projeto." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do RH cria este rascunho." }, 403);
  const usuarioId = quem.user.id;

  let corpo: { mensagem_id?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mensagemId = String(corpo.mensagem_id ?? "");
  if (!UUID.test(mensagemId)) return responder({ erro: "Mensagem inválida." }, 400);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conta } = await banco.rpc("gmail_refresh_token", { p_perfil: usuarioId });
  const c = conta as { email: string; refresh_token: string } | null;
  if (!c?.refresh_token) return responder({ erro: "Conecte o seu Gmail antes (botão \"Conectar meu Gmail\")." }, 409);

  const { data: mensagem } = await banco.from("mensagens")
    .select("id, modulo, canal, status, destinatario, cc, assunto, corpo, criado_por, id_externo").eq("id", mensagemId).maybeSingle();
  if (!mensagem || mensagem.modulo !== MODULO || mensagem.canal !== "email") return responder({ erro: "Mensagem não encontrada." }, 404);
  if (mensagem.criado_por !== usuarioId) return responder({ erro: "Só quem criou a mensagem gera o rascunho." }, 403);
  if (mensagem.status !== "rascunho" || mensagem.id_externo) return responder({ erro: "Esta mensagem já tem rascunho." }, 409);

  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  let rascunho;
  try {
    const mime = montarMime({
      de: c.email, para: mensagem.destinatario as string, cc: (mensagem.cc as string | null) ?? null,
      assunto: (mensagem.assunto as string | null) ?? "", corpo: mensagem.corpo as string,
    });
    const acesso = await obterAccessToken(buscar, { clientId, clientSecret, refreshToken: c.refresh_token, remetente: c.email });
    rascunho = await criarRascunho(buscar, acesso, mime);
  } catch (e) {
    let texto = e instanceof GmailErro ? e.message : "Falha inesperada ao criar o rascunho.";
    if (/token de autoriza/i.test(texto)) texto = "A autorização do seu Gmail expirou ou foi revogada: clique em \"Conectar meu Gmail\" de novo.";
    await banco.from("mensagens").update({ erro: texto }).eq("id", mensagemId);
    return responder({ erro: texto }, e instanceof GmailErro && e.status && e.status < 500 ? 400 : 502);
  }
  const { error } = await banco.from("mensagens").update({ id_externo: rascunho.rascunhoId, erro: null }).eq("id", mensagemId);
  return responder({ ok: true, url: rascunho.url, aviso: error ? `O rascunho foi criado no Gmail, mas o registro no Neo Admin falhou (${error.message}).` : undefined });
});
