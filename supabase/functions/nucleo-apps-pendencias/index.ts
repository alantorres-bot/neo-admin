// Edge Function do núcleo: lê o resumo de pendências de cada aplicativo externo (função neo-admin-pendencias de cada um)
// e publica na Central de Gestão (apps_pendencias_publicar, migration 0800). Especificação:
// docs/modulos/administrativo-gestao-aplicativos.md. Nunca escreve nos aplicativos.
//
// Quem pode chamar: o agendamento do banco (pg_cron, x-sincronizacao-segredo = SINCRONIZACAO_SEGREDO), a service role ou
// o admin_geral logado (botão "Ler agora" em Configurações › Aplicativos).
// Corpo: { "acao": "ler", "aplicativo"?: "<codigo>" }. Aplicativo com a leitura DESLIGADA só é lido pelo botão, e aí só
// registra a rodada (os tipos lidos aparecem na tela para escolher os responsáveis), sem publicar nada.
// Segredos: o nome fica em aplicativos.pendencias_segredo (NEO_FISCAL_SEGREDO, NEOCONTROL_SEGREDO); o valor é o mesmo do
// NEO_ADMIN_SEGREDO do aplicativo.
//
// Deploy: npx supabase functions deploy nucleo-apps-pendencias --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lerResposta, montarPendencias } from "../_shared/apps-pendencias.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const hojeCuiaba = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type App = {
  id: string; codigo: string; nome: string; pendencias_ligado: boolean; pendencias_url: string | null;
  pendencias_segredo: string | null; pendencias_responsaveis: Record<string, string>;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  const segredoRecebido = req.headers.get("x-sincronizacao-segredo") ?? "";
  if (!autorizacao && !segredoRecebido) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  let manual = false;
  if (segredoRecebido) {
    const esperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (esperado.length < 32 || !iguaisSeguro(segredoRecebido, esperado)) return responder({ erro: "Não autorizado." }, 401);
  } else if (!iguaisSeguro(autorizacao.replace(/^Bearer\s+/i, ""), chaveServico)) {
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error } = await comoUsuario.auth.getUser();
    if (error || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: admin } = await comoUsuario.rpc("eh_admin_geral");
    if (admin !== true) return responder({ erro: "Somente o administrador geral lê as pendências dos aplicativos." }, 403);
    manual = true;
  }

  let corpo: { aplicativo?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  let consulta = banco.from("aplicativos")
    .select("id, codigo, nome, pendencias_ligado, pendencias_url, pendencias_segredo, pendencias_responsaveis")
    .eq("ativo", true).not("pendencias_modulo", "is", null);
  if (corpo.aplicativo) consulta = consulta.eq("codigo", corpo.aplicativo);
  else consulta = consulta.eq("pendencias_ligado", true);
  const { data: apps, error: erroApps } = await consulta;
  if (erroApps) return responder({ erro: `Falha ao ler os aplicativos: ${erroApps.message}` }, 500);
  if (!manual && corpo.aplicativo && !(apps ?? []).every((a) => a.pendencias_ligado)) return responder({ erro: "Leitura desligada." }, 409);

  const resultados: Record<string, unknown>[] = [];
  for (const app of (apps ?? []) as App[]) {
    const { data: rodada } = await banco.from("apps_pendencias_rodadas").insert({ aplicativo_id: app.id, origem: manual ? "manual" : "agendamento" }).select("id").single();
    const fechar = async (campos: Record<string, unknown>) => {
      if (rodada) await banco.from("apps_pendencias_rodadas").update({ concluido_em: new Date().toISOString(), ...campos }).eq("id", rodada.id);
      resultados.push({ aplicativo: app.codigo, ...campos });
    };
    try {
      const segredo = app.pendencias_segredo ? Deno.env.get(app.pendencias_segredo) ?? "" : "";
      if (!app.pendencias_url || segredo.length < 32) throw new Error(`Integração não configurada (endereço da função e segredo ${app.pendencias_segredo ?? "?"}).`);
      const resposta = await fetch(app.pendencias_url, { method: "POST", headers: { "Content-Type": "application/json", "x-neo-admin-segredo": segredo }, body: "{}", signal: AbortSignal.timeout(60_000) });
      let json: unknown = null;
      try { json = await resposta.json(); } catch { /* corpo não-JSON */ }
      if (!resposta.ok) throw new Error(`${app.nome} respondeu ${resposta.status}${json && typeof json === "object" && "erro" in json ? `: ${(json as { erro: string }).erro}` : ""}.`);
      const lido = lerResposta(json);
      if (!lido.ok) throw new Error(lido.erro);
      const tipos = lido.tipos.map((t) => ({ codigo: t.codigo, titulo: t.titulo, quantidade: t.quantidade }));
      if (!app.pendencias_ligado) {
        await fechar({ ok: true, tipos, erro: "Leitura desligada: nada publicado na Central." });
        continue;
      }
      const pendencias = montarPendencias({ codigo: app.codigo, nome: app.nome, responsaveis: app.pendencias_responsaveis ?? {} }, lido.tipos, hojeCuiaba());
      const { data: pub, error } = await banco.rpc("apps_pendencias_publicar", { p_aplicativo: app.id, p_pendencias: pendencias });
      if (error) throw new Error(`Falha ao publicar: ${error.message}`);
      await fechar({ ok: true, tipos, publicadas: pub?.publicadas ?? 0, encerradas: pub?.encerradas ?? 0 });
    } catch (e) {
      // Sem resposta válida nada se encerra: as pendências ficam como estavam até a próxima leitura.
      await fechar({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return responder({ ok: resultados.every((r) => r.ok !== false), resultados });
});
