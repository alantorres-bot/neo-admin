// Edge Function do núcleo (Central de Gestão, Fase 7): envia pelo Slack os avisos pendentes da fila `notificacoes`.
// NADA SAI se `administrativo.gestao.notificacoes_ligadas` estiver desligado (começa desligado) — a função só registra
// por que não enviou. Cada aviso é enviado uma vez (a fila tem chave contra duplicidade); falha tenta de novo até 3 vezes.
//
// Quem chama: o agendamento do banco (pg_cron a cada 15 min, função central_chamar_envios, com o cabeçalho
// `x-notificacoes-segredo` igual ao segredo NOTIFICACOES_SEGREDO, o mesmo valor guardado no Vault como
// `notificacoes_segredo`) ou o admin geral logado (botão "Enviar agora" da tela de avisos).
// Segredos (Supabase > Edge Functions > Secrets): SLACK_BOT_TOKEN (o mesmo do Contas a pagar; escopo chat:write; para
// mensagens diretas o aplicativo precisa poder conversar com a pessoa) e NOTIFICACOES_SEGREDO (32+ caracteres).
//
// Deploy: npx supabase functions deploy nucleo-notificacoes-enviar
import { createClient } from "jsr:@supabase/supabase-js@2";
import { aposFalha, destinoDoAviso, mensagemSlack, MAX_TENTATIVAS, type Notificacao } from "../_shared/notificacoes.ts";

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const LOTE = 50;

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const tokenSlack = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // Quem chama: agendamento (segredo próprio) ou admin geral logado.
  const segredo = req.headers.get("x-notificacoes-segredo") ?? "";
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (segredo) {
    const esperado = Deno.env.get("NOTIFICACOES_SEGREDO") ?? "";
    if (esperado.length < 32 || !iguaisSeguro(segredo, esperado)) return responder({ erro: "Não autorizado." }, 401);
  } else {
    if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: admin } = await comoUsuario.rpc("eh_admin_geral");
    if (admin !== true) return responder({ erro: "Somente o administrador geral envia os avisos." }, 403);
  }

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfg } = await banco.from("configuracoes").select("chave, valor")
    .in("chave", ["administrativo.gestao.notificacoes_ligadas", "administrativo.gestao.slack_canal_gestao", "administrativo.gestao.url_base"]);
  const valor = (c: string) => cfg?.find((x) => x.chave === c)?.valor;
  if (valor("administrativo.gestao.notificacoes_ligadas") !== true) return responder({ ok: true, enviados: 0, motivo: "Envio de avisos desligado." });
  if (!tokenSlack.startsWith("xoxb-")) return responder({ erro: "nao_configurado", detalhe: "Falta o segredo SLACK_BOT_TOKEN." }, 409);
  const canal = typeof valor("administrativo.gestao.slack_canal_gestao") === "string" ? (valor("administrativo.gestao.slack_canal_gestao") as string) : null;
  const urlBase = typeof valor("administrativo.gestao.url_base") === "string" ? (valor("administrativo.gestao.url_base") as string) : "";

  const { data: fila, error } = await banco.from("notificacoes").select("id, evento, destinatario_id, texto, link, tentativas")
    .eq("status", "pendente").lt("tentativas", MAX_TENTATIVAS).order("criado_em").limit(LOTE);
  if (error) return responder({ erro: `Falha ao ler a fila: ${error.message}` }, 500);

  const ids = [...new Set((fila ?? []).map((n) => n.destinatario_id).filter(Boolean))] as string[];
  const { data: perfis } = ids.length ? await banco.from("perfis").select("id, slack_usuario_id, ativo").in("id", ids) : { data: [] };
  const slackDe = new Map((perfis ?? []).filter((p) => p.ativo).map((p) => [p.id as string, (p.slack_usuario_id as string | null) ?? null]));

  let enviados = 0, ignorados = 0, falhas = 0;
  for (const n of (fila ?? []) as Notificacao[]) {
    const alvo = destinoDoAviso(n, n.destinatario_id ? (slackDe.get(n.destinatario_id) ?? null) : null, canal);
    if ("ignorar" in alvo) {
      await banco.from("notificacoes").update({ status: "ignorada", motivo: alvo.ignorar }).eq("id", n.id);
      ignorados++;
      continue;
    }
    try {
      const r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenSlack}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: alvo.destino, text: mensagemSlack(n, urlBase), unfurl_links: false }),
      });
      const json = (await r.json()) as { ok?: boolean; error?: string; ts?: string };
      if (!json.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
      await banco.from("notificacoes").update({ status: "enviada", enviado_em: new Date().toISOString(), id_externo: json.ts ?? null, tentativas: n.tentativas + 1, motivo: null }).eq("id", n.id);
      enviados++;
    } catch (e) {
      const depois = aposFalha(n.tentativas);
      await banco.from("notificacoes").update({ status: depois.status, tentativas: depois.tentativas, motivo: `Slack: ${(e as Error).message}`.slice(0, 500) }).eq("id", n.id);
      falhas++;
    }
  }
  return responder({ ok: true, enviados, ignorados, falhas });
});
