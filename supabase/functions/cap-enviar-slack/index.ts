// Edge Function do módulo Financeiro/Contas a pagar: publica a autorização de pagamento (mensagem + PDF) no canal do
// financeiro no Slack, como o aplicativo "Neo Admin" do Slack. SÓ roda quando um gestor do Financeiro clica em
// "Enviar no Slack" e confirma: nada é enviado sozinho. O PDF é gerado pelo app Next e chega aqui em base64.
//
// Segredos (Supabase > Edge Functions > Secrets): SLACK_BOT_TOKEN (token xoxb- do aplicativo, com os escopos chat:write e
// files:write; o aplicativo precisa estar no canal). O canal vem de configuracoes (financeiro.contas-pagar.slack_canal_id).
//
// Corpo (JSON): { autorizacaoId, mensagem, pdfBase64, nomeArquivo }
// Resposta: { ok: true, permalink } ou { erro }
//
// Deploy: npx supabase functions deploy cap-enviar-slack
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODULO = "financeiro.contas-pagar";
const CHAVE_CANAL = "financeiro.contas-pagar.slack_canal_id";
const LIMITE_PDF = 8 * 1024 * 1024;

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function slack(metodo: string, token: string, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`https://slack.com/api/${metodo}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(corpo),
  });
  const json = (await r.json()) as Record<string, unknown>;
  if (!json.ok) throw new Error(`Slack ${metodo}: ${String(json.error ?? "falha")}`);
  return json;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const tokenSlack = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // Só gestor do Financeiro logado (verify_jwt = false no gateway: a conferência é aqui).
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "gestor" });
  if (erroPermissao || permitido !== true) return responder({ erro: "Somente gestor do Financeiro (ou acima) pode enviar a autorização no Slack." }, 403);

  if (!tokenSlack.startsWith("xoxb-")) {
    return responder({ erro: "nao_configurado", detalhe: "O aplicativo do Slack ainda não está configurado (segredo SLACK_BOT_TOKEN)." }, 409);
  }

  let corpo: { autorizacaoId?: string; mensagem?: string; pdfBase64?: string; nomeArquivo?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const { autorizacaoId, mensagem, pdfBase64, nomeArquivo } = corpo;
  if (!autorizacaoId || !/^[0-9a-f-]{36}$/i.test(autorizacaoId) || !mensagem || !pdfBase64 || !nomeArquivo) return responder({ erro: "Dados incompletos." }, 400);
  if (pdfBase64.length > LIMITE_PDF * 1.4) return responder({ erro: "PDF grande demais." }, 413);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfg } = await banco.from("configuracoes").select("valor").eq("chave", CHAVE_CANAL).maybeSingle();
  const canal = typeof cfg?.valor === "string" ? cfg.valor : "";
  if (!/^[CG][A-Z0-9]{8,}$/.test(canal)) return responder({ erro: "nao_configurado", detalhe: "O canal do financeiro no Slack não está configurado." }, 409);

  // A autorização existe e não está cancelada (quem chama já passou pela RLS no app; aqui é a service role).
  const { data: a, error: erroA } = await banco.from("cap_autorizacoes").select("id, numero, status").eq("id", autorizacaoId).maybeSingle();
  if (erroA || !a) return responder({ erro: "Autorização não encontrada." }, 404);
  if (a.status === "cancelada") return responder({ erro: "Autorização cancelada não é enviada." }, 400);

  try {
    const pdf = base64ParaBytes(pdfBase64);
    // Upload em 3 passos (files.uploadV2): pede URL, envia bytes, conclui no canal com a mensagem.
    const passo1 = await slack("files.getUploadURLExternal", tokenSlack, { filename: nomeArquivo, length: pdf.length });
    const envio = await fetch(passo1.upload_url as string, { method: "POST", body: new Blob([pdf], { type: "application/pdf" }) });
    if (!envio.ok) throw new Error(`Slack upload: HTTP ${envio.status}`);
    const passo3 = await slack("files.completeUploadExternal", tokenSlack, {
      files: [{ id: passo1.file_id, title: `Autorização de pagamento nº ${a.numero}` }],
      channel_id: canal,
      initial_comment: mensagem,
    });
    const arquivos = (passo3.files as { permalink?: string }[] | undefined) ?? [];
    const permalink = arquivos[0]?.permalink ?? null;

    const { error: erroUpd } = await banco.from("cap_autorizacoes")
      .update({ slack_enviada_em: new Date().toISOString(), slack_enviada_por: quem.user.id, slack_permalink: permalink })
      .eq("id", autorizacaoId);
    if (erroUpd) return responder({ ok: true, permalink, aviso: `Enviado, mas o registro do envio falhou: ${erroUpd.message}` });
    return responder({ ok: true, permalink });
  } catch (e) {
    const mensagemErro = e instanceof Error ? e.message : "falha";
    if (/not_in_channel|channel_not_found/.test(mensagemErro)) {
      return responder({ erro: "O aplicativo Neo Admin não está no canal do financeiro. No Slack, abra o canal e use /invite @Neo Admin." }, 400);
    }
    if (/invalid_auth|token_revoked|account_inactive|missing_scope/.test(mensagemErro)) {
      return responder({ erro: `Token do Slack inválido ou sem permissão (${mensagemErro}).` }, 400);
    }
    return responder({ erro: `Não foi possível publicar no Slack: ${mensagemErro}` }, 500);
  }
});
