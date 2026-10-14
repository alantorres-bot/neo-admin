// Edge Function do módulo RH/SST > Vale-transporte: consulta no Consistem o fornecedor de cada funcionário (o "Nº" da
// planilha do VT) e devolve nome, CPF e situação. SÓ LEITURA: não grava nada; o painel compara com o cadastro e o operador
// decide o que aplicar. Regras em docs/modulos/rh-vale-transporte.md (seções 4 e 7).
//
// Quem chama: usuário logado, operador do RH (ou acima).
// Corpo: { "empresa_id": "<uuid>", "codigos": ["660", "695", ...] } (até 300 códigos).
// Resposta: { fornecedores: [{ codFornecedor, nome, cpf, ativo }], naoEncontrados: ["..."], erros: [{ codigo, mensagem }] }.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy rh-vt-consultar-fornecedor --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, ConsistemErro, documentoFormatado, limparToken } from "../_shared/consistem-receber.ts";
import { normalizarFornecedorApi } from "../_shared/consistem-pagar.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CODIGOS = 300;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !chaveAnonima) return responder({ erro: "Função mal configurada." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "rh", p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do RH (ou acima) consulta fornecedores do vale-transporte." }, 403);

  let corpo: { empresa_id?: string; codigos?: unknown } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  if (!corpo.empresa_id || !UUID.test(corpo.empresa_id)) return responder({ erro: "Empresa inválida." }, 400);
  const codigos = Array.isArray(corpo.codigos) ? [...new Set(corpo.codigos.map((c) => String(c).trim().replace(/^0+(?=\d)/, "")))] : [];
  if (codigos.length === 0 || codigos.length > MAX_CODIGOS || codigos.some((c) => !/^\d{1,9}$/.test(c))) {
    return responder({ erro: `Informe de 1 a ${MAX_CODIGOS} códigos de fornecedor (números).` }, 400);
  }
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  // A empresa é lida com a sessão de quem chama (RLS do núcleo): só serve empresa que a pessoa enxerga.
  const { data: empresa } = await comoUsuario.from("empresas").select("codigo_erp").eq("id", corpo.empresa_id).maybeSingle();
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };

  const fornecedores: { codFornecedor: string; nome: string; cpf: string | null; ativo: boolean }[] = [];
  const naoEncontrados: string[] = [];
  const erros: { codigo: string; mensagem: string }[] = [];
  for (const cod of codigos) {
    try {
      const bruto = await buscarObjeto((u, init) => fetch(u, init), cfg, `cadastrosgerais/v10/fornecedor/${cod}`);
      const f = normalizarFornecedorApi(bruto);
      if (!f || f.codFornecedor.replace(/^0+(?=\d)/, "") !== cod) { naoEncontrados.push(cod); continue; }
      fornecedores.push({ codFornecedor: cod, nome: f.nome, cpf: f.documentoBruto ? documentoFormatado(f.documentoBruto) : null, ativo: f.ativo });
    } catch (e) {
      if (e instanceof ConsistemErro && e.status === 404) { naoEncontrados.push(cod); continue; }
      if (e instanceof ConsistemErro && (e.status === 401 || e.status === 403)) return responder({ erro: `Consistem: ${e.message}` }, 502);
      erros.push({ codigo: cod, mensagem: e instanceof Error ? e.message : "falha" });
    }
  }
  return responder({ fornecedores, naoEncontrados, erros });
});
