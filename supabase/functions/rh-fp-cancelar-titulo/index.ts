// Edge Function do RH/SST (folha de pagamento): CANCELA no Neo Admin um título que o painel lançou no Consistem, depois de
// conferir pela API que ele foi excluído lá (migration 0533; docs/modulos/rh-folha.md, regra 10). A API do Consistem não tem
// exclusão: o título é excluído à mão no ERP; aqui só se registra, com a resposta lida como evidência.
//
// Quem chama: SÓ um usuário logado, gestor do RH (ou acima), pelo botão "Cancelar" do quadro "Contas a pagar no Consistem".
// Corpo: { "id": "<uuid do rh_fp_lancamentos_erp>", "motivo": "..." }.
//   GET financeiro/v10/lancamentoContasPagar/{cod}:
//     "Lançamento não cadastrado!" (400) ou 404 → rh_fp_cancelar_lancamento_conferido (lançado → cancelado, com a evidência);
//     existe com pagamento → recusa (estorno de baixa é com o financeiro, no ERP);
//     existe em aberto → recusa (exclua no Consistem primeiro);
//     qualquer outra resposta → nada muda (tentar de novo).
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de consulta) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: só por scripts/publicar.mjs (docs/PUBLICACAO.md, seção 4.1).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, ConsistemErro, limparToken } from "../_shared/consistem-receber.ts";
import { conferirParaCancelar, ROTA_DETALHE_LANCAMENTO } from "../_shared/consistem-pagar.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reais = (centavos: number | null) => centavos === null ? "" : ` R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  let corpo: { id?: string; motivo?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const motivo = String(corpo.motivo ?? "").trim().slice(0, 300);
  if (!corpo.id || !UUID.test(corpo.id)) return responder({ erro: "Lançamento inválido." }, 400);
  if (motivo.length < 3) return responder({ erro: "Informe o motivo (ex.: valor errado; excluído no Consistem em dd/mm)." }, 400);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "rh", p_minimo: "gestor" });
  if (permitido !== true) return responder({ erro: "Somente gestor do RH (ou acima) cancela títulos da folha." }, 403);

  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: lanc } = await banco.from("rh_fp_lancamentos_erp").select("id, item_id, situacao, cod_lancamento_erp").eq("id", corpo.id).maybeSingle();
  if (!lanc) return responder({ erro: "Lançamento não encontrado." }, 404);
  if (lanc.situacao !== "lancado" || !lanc.cod_lancamento_erp) return responder({ erro: "Só um título lançado pode ser cancelado." }, 409);
  const cod = String(lanc.cod_lancamento_erp);

  // Empresa do Consistem = a da linha do mês (a mesma usada no envio).
  const { data: item } = await banco.from("rh_fp_itens").select("empresa_id").eq("id", lanc.item_id).maybeSingle();
  const { data: empresa } = item ? await banco.from("empresas").select("codigo_erp").eq("id", item.empresa_id).maybeSingle() : { data: null };
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa do título está sem o código do Consistem (empresas.codigo_erp)." }, 400);

  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };
  let leitura: Parameters<typeof conferirParaCancelar>[1];
  try {
    leitura = { detalhe: await buscarObjeto((u: string, init: { headers: Record<string, string> }) => fetch(u, init), cfg, `${ROTA_DETALHE_LANCAMENTO}/${encodeURIComponent(cod)}`) };
  } catch (e) {
    leitura = { erro: { status: e instanceof ConsistemErro ? e.status : undefined, mensagem: (e as Error).message } };
  }
  const r = conferirParaCancelar(cod, leitura);
  if (r.tipo === "pago") {
    return responder({ erro: `O título ${cod} já tem pagamento no Consistem${reais(r.valorPagoCentavos)}${r.dataPagamento ? ` em ${r.dataPagamento.split("-").reverse().join("/")}` : ""}: não pode ser cancelado aqui. O estorno da baixa é com o financeiro, no Consistem.` }, 409);
  }
  if (r.tipo === "em_aberto") return responder({ erro: `O título ${cod} ainda existe no Consistem. Exclua-o lá primeiro e depois cancele aqui.` }, 409);
  if (r.tipo === "incerto") return responder({ erro: `${r.mensagem} Nada foi alterado.` }, 502);

  const evidencia = { codLancamento: cod, conferido_em: new Date().toISOString(), resposta: "erro" in leitura ? leitura.erro : leitura.detalhe };
  const { error } = await banco.rpc("rh_fp_cancelar_lancamento_conferido", { p_id: lanc.id, p_usuario: quem.user.id, p_motivo: motivo, p_evidencia: evidencia });
  if (error) return responder({ erro: error.message }, 409);
  return responder({ ok: true, aviso: `Título ${cod} cancelado (excluído no Consistem, conferido agora).` });
});
