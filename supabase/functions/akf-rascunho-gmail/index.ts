// Edge Function do módulo Financeiro/AKF: cria no Gmail o RASCUNHO do e-mail de solicitação de antecipação (André/Kayza),
// com cópia para o financeiro. Nunca envia: só `drafts.create` (escopo gmail.compose). Quem confere e envia é uma pessoa.
//
// Chamada pela ação de servidor da página da solicitação, depois de gravar a mensagem como `rascunho` com a sessão do usuário.
// Corpo (JSON): { mensagem_id, operacao_id }
// Depois do rascunho: liga o id do Gmail à mensagem e marca a solicitação como "solicitada" (akf_marcar_solicitada), que
// registra a interação no histórico de cada título.
//
// Quem pode chamar: usuário logado, operador (ou acima) do Financeiro e autor da mensagem.
// Segredos (os mesmos de rec-rascunho-gmail): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_REMETENTE.
//
// Deploy: npx supabase functions deploy akf-rascunho-gmail
import { createClient } from "jsr:@supabase/supabase-js@2";
import { criarRascunho, GmailErro, lerCredenciais, montarMime, obterAccessToken } from "../_shared/gmail.ts";

const MODULO = "financeiro.akf";

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
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // 1) Quem chama: operador do Financeiro logado.
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
  if (erroPermissao || permitido !== true) return responder({ erro: "Somente operador do Financeiro ou acima cria rascunhos de e-mail." }, 403);
  const usuarioId = quem.user.id;

  let corpo: { mensagem_id?: unknown; operacao_id?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mensagemId = String(corpo.mensagem_id ?? "");
  const operacaoId = String(corpo.operacao_id ?? "");
  if (!UUID.test(mensagemId) || !UUID.test(operacaoId)) return responder({ erro: "Mensagem ou solicitação inválida." }, 400);

  // 2) Credenciais do Gmail (antes de qualquer trabalho): faltando, diz só os NOMES.
  const cred = lerCredenciais((n) => Deno.env.get(n));
  if (!cred.ok) {
    return responder({ erro: `O Gmail ainda não está configurado neste projeto (faltam: ${cred.faltando.join(", ")}). Rode scripts/gmail-autorizar.mjs.` }, 500);
  }

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  // 3) A mensagem: do módulo AKF, do usuário, e-mail, ainda rascunho e sem rascunho já criado.
  const { data: mensagem } = await banco.from("mensagens")
    .select("id, modulo, canal, status, destinatario, cc, assunto, corpo, criado_por, id_externo").eq("id", mensagemId).maybeSingle();
  if (!mensagem || mensagem.modulo !== MODULO || mensagem.canal !== "email") return responder({ erro: "Mensagem não encontrada." }, 404);
  if (mensagem.criado_por !== usuarioId) return responder({ erro: "Só quem criou a mensagem gera o rascunho." }, 403);
  if (mensagem.status !== "rascunho" || mensagem.id_externo) return responder({ erro: "Esta mensagem já tem rascunho ou já foi encerrada." }, 409);

  // 4) A solicitação: em rascunho e ainda sem mensagem.
  const { data: operacao } = await banco.from("akf_operacoes").select("id, numero, status, mensagem_id").eq("id", operacaoId).maybeSingle();
  if (!operacao) return responder({ erro: "Solicitação não encontrada." }, 404);
  if (operacao.status !== "rascunho" || operacao.mensagem_id) return responder({ erro: `A solicitação nº ${operacao.numero} já foi solicitada ou cancelada.` }, 409);

  // 5) Rascunho no Gmail (vários destinatários e cópia).
  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  let rascunho;
  try {
    const mime = montarMime({
      de: cred.credenciais.remetente, para: mensagem.destinatario as string, cc: (mensagem.cc as string | null) ?? null,
      assunto: (mensagem.assunto as string | null) ?? "", corpo: mensagem.corpo as string,
    });
    const acesso = await obterAccessToken(buscar, cred.credenciais);
    rascunho = await criarRascunho(buscar, acesso, mime);
  } catch (e) {
    const texto = e instanceof GmailErro ? e.message : "Falha inesperada ao criar o rascunho.";
    await banco.from("mensagens").update({ erro: texto }).eq("id", mensagemId);
    return responder({ erro: texto }, e instanceof GmailErro && e.status && e.status < 500 ? 400 : 502);
  }

  // 6) Registro: o rascunho na mensagem e a solicitação marcada como solicitada (com as interações por título).
  const { error: erroMensagem } = await banco.from("mensagens").update({ id_externo: rascunho.rascunhoId, erro: null }).eq("id", mensagemId);
  const { error: erroOperacao } = erroMensagem ? { error: erroMensagem } : await banco.rpc("akf_marcar_solicitada", { p_operacao: operacaoId, p_mensagem: mensagemId, p_usuario: usuarioId });
  const aviso = erroMensagem || erroOperacao ? `O rascunho foi criado no Gmail, mas o registro no Neo Admin falhou (${(erroMensagem ?? erroOperacao)?.message}).` : undefined;

  return responder({ ok: true, url: rascunho.url, rascunhoId: rascunho.rascunhoId, aviso });
});
