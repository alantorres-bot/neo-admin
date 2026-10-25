// Supabase SIMULADO para os testes de interface do GED (playwright.ged.config.ts). Só testes: dados fictícios, nada sai da
// máquina, nenhum banco, nenhum Google. Responde às rotas que a tela /configuracoes/documentos usa:
//   /auth/v1/user (o getClaims do app confere tokens HS256 aqui), /rest/v1/<tabela>, /rest/v1/rpc/<função> e a Edge Function
//   /functions/v1/nucleo-ged-conectar (GET simula a ida e volta do Google; POST simula a desconexão).
// O cenário é trocado pelo teste em POST /__cenario; GET /__chamadas devolve o que o app pediu.
// Uso: node e2e/supabase-simulado.mjs <porta> <url-do-app>
import { createServer } from "node:http";

const PORTA = Number(process.argv[2] ?? 54399);
const APP = process.argv[3] ?? "http://127.0.0.1:3113";
const ADMIN = "00000000-0000-4000-8000-0000000000a1"; // qualquer outro id é tratado como usuário comum (área Contratos, gestor)

const padrao = () => ({
  usuario: ADMIN, // ADMIN | COMUM
  semMigration: false,
  situacao: null, // linha de ged_situacao_conexao (projeção) ou null
  conta: "ged.drive@exemplo.invalid",
  revogar: true,
  iniciarErro: null, // { code, message }
  retorno: { ged: "conectado", codigo: null }, // como a Edge Function voltaria do Google
  desconectarErro: false,
  desconectarAtrasoMs: 0,
  revogacao: "ok",
});
let cenario = padrao();
let chamadas = [];

const json = (res, status, corpo, extra = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(corpo === undefined ? "" : JSON.stringify(corpo));
};
const lerCorpo = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });
const perfil = (id) => ({
  id, nome: id === ADMIN ? "Admin Exemplo" : "Comum Exemplo", email: id === ADMIN ? "admin@exemplo.invalid" : "comum@exemplo.invalid",
  admin_geral: id === ADMIN, ativo: true, deve_trocar_senha: false, unidade_restrita: null,
});
const AREAS = [
  { codigo: "contratos", nome: "Contratos", sensivel: false, ordem: 3 },
  { codigo: "administrativo", nome: "Administrativo geral", sensivel: false, ordem: 6 },
];

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
  const corpo = await lerCorpo(req);
  const p = url.pathname;

  // Controle do teste.
  if (p === "/__cenario") { cenario = { ...padrao(), ...JSON.parse(corpo || "{}") }; chamadas = []; return json(res, 200, { ok: true }); }
  if (p === "/__chamadas") return json(res, 200, chamadas);
  chamadas.push({ metodo: req.method, caminho: p, busca: url.search, autorizacao: req.headers.authorization ? "Bearer …" : null, corpo });

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
    return res.end();
  }

  // Auth: devolve o usuário do cenário para qualquer token (o app só manda o token do cookie de teste).
  if (p === "/auth/v1/user") {
    const id = cenario.usuario;
    return json(res, 200, { id, aud: "authenticated", role: "authenticated", email: perfil(id).email, app_metadata: { provider: "google" }, user_metadata: {} });
  }
  if (p.startsWith("/auth/v1/")) return json(res, 400, { error: "nao_simulado" });

  // RPC.
  if (p.startsWith("/rest/v1/rpc/")) {
    const nome = p.slice("/rest/v1/rpc/".length);
    if (nome === "ged_situacao_conexao") {
      if (cenario.semMigration) return json(res, 404, { code: "PGRST202", message: "Could not find the function public.ged_situacao_conexao" });
      return json(res, 200, cenario.usuario === ADMIN && cenario.situacao ? [cenario.situacao] : []);
    }
    if (nome === "ged_iniciar_conexao") {
      if (cenario.iniciarErro) return json(res, 400, cenario.iniciarErro);
      return json(res, 200, "f".repeat(64));
    }
    return json(res, 200, null);
  }

  // Tabelas.
  if (p.startsWith("/rest/v1/")) {
    const tabela = p.slice("/rest/v1/".length);
    const objeto = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    let linhas = [];
    if (tabela === "perfis") linhas = [perfil(cenario.usuario)];
    else if (tabela === "permissoes") linhas = cenario.usuario === ADMIN ? [] : [{ area: "contratos", nivel: "gestor" }];
    else if (tabela === "areas") linhas = AREAS;
    else if (tabela === "configuracoes" && req.method === "PATCH") {
      // Gravação da conta (RLS configuracoes_admin): só o admin; o filtro tem de ser exatamente a chave da conta.
      if (cenario.usuario !== ADMIN) return json(res, 403, { code: "42501", message: "new row violates row-level security policy" });
      if (url.searchParams.get("chave") !== "eq.administrativo.ged.conta") return json(res, 400, { message: "filtro_inesperado" });
      cenario.conta = JSON.parse(corpo).valor;
      linhas = [{ chave: "administrativo.ged.conta" }];
    } else if (tabela === "configuracoes") {
      linhas = [
        { chave: "administrativo.ged.conta", valor: cenario.conta },
        { chave: "administrativo.ged.revogar_no_google", valor: cenario.revogar },
      ];
    }
    return json(res, 200, objeto ? (linhas[0] ?? null) : linhas);
  }

  // Edge Function nucleo-ged-conectar (simulada).
  if (p === "/functions/v1/nucleo-ged-conectar") {
    if (req.method === "GET") {
      // Simula a ida ao Google e a volta já tratada pela função real: só códigos fixos na URL.
      const volta = new URL("/configuracoes/documentos", APP);
      volta.searchParams.set("ged", cenario.retorno.ged);
      if (cenario.retorno.codigo) volta.searchParams.set("codigo", cenario.retorno.codigo);
      if (cenario.retorno.ged === "conectado") {
        cenario.situacao = {
          email: cenario.conta, escopos: ["openid", "https://www.googleapis.com/auth/drive.readonly"], conectado_em: new Date().toISOString(),
          desconectado_em: null, revogacao_remota: null, ultimo_erro: null, ultimo_erro_em: null, situacao: "conectada",
        };
      }
      res.writeHead(302, { Location: volta.toString() });
      return res.end();
    }
    if (req.method === "POST") {
      if (cenario.desconectarAtrasoMs) await new Promise((ok) => setTimeout(ok, cenario.desconectarAtrasoMs));
      if (cenario.desconectarErro) return json(res, 500, { erro: "falha simulada" });
      if (cenario.situacao) cenario.situacao = { ...cenario.situacao, situacao: "desconectada", desconectado_em: new Date().toISOString(), revogacao_remota: cenario.revogacao };
      return json(res, 200, { desconectado: true, revogacao: cenario.revogacao });
    }
  }

  return json(res, 404, { message: "nao_simulado" });
}).listen(PORTA, "127.0.0.1", () => console.log(`supabase-simulado em http://127.0.0.1:${PORTA}`));
