// Edge Function do Faturamento da Filial: confere no Consistem o CÓDIGO do cliente de cada kit, pelo CNPJ/CPF lido da nota
// do Syslock. É o "Cliente" que se digita na implantação (CCFT040). Cliente que já tem título vem de `contrapartes`; o que
// ainda não tem só existe no Consistem — por isso esta consulta. SÓ LÊ o Consistem (cadastrosgerais/v10/cliente).
//
// Corpo (JSON): { kit_ids: uuid[] }  →  { ok, resultados: [{ kit_id, documento, codigo, nome }] }
// codigo nulo = CNPJ/CPF não cadastrado no Consistem (o kit fica com o alerta "cadastrar antes de implantar").
//
// Quem pode chamar: usuário logado, operador (ou acima) do Financeiro. A gravação no kit usa a sessão do usuário
// (rec_kit_definir_cliente_erp, com auditoria).
// Segredos: CONSISTEM_API_KEY (o mesmo da sincronização); CONSISTEM_BASE_URL opcional.
//
// Deploy: npx supabase functions deploy rec-filial-cliente-erp --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  BASE_URL_PADRAO, buscarTodasPaginas, ConsistemErro, documentoFormatado, normalizarClienteApi, PAGINACAO, type ConfigConsistem,
} from "../_shared/consistem-receber.ts";

const MODULO = "financeiro.filial";
const MAX_KITS = 100;
const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization");
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("CONSISTEM_API_KEY") ?? "";
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
  if (erroPermissao || permitido !== true) return responder({ erro: "Somente operador do Financeiro ou acima confere clientes no Consistem." }, 403);
  if (token.trim().length < 50) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  let corpo: { kit_ids?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const kitIds = Array.isArray(corpo.kit_ids) ? [...new Set(corpo.kit_ids.map(String))] : [];
  if (kitIds.length === 0 || kitIds.length > MAX_KITS || !kitIds.every((i) => UUID.test(i))) return responder({ erro: "Kits inválidos." }, 400);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: kits, error: erroKits } = await banco.from("rec_kits")
    .select("id, empresa_id, cliente_documento, estagio").in("id", kitIds).not("estagio", "in", "(enviada,cancelada)");
  if (erroKits) return responder({ erro: "Não foi possível ler os kits." }, 500);
  const comDocumento = (kits ?? []).filter((k) => k.cliente_documento);
  if (comDocumento.length === 0) return responder({ ok: true, resultados: [] });

  const { data: empresa } = await banco.from("empresas").select("codigo_erp").eq("id", comDocumento[0].empresa_id).maybeSingle();
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg: ConfigConsistem = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: empresa.codigo_erp as string };

  // Cadastro de clientes ativos do Consistem, indexado pelo CNPJ/CPF formatado (mesma regra do núcleo).
  const porDocumento = new Map<string, { codigo: string; nome: string }>();
  try {
    const registros = await buscarTodasPaginas((u, init) => fetch(u, init), cfg, "cadastrosgerais/v10/cliente", { situacao: 1, paginacao: PAGINACAO });
    for (const r of registros) {
      const c = normalizarClienteApi(r);
      const doc = c ? documentoFormatado(c.documentoBruto) : null;
      if (c && doc && !porDocumento.has(doc)) porDocumento.set(doc, { codigo: c.codCliente, nome: c.nome });
    }
  } catch (e) {
    return responder({ erro: e instanceof ConsistemErro ? e.message : "Falha ao consultar o Consistem." }, 502);
  }

  const resultados: { kit_id: string; documento: string; codigo: string | null; nome: string | null }[] = [];
  for (const k of comDocumento) {
    const achado = porDocumento.get(k.cliente_documento as string) ?? null;
    const { error } = await comoUsuario.rpc("rec_kit_definir_cliente_erp", { p_kit: k.id, p_codigo: achado?.codigo ?? null });
    if (error) return responder({ erro: error.message }, 400);
    resultados.push({ kit_id: k.id as string, documento: k.cliente_documento as string, codigo: achado?.codigo ?? null, nome: achado?.nome ?? null });
  }
  return responder({ ok: true, resultados });
});
