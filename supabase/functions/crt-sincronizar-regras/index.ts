// Edge Function do módulo Financeiro/Cartão de crédito: copia do Neo Fiscal a regra "fornecedor → cartão" (com vigência)
// para o espelho crt_regras_fornecedor. O cadastro da regra continua só no Neo Fiscal; aqui é cópia de leitura.
//
// Quem pode chamar: operador do Financeiro logado (botão "Atualizar do Neo Fiscal"), o agendamento do banco (pg_cron, com
// x-sincronizacao-segredo = SINCRONIZACAO_SEGREDO) ou a service role.
// Corpo: { "acao": "sincronizar" } (grava) ou { "acao": "simular" } (só conta).
// Segredos: NEO_FISCAL_REGRAS_URL (https://<ref do Neo Fiscal>.supabase.co/functions/v1/cartao-regras) e NEO_FISCAL_SEGREDO
// (o mesmo valor do segredo NEO_ADMIN_SEGREDO da função cartao-regras no Neo Fiscal). Nunca escreve no Neo Fiscal.
//
// Deploy: npx supabase functions deploy crt-sincronizar-regras --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lerResposta, planejar, type RegraGravada } from "../_shared/regras-cartao.ts";

const MODULO = "financeiro.cartao";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  const segredoRecebido = req.headers.get("x-sincronizacao-segredo") ?? "";
  if (!autorizacao && !segredoRecebido) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  let usuarioId: string | null = null;
  if (segredoRecebido) {
    const esperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (esperado.length < 32 || !iguaisSeguro(segredoRecebido, esperado)) return responder({ erro: "Não autorizado." }, 401);
  } else {
    const portador = autorizacao.replace(/^Bearer\s+/i, "");
    if (!iguaisSeguro(portador, chaveServico)) {
      const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
      const { data: quem, error } = await comoUsuario.auth.getUser();
      if (error || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
      const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "financeiro", p_minimo: "operador" });
      if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) atualiza as regras de cartão." }, 403);
      usuarioId = quem.user.id;
    }
  }

  let corpo: { acao?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const simular = corpo.acao === "simular";

  const urlNeoFiscal = Deno.env.get("NEO_FISCAL_REGRAS_URL") ?? "";
  const segredoNeoFiscal = Deno.env.get("NEO_FISCAL_SEGREDO") ?? "";
  if (!urlNeoFiscal.startsWith("https://") || segredoNeoFiscal.length < 32) {
    return responder({ erro: "Integração com o Neo Fiscal não configurada (segredos NEO_FISCAL_REGRAS_URL e NEO_FISCAL_SEGREDO)." }, 500);
  }

  let resposta: Response;
  try {
    resposta = await fetch(urlNeoFiscal, { method: "POST", headers: { "Content-Type": "application/json", "x-neo-admin-segredo": segredoNeoFiscal }, body: "{}" });
  } catch (e) {
    return responder({ erro: `Não foi possível falar com o Neo Fiscal: ${e instanceof Error ? e.message : "falha de rede"}` }, 502);
  }
  let json: unknown = null;
  try { json = await resposta.json(); } catch { /* corpo não-JSON */ }
  if (!resposta.ok) return responder({ erro: `Neo Fiscal respondeu ${resposta.status}${json && typeof json === "object" && "erro" in json ? `: ${(json as { erro: string }).erro}` : ""}.` }, 502);
  const lido = lerResposta(json);
  if (!lido.ok) return responder({ erro: lido.erro }, 502);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: gravadas, error: erroLer } = await banco.from("crt_regras_fornecedor").select("id, cod_fornecedor, cartao, parcelas_padrao, vigencia_ini, vigencia_fim").limit(10000);
  if (erroLer) return responder({ erro: `Falha ao ler o espelho: ${erroLer.message}` }, 500);
  const plano = planejar(lido.regras, (gravadas ?? []) as RegraGravada[]);
  // Trava: resposta vazia com espelho cheio é mais provável falha do que "todas as regras apagadas".
  if (lido.regras.length === 0 && (gravadas ?? []).length > 0) return responder({ erro: "O Neo Fiscal devolveu nenhuma regra; nada foi alterado." }, 502);

  const resumo = { recebidas: lido.regras.length, novas: plano.inserir.length, alteradas: plano.atualizar.length, removidas: plano.remover.length, simulacao: simular };
  if (simular) return responder({ ok: true, ...resumo });

  const agora = new Date().toISOString();
  if (plano.inserir.length) {
    const { error } = await banco.from("crt_regras_fornecedor").insert(plano.inserir.map((r) => ({ ...r, sincronizado_em: agora })));
    if (error) return responder({ erro: `Falha ao gravar regras novas: ${error.message}` }, 500);
  }
  for (const a of plano.atualizar) {
    const { error } = await banco.from("crt_regras_fornecedor").update({ ...a.campos, sincronizado_em: agora }).eq("id", a.id);
    if (error) return responder({ erro: `Falha ao atualizar regra: ${error.message}` }, 500);
  }
  if (plano.remover.length) {
    const { error } = await banco.from("crt_regras_fornecedor").delete().in("id", plano.remover);
    if (error) return responder({ erro: `Falha ao remover regras: ${error.message}` }, 500);
  }
  await banco.from("importacoes").insert({
    modulo: MODULO, tipo: "regras_fornecedor_cartao", arquivo: "api:neo-fiscal",
    linhas_novas: plano.inserir.length, linhas_alteradas: plano.atualizar.length, linhas_baixadas: plano.remover.length, usuario_id: usuarioId,
  });
  return responder({ ok: true, ...resumo });
});
