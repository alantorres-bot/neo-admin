// SOMENTE DESENVOLVIMENTO/TESTE LOCAL (ver scripts/local-sem-docker/LEIA-ME.md). Em produção use o Supabase de verdade.
// Proxy local que imita as rotas do Supabase: /rest/v1 -> PostgREST, /auth/v1 -> GoTrue, /storage/v1 -> Storage mínimo.
// O Storage grava a linha em storage.objects via PostgREST COM O TOKEN DO USUÁRIO (as políticas RLS do bucket valem) e
// guarda o arquivo em disco; URL assinada = HMAC com validade. Só para desenvolvimento/teste local.
import http from "node:http";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
const SEGREDO = process.env.SEGREDO, PASTA = process.env.PASTA_ARQUIVOS ?? ".local-supabase/arquivos";
const alvo = (prefixo, porta) => ({ prefixo, porta });
const rotas = [alvo("/rest/v1", 3001), alvo("/auth/v1", 9999)];
const corpo = (req) => new Promise((ok) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => ok(Buffer.concat(p))); });
function repassar(req, res, porta, caminho, body, headersExtra = {}) {
  const r = http.request({ host: "127.0.0.1", port: porta, method: req.method, path: caminho, headers: { ...req.headers, host: `127.0.0.1:${porta}`, ...headersExtra } }, (x) => {
    res.writeHead(x.statusCode, x.headers); x.pipe(res);
  });
  r.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  r.end(body);
}
async function rest(metodo, caminho, token, body, perfil) {
  const r = await fetch(`http://127.0.0.1:3001${caminho}`, { method: metodo, headers: { Authorization: token, "Content-Type": "application/json", "Accept-Profile": perfil, "Content-Profile": perfil, Prefer: "return=representation" }, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const assinar = (nome, exp) => createHmac("sha256", SEGREDO).update(`${nome}|${exp}`).digest("hex");
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  for (const r of rotas) if (url.pathname.startsWith(r.prefixo)) return repassar(req, res, r.porta, req.url.slice(r.prefixo.length) || "/", await corpo(req));
  if (url.pathname.startsWith("/storage/v1/object/")) {
    const resto = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length));
    const token = req.headers.authorization ?? "";
    if (resto.startsWith("sign/") && req.method === "POST") {
      const [bucket, ...partes] = resto.slice(5).split("/"); const nome = partes.join("/");
      const v = await rest("GET", `/objects?select=name&bucket_id=eq.${encodeURIComponent(bucket)}&name=eq.${encodeURIComponent(nome)}`, token, undefined, "storage");
      if (!Array.isArray(v.json) || v.json.length === 0) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" })); }
      const { expiresIn = 60 } = JSON.parse((await corpo(req)).toString() || "{}"); const exp = Math.floor(Date.now() / 1000) + Number(expiresIn);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ signedURL: `/object/sign/${bucket}/${nome}?token=${assinar(`${bucket}/${nome}`, exp)}&exp=${exp}` }));
    }
    if (resto.startsWith("sign/") && req.method === "GET") {
      const nome = resto.slice(5); const exp = Number(url.searchParams.get("exp"));
      if (assinar(nome, exp) !== url.searchParams.get("token") || exp < Date.now() / 1000) { res.writeHead(400); return res.end("assinatura inválida ou vencida"); }
      const arq = join(PASTA, nome); if (!existsSync(arq)) { res.writeHead(404); return res.end("sem arquivo"); }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${nome.split("/").pop()}"` }); return res.end(readFileSync(arq));
    }
    if (req.method === "POST") {
      const [bucket, ...partes] = resto.split("/"); const nome = partes.join("/");
      const dados = await corpo(req);
      let owner = null; try { owner = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub ?? null; } catch {}
      const v = await rest("POST", "/objects", token, JSON.stringify({ bucket_id: bucket, name: nome, owner }), "storage");
      if (v.status >= 300) { res.writeHead(v.status === 401 ? 401 : 403, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" })); }
      const arq = join(PASTA, bucket, nome); mkdirSync(dirname(arq), { recursive: true }); writeFileSync(arq, dados);
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ Key: `${bucket}/${nome}`, Id: v.json?.[0]?.id }));
    }
  }
  res.writeHead(501, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "não emulado localmente" }));
}).listen(54321, "127.0.0.1", () => console.log("proxy em http://127.0.0.1:54321"));
