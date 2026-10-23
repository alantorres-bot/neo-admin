// Edge Function do núcleo (Central de Gestão, Fase 7): cria no ClickUp as tarefas das pendências marcadas
// "enviar ao ClickUp" (o gestor marca; as tarefas de implementação de sugestões já vêm marcadas). Só ida: guarda o id em
// `pendencias.clickup_task_id` para não duplicar; mudança no ClickUp não altera nem encerra a pendência.
// Só roda com o envio de avisos ligado e a lista configurada (administrativo.gestao.clickup_lista_id).
//
// Quem chama: o admin geral logado (botão "Enviar ao ClickUp agora") ou o agendamento, com `x-notificacoes-segredo`.
// Segredos: CLICKUP_TOKEN (token pessoal de API do ClickUp de uma conta de serviço do workspace) e NOTIFICACOES_SEGREDO.
//
// Deploy: npx supabase functions deploy nucleo-clickup-enviar
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tarefaClickup } from "../_shared/notificacoes.ts";

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

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
  const token = (Deno.env.get("CLICKUP_TOKEN") ?? "").trim();
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const segredo = req.headers.get("x-notificacoes-segredo") ?? "";
  if (segredo) {
    const esperado = Deno.env.get("NOTIFICACOES_SEGREDO") ?? "";
    if (esperado.length < 32 || !iguaisSeguro(segredo, esperado)) return responder({ erro: "Não autorizado." }, 401);
  } else {
    const autorizacao = req.headers.get("Authorization") ?? "";
    if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: admin } = await comoUsuario.rpc("eh_admin_geral");
    if (admin !== true) return responder({ erro: "Somente o administrador geral envia ao ClickUp." }, 403);
  }

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfg } = await banco.from("configuracoes").select("chave, valor")
    .in("chave", ["administrativo.gestao.notificacoes_ligadas", "administrativo.gestao.clickup_lista_id", "administrativo.gestao.url_base"]);
  const valor = (c: string) => cfg?.find((x) => x.chave === c)?.valor;
  if (valor("administrativo.gestao.notificacoes_ligadas") !== true) return responder({ ok: true, criadas: 0, motivo: "Envio desligado." });
  const lista = valor("administrativo.gestao.clickup_lista_id");
  if (!token || typeof lista !== "string") return responder({ erro: "nao_configurado", detalhe: "Faltam o segredo CLICKUP_TOKEN e/ou a lista do ClickUp." }, 409);
  const urlBase = typeof valor("administrativo.gestao.url_base") === "string" ? (valor("administrativo.gestao.url_base") as string) : "";

  const { data: pendencias, error } = await banco.from("pendencias").select("id, titulo, descricao, prazo, criticidade")
    .eq("clickup_enviar", true).is("clickup_task_id", null).in("status", ["aberta", "em_andamento"]).limit(30);
  if (error) return responder({ erro: `Falha ao ler as pendências: ${error.message}` }, 500);

  let criadas = 0;
  const falhas: string[] = [];
  for (const p of pendencias ?? []) {
    try {
      const r = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(lista)}/task`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(tarefaClickup(p, urlBase)),
      });
      const json = (await r.json()) as { id?: string; err?: string };
      if (!r.ok || !json.id) throw new Error(json.err ?? `HTTP ${r.status}`);
      await banco.from("pendencias").update({ clickup_task_id: json.id }).eq("id", p.id);
      criadas++;
    } catch (e) {
      falhas.push(`${p.titulo}: ${(e as Error).message}`.slice(0, 300));
    }
  }
  return responder({ ok: true, criadas, falhas });
});
