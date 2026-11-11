// Supabase SIMULADO para a homologação visual da Gestão de Parcelamentos (playwright.parcelamentos.config.ts). Só máquina local.
// Diferente do simulador do GED, o banco é REAL: PGlite com TODAS as migrations do repositório (tests/db/harness.ts), e cada
// pedido roda com o papel e o usuário da sessão (RLS e funções valendo). Imita o mínimo do PostgREST que as telas usam:
//   GET/HEAD /rest/v1/<tabela|view>?select=&<col>=<op>.<valor>&order=&limit=   (eq, neq, gt, gte, lt, lte, is, in, like, ilike, not.*)
//   POST /rest/v1/rpc/<função>                                                (argumentos nomeados)
//   /auth/v1/user                                                              (sessão do cookie de teste)
//   POST /functions/v1/fin-parcelamentos-sincronizar                           (repete a CARGA gravada: não chama o Consistem)
// Carga: arquivo JSON { lancamentos, fornecedores, detalhes } (lista e detalhes já normalizados, como a Edge Function grava).
// Sem arquivo, usa só a amostra de nov/2026 dos testes. NUNCA aponta para produção; nada sai da máquina.
// Uso: node e2e/parcelamentos-simulado.mjs <porta> [carga.json]
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const PORTA = Number(process.argv[2] ?? 54398);
const CARGA = process.argv[3];
const raiz = process.cwd();
const { criarBanco, novoUsuario, como } = await import(pathToFileURL(join(raiz, "tests/db/harness.ts")).href);

