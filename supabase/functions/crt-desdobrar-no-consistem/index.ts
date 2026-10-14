// Edge Function do módulo Financeiro/Cartão de crédito: DESDOBRA no Consistem a compra parcelada cuja NF foi lançada pelo valor
// cheio (regras 61 a 64; migration 0165). Reservado pelo painel (crt_reservar_desdobramento), com o detalhe do título lido antes.
//
// Quem chama: SÓ um usuário logado, operador do Financeiro (ou acima), autor da reserva, pelo botão "Desdobrar no Consistem".
// Corpo: { "lote": "<uuid>" }. Ordem (o passo incerto primeiro, nada é criado se ele falhar):
//   1) GET lancamentoContasPagar/{id}: o título tem de estar como o painel leu (valor, documento, fornecedor, vencimento, pagamento);
//   2) PUT .../{id} só com { valorDocumento, codDocumento, complementoHistorico } (a parcela 1);
//   3) GET de novo e confere: esses três campos novos e TODO o resto igual;
//   4) só então cria as parcelas 2..N (crt_lancamentos_erp do mesmo lote, ../_shared/crt-envio-lote.ts).
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de inclusão e alteração) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-desdobrar-no-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, limparToken } from "../_shared/consistem-receber.ts";
import { alterarTitulo, conferirAlteracao, jaAlterado, ROTA_INCLUSAO_LANCAMENTO } from "../_shared/consistem-inclusao.ts";
import { enviarLoteErp } from "../_shared/crt-envio-lote.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Campos que não podem ter mudado entre a leitura do painel e o envio. */
const ESTAVEIS = ["valorDocumento", "codDocumento", "codFornecedor", "dataVencimento", "valorPago", "dataPagamento"];

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
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) desdobra títulos no Consistem." }, 403);

  let corpo: { lote?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const lote = corpo.lote && UUID.test(corpo.lote) ? corpo.lote : null;
  if (!lote) return responder({ erro: "Lote inválido." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: d, error: erroD } = await banco.from("crt_desdobramentos")
    .select("id, fatura_id, ciclo_id, cod_lancamento, alteracao, antes, criado_por").eq("lote", lote).eq("situacao", "reservado").maybeSingle();
  if (erroD) return responder({ erro: "Não foi possível ler o desdobramento." }, 500);
  if (!d) return responder({ erro: "Nada a enviar: este desdobramento já foi enviado." }, 409);
  if (d.criado_por !== quem.user.id) return responder({ erro: "Só quem conferiu o desdobramento pode enviá-lo." }, 403);
  const { data: fatura } = await banco.from("crt_faturas").select("empresa_id").eq("id", d.fatura_id).maybeSingle();
  const { data: empresa } = fatura ? await banco.from("empresas").select("codigo_erp").eq("id", fatura.empresa_id).maybeSingle() : { data: null };
  const cod = d.cod_lancamento as string;
  const alteracao = d.alteracao as Record<string, unknown>;
  const lido = d.antes as Record<string, unknown>;
  const concluir = async (alterado: boolean, depois: unknown, resposta: unknown, erro: string | null) => {
    await banco.rpc("crt_concluir_desdobramento", { p_id: d.id, p_alterado: alterado, p_depois: depois, p_resposta: resposta, p_erro: erro });
  };
  const falhar = async (status: number, mensagem: string, depois: unknown = null, resposta: unknown = null) => {
    await concluir(false, depois, resposta, mensagem);
    return responder({ ok: false, alterado: false, mensagem }, status);
  };

  const { error: erroInicio } = await banco.rpc("crt_iniciar_desdobramento", { p_id: d.id });
  if (erroInicio) return responder({ erro: erroInicio.message }, 409);
  if (!empresa?.codigo_erp) return falhar(400, "A empresa da fatura não tem o código do Consistem (empresas.codigo_erp).");
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };
  const detalhe = (c: string) => buscarObjeto((u: string, init: { headers: Record<string, string> }) => fetch(u, init), cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${encodeURIComponent(c)}`);
  const enviar = (u: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => fetch(u, init);

  // 1) O título está como o painel leu?
  let antes: Record<string, unknown>;
  try {
    antes = await detalhe(cod);
  } catch (e) {
    return falhar(502, `Não foi possível ler o lançamento ${cod} no Consistem: ${(e as Error).message}. Nada foi alterado.`);
  }
  let resposta: unknown = null;
  let incerto: string | null = null;
  if (!jaAlterado(antes, alteracao)) {
    const mudou = ESTAVEIS.filter((k) => JSON.stringify(antes[k] ?? null) !== JSON.stringify(lido[k] ?? null));
    if (mudou.length) return falhar(409, `O título ${cod} mudou no Consistem desde a leitura (${mudou.join(", ")}). Nada foi alterado: recarregue a página e confira.`, antes);

    // 2) PUT da parcela 1.
    const r = await alterarTitulo(enviar, cfg, cod, alteracao);
    if (r.tipo === "erro") return falhar(422, `${r.mensagem} Nada foi alterado nem criado.`, null, r.resposta ?? null);
    resposta = r.resposta ?? null;
    if (r.tipo === "incerto") incerto = r.mensagem;

    // 3) Conferência pelo detalhe.
    let depois: Record<string, unknown> | null = null;
    for (let i = 0; i < 2 && !depois; i++) {
      try { depois = await detalhe(cod); } catch { /* tenta de novo */ }
    }
    if (!depois) {
      return falhar(502, `${incerto ?? "O Consistem aceitou a alteração"}, mas não foi possível ler o lançamento ${cod} depois. Confira o título no Consistem: se já estiver com o valor da parcela 1, use "Resolver" no desdobramento; senão, "Desdobrar no Consistem" de novo.`, null, resposta);
    }
    const conf = conferirAlteracao(antes, depois, alteracao);
    if (!conf.ok) return falhar(422, incerto && !jaAlterado(depois, alteracao) ? `${incerto} Nada foi criado.` : `${conf.mensagem} As parcelas não foram criadas.`, depois, resposta);
    await concluir(true, depois, resposta, null);
  } else {
    // Já estava com a parcela 1 (tentativa anterior sem resposta): segue para as parcelas.
    await concluir(true, antes, null, null);
  }

  // 4) Parcelas 2..N.
  const { data: itens, error: erroItens } = await banco.from("crt_lancamentos_erp")
    .select("id, parcela, payload, criado_por").eq("lote", lote).eq("situacao", "reservado").order("parcela");
  if (erroItens || !itens) return responder({ ok: false, alterado: true, mensagem: "O título foi alterado, mas não foi possível ler as parcelas: use \"Reenviar o que faltou\"." }, 500);
  const envio = await enviarLoteErp(banco, cfg, lote, itens.map((i) => ({ id: i.id as string, parcela: i.parcela as number | null, payload: i.payload })));
  await banco.rpc("crt_sincronizar_pendencia_desdobramentos", { p_ciclo: d.ciclo_id });
  return responder({ ...envio.corpo, alterado: true, codOriginal: cod }, envio.status);
});
