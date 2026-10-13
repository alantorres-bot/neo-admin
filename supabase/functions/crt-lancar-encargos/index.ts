// Edge Function do módulo Financeiro/Cartão de crédito: lança no Consistem o título de ENCARGOS da fatura (a única escrita do
// Neo Admin no ERP). Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 31 a 36; migration 0137.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), pelo botão "Lançar no Consistem" com conferência.
// Nada de agendamento nem service role de fora: nenhum título sai sozinho.
// Corpo: { "id": "<crt_lancamentos_erp.id reservado pelo painel>" }. O título (payload) foi montado e conferido pelo painel e
// gravado na reserva; aqui ele é enviado tal como está.
// Passos: confere quem chama → marca "enviando" (crt_iniciar_envio_encargos: só uma vez) → PUT lancamentoContasPagar (sem
// repetir) → conclui: lançado (com o código; casa as linhas), erro (4xx: nada criado) ou incerto (fica "enviando": conferir).
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de inclusão) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-lancar-encargos --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, limparToken } from "../_shared/consistem-receber.ts";
import { incluirLancamento } from "../_shared/consistem-inclusao.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

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
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) lança encargos no Consistem." }, 403);

  let corpo: { id?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  if (!corpo.id || !/^[0-9a-f-]{36}$/i.test(corpo.id)) return responder({ erro: "Lançamento inválido." }, 400);

  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: reserva, error: erroReserva } = await banco.from("crt_lancamentos_erp").select("id, fatura_id, situacao, criado_por").eq("id", corpo.id).maybeSingle();
  if (erroReserva || !reserva) return responder({ erro: "Lançamento não encontrado." }, 404);
  if (reserva.criado_por !== quem.user.id) return responder({ erro: "Só quem conferiu o título pode enviá-lo." }, 403);
  if (reserva.situacao !== "reservado") return responder({ erro: "Este lançamento já foi enviado." }, 409);
  const { data: fatura } = await banco.from("crt_faturas").select("empresa_id").eq("id", reserva.fatura_id).maybeSingle();
  const { data: empresa } = fatura ? await banco.from("empresas").select("codigo_erp").eq("id", fatura.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa da fatura não tem o código do Consistem (empresas.codigo_erp)." }, 400);

  const { data: lancamento, error: erroInicio } = await banco.rpc("crt_iniciar_envio_encargos", { p_id: reserva.id });
  if (erroInicio || !lancamento) return responder({ erro: erroInicio?.message ?? "Não foi possível iniciar o envio." }, 409);

  const resultado = await incluirLancamento(
    (u, init) => fetch(u, init),
    { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) },
    (lancamento as { payload: unknown }).payload,
  );

  if (resultado.tipo === "incerto") {
    // Fica "enviando": uma pessoa confere no Consistem e resolve (crt_resolver_lancamento_encargos).
    await banco.from("crt_lancamentos_erp").update({ erro: resultado.mensagem, resposta: resultado.resposta ?? null }).eq("id", reserva.id);
    return responder({ ok: false, tipo: "incerto", mensagem: resultado.mensagem }, 502);
  }
  const { error: erroConcluir } = await banco.rpc("crt_concluir_lancamento_encargos", {
    p_id: reserva.id,
    p_cod: resultado.tipo === "lancado" ? resultado.codLancamento : null,
    p_resposta: resultado.resposta ?? null,
    p_erro: resultado.tipo === "erro" ? resultado.mensagem : null,
  });
  if (erroConcluir) {
    const mensagem = resultado.tipo === "lancado"
      ? `O Consistem criou o lançamento ${resultado.codLancamento}, mas o registro no Neo Admin falhou (${erroConcluir.message}). Resolva à mão com esse código.`
      : `Erro do Consistem não registrado: ${resultado.mensagem}`;
    await banco.from("crt_lancamentos_erp").update({ erro: mensagem }).eq("id", reserva.id);
    return responder({ ok: false, tipo: "incerto", mensagem }, 500);
  }
  if (resultado.tipo === "erro") return responder({ ok: false, tipo: "erro", mensagem: resultado.mensagem }, 422);
  return responder({ ok: true, tipo: "lancado", codLancamento: resultado.codLancamento });
});
