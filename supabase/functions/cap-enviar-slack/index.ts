// Edge Function do módulo Financeiro/Contas a pagar: publica a autorização de pagamento (só o PDF) no canal do financeiro
// no Slack, como o aplicativo "Neo Admin" do Slack, e, no cancelamento, apaga o arquivo/mensagem e publica um aviso curto.
// SÓ roda quando um gestor do Financeiro clica e confirma: nada é enviado sozinho. O PDF é gerado pelo app Next (base64).
//
// Segredos (Supabase > Edge Functions > Secrets): SLACK_BOT_TOKEN (token xoxb- do aplicativo, escopos chat:write e
// files:write; o aplicativo precisa estar no canal). O canal vem de configuracoes (financeiro.contas-pagar.slack_canal_id).
//
// Corpo (JSON), campo `acao`:
//   enviar   { autorizacaoId, pdfBase64, nomeArquivo, titulo }   publica o PDF (sem texto)
//   cancelar { autorizacaoId, aviso }                              apaga o PDF/mensagem e publica o aviso
// Resposta: { ok: true, permalink? } ou { erro }
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

/** Chamada à Web API. `files.getUploadURLExternal` e `files.info` só aceitam formulário (x-www-form-urlencoded); os demais aceitam JSON. */
async function slack(metodo: string, token: string, corpo: Record<string, unknown>, formato: "json" | "form" = "json"): Promise<Record<string, unknown>> {
  const form = new URLSearchParams();
  if (formato === "form") for (const [k, v] of Object.entries(corpo)) form.set(k, String(v));
  const r = await fetch(`https://slack.com/api/${metodo}`, {
    method: "POST",
    headers: formato === "form"
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }
      : { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: formato === "form" ? form.toString() : JSON.stringify(corpo),
  });
  const json = (await r.json()) as Record<string, unknown>;
  if (!json.ok) throw new Error(`Slack ${metodo}: ${String(json.error ?? "falha")}`);
  return json;
}

/** ts da mensagem que compartilhou o arquivo no canal (files[0].shares.public|private[canal][0].ts). */
function tsDoCompartilhamento(arquivo: Record<string, unknown> | undefined, canal: string): string | null {
  const shares = (arquivo?.shares ?? {}) as Record<string, Record<string, { ts?: string }[]>>;
  for (const tipo of ["public", "private"]) {
    const porCanal = shares[tipo]?.[canal];
    if (Array.isArray(porCanal) && porCanal[0]?.ts) return String(porCanal[0].ts);
  }
  return null;
}

