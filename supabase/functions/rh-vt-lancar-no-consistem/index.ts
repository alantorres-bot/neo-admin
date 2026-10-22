// Edge Function do RH/SST: lança no Consistem os títulos reservados pelo painel no mês aprovado — do vale-transporte (um por
// colaborador; regra 11 de docs/modulos/rh-vale-transporte.md; migration 0503) e, desde 0521, da folha de pagamento (um por pessoa ×
// tipo; regra 10 de docs/modulos/rh-folha.md). O nome ficou o do VT para não mudar o que já está publicado.
//
// Quem chama: SÓ um usuário logado, operador do RH (ou acima), e só quem reservou o lote. Nada sai sozinho.
// Corpo: { "lote": "<uuid>", "origem"?: "vt" | "folha" } (sem origem = vt). O envio (em ordem, um PUT cada, sem repetir) está em
// ../_shared/rh-envio-lote.ts.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050, com permissão de inclusão) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy rh-vt-lancar-no-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, limparToken } from "../_shared/consistem-receber.ts";
import { enviarLoteRh, type LivroRh } from "../_shared/rh-envio-lote.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORIGENS: Record<string, LivroRh & { itens: string; chave: string }> = {
  vt: { prefixo: "rh_vt", tabela: "rh_vt_lancamentos_erp", itens: "rh_vt_itens", chave: "rh.vale_transporte.lancar_no_erp" },
  folha: { prefixo: "rh_fp", tabela: "rh_fp_lancamentos_erp", itens: "rh_fp_itens", chave: "rh.folha.lancar_no_erp" },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  let corpo: { lote?: string; origem?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const origem = ORIGENS[corpo.origem ?? "vt"];
  if (!origem) return responder({ erro: "Origem inválida." }, 400);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "rh", p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do RH (ou acima) lança títulos no Consistem." }, 403);

  if (!corpo.lote || !UUID.test(corpo.lote)) return responder({ erro: "Lote inválido." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: ligado } = await banco.from("configuracoes").select("valor").eq("chave", origem.chave).maybeSingle();
  if (ligado?.valor !== true) return responder({ erro: "O lançamento no Consistem está desligado (Parâmetros)." }, 409);
  const { data: itens, error: erroItens } = await banco.from(origem.tabela)
    .select("id, item_id, criado_por, payload").eq("lote", corpo.lote).eq("situacao", "reservado").order("ordem");
  if (erroItens) return responder({ erro: "Não foi possível ler os lançamentos." }, 500);
  if (!itens || itens.length === 0) return responder({ erro: "Nada a enviar: os títulos deste lote já foram enviados." }, 409);
  if (itens.some((i) => i.criado_por !== quem.user.id)) return responder({ erro: "Só quem conferiu os títulos pode enviá-los." }, 403);

  // Empresa do Consistem de cada título = a da linha do mês (foto do cadastro).
  const { data: linhas } = await banco.from(origem.itens).select("id, empresa_id").in("id", [...new Set(itens.map((i) => i.item_id as string))]);
  const { data: empresas } = await banco.from("empresas").select("id, codigo_erp").in("id", [...new Set((linhas ?? []).map((l) => l.empresa_id as string))]);
  const codigoErp = new Map((empresas ?? []).map((e) => [e.id as string, e.codigo_erp as string | null]));
  const empresaDoItem = new Map((linhas ?? []).map((l) => [l.id as string, codigoErp.get(l.empresa_id as string) ?? null]));
  const empresaDoLanc = new Map(itens.map((i) => [i.id as string, empresaDoItem.get(i.item_id as string) ?? null]));
  if ([...empresaDoLanc.values()].some((e) => !e)) return responder({ erro: "Há título de empresa sem o código do Consistem (empresas.codigo_erp)." }, 400);

  const baseUrl = Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO;
  const r = await enviarLoteRh(banco, origem, (id) => ({ baseUrl, token, empresa: String(empresaDoLanc.get(id)) }), corpo.lote,
    itens.map((i) => ({ id: i.id as string, payload: i.payload })));
  return responder(r.corpo, r.status);
});
