// Edge Function do módulo RH/SST > Vale-transporte: consulta no Consistem o fornecedor de cada funcionário (o "Nº" da
// planilha do VT) e devolve nome, CPF e situação. SÓ LEITURA: não grava nada; o painel compara com o cadastro e o operador
// decide o que aplicar. Regras em docs/modulos/rh-vale-transporte.md (seções 4 e 7).
//
// Quem chama: usuário logado, operador do RH (ou acima).
// Corpo: { "empresa_id": "<uuid>", "codigos": ["660", "695", ...] } (até 300 códigos).
// Resposta: { fornecedores: [{ codFornecedor, nome, cpf, ativo }], naoEncontrados: ["..."], erros: [{ codigo, mensagem }] }.
//
// Ação "modelo" (gestor do RH; também SÓ LEITURA): o título de VT já lançado que serve de modelo para os códigos do
// lançamento (histórico, portador, categoria, fluxo, contas contábeis). Regra 11 da especificação.
//   { "acao": "modelo", "empresa_id", "codLancamento": "12345" }        → detalhe desse lançamento
//   { "acao": "modelo", "empresa_id", "codFornecedor": "660", "dias": 120 } → o título (C) mais recente do fornecedor emitido
//                                                                          nos últimos `dias` (até 400), com o detalhe
// Resposta: { detalhe: {...cru da API...}, codLancamento, emissao, complemento, outros: [{codLancamento, emissao, complemento, valor}] }.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy rh-vt-consultar-fornecedor --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, buscarTodasPaginas, ConsistemErro, documentoFormatado, limparToken, PAGINACAO } from "../_shared/consistem-receber.ts";
import { normalizarFornecedorApi, normalizarLancamentoPagar, ROTA_CONTAS_PAGAR, ROTA_DETALHE_LANCAMENTO } from "../_shared/consistem-pagar.ts";

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

  let corpo: { acao?: string; empresa_id?: string; codigos?: unknown; codLancamento?: unknown; codFornecedor?: unknown; dias?: unknown } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  if (!corpo.empresa_id || !UUID.test(corpo.empresa_id)) return responder({ erro: "Empresa inválida." }, 400);
  if (corpo.acao === "modelo") {
    const { data: gestor } = await comoUsuario.rpc("tem_acesso_area", { p_area: "rh", p_minimo: "gestor" });
    if (gestor !== true) return responder({ erro: "Somente gestor do RH (ou acima) consulta o título modelo." }, 403);
  }
  const codigos = Array.isArray(corpo.codigos) ? [...new Set(corpo.codigos.map((c) => String(c).trim().replace(/^0+(?=\d)/, "")))] : [];
  if (corpo.acao !== "modelo" && (codigos.length === 0 || codigos.length > MAX_CODIGOS || codigos.some((c) => !/^\d{1,9}$/.test(c)))) {
    return responder({ erro: `Informe de 1 a ${MAX_CODIGOS} códigos de fornecedor (números).` }, 400);
  }
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  // A empresa é lida com a sessão de quem chama (RLS do núcleo): só serve empresa que a pessoa enxerga.
  const { data: empresa } = await comoUsuario.from("empresas").select("codigo_erp").eq("id", corpo.empresa_id).maybeSingle();
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa não tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };

  if (corpo.acao === "modelo") {
    const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
    try {
      let cod = String(corpo.codLancamento ?? "").trim();
      let outros: { codLancamento: string; emissao: string | null; complemento: string; valor: number }[] = [];
      if (!cod) {
        const fornecedor = String(corpo.codFornecedor ?? "").trim().replace(/^0+(?=\d)/, "");
        if (!/^\d{1,9}$/.test(fornecedor)) return responder({ erro: "Informe o código do lançamento ou do fornecedor." }, 400);
        const dias = Math.min(400, Math.max(1, Number(corpo.dias) || 120));
        const hoje = new Date();
        const ini = new Date(hoje.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
        const regs = await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, { dataEmissaoIni: ini, dataEmissaoFim: hoje.toISOString().slice(0, 10), paginacao: PAGINACAO });
        outros = regs.map(normalizarLancamentoPagar)
          .flatMap((r) => (r.ok && r.lancamento.tipo === "C" && r.lancamento.codFornecedor.replace(/^0+(?=\d)/, "") === fornecedor ? [r.lancamento] : []))
          .sort((a, b) => (b.emissao ?? "").localeCompare(a.emissao ?? "") || Number(b.codLancamento) - Number(a.codLancamento))
          .slice(0, 10)
          .map((l) => ({ codLancamento: l.codLancamento, emissao: l.emissao, complemento: l.complemento, valor: l.valorDocumentoCentavos / 100 }));
        if (!outros.length) return responder({ erro: `Nenhum título do fornecedor ${fornecedor} emitido nos últimos ${dias} dias.` }, 404);
        cod = outros[0].codLancamento;
      }
      if (!/^\d{1,12}$/.test(cod)) return responder({ erro: "Código do lançamento inválido." }, 400);
      const detalhe = await buscarObjeto(buscar, cfg, `${ROTA_DETALHE_LANCAMENTO}/${cod}`);
      return responder({ codLancamento: cod, detalhe, outros });
    } catch (e) {
      return responder({ erro: `Consistem: ${e instanceof Error ? e.message : "falha"}` }, 502);
    }
  }

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
