#!/usr/bin/env node
// Autoriza o Neo Admin a CRIAR RASCUNHOS no Gmail da caixa que fizer login, e grava os segredos no Supabase.
//
// Rode no terminal, na pasta do projeto:   node scripts/gmail-autorizar.mjs
// Antes: crie um "ID do cliente OAuth" do tipo "App para computador" no Google Cloud (docs/GMAIL_CREDENCIAIS.md).
//
// O que faz: pergunta o ID e o segredo do cliente (o segredo não aparece na tela), abre o login do Google com o escopo
// gmail.compose (criar e editar rascunhos; NÃO envia nem lê e-mails), recebe o código numa porta local (127.0.0.1),
// troca por um token de renovação e grava no Supabase, com `supabase secrets set`:
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_REMETENTE
// Nada é impresso nem salvo em arquivo permanente: o arquivo temporário usado para o `supabase secrets set` é apagado.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const ESCOPO = "https://www.googleapis.com/auth/gmail.compose";
const URL_AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function perguntar(pergunta, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (texto) => {
        if (texto.includes(pergunta)) process.stdout.write(texto);
      };
    }
    rl.question(pergunta, (resposta) => {
      rl.close();
      if (oculto) process.stdout.write("\n");
      resolve(resposta.trim());
    });
  });
}

function abrirNavegador(url) {
  const [comando, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    spawn(comando, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* sem navegador automático: o endereço é mostrado na tela */
  }
}

/** Sobe um servidor local numa porta livre e espera o Google devolver o código. */
function esperarCodigo(estado) {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const erro = u.searchParams.get("error");
      const codigo = u.searchParams.get("code");
      const okEstado = u.searchParams.get("state") === estado;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem"><h2>${codigo && okEstado && !erro ? "Autorizado. Pode fechar esta janela e voltar ao terminal." : "Não foi possível autorizar. Volte ao terminal."}</h2></body>`);
      servidor.close();
      if (erro) reject(new Error(`O Google devolveu o erro: ${erro}`));
      else if (!okEstado || !codigo) reject(new Error("Resposta do Google inválida (estado ou código ausente)."));
      else resolve(codigo);
    });
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      servidor.emit("pronto", servidor.address().port);
    });
    esperarCodigo.servidor = servidor;
    setTimeout(() => {
      servidor.close();
      reject(new Error("Tempo esgotado (5 minutos) sem autorização."));
    }, 5 * 60 * 1000).unref();
  });
}

async function main() {
  console.log("Autorização do Gmail do Neo Admin (só cria rascunhos; não envia nem lê e-mails).\n");
  const clientId = await perguntar("ID do cliente OAuth: ");
  const clientSecret = await perguntar("Segredo do cliente OAuth (não aparece ao digitar): ", { oculto: true });
  const remetente = await perguntar("E-mail da caixa que vai fazer login (onde os rascunhos aparecerão): ");
  if (!clientId || !clientSecret) throw new Error("Informe o ID e o segredo do cliente.");
  if (!EMAIL.test(remetente)) throw new Error("E-mail da caixa inválido.");

  const estado = base64url(crypto.randomBytes(16));
  const verificador = base64url(crypto.randomBytes(48));
  const desafio = base64url(crypto.createHash("sha256").update(verificador).digest());

  const promessa = esperarCodigo(estado);
  const porta = await new Promise((resolve) => esperarCodigo.servidor.once("pronto", resolve));
  const redirecionamento = `http://127.0.0.1:${porta}/oauth2callback`;
  const url = `${URL_AUTORIZACAO}?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirecionamento, response_type: "code", scope: ESCOPO, access_type: "offline", prompt: "consent",
    state: estado, code_challenge: desafio, code_challenge_method: "S256", login_hint: remetente,
  })}`;

  console.log("\nAbrindo o login do Google no navegador. Entre com a caixa informada e clique em Permitir.");
  console.log("Se não abrir sozinho, copie este endereço para o navegador:\n\n" + url + "\n");
  abrirNavegador(url);
  const codigo = await promessa;

  const resp = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: codigo, code_verifier: verificador, grant_type: "authorization_code", redirect_uri: redirecionamento }),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`O Google recusou a troca do código (${corpo.error ?? resp.status}). Confira o ID e o segredo do cliente.`);
  if (!corpo.refresh_token) {
    throw new Error("O Google não devolveu o token de renovação. Remova o acesso do app em https://myaccount.google.com/permissions e rode o script de novo.");
  }
  if (!String(corpo.scope ?? "").includes("gmail.compose")) throw new Error("A permissão gmail.compose não foi concedida. Rode de novo e marque a permissão.");

  // Grava nos segredos do Supabase por arquivo temporário (nada na linha de comando, nada no histórico).
  const arquivo = path.join(os.tmpdir(), `neo-admin-gmail-${crypto.randomBytes(6).toString("hex")}.env`);
  fs.writeFileSync(arquivo, `GMAIL_CLIENT_ID=${clientId}\nGMAIL_CLIENT_SECRET=${clientSecret}\nGMAIL_REFRESH_TOKEN=${corpo.refresh_token}\nGMAIL_REMETENTE=${remetente}\n`, { mode: 0o600 });
  try {
    console.log("Autorizado. Gravando os segredos no Supabase...");
    const r = spawnSync("npx", ["supabase", "secrets", "set", "--env-file", arquivo, "--agent", "no"], { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error("Não consegui gravar no Supabase. Confira `npx supabase login` e `npx supabase link`.");
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
  console.log(`\nPronto. Os rascunhos do Neo Admin vão aparecer na caixa ${remetente}.`);
  console.log("Para trocar de caixa ou revogar: rode este script de novo, ou remova o acesso em https://myaccount.google.com/permissions");
}

main().catch((e) => {
  console.error("\nErro: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
