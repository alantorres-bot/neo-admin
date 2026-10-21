// Edge Function do módulo Financeiro/Cartão de crédito: CORRIGE no Consistem um título da fatura que o painel não criou —
// trocar o cartão (complemento, banco, histórico e vencimento), acertar o vencimento ou trocar a conta de fluxo de caixa.
// Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 69 a 71; migration 0176.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), pelos botões da aba Conciliados (com prévia e confirmação).
// Corpo: { "id": "<uuid>" } (reservado por crt_reservar_correcao, que conferiu a chave, o mês em conciliação e os campos).
//   GET lancamentoContasPagar/{id} (antes) → já está com os campos novos: só registra; complemento com mais de 60 caracteres
//   (fora a troca de cartão, que grava um novo de até 60) não é alterado, porque o Consistem cortaria o texto → PUT .../{id} só
//   com os campos da correção → GET de novo (depois) e confere: campos novos e TODO o resto igual. Diferença ou recusa = erro com
//   o antes/depois. Nunca repete sozinho: uma nova tentativa é uma nova correção.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de alteração) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-corrigir-no-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, limparToken } from "../_shared/consistem-receber.ts";
import { alterarTitulo, complementoCabeNaAlteracao, conferirAlteracao, jaAlterado, ROTA_INCLUSAO_LANCAMENTO } from "../_shared/consistem-inclusao.ts";

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
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) corrige títulos no Consistem." }, 403);

  let corpo: { id?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const id = corpo.id && UUID.test(corpo.id) ? corpo.id : null;
  if (!id) return responder({ erro: "Correção inválida." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: item } = await banco.from("crt_correcoes_erp").select("id, ciclo_id, cod_lancamento, tipo, alteracao, situacao, criado_por").eq("id", id).maybeSingle();
  if (!item || item.situacao !== "reservado") return responder({ erro: "Nada a enviar: esta correção já foi feita ou não existe." }, 409);
  if (item.criado_por !== quem.user.id) return responder({ erro: "Só quem conferiu a correção pode enviá-la." }, 403);
  const concluir = (corrigido: boolean, antes: unknown, depois: unknown, resposta: unknown, erro: string | null) =>
    banco.rpc("crt_concluir_correcao", { p_id: id, p_corrigido: corrigido, p_antes: antes, p_depois: depois, p_resposta: resposta, p_erro: erro });

  const { data: ciclo } = await banco.from("crt_ciclos").select("empresa_id").eq("id", item.ciclo_id).maybeSingle();
  const { data: empresa } = ciclo ? await banco.from("empresas").select("codigo_erp").eq("id", ciclo.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) {
    const mensagem = "A empresa do mês não tem o código do Consistem (empresas.codigo_erp).";
    await concluir(false, null, null, null, mensagem);
    return responder({ erro: mensagem }, 400);
  }
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };
  const cod = item.cod_lancamento as string;
  const alteracao = item.alteracao as Record<string, unknown>;
  const detalhe = () => buscarObjeto((u: string, init: { headers: Record<string, string> }) => fetch(u, init), cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${encodeURIComponent(cod)}`);

  const { error: erroInicio } = await banco.rpc("crt_iniciar_correcao", { p_id: id });
  if (erroInicio) return responder({ erro: erroInicio.message }, 409);

  let antes: Record<string, unknown>;
  try {
    antes = await detalhe();
  } catch (e) {
    const mensagem = `Não foi possível ler o lançamento ${cod} no Consistem: ${(e as Error).message}. Nada foi alterado.`;
    await concluir(false, null, null, null, mensagem);
    return responder({ erro: mensagem }, 502);
  }
  if (jaAlterado(antes, alteracao)) {
    await concluir(true, antes, antes, null, null);
    return responder({ ok: true, aviso: `O título ${cod} já estava assim no Consistem: registrado.` });
  }
  // Fora a troca de cartão (que grava um complemento novo de até 60), o Consistem cortaria o complemento ao alterar.
  const longo = item.tipo === "cartao" ? null : complementoCabeNaAlteracao(antes);
  if (longo) {
    await concluir(false, antes, null, null, longo);
    return responder({ erro: longo }, 422);
  }

  const r = await alterarTitulo((u, init) => fetch(u, init), cfg, cod, alteracao, "a correção é conferida pelo detalhe do título");
  if (r.tipo === "erro") {
    await concluir(false, antes, null, r.resposta ?? null, r.mensagem);
    return responder({ erro: r.mensagem }, 422);
  }
  let depois: Record<string, unknown> | null = null;
  try { depois = await detalhe(); } catch { /* fica sem conferência */ }
  if (!depois) {
    const mensagem = `${r.tipo === "incerto" ? r.mensagem : "O Consistem aceitou a correção"}, mas não foi possível ler o lançamento ${cod} depois: confira no Consistem.`;
    await concluir(false, antes, null, r.resposta ?? null, mensagem);
    return responder({ erro: mensagem }, 502);
  }
  const conf = conferirAlteracao(antes, depois, alteracao);
  if (!conf.ok) {
    await concluir(false, antes, depois, r.resposta ?? null, conf.mensagem);
    return responder({ erro: conf.mensagem }, 422);
  }
  await concluir(true, antes, depois, r.resposta ?? null, null);
  return responder({ ok: true, aviso: `Título ${cod} corrigido no Consistem e conferido.` });
});