function traduzirErro(mensagemErro: string): { texto: string; status: number } {
  if (/not_in_channel|channel_not_found/.test(mensagemErro)) {
    return { texto: "O aplicativo Neo Admin não está no canal do financeiro. No Slack, abra o canal e use /invite @Neo Admin.", status: 400 };
  }
  if (/invalid_auth|token_revoked|account_inactive|missing_scope/.test(mensagemErro)) {
    return { texto: `Token do Slack inválido ou sem permissão (${mensagemErro}).`, status: 400 };
  }
  return { texto: `Não foi possível falar com o Slack: ${mensagemErro}`, status: 500 };
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
  if (erroPermissao || permitido !== true) return responder({ erro: "Somente gestor do Financeiro (ou acima) pode enviar ou retirar a autorização no Slack." }, 403);

  if (!tokenSlack.startsWith("xoxb-")) {
    return responder({ erro: "nao_configurado", detalhe: "O aplicativo do Slack ainda não está configurado (segredo SLACK_BOT_TOKEN)." }, 409);
  }

  let corpo: { acao?: string; autorizacaoId?: string; pdfBase64?: string; nomeArquivo?: string; titulo?: string; aviso?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const acao = corpo.acao ?? "enviar";
  const { autorizacaoId } = corpo;
  if (!autorizacaoId || !/^[0-9a-f-]{36}$/i.test(autorizacaoId)) return responder({ erro: "Dados incompletos." }, 400);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfg } = await banco.from("configuracoes").select("valor").eq("chave", CHAVE_CANAL).maybeSingle();
  const canal = typeof cfg?.valor === "string" ? cfg.valor : "";
  if (!/^[CG][A-Z0-9]{8,}$/.test(canal)) return responder({ erro: "nao_configurado", detalhe: "O canal do financeiro no Slack não está configurado." }, 409);

  const { data: a, error: erroA } = await banco.from("cap_autorizacoes").select("id, codigo, status, slack_file_id, slack_message_ts").eq("id", autorizacaoId).maybeSingle();
  if (erroA || !a) return responder({ erro: "Autorização não encontrada." }, 404);

  try {
    if (acao === "cancelar") {
      // Apaga o arquivo (a mensagem de compartilhamento vai junto) e, por garantia, a mensagem; depois publica o aviso.
      const avisos: string[] = [];
      if (a.slack_file_id) {
        try {
          await slack("files.delete", tokenSlack, { file: a.slack_file_id });
        } catch (e) {
          if (!/file_not_found|file_deleted/.test(String(e))) avisos.push(e instanceof Error ? e.message : "files.delete");
        }
      }
      if (a.slack_message_ts) {
        try {
          await slack("chat.delete", tokenSlack, { channel: canal, ts: a.slack_message_ts });
        } catch (e) {
          if (!/message_not_found/.test(String(e))) avisos.push(e instanceof Error ? e.message : "chat.delete");
        }
      }
      const aviso = (corpo.aviso ?? "").trim().slice(0, 500) || `Autorização de pagamento ${a.codigo} cancelada.`;
      await slack("chat.postMessage", tokenSlack, { channel: canal, text: aviso });
      await banco.from("cap_autorizacoes").update({ slack_retirada_em: new Date().toISOString(), slack_permalink: null }).eq("id", autorizacaoId);
      return responder({ ok: true, avisos });
    }

    // enviar
    const { pdfBase64, nomeArquivo } = corpo;
    if (!pdfBase64 || !nomeArquivo) return responder({ erro: "Dados incompletos." }, 400);
    if (pdfBase64.length > LIMITE_PDF * 1.4) return responder({ erro: "PDF grande demais." }, 413);
    if (a.status === "cancelada") return responder({ erro: "Autorização cancelada não é enviada." }, 400);
    const pdf = base64ParaBytes(pdfBase64);
    const titulo = (corpo.titulo ?? "").trim().slice(0, 200) || `Autorização de pagamento ${a.codigo}`;
    // Upload em 3 passos (files.uploadV2): pede URL, envia bytes, conclui no canal. Sem texto: só o PDF.
    const passo1 = await slack("files.getUploadURLExternal", tokenSlack, { filename: nomeArquivo, length: pdf.length }, "form");
    const conteudo = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    const envio = await fetch(passo1.upload_url as string, { method: "POST", body: new Blob([conteudo], { type: "application/pdf" }) });
    if (!envio.ok) throw new Error(`Slack upload: HTTP ${envio.status}`);
    const passo3 = await slack("files.completeUploadExternal", tokenSlack, {
      files: [{ id: passo1.file_id, title: titulo }],
      channel_id: canal,
    });
    const arquivos = (passo3.files as Record<string, unknown>[] | undefined) ?? [];
    const arquivo = arquivos[0];
    const permalink = (arquivo?.permalink as string | undefined) ?? null;
    const fileId = (arquivo?.id as string | undefined) ?? (passo1.file_id as string);
    // O ts do compartilhamento às vezes só aparece depois: tenta no retorno e, se faltar, consulta files.info.
    let ts = tsDoCompartilhamento(arquivo, canal);
    if (!ts) {
      try {
        const info = await slack("files.info", tokenSlack, { file: fileId }, "form");
        ts = tsDoCompartilhamento(info.file as Record<string, unknown> | undefined, canal);
      } catch {
        // sem ts: o cancelamento apaga pelo arquivo
      }
    }

    const { error: erroUpd } = await banco.from("cap_autorizacoes")
      .update({ slack_enviada_em: new Date().toISOString(), slack_enviada_por: quem.user.id, slack_permalink: permalink, slack_file_id: fileId, slack_message_ts: ts, slack_retirada_em: null })
      .eq("id", autorizacaoId);
    if (erroUpd) return responder({ ok: true, permalink, aviso: `Enviado, mas o registro do envio falhou: ${erroUpd.message}` });
    return responder({ ok: true, permalink });
  } catch (e) {
    const t = traduzirErro(e instanceof Error ? e.message : "falha");
    return responder({ erro: t.texto }, t.status);
  }
});
