import { describe, expect, it } from "vitest";
import {
  bytesParaBase64,
  codificarAssunto,
  criarRascunho,
  emailValido,
  GmailErro,
  lerCredenciais,
  limparCabecalho,
  montarMime,
  obterAccessToken,
  quebrarBase64,
  type Buscar,
  type CredenciaisGmail,
} from "../../../supabase/functions/_shared/gmail";

const cred: CredenciaisGmail = { clientId: "cliente-id", clientSecret: "segredo-do-cliente", refreshToken: "refresh-token-secreto", remetente: "financeiro@exemplo.com.br" };
const resposta = (status: number, corpo: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) });
const decodificar = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r?\n/g, "")), (c) => c.charCodeAt(0)));

describe("lerCredenciais", () => {
  it("devolve só os NOMES que faltam", () => {
    const r = lerCredenciais((n) => ({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: " ", GMAIL_REMETENTE: "x@y.com" } as Record<string, string>)[n]);
    expect(r).toEqual({ ok: false, faltando: ["GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] });
  });
  it("lê tudo quando está completo, com espaços aparados", () => {
    const r = lerCredenciais((n) => ` ${n.toLowerCase()} `);
    expect(r.ok && r.credenciais).toEqual({ clientId: "gmail_client_id", clientSecret: "gmail_client_secret", refreshToken: "gmail_refresh_token", remetente: "gmail_remetente" });
  });
});

describe("cabeçalhos", () => {
  it("emailValido", () => {
    expect(emailValido("ana@empresa.com.br")).toBe(true);
    for (const ruim of ["", "ana", "ana@", "a b@c.com", "ana@empresa", "<a@b.com>", "a@b.com, c@d.com"]) expect(emailValido(ruim)).toBe(false);
  });
  it("limparCabecalho impede injeção de cabeçalhos", () => {
    expect(limparCabecalho("Oi\r\nBcc: alguem@x.com")).toBe("Oi Bcc: alguem@x.com");
  });
  it("assunto ASCII fica como está; com acento vira encoded-word UTF-8 que volta igual", () => {
    expect(codificarAssunto("Boleto - NF 1395")).toBe("Boleto - NF 1395");
    const c = codificarAssunto("Boleto — NF 1395 — Neo Formas — ação pendente com um assunto bem comprido para forçar várias partes");
    expect(c).toMatch(/^=\?UTF-8\?B\?/);
    const partes = c.split("\r\n ");
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(75);
    expect(partes.map((p) => decodificar(p.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, ""))).join("")).toBe("Boleto — NF 1395 — Neo Formas — ação pendente com um assunto bem comprido para forçar várias partes");
  });
  it("quebrarBase64 em linhas de 76", () => {
    const l = quebrarBase64("A".repeat(200)).split("\r\n");
    expect(l.map((x) => x.length)).toEqual([76, 76, 48]);
  });
  it("bytesParaBase64 aguenta arquivo grande", () => {
    expect(bytesParaBase64(new Uint8Array(300_000)).length).toBe(Math.ceil(300_000 / 3) * 4);
  });
});

describe("montarMime", () => {
  const base = { de: "financeiro@exemplo.com.br", para: "ana@cliente.com.br", assunto: "Boleto — NF 1395", corpo: "Olá, Ana!\n\nSegue o boleto.\n\nAtenciosamente," };

  it("sem anexo: cabeçalhos, UTF-8 em base64 e corpo que volta igual (com CRLF)", () => {
    const m = montarMime(base);
    const [cab, ...resto] = m.split("\r\n\r\n");
    expect(cab).toContain("From: financeiro@exemplo.com.br");
    expect(cab).toContain("To: ana@cliente.com.br");
    expect(cab).toContain("MIME-Version: 1.0");
    expect(cab).toContain("Subject: =?UTF-8?B?");
    expect(cab).not.toContain("multipart");
    expect(decodificar(resto.join("\r\n\r\n"))).toBe("Olá, Ana!\r\n\r\nSegue o boleto.\r\n\r\nAtenciosamente,");
    expect(/^[\x00-\x7f]*$/.test(m)).toBe(true); // ASCII puro: o acento vai codificado
  });

  it("com anexos: multipart/mixed, uma parte de texto e uma por arquivo", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 conteudo");
    const m = montarMime({ ...base, limite: "LIM", anexos: [{ nome: "Boleto Parcela 1ª.pdf", tipo: "application/pdf", bytes: pdf }, { nome: "b.png", tipo: "image/png", bytes: new Uint8Array([1, 2, 3]) }] });
    expect(m).toContain('Content-Type: multipart/mixed; boundary="LIM"');
    expect(m.match(/--LIM\r\n/g)).toHaveLength(3);
    expect(m.endsWith("--LIM--\r\n")).toBe(true);
    expect(m).toContain('Content-Type: application/pdf; name="Boleto Parcela 1_.pdf"');
    expect(m).toContain("filename*=UTF-8''Boleto%20Parcela%201%C2%AA.pdf");
    expect(m).toContain("Content-Type: image/png");
    const base64Pdf = m.split("filename*=UTF-8''Boleto%20Parcela%201%C2%AA.pdf\r\n\r\n")[1].split("\r\n--LIM")[0];
    expect(decodificar(base64Pdf)).toBe("%PDF-1.4 conteudo");
  });

  it("tipo de arquivo estranho vira application/octet-stream", () => {
    const m = montarMime({ ...base, limite: "L", anexos: [{ nome: "x", tipo: "isso não é tipo\r\nBcc: a@b.com", bytes: new Uint8Array([1]) }] });
    expect(m).toContain("application/octet-stream");
    expect(m).not.toContain("Bcc:");
  });

  it("recusa remetente ou destinatário inválido e não deixa injetar cabeçalho pelo assunto ou pelo destinatário", () => {
    expect(() => montarMime({ ...base, para: "isso não é e-mail" })).toThrow(GmailErro);
    expect(() => montarMime({ ...base, de: "" })).toThrow(/Remetente/);
    expect(() => montarMime({ ...base, para: "a@b.com\r\nBcc: x@y.com" })).toThrow(GmailErro);
    const m = montarMime({ ...base, assunto: "Oi\r\nBcc: x@y.com" });
    expect(m.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });
});

describe("obterAccessToken", () => {
  it("troca o refresh token (corpo form) e devolve o access token", async () => {
    let enviado = "";
    const buscar: Buscar = async (url, init) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      enviado = String(init.body);
      return resposta(200, { access_token: "ya29.abc", expires_in: 3599 });
    };
    expect(await obterAccessToken(buscar, cred)).toBe("ya29.abc");
    expect(enviado).toContain("grant_type=refresh_token");
    expect(enviado).toContain("refresh_token=refresh-token-secreto");
  });
  it("invalid_grant e invalid_client têm mensagens claras e nunca repetem segredos", async () => {
    const e1 = await obterAccessToken(async () => resposta(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }), cred).catch((x) => x);
    expect(e1).toBeInstanceOf(GmailErro);
    expect(e1.message).toMatch(/expirou ou foi revogado/);
    const e2 = await obterAccessToken(async () => resposta(401, { error: "invalid_client" }), cred).catch((x) => x);
    expect(e2.message).toMatch(/GMAIL_CLIENT_ID/);
    for (const e of [e1, e2]) for (const s of ["refresh-token-secreto", "segredo-do-cliente"]) expect(e.message).not.toContain(s);
  });
  it("erro de rede é genérico, sem o texto original", async () => {
    const e = await obterAccessToken(async () => { throw new TypeError("falha com refresh-token-secreto"); }, cred).catch((x) => x);
    expect(e.message).toBe("Falha de rede ao falar com o Google.");
  });
  it("resposta sem access_token", async () => {
    await expect(obterAccessToken(async () => resposta(200, {}), cred)).rejects.toThrow(/não devolveu o token/);
  });
});