// ------------------------------------------------------------------ banco e cenário
const t0 = Date.now();
const db = await criarBanco();
const usuarios = {
  admin: await novoUsuario(db, "admin.teste@neoformas.com.br"),
  gestor: await novoUsuario(db, "gestor.teste@neoformas.com.br", { financeiro: "gestor" }),
  operador: await novoUsuario(db, "operador.teste@neoformas.com.br", { financeiro: "operador" }),
  consulta: await novoUsuario(db, "consulta.teste@neoformas.com.br", { financeiro: "consulta" }),
  semacesso: await novoUsuario(db, "rh.teste@neoformas.com.br", { rh: "gestor" }),
};
for (const [k, id] of Object.entries(usuarios)) await db.query(`update perfis set nome = $2 where id = $1`, [id, `${k[0].toUpperCase()}${k.slice(1)} (teste)`]);
const empresa = (await db.query(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas (teste)', 'Neo Formas', '1') returning id`)).rows[0].id;

let carga;
if (CARGA) carga = JSON.parse(readFileSync(CARGA, "utf8"));
else {
  // Versionado: a amostra de nov/2026 dos testes (nomes de pessoas já trocados) + um C pago SINTÉTICO do mesmo lote (out/2026),
  // para as telas mostrarem a baixa ("Baixa vista em") sem carga externa.
  const { AMOSTRA_NOV26 } = await import(pathToFileURL(join(raiz, "tests/db/par-amostra-nov26.ts")).href);
  const base = AMOSTRA_NOV26.find((l) => l.codLancamento === "12482");
  const pagoSintetico = { ...base, codLancamento: "12481", tipo: "C", numDocumento: "8003-10/26", vencimento: "2026-10-30", valorDocumentoCentavos: 229_573, saldoCentavos: 0 };
  const lancamentos = [...AMOSTRA_NOV26, pagoSintetico];
  carga = { lancamentos, fornecedores: ["336", "475", "917", "986"], detalhes: lancamentos.map((l) => ({ encontrado: true, ...l, valorPagoCentavos: l.tipo === "C" ? l.valorDocumentoCentavos : 0 })) };
}
const detalhePorCodigo = new Map(carga.detalhes.map((d) => [d.codLancamento, d]));

const servico = (sql, p = []) => como(db, "service", () => db.query(sql, p));
// Repete o que a Edge Function faz numa rodada, com a carga gravada no lugar do Consistem.
async function rodada(agendada, usuarioId) {
  const id = (await servico(`select par_iniciar_sincronizacao($1, $2, $3) as id`, [empresa, agendada, usuarioId])).rows[0].id;
  const lista = (await servico(`select par_registrar_lista($1, $2::jsonb, $3::text[]) as r`, [empresa, JSON.stringify(carga.lancamentos), carga.fornecedores])).rows[0].r;
  const cods = (await servico(`select par_para_detalhar($1, $2::text[], 400) as r`, [empresa, lista.foraDaLista])).rows[0].r;
  const det = cods.map((c) => detalhePorCodigo.get(c) ?? { codLancamento: c, encontrado: false });
  const detalhes = det.length ? (await servico(`select par_registrar_detalhes($1, $2::jsonb) as r`, [empresa, JSON.stringify(det)])).rows[0].r : {};
  const resumo = { empresa: "Neo Formas", registrosNaApi: carga.lancamentos.length, fornecedoresListados: carga.fornecedores,
    projecoes: carga.lancamentos.filter((l) => l.tipo === "P").length, titulosC: carga.lancamentos.filter((l) => l.tipo === "C").length,
    ...lista, foraDaLista: lista.foraDaLista.length, detalhesPedidos: cods.length, detalhes, falhasDetalhe: [], detalhesAdiados: 0, simulado: true };
  await servico(`select par_concluir_sincronizacao($1, null, $2::jsonb)`, [id, JSON.stringify(resumo)]);
  return resumo;
}
// Carga inicial: rodadas até não sobrar detalhe pendente (como clicar "Atualizar" algumas vezes).
for (let i = 0; i < 8; i++) {
  const r = await rodada(false, usuarios.operador);
  if (r.detalhesPedidos < 400) break;
}
// Alguns parcelamentos criados a partir das sugestões (como o gestor faria) e um manual, para as telas terem conteúdo.
const comoGestor = (sql, p) => como(db, usuarios.gestor, () => db.query(sql, p));
for (const [chave, descricao, natureza] of [
  ["986:8003", "PGE/MT — CDA ICMS 2025658003", "estadual"], ["475:0419", "SEFAZ/MT — Parc. ICMS Neo Formas", "estadual"],
  ["336:9982", "Receita — Parc. 3429982 (pessoa física)", "federal"], ["917:5409", "PGFN 015205406 — eSocial (Alutec)", "federal"],
  ["986:1533", "PGE/MT — CDA 20262271533", "estadual"],
]) {
  const existe = (await db.query(`select 1 from par_lancamentos where chave_erp = $1`, [chave])).rows.length;
  if (existe) await comoGestor(`select par_salvar_parcelamento(null, $1::jsonb)`, [JSON.stringify({ empresaId: empresa, chaveErp: chave, descricao, natureza, credor: "" })]);
}
const manual = (await comoGestor(`select par_salvar_parcelamento(null, $1::jsonb) as id`, [JSON.stringify({ empresaId: empresa, descricao: "Prefeitura de Cuiabá — ISS (manual, teste)", natureza: "municipal", qtdParcelas: 10, valorOriginal: "5000.00" })])).rows[0].id;
await comoGestor(`select par_adicionar_parcela($1, '2026-12', '2026-12-20', 500.00, 1, 'parcela manual de teste')`, [manual]);
console.log(`banco pronto em ${Math.round((Date.now() - t0) / 1000)} s; ${carga.lancamentos.length} lançamentos na carga`);

// ------------------------------------------------------------------ PostgREST mínimo
let fila = Promise.resolve();
const emSerie = (fn) => { const p = fila.then(fn, fn); fila = p.catch(() => {}); return p; }; // PGlite: uma conexão, um pedido por vez

const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`identificador inválido: ${s}`), { http: 400 }); return `"${s}"`; };
const valoresIn = (v) => v.replace(/^\(|\)$/g, "").match(/("([^"\\]|\\.)*"|[^,]+)/g)?.map((x) => x.replace(/^"|"$/g, "")) ?? [];
function filtro(col, expr, params) {
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf(".");
  const op = expr.slice(0, i), val = expr.slice(i + 1);
  const c = ident(col);
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case "eq": sql = `${c}::text = ${p(val)}`; break;
    case "neq": sql = `${c}::text <> ${p(val)}`; break;
    case "gt": case "gte": case "lt": case "lte": {
      const sinal = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]; sql = `${c} ${sinal} ${p(val)}`; break;
    }
    case "is": sql = `${c} is ${({ null: "null", true: "true", false: "false" })[val] ?? "null"}`; break;
    case "in": sql = `${c}::text = any(${p(valoresIn(val))}::text[])`; break;
    case "like": sql = `${c}::text like ${p(val.replaceAll("*", "%"))}`; break;
    case "ilike": sql = `${c}::text ilike ${p(val.replaceAll("*", "%"))}`; break;
    default: throw Object.assign(new Error(`operador não simulado: ${op}`), { http: 400 });
  }
  return neg ? `not (${sql})` : sql;
}
function montarSelect(tabela, busca, cabecalhoContagem) {
  const params = [];
  const colunas = (busca.get("select") ?? "*").split(",").map((c) => (c === "*" ? "*" : ident(c.trim()))).join(", ");
  const where = [];
  for (const [k, v] of busca) if (!["select", "order", "limit", "offset"].includes(k)) where.push(filtro(k, v, params));
  const ordem = (busca.get("order") ?? "").split(",").filter(Boolean).map((o) => {
    const [c, ...mods] = o.split(".");
    return `${ident(c)} ${mods.includes("desc") ? "desc" : "asc"}${mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : ""}`;
  });
  const base = `from ${ident(tabela)}${where.length ? ` where ${where.join(" and ")}` : ""}`;
  const sql = `select ${colunas} ${base}${ordem.length ? ` order by ${ordem.join(", ")}` : ""}${busca.get("limit") ? ` limit ${Number(busca.get("limit"))}` : ""}${busca.get("offset") ? ` offset ${Number(busca.get("offset"))}` : ""}`;
  return { sql, contagem: cabecalhoContagem ? `select count(*)::int as n ${base}` : null, params };
}

