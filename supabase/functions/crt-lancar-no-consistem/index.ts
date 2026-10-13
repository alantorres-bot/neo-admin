// Edge Function do módulo Financeiro/Cartão de crédito: lança no Consistem os títulos reservados pelo painel — o título de
// ENCARGOS do mês e os títulos de COMPRA sem título (todas as parcelas restantes). É a única escrita do Neo Admin no ERP.
// Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 31 a 43; migrations 0137 e 0138.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), pelos botões com conferência. Nada sai sozinho.
// Corpo: { "lote": "<uuid>" } (ou { "id": "<uuid>" }, que vale pelo lote do lançamento). Os títulos (payload) foram montados e
// conferidos pelo painel e gravados na reserva; aqui são enviados tal como estão, EM ORDEM, um PUT cada, sem repetir.
// Para no primeiro que não voltar lançado: erro (4xx, nada criado) ou incerto (fica "enviando": conferir no Consistem). Os
// seguintes viram "erro: envio interrompido" e podem ser reenviados pelo painel.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de inclusão) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-lancar-no-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, limparToken } from "../_shared/consistem-receber.ts";
import { incluirLancamento } from "../_shared/consistem-inclusao.ts";

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
    .select("id, fatura_id, situacao, criado_por, parcela, payload").eq("lote", lote).eq("situacao", "reservado").order("parcela", { nullsFirst: true });
  if (erroItens) return responder({ erro: "Não foi possível ler os lançamentos." }, 500);
  if (!itens || itens.length === 0) return responder({ erro: "Nada a enviar: os títulos deste lote já foram enviados." }, 409);
  if (itens.some((i) => i.criado_por !== quem.user.id)) return responder({ erro: "Só quem conferiu os títulos pode enviá-los." }, 403);
  const { data: fatura } = await banco.from("crt_faturas").select("empresa_id").eq("id", itens[0].fatura_id).maybeSingle();
  const { data: empresa } = fatura ? await banco.from("empresas").select("codigo_erp").eq("id", fatura.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa da fatura não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };

  const lancados: { parcela: number | null; codLancamento: string }[] = [];
  for (const item of itens) {
    const { error: erroInicio } = await banco.rpc("crt_iniciar_envio_erp", { p_id: item.id });
    if (erroInicio) {
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: não foi possível iniciar o envio." });
      return responder({ ok: false, tipo: "erro", lancados, mensagem: erroInicio.message }, 409);
    }
    const r = await incluirLancamento((u, init) => fetch(u, init), cfg, item.payload);
    if (r.tipo === "incerto") {
      await banco.from("crt_lancamentos_erp").update({ erro: r.mensagem, resposta: r.resposta ?? null }).eq("id", item.id);
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: o título anterior ficou sem resposta do Consistem." });
      return responder({ ok: false, tipo: "incerto", lancados, mensagem: r.mensagem }, 502);
    }
    const { error: erroConcluir } = await banco.rpc("crt_concluir_lancamento_erp", {
      p_id: item.id, p_cod: r.tipo === "lancado" ? r.codLancamento : null, p_resposta: r.resposta ?? null, p_erro: r.tipo === "erro" ? r.mensagem : null,
    });
    if (erroConcluir) {
      const mensagem = r.tipo === "lancado"
        ? `O Consistem criou o lançamento ${r.codLancamento}, mas o registro no Neo Admin falhou (${erroConcluir.message}). Resolva à mão com esse código.`
        : `Erro do Consistem não registrado: ${r.mensagem}`;
      await banco.from("crt_lancamentos_erp").update({ erro: mensagem }).eq("id", item.id);
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido." });
      return responder({ ok: false, tipo: "incerto", lancados, mensagem }, 500);
    }
    if (r.tipo === "erro") {
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: o título anterior foi recusado pelo Consistem." });
      return responder({ ok: false, tipo: "erro", lancados, mensagem: r.mensagem }, 422);
    }
    lancados.push({ parcela: item.parcela as number | null, codLancamento: r.codLancamento });
  }
  return responder({ ok: true, tipo: "lancado", lancados, codLancamento: lancados[0]?.codLancamento });
});