describe("criarRascunho", () => {
  it("chama drafts.create (upload) com a mensagem em message/rfc822 e monta o link do rascunho", async () => {
    let init: Parameters<Buscar>[1] | undefined;
    let url = "";
    const buscar: Buscar = async (u, i) => ((url = u), (init = i), resposta(200, { id: "r-123", message: { id: "m-456" } }));
    const r = await criarRascunho(buscar, "ya29.abc", "From: a@b.com\r\n\r\ncorpo");
    expect(url).toBe("https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=media");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer ya29.abc", "Content-Type": "message/rfc822" });
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe("From: a@b.com\r\n\r\ncorpo");
    expect(r).toEqual({ rascunhoId: "r-123", mensagemId: "m-456", url: "https://mail.google.com/mail/u/0/#drafts?compose=m-456" });
  });
  it("sem id de mensagem, o link abre a pasta de rascunhos", async () => {
    const r = await criarRascunho(async () => resposta(200, { id: "r" }), "t", "x");
    expect(r.url).toBe("https://mail.google.com/mail/u/0/#drafts");
  });
  it("nunca chama a rota de envio", async () => {
    const urls: string[] = [];
    await criarRascunho(async (u) => (urls.push(u), resposta(200, { id: "r" })), "t", "x");
    expect(urls.every((u) => !/send/i.test(u))).toBe(true);
  });
  it("401/403 orienta sobre API ativada e escopo; outros erros trazem só o código", async () => {
    const e = await criarRascunho(async () => resposta(403, { error: { message: "detalhe interno" } }), "t", "x").catch((x) => x);
    expect(e.message).toMatch(/gmail\.compose/);
    expect(e.message).not.toContain("detalhe interno");
    const e2 = await criarRascunho(async () => resposta(500, "oops"), "t", "x").catch((x) => x);
    expect(e2.message).toBe("O Gmail recusou o rascunho (HTTP 500).");
  });
});
