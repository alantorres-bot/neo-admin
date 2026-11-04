// Edge Function do RH > Portal do Líder: ENVIA (não é rascunho) o pedido do líder, por e-mail, ao RH — decisão do Alan em
// 04/11/2026 (0527). Sai do Gmail do PRÓPRIO líder (conexão "Conectar meu Gmail", 0153) e só para o e-mail do RH configurado
// em rh.portal_lider.email_rh, apenas endereços @neoformas.com.br (comunicação interna; nunca terceiros).
//
// Chamada pela ação de servidor do portal, logo depois de gravar o pedido (e de subir o atestado, se houver).
// Corpo (JSON): { pedido_id, assunto, corpo }  — o texto é montado pelo app (lib/modulos/rh/portal-lider/modulo.ts).
// Quem pode: o líder que criou o pedido (a RLS de rh_ld_solicitacoes confere a liderança). Um envio por pedido.
// Os anexos do pedido (atestado) vão junto. O resultado fica em rh_ld_solicitacoes (rh_ld_registrar_email).
// Segredos: GMAIL_WEB_CLIENT_ID, GMAIL_WEB_CLIENT_SECRET.
// Deploy: npx supabase functions deploy rh-ld-enviar-email --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { enviarMensagem, GmailErro, montarMime, obterAccessToken, type AnexoEmail } from "../_shared/gmail.ts";

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNO = /^[^@\s,;]+@neoformas\.com\.br$/i;
const LIMITE_ANEXOS_BYTES = 20 * 1024 * 1024;

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

  let entrada: { pedido_id?: unknown; assunto?: unknown; corpo?: unknown };
  try {
    entrada = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const pedidoId = String(entrada.pedido_id ?? "");
  const assunto = String(entrada.assunto ?? "").slice(0, 200);
  const corpo = String(entrada.corpo ?? "").slice(0, 8000);
  if (!UUID.test(pedidoId) || !assunto.trim() || !corpo.trim()) return responder({ erro: "Pedido ou texto inválido." }, 400);

  // 1) Quem chama: o líder que criou o pedido (a RLS só mostra pedidos do setor que ele lidera).
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: pedido } = await comoUsuario.from("rh_ld_solicitacoes").select("id, criado_por, email_enviado_em, status").eq("id", pedidoId).maybeSingle();
  if (!pedido || pedido.criado_por !== quem.user.id) return responder({ erro: "Pedido não encontrado." }, 404);
  if (pedido.email_enviado_em) return responder({ erro: "O e-mail deste pedido já foi enviado." }, 409);
  if (pedido.status === "cancelada") return responder({ erro: "Pedido cancelado." }, 409);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const registrar = (emailId: string | null, erro: string | null) => banco.rpc("rh_ld_registrar_email", { p_id: pedidoId, p_email_id: emailId, p_erro: erro });

  // 2) Gmail do líder e destino (só interno).
  const { data: conta } = await banco.rpc("gmail_refresh_token", { p_perfil: quem.user.id });
  const c = conta as { email: string; refresh_token: string } | null;
  if (!c?.refresh_token) {
    await registrar(null, "Gmail do líder não conectado.");
    return responder({ erro: "Conecte o seu Gmail (botão \"Conectar meu Gmail\") para o pedido seguir por e-mail." }, 409);
  }
  const { data: cfg } = await banco.from("configuracoes").select("valor").eq("chave", "rh.portal_lider.email_rh").maybeSingle();
  const para = (Array.isArray(cfg?.valor) ? (cfg!.valor as unknown[]) : []).map(String).filter((e) => INTERNO.test(e));
  if (!para.length) {
    await registrar(null, "E-mail do RH não configurado.");
    return responder({ erro: "O e-mail do RH não está configurado (RH > Portal do Líder)." }, 409);
  }

  // 3) Anexos do pedido (atestado).
  const { data: docs } = await banco.from("anexos").select("arquivo_path, nome_arquivo")
    .eq("referencia_tabela", "rh_ld_solicitacoes").eq("referencia_id", pedidoId).order("enviado_em");
  const anexos: AnexoEmail[] = [];
  let total = 0;
  for (const d of docs ?? []) {
    const { data: blob, error } = await banco.storage.from("anexos").download(d.arquivo_path as string);
    if (error || !blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.length;
    if (total > LIMITE_ANEXOS_BYTES) break;
    anexos.push({ nome: d.nome_arquivo as string, tipo: blob.type || "application/octet-stream", bytes });
  }

  // 4) Envio pelo Gmail do líder.
  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  try {
    const mime = montarMime({ de: c.email, para, assunto, corpo, anexos });
    const acesso = await obterAccessToken(buscar, { clientId, clientSecret, refreshToken: c.refresh_token, remetente: c.email });
    const enviado = await enviarMensagem(buscar, acesso, mime);
    await registrar(enviado.mensagemId, null);
    return responder({ ok: true, para, anexos: anexos.length });
  } catch (e) {
    let texto = e instanceof GmailErro ? e.message : "Falha inesperada ao enviar o e-mail.";
    if (/token de autoriza/i.test(texto)) texto = "A autorização do seu Gmail expirou ou foi revogada: clique em \"Conectar meu Gmail\" de novo.";
    await registrar(null, texto);
    return responder({ erro: texto }, e instanceof GmailErro && e.status && e.status < 500 ? 400 : 502);
  }
});
