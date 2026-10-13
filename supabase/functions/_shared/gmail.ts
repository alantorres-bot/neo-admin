// Gmail: monta a mensagem (MIME) e cria RASCUNHO pela API. Nunca envia: o escopo pedido é gmail.compose e a única
// chamada de escrita é `drafts.create`. Lógica pura (sem Deno, sem imports) para ser testada com o Vitest do projeto
// (lib/integracoes/gmail/gmail.test.ts) e usada pela Edge Function `rec-rascunho-gmail`.
//
// Credenciais (segredos de Edge Functions): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_REMETENTE.
// O rascunho aparece na caixa de quem autorizou (a dona do refresh token).

export class GmailErro extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
    this.name = "GmailErro";
  }
}

export type CredenciaisGmail = { clientId: string; clientSecret: string; refreshToken: string; remetente: string };

/** Lê as credenciais do ambiente; devolve o que falta (só os NOMES, nunca valores). */
export function lerCredenciais(env: (nome: string) => string | undefined): { ok: true; credenciais: CredenciaisGmail } | { ok: false; faltando: string[] } {
  const nomes = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_REMETENTE"] as const;
  const valores = nomes.map((n) => (env(n) ?? "").trim());
  const faltando = nomes.filter((_, i) => valores[i] === "");
  if (faltando.length > 0) return { ok: false, faltando: [...faltando] };
  return { ok: true, credenciais: { clientId: valores[0], clientSecret: valores[1], refreshToken: valores[2], remetente: valores[3] } };
}

// ---------------------------------------------------------------- MIME

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
export const emailValido = (v: string): boolean => EMAIL.test(v.trim());

const codificador = new TextEncoder();

/** base64 de bytes, sem estourar a pilha em arquivos grandes. */
export function bytesParaBase64(bytes: Uint8Array): string {
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  return btoa(bin);
}

const textoParaBase64 = (t: string) => bytesParaBase64(codificador.encode(t));

/** Quebra em linhas de 76 caracteres (RFC 2045), separadas por CRLF. */
export function quebrarBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** Tira CR/LF e controles de um valor de cabeçalho (impede injeção de cabeçalhos). */
export const limparCabecalho = (v: string): string => v.replace(/[\r\n\u0000-\u001f]+/g, " ").trim();

/** Assunto com acento vira "encoded-word" UTF-8 (RFC 2047), em pedaços que não cortam um caractere no meio. */
export function codificarAssunto(assunto: string): string {
  const limpo = limparCabecalho(assunto);
  if (/^[\x20-\x7e]*$/.test(limpo)) return limpo;
  const palavras: string[] = [];
  let atual = "";
  for (const ch of limpo) {
    if (codificador.encode(atual + ch).length > 42) {
      palavras.push(atual);
      atual = "";
    }
    atual += ch;
  }
  if (atual) palavras.push(atual);
  return palavras.map((p) => `=?UTF-8?B?${textoParaBase64(p)}?=`).join("\r\n ");
}

const asciiSeguro = (nome: string) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 120) || "arquivo";

export type AnexoEmail = { nome: string; tipo: string; bytes: Uint8Array };

export type DadosEmail = {
  de: string;
  /** Um e-mail, ou vários separados por vírgula (ou uma lista). */
  para: string | readonly string[];
  /** Cópias (Cc), opcional: um e-mail, vários separados por vírgula, ou uma lista. */
  cc?: string | readonly string[] | null;
  assunto: string;
  corpo: string;
  /** Versão HTML do corpo (opcional). Com ela, o e-mail vai como multipart/alternative: texto simples + HTML. */
  html?: string | null;
  anexos?: readonly AnexoEmail[];
  /** Message-ID próprio (ex.: "<kit-…@neoformas.com.br>"): permite responder depois na mesma conversa. */
  messageId?: string | null;
  /** Resposta a um e-mail anterior: Message-ID dele (In-Reply-To e References). */
  inReplyTo?: string | null;
  /** Para teste: fixa o separador das partes. */
  limite?: string;
};

/** Lista de e-mails (string com vírgulas/ponto e vírgula ou array), limpa e sem repetição. */
export function listaDeEmails(v: string | readonly string[] | null | undefined): string[] {
  const partes = (Array.isArray(v) ? v : String(v ?? "").split(/[,;]/)).map((e) => limparCabecalho(String(e)));
  return [...new Set(partes.filter((e) => e !== ""))];
}

/** "<id@dominio>" limpo (sem quebra de linha); recusa o que não parece um Message-ID. */
function idDeMensagem(v: string): string {
  const t = limparCabecalho(v);
  const comSinais = t.startsWith("<") ? t : `<${t}>`;
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(comSinais)) throw new GmailErro("Message-ID inválido.");
  return comSinais;
}