async function chamarRpc(nome, args) {
  const f = (await db.query(`select p.proretset, pg_get_function_result(p.oid) as res, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nome])).rows[0];
  if (!f) throw Object.assign(new Error(`Could not find the function public.${nome}`), { code: "PGRST202", http: 404 });
  const nomes = f.proargnames ?? [];
  const partes = [], params = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    const i = nomes.indexOf(k);
    if (i < 0) throw Object.assign(new Error(`argumento desconhecido: ${k}`), { http: 400 });
    const tipo = f.tipos[i];
    params.push(v === null || v === undefined ? null : tipo === "jsonb" ? JSON.stringify(v) : Array.isArray(v) ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
    partes.push(`${ident(k)} => $${params.length}::${tipo}`);
  }
  const chamada = `${ident(nome)}(${partes.join(", ")})`;
  if (f.proretset) return (await db.query(`select to_jsonb(x) as r from ${chamada} x`, params)).rows.map((r) => r.r);
  const r = (await db.query(`select to_jsonb(${chamada}) as r`, params)).rows[0]?.r ?? null;
  return f.res === "void" ? null : r;
}

// ------------------------------------------------------------------ servidor
const json = (res, status, corpo, extra = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...extra }); res.end(corpo === undefined ? "" : JSON.stringify(corpo)); };
const lerCorpo = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });
const subDoToken = (auth) => {
  const t = (auth ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
  try { return JSON.parse(Buffer.from(t, "base64url").toString()).sub ?? null; } catch { return null; }
};
const erroPg = (res, e) => {
  if (e.http) return json(res, e.http, { code: e.code ?? "PGRST100", message: e.message });
  // P0001 = raise exception das funções (mensagem para a pessoa); 42501 = permissão
  return json(res, e.code === "42501" ? 403 : 400, { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
};
const pedidos = [];

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
  const corpo = await lerCorpo(req);
  const p = url.pathname;
  if (p === "/__usuarios") return json(res, 200, usuarios);
  if (p === "/__pedidos") return json(res, 200, pedidos);
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }); return res.end(); }
  const sub = subDoToken(req.headers.authorization);
  pedidos.push({ metodo: req.method, caminho: p, busca: url.search.slice(0, 300), usuario: Object.entries(usuarios).find(([, id]) => id === sub)?.[0] ?? null });

  if (p === "/auth/v1/user") {
    if (!sub) return json(res, 401, { message: "sem sessão" });
    const email = (await db.query(`select email from perfis where id = $1`, [sub])).rows[0]?.email;
    return json(res, 200, { id: sub, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "google" }, user_metadata: {} });
  }
  if (p.startsWith("/auth/v1/")) return json(res, 400, { error: "nao_simulado" });

  const quem = sub ?? "anon";
  if (p.startsWith("/rest/v1/rpc/")) {
    return emSerie(async () => {
      try { return json(res, 200, await como(db, quem, () => chamarRpc(p.slice("/rest/v1/rpc/".length), corpo ? JSON.parse(corpo) : {}))); }
      catch (e) { return erroPg(res, e); }
    });
  }
  if (p.startsWith("/rest/v1/")) {
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { code: "PGRST000", message: "escrita direta não simulada (o módulo grava por funções)" });
    return emSerie(async () => {
      try {
        const contar = /count=exact/.test(req.headers.prefer ?? "");
        const { sql, contagem, params } = montarSelect(p.slice("/rest/v1/".length), url.searchParams, contar);
        const [linhas, n] = await como(db, quem, async () => [req.method === "HEAD" ? [] : (await db.query(sql, params)).rows, contagem ? (await db.query(contagem, params)).rows[0].n : null]);
        const extra = n === null ? {} : { "Content-Range": `0-${Math.max(linhas.length - 1, 0)}/${n}` };
        if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
          if (linhas.length !== 1) return json(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${linhas.length} rows` });
          return json(res, 200, linhas[0], extra);
        }
        return json(res, 200, req.method === "HEAD" ? undefined : linhas, extra);
      } catch (e) { return erroPg(res, e); }
    });
  }
  if (p === "/functions/v1/fin-parcelamentos-sincronizar" && req.method === "POST") {
    return emSerie(async () => {
      if (!sub) return json(res, 401, { erro: "Não autenticado." });
      const ok = (await como(db, sub, () => db.query(`select tem_acesso_modulo('financeiro.parcelamentos', 'operador') as ok`))).rows[0].ok;
      if (!ok) return json(res, 403, { erro: "Somente operador do Financeiro (ou acima) atualiza os parcelamentos." });
      try { return json(res, 200, { ok: true, segundos: 0, empresas: [await rodada(false, sub)] }); }
      catch (e) { return json(res, 502, { ok: false, empresas: [{ empresa: "Neo Formas", erro: e.message }] }); }
    });
  }
  return json(res, 404, { message: "nao_simulado" });
}).listen(PORTA, "127.0.0.1", () => console.log(`parcelamentos-simulado em http://127.0.0.1:${PORTA}`));
