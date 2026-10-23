// Edge Function do módulo Financeiro > Intimações de cartório: LÊ o Gmail (só leitura) e registra as intimações.
// Especificação: docs/modulos/financeiro-intimacoes-cartorio.md; migration 0181.
//
// Quem chama:
//   - agendamento do banco (fin_int_chamar_leitura, a cada 30 min nos dias úteis, só com financeiro.intimacoes.ler_gmail ligada),
//     com o cabeçalho `x-sincronizacao-segredo` = SINCRONIZACAO_SEGREDO; ou
//   - usuário logado, operador do Financeiro (ou acima), pelo botão "Ler o Gmail agora".
// O que faz: busca as mensagens do 4º Ofício e da CENPROT (CONSULTA_GMAIL), pula as já lidas, lê cada nova (format=full),
// classifica, extrai e chama fin_int_registrar_leitura (que deduplica por e-mail e por intimação). Para a intimação do 4º
// Ofício, ENTRA NO LINK (portal público, como a pessoa que clica; decisão do Alan em 23/10/2026) e registra um protocolo por
// título "intimado", com prazo, total no cartório e custas. Nunca escreve no Gmail nem fala com o Consistem.
// Segredos: GMAIL_LEITURA_CLIENT_ID, GMAIL_LEITURA_CLIENT_SECRET, GMAIL_LEITURA_REFRESH_TOKEN, GMAIL_LEITURA_CAIXA
// (node scripts/gmail-autorizar.mjs --leitura) e SINCRONIZACAO_SEGREDO.
//
// Deploy: npx supabase functions deploy fin-intimacoes-ler-gmail --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { obterAccessToken } from "../_shared/gmail.ts";
import { classificarEmail, CONSULTA_GMAIL, lerEmail, lerMensagemCompletaGmail, lerMensagemGmail, lerPortal4Oficio, listarMensagensGmail } from "../_shared/intimacoes.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const SEGREDOS = ["GMAIL_LEITURA_CLIENT_ID", "GMAIL_LEITURA_CLIENT_SECRET", "GMAIL_LEITURA_REFRESH_TOKEN", "GMAIL_LEITURA_CAIXA"] as const;
/** Mensagens novas lidas por rodada (cada uma é um GET): o resto fica para a próxima. */
const MAX_POR_RODADA = 60;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const segredoRecebido = req.headers.get("x-sincronizacao-segredo") ?? "";
  if (segredoRecebido) {
    const esperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (!esperado || segredoRecebido !== esperado) return responder({ erro: "Não autorizado." }, 401);
  } else {
    const autorizacao = req.headers.get("Authorization") ?? "";
    if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error } = await comoUsuario.auth.getUser();
    if (error || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "financeiro", p_minimo: "operador" });
    if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) lê o Gmail das intimações." }, 403);
  }

  const valores = SEGREDOS.map((n) => (Deno.env.get(n) ?? "").trim());
  const faltando = SEGREDOS.filter((_, i) => valores[i] === "");
  if (faltando.length) {
    return responder({ erro: `A caixa das intimações ainda não foi autorizada: faltam os segredos ${faltando.join(", ")} (node scripts/gmail-autorizar.mjs --leitura).`, faltando }, 503);
  }
  const [clientId, clientSecret, refreshToken, caixa] = valores;
  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const token = await obterAccessToken(buscar, { clientId, clientSecret, refreshToken, remetente: caixa });
    const ids = await listarMensagensGmail(buscar, token, CONSULTA_GMAIL);
    const lidos = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await banco.from("fin_intimacao_emails").select("message_id").in("message_id", ids.slice(i, i + 100));
      if (error) throw new Error(`Não foi possível consultar os e-mails já lidos: ${error.message}`);
      for (const r of data ?? []) lidos.add(r.message_id as string);
    }
    const novos = ids.filter((id) => !lidos.has(id));
    const { data: empresas } = await banco.from("empresas").select("cnpj").eq("ativa", true).not("cnpj", "is", null);
    const documentos = (empresas ?? []).map((e) => String(e.cnpj));
    // Cópias e reenvios do mesmo e-mail trazem o mesmo localizador: o portal é lido uma vez por rodada.
    const portal = new Map<string, Awaited<ReturnType<typeof lerPortal4Oficio>> | { erro: string }>();
    const emails: unknown[] = [];
    const situacoesPortal: Record<string, number> = {};
    const avisosPortal: string[] = [];
    let foraDoFiltro = 0;
    for (const id of novos.slice(0, MAX_POR_RODADA)) {
      const m = await lerMensagemCompletaGmail(buscar, token, id);
      const e = lerMensagemGmail(m);
      const tipo = classificarEmail(e.remetente, e.assunto);
      if (!tipo) { foraDoFiltro++; continue; }
      let intimacoes = lerEmail(tipo, e.html, e.texto);
      const localizador = tipo === "cartorio" ? intimacoes[0]?.localizador : null;
      if (localizador) {
        if (!portal.has(localizador)) {
          try {
            const r = await lerPortal4Oficio(buscar, localizador, documentos);
            portal.set(localizador, r);
            for (const [s, n] of Object.entries(r.situacoes)) situacoesPortal[s] = (situacoesPortal[s] ?? 0) + n;
          } catch (erro) {
            portal.set(localizador, { erro: erro instanceof Error ? erro.message : "falha" });
            avisosPortal.push(`${localizador.slice(0, 8)}: ${erro instanceof Error ? erro.message : "falha"}`);
          }
        }
        const r = portal.get(localizador)!;
        // Portal lido: um registro por protocolo "intimado" (pode ser nenhum, se tudo já foi pago). Falhou: fica o "só localizador".
        if (!("erro" in r)) intimacoes = r.intimacoes;
      }
      emails.push({ messageId: m.id, threadId: m.threadId ?? null, tipo, remetente: e.remetente, assunto: e.assunto, recebidoEm: e.recebidoEm, intimacoes });
    }
    const { data: resumo, error } = emails.length
      ? await banco.rpc("fin_int_registrar_leitura", { p_caixa: caixa, p_emails: emails })
      : { data: { emails: 0, jaLidos: 0, novas: 0, repetidas: 0 }, error: null };
    if (error) throw new Error(`Não foi possível registrar a leitura: ${error.message}`);
    return responder({ ok: true, caixa, encontrados: ids.length, jaLidos: lidos.size, foraDoFiltro, restantes: Math.max(0, novos.length - MAX_POR_RODADA), situacoesPortal, avisosPortal, ...resumo });
  } catch (e) {
    return responder({ erro: e instanceof Error ? e.message : "Falha ao ler o Gmail." }, 502);
  }
});