/** Mensagem completa (ASCII puro: texto e anexos vão em base64). Lança GmailErro se algum endereço for inválido. */
export function montarMime(d: DadosEmail): string {
  const de = limparCabecalho(d.de);
  const para = listaDeEmails(d.para);
  const cc = listaDeEmails(d.cc);
  if (!emailValido(de)) throw new GmailErro("Remetente (GMAIL_REMETENTE) inválido.");
  if (para.length === 0 || !para.every(emailValido)) throw new GmailErro("O destinatário não tem um e-mail válido.");
  if (!cc.every(emailValido)) throw new GmailErro("Um dos e-mails em cópia (Cc) é inválido.");

  const limite = d.limite ?? `neo-admin-${crypto.randomUUID()}`;
  const cabecalhos = [
    `From: ${de}`,
    `To: ${para.join(", ")}`,
    ...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${codificarAssunto(d.assunto)}`,
    ...(d.messageId ? [`Message-ID: ${idDeMensagem(d.messageId)}`] : []),
    ...(d.inReplyTo ? [`In-Reply-To: ${idDeMensagem(d.inReplyTo)}`, `References: ${idDeMensagem(d.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
  ];
  const parteTexto = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    quebrarBase64(textoParaBase64(d.corpo.replace(/\r?\n/g, "\r\n"))),
  ];
  // Com HTML: multipart/alternative (o leitor mostra o HTML; quem não lê HTML vê o texto simples).
  const limiteAlt = `${limite}-alt`;
  const corpoParte = d.html
    ? [
      `Content-Type: multipart/alternative; boundary="${limiteAlt}"`,
      "",
      `--${limiteAlt}`,
      ...parteTexto,
      `--${limiteAlt}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      quebrarBase64(textoParaBase64(d.html)),
      `--${limiteAlt}--`,
    ]
    : parteTexto;

  const anexos = d.anexos ?? [];
  if (anexos.length === 0) return [...cabecalhos, ...corpoParte, ""].join("\r\n");

  const partes = [`--${limite}`, ...corpoParte];
  for (const a of anexos) {
    const ascii = asciiSeguro(a.nome);
    partes.push(
      `--${limite}`,
      `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.tipo) ? a.tipo : "application/octet-stream"}; name="${ascii}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limparCabecalho(a.nome))}`,
      "",
      quebrarBase64(bytesParaBase64(a.bytes)),
    );
  }
  partes.push(`--${limite}--`, "");
  return [...cabecalhos, `Content-Type: multipart/mixed; boundary="${limite}"`, "", ...partes].join("\r\n");
}

// ---------------------------------------------------------------- API do Gmail

export type Buscar = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_RASCUNHO = "https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=media";

/** Troca o refresh token por um access token (vale ~1 hora). Os erros nunca repetem segredos. */
export async function obterAccessToken(buscar: Buscar, c: CredenciaisGmail): Promise<string> {
  const corpo = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }).toString();
  let resp;
  try {
    resp = await buscar(URL_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo });
  } catch {
    throw new GmailErro("Falha de rede ao falar com o Google.");
  }
  const texto = await resp.text();
  if (!resp.ok) {
    let motivo = "";
    try {
      const j = JSON.parse(texto) as { error?: string; error_description?: string };
      motivo = j.error ?? "";
    } catch { /* corpo não é JSON */ }
    if (motivo === "invalid_grant") {
      throw new GmailErro("O Google recusou o token de autorização (expirou ou foi revogado). Autorize de novo com o script scripts/gmail-autorizar.mjs.", resp.status);
    }
    if (motivo === "invalid_client") throw new GmailErro("O Google não reconheceu o GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET.", resp.status);
    throw new GmailErro(`O Google recusou a renovação do acesso (HTTP ${resp.status}${motivo ? `, ${motivo}` : ""}).`, resp.status);
  }
  const j = JSON.parse(texto) as { access_token?: string };
  if (!j.access_token) throw new GmailErro("O Google não devolveu o token de acesso.");
  return j.access_token;
}

export type RascunhoCriado = { rascunhoId: string; mensagemId: string; url: string; threadId?: string };
const URL_RASCUNHO_MULTIPART = "https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=multipart";

/** `drafts.create`: guarda a mensagem como rascunho na caixa de quem autorizou. Nunca envia. */
export async function criarRascunho(buscar: Buscar, accessToken: string, mime: string, opcoes: { threadId?: string | null } = {}): Promise<RascunhoCriado> {
  let resp;
  try {
    if (opcoes.threadId) {
      // Na mesma conversa: upload multipart (metadados com o threadId + a mensagem rfc822).
      const limite = `neo-admin-rel-${crypto.randomUUID()}`;
      const corpo = [
        `--${limite}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ message: { threadId: opcoes.threadId } }),
        `--${limite}`, "Content-Type: message/rfc822", "", mime, `--${limite}--`, "",
      ].join("\r\n");
      resp = await buscar(URL_RASCUNHO_MULTIPART, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${limite}` },
        body: codificador.encode(corpo),
      });
    } else {
      resp = await buscar(URL_RASCUNHO, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" },
        body: codificador.encode(mime),
      });
    }
  } catch {
    throw new GmailErro("Falha de rede ao falar com o Gmail.");
  }
  const texto = await resp.text();
  if (resp.status === 401 || resp.status === 403) {
    throw new GmailErro(`O Gmail negou o acesso (HTTP ${resp.status}). Confira se a API do Gmail está ativada no projeto do Google e se o escopo gmail.compose foi autorizado.`, resp.status);
  }
  if (!resp.ok) throw new GmailErro(`O Gmail recusou o rascunho (HTTP ${resp.status}).`, resp.status);
  const j = JSON.parse(texto) as { id?: string; message?: { id?: string; threadId?: string } };
  if (!j.id) throw new GmailErro("O Gmail não devolveu o identificador do rascunho.");
  const mensagemId = j.message?.id ?? "";
  return {
    rascunhoId: j.id, mensagemId, threadId: j.message?.threadId,
    url: mensagemId ? `https://mail.google.com/mail/u/0/#drafts?compose=${mensagemId}` : "https://mail.google.com/mail/u/0/#drafts",
  };
}
