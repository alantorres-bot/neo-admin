// Edge Function do módulo Financeiro/Cartão de crédito: lança no Consistem os títulos reservados pelo painel — o título de
// ENCARGOS do mês, os títulos de COMPRA sem título (todas as parcelas restantes), o agrupado, o provisório e o reenvio das
// parcelas do desdobramento. Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 31 a 43; migrations 0137 e 0138.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), pelos botões com conferência. Nada sai sozinho.
// Corpo: { "lote": "<uuid>" } (ou { "id": "<uuid>" }, que vale pelo lote do lançamento). O envio (em ordem, um PUT cada, sem
// repetir, parando no primeiro que não voltar lançado) está em ../_shared/crt-envio-lote.ts.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de inclusão) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-lancar-no-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, limparToken } from "../_shared/consistem-receber.ts";
import { enviarLoteErp } from "../_shared/crt-envio-lote.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "financeiro", p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) lança no Consistem." }, 403);

  let corpo: { lote?: string; id?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  let lote = corpo.lote && UUID.test(corpo.lote) ? corpo.lote : null;
  if (!lote && corpo.id && UUID.test(corpo.id)) {
    const { data } = await banco.from("crt_lancamentos_erp").select("lote").eq("id", corpo.id).maybeSingle();
    lote = (data?.lote as string | undefined) ?? null;
  }
  if (!lote) return responder({ erro: "Lançamento inválido." }, 400);

  const { data: itens, error: erroItens } = await banco.from("crt_lancamentos_erp")
    .select("id, fatura_id, ciclo_id, tipo, situacao, criado_por, parcela, payload").eq("lote", lote).eq("situacao", "reservado").order("parcela", { nullsFirst: true });
  if (erroItens) return responder({ erro: "Não foi possível ler os lançamentos." }, 500);
  if (!itens || itens.length === 0) return responder({ erro: "Nada a enviar: os títulos deste lote já foram enviados." }, 409);
  if (itens.some((i) => i.criado_por !== quem.user.id)) return responder({ erro: "Só quem conferiu os títulos pode enviá-los." }, 403);
  const { data: fatura } = await banco.from("crt_faturas").select("empresa_id").eq("id", itens[0].fatura_id).maybeSingle();
  const { data: empresa } = fatura ? await banco.from("empresas").select("codigo_erp").eq("id", fatura.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa da fatura não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };

  const r = await enviarLoteErp(banco, cfg, lote, itens.map((i) => ({ id: i.id as string, parcela: i.parcela as number | null, payload: i.payload })));
  // Parcelas do desdobramento: a pendência "Desdobrar no Consistem" acompanha o que faltou.
  if (itens[0].tipo === "desdobramento") await banco.rpc("crt_sincronizar_pendencia_desdobramentos", { p_ciclo: itens[0].ciclo_id });
  return responder(r.corpo, r.status);
});
