// Edge Function do módulo Financeiro/Cartão de crédito: troca no Consistem o PORTADOR (banco) e o HISTÓRICO dos títulos da
// fatura do mês fechado para os códigos do cartão (crt_cartoes.portador_fatura / historico_fatura): o financeiro filtra o
// borderô (CCFFE065) pelo histórico (migrations 0162 e 0164).
// Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 56 a 60; migration 0162.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), pelo fechamento do mês ou pelo botão "Trocar de novo".
// Corpo: { "lote": "<uuid>" } (reservado por crt_reservar_trocas). Para cada título, em ordem:
//   GET lancamentoContasPagar/{id} (antes) → se já está marcado, só registra; senão PUT .../{id} com { codPortador, codHistorico }
//   → GET de novo (depois) e confere: portador novo e TODO o resto igual. Diferença = erro com o antes/depois (corrigir no ERP)
//   e o lote para. Trocar o portador é idempotente: a decisão é sempre pelo que o Consistem mostra depois.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de alteração) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-trocar-portador --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, limparToken } from "../_shared/consistem-receber.ts";
import { alterarPortador, conferirTroca, jaMarcado, ROTA_INCLUSAO_LANCAMENTO } from "../_shared/consistem-inclusao.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codigoDe = (d: Record<string, unknown> | null, campo: string) => {
  const n = Number(d?.[campo]);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const portadorDe = (d: Record<string, unknown> | null) => codigoDe(d, "codPortador");

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
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) troca o banco dos títulos no Consistem." }, 403);

  let corpo: { lote?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const lote = corpo.lote && UUID.test(corpo.lote) ? corpo.lote : null;
  if (!lote) return responder({ erro: "Lote inválido." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: itens, error: erroItens } = await banco.from("crt_trocas_portador")
    .select("id, ciclo_id, cod_lancamento, portador_novo, historico_novo, criado_por").eq("lote", lote).eq("situacao", "reservado").order("cod_lancamento");
  if (erroItens) return responder({ erro: "Não foi possível ler as trocas." }, 500);
  if (!itens || itens.length === 0) return responder({ erro: "Nada a enviar: as trocas deste lote já foram feitas." }, 409);
  const { data: ciclo } = await banco.from("crt_ciclos").select("empresa_id").eq("id", itens[0].ciclo_id).maybeSingle();
  const { data: empresa } = ciclo ? await banco.from("empresas").select("codigo_erp").eq("id", ciclo.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) {
    await banco.rpc("crt_interromper_trocas", { p_lote: lote, p_motivo: "A empresa do mês não tem o código do Consistem (empresas.codigo_erp)." });
    return responder({ erro: "A empresa do mês não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  }
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
  const detalhe = (cod: string) => buscarObjeto(buscar, cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${encodeURIComponent(cod)}`);
  const enviar = (u: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => fetch(u, init);

  const trocados: string[] = [];
  const erros: { cod: string; mensagem: string }[] = [];
  for (const item of itens) {
    const cod = item.cod_lancamento as string;
    const marcas = { codPortador: item.portador_novo as number, codHistorico: (item.historico_novo as number | null) ?? null };
    const { error: erroInicio } = await banco.rpc("crt_iniciar_troca", { p_id: item.id });
    if (erroInicio) { erros.push({ cod, mensagem: erroInicio.message }); continue; }
    let historicoAnterior: number | null = null;
    const concluir = (trocado: boolean, anterior: number | null, antes: unknown, depois: unknown, resposta: unknown, erro: string | null) =>
      banco.rpc("crt_concluir_troca", {
        p_id: item.id, p_trocado: trocado, p_portador_anterior: anterior, p_historico_anterior: historicoAnterior, p_antes: antes, p_depois: depois, p_resposta: resposta, p_erro: erro,
      });

    let antes: Record<string, unknown>;
    try {
      antes = await detalhe(cod);
    } catch (e) {
      const mensagem = `Não foi possível ler o lançamento ${cod} no Consistem: ${(e as Error).message}`;
      await concluir(false, null, null, null, null, mensagem);
      erros.push({ cod, mensagem });
      continue;
    }
    const anterior = portadorDe(antes);
    historicoAnterior = codigoDe(antes, "codHistorico");
    if (jaMarcado(antes, marcas)) {
      await concluir(true, anterior, antes, antes, null, null);
      trocados.push(cod);
      continue;
    }
    const r = await alterarPortador(enviar, cfg, cod, marcas);
    if (r.tipo === "erro") {
      await concluir(false, anterior, antes, null, r.resposta ?? null, r.mensagem);
      erros.push({ cod, mensagem: r.mensagem });
      // Recusa de acesso vale para todos: não insiste nos seguintes.
      if (/Acesso negado|excesso de requisições/.test(r.mensagem)) break;
      continue;
    }
    let depois: Record<string, unknown> | null = null;
    try { depois = await detalhe(cod); } catch { /* fica sem conferência */ }
    if (!depois) {
      const mensagem = `${r.tipo === "incerto" ? r.mensagem : "O Consistem aceitou a troca"}, mas não foi possível ler o lançamento ${cod} depois: confira o portador no Consistem e use "Trocar de novo".`;
      await concluir(false, anterior, antes, null, r.resposta ?? null, mensagem);
      erros.push({ cod, mensagem });
      continue;
    }
    const conf = conferirTroca(antes, depois, marcas);
    if (conf.ok) {
      await concluir(true, anterior, antes, depois, r.resposta ?? null, null);
      trocados.push(cod);
      continue;
    }
    const mensagem = r.tipo === "incerto" && !jaMarcado(depois, marcas) ? r.mensagem : conf.mensagem;
    await concluir(false, anterior, antes, depois, r.resposta ?? null, mensagem);
    erros.push({ cod, mensagem });
    // O PUT mexeu em outros campos: para o lote (os demais ficam como erro, para conferir antes de tentar de novo).
    if (conf.diferencas.length) break;
  }
  await banco.rpc("crt_interromper_trocas", { p_lote: lote, p_motivo: "Envio interrompido: confira o erro do título anterior antes de tentar de novo." });
  return responder({ ok: erros.length === 0, trocados, erros });
});
