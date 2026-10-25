import { describe, expect, it, vi } from "vitest";
import {
  configConexao,
  conferirIdToken,
  desafioPkce,
  escoposConcedidos,
  ESCOPO_DRIVE_LEITURA,
  tratarConexao,
  tratarDesconexao,
  urlAutorizacaoGoogle,
  urlRetornoGed,
  type DepsConexao,
  type DepsDesconexao,
} from "../../../supabase/functions/_shared/ged";

// Tudo fictício: nenhuma credencial, conta ou URL real.
const ENV: Record<string, string> = {
  GED_DRIVE_CLIENT_ID: "cliente-ficticio.apps.googleusercontent.com",
  GED_DRIVE_CLIENT_SECRET: "segredo-cliente-ficticio",
  GED_DRIVE_REDIRECT_URI: "https://projeto-ficticio.supabase.co/functions/v1/nucleo-ged-conectar",
  NEO_ADMIN_URL: "https://neoadmin.exemplo.invalid",
};
const CONTA = "teste.ficticio.ged@neoformas.com.br";
const STATE = "a".repeat(64);
const VERIFIER = "b".repeat(64);
const AGORA = 1_800_000_000;
const ESCOPOS = `openid https://www.googleapis.com/auth/userinfo.email ${ESCOPO_DRIVE_LEITURA}`;
const SENSIVEIS = ["codigo-ficticio", "rt-ficticio", "segredo-cliente-ficticio", VERIFIER, "sub-123", "at-ficticio"];

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (sobre: Record<string, unknown> = {}) =>
  `${b64url({ alg: "RS256" })}.${b64url({
    iss: "https://accounts.google.com", aud: ENV.GED_DRIVE_CLIENT_ID, exp: AGORA + 300, email: CONTA,
    email_verified: true, hd: "neoformas.com.br", sub: "sub-123", ...sobre,
  })}.assinatura`;
const respostaToken = (sobre: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: "at-ficticio", refresh_token: "rt-ficticio", id_token: idToken(), scope: ESCOPOS, ...sobre }), { status: 200 });

function deps(o: { rpc?: Record<string, unknown>; erroConcluir?: string; token?: () => Response | Promise<Response> } = {}) {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  const rpcPadrao: Record<string, unknown> = {
    ged_validar_estado: { code_verifier: VERIFIER, destino: "/configuracoes/documentos", conta: CONTA },
    ged_consumir_estado: { code_verifier: VERIFIER, destino: "/configuracoes/documentos", conta: CONTA },
    ged_concluir_conexao: "/configuracoes/documentos",
    ged_registrar_erro_conexao: null,
    ...o.rpc,
  };
  const fetch = vi.fn(async () => (o.token ? o.token() : respostaToken()));
  const d: DepsConexao = {
    env: (k) => ENV[k],
    rpc: async (nome, args) => {
      chamadas.push({ nome, args });
      if (nome === "ged_concluir_conexao" && o.erroConcluir) return { data: null, error: { message: o.erroConcluir } };
      return { data: rpcPadrao[nome] ?? null, error: null };
    },
    fetch,
    agoraSeg: () => AGORA,
  };
  return { d, chamadas, fetch };
}
const ida = (d: DepsConexao, state = STATE) => tratarConexao({ method: "GET", url: `${ENV.GED_DRIVE_REDIRECT_URI}?state=${state}` }, d);
const volta = (d: DepsConexao, extra = "code=codigo-ficticio") =>
  tratarConexao({ method: "GET", url: `${ENV.GED_DRIVE_REDIRECT_URI}?${extra}&state=${STATE}` }, d);
function semVazamento(...valores: unknown[]) {
  const t = JSON.stringify(valores);
  for (const s of SENSIVEIS) expect(t, s).not.toContain(s);
}

describe("configuração obrigatória, sem fallback", () => {
  it("faltando qualquer item (ou redirect não https): 500 genérico, sem redirecionar", async () => {
    for (const k of Object.keys(ENV)) {
      const { d } = deps();
      const r = await tratarConexao({ method: "GET", url: `${ENV.GED_DRIVE_REDIRECT_URI}?state=${STATE}` }, { ...d, env: (x) => (x === k ? undefined : ENV[x]) });
      expect(r, k).toEqual({ status: 500, corpo: "A conexão do GED não está configurada." });
    }
    expect(configConexao((k) => (k === "GED_DRIVE_REDIRECT_URI" ? "http://inseguro.invalid/x" : ENV[k]))).toBeNull();
  });
});

describe("ida ao Google", () => {
  it("só GET; state mal formado é recusado sem consultar o banco", async () => {
    const { d, chamadas } = deps();
    expect((await tratarConexao({ method: "POST", url: ENV.GED_DRIVE_REDIRECT_URI }, d)).status).toBe(405);
    expect((await ida(d, "abc")).status).toBe(400);
    expect((await ida(d, "A".repeat(64))).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("state vencido ou desconhecido: 400 'expirou'", async () => {
    const { d } = deps({ rpc: { ged_validar_estado: null } });
    expect(await ida(d)).toMatchObject({ status: 400, corpo: expect.stringContaining("expirou") });
  });

  it("URL do Google: PKCE S256, offline, consent, só drive.readonly, sem include_granted_scopes, sem verifier", async () => {
    const { d, chamadas } = deps();
    const r = await ida(d);
    expect(r.status).toBe(302);
    const u = new URL(r.location as string);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = Object.fromEntries(u.searchParams);
    expect(p).toMatchObject({
      client_id: ENV.GED_DRIVE_CLIENT_ID, redirect_uri: ENV.GED_DRIVE_REDIRECT_URI, response_type: "code",
      scope: `openid email ${ESCOPO_DRIVE_LEITURA}`, access_type: "offline", prompt: "consent",
      code_challenge_method: "S256", code_challenge: await desafioPkce(VERIFIER), login_hint: CONTA, hd: "neoformas.com.br", state: STATE,
    });
    expect(p).not.toHaveProperty("include_granted_scopes");
    expect(r.location).not.toContain(VERIFIER);
    expect(chamadas.map((c) => c.nome)).toEqual(["ged_validar_estado"]); // ida não consome
  });

  it("desafio S256 confere com o vetor da RFC 7636", async () => {
    expect(await desafioPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("volta do Google", () => {
  it("sucesso: consome o state ANTES de trocar o código; troca com code_verifier; conclui; volta com 'conectado'", async () => {
    const { d, chamadas, fetch } = deps();
    const r = await volta(d);
    expect(chamadas.map((c) => c.nome)).toEqual(["ged_consumir_estado", "ged_concluir_conexao"]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({
      code: "codigo-ficticio", code_verifier: VERIFIER, redirect_uri: ENV.GED_DRIVE_REDIRECT_URI, grant_type: "authorization_code",
    });
    expect(chamadas[1].args).toMatchObject({ p_email: CONTA, p_sub: "sub-123", p_refresh_token: "rt-ficticio" });
    expect(chamadas[1].args.p_escopos).toEqual(ESCOPOS.split(" "));
    expect(r).toEqual({ status: 302, location: "https://neoadmin.exemplo.invalid/configuracoes/documentos?ged=conectado" });
    semVazamento(r);
  });

  it("state já consumido (replay): 'expirou' e nenhuma troca de código", async () => {
    const { d, fetch } = deps({ rpc: { ged_consumir_estado: null } });
    expect((await volta(d)).corpo).toContain("expirou");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recusa no Google: registra 'recusado', volta com 'recusado', sem troca", async () => {
    const { d, chamadas, fetch } = deps();
    const r = await volta(d, "error=access_denied");
    expect(fetch).not.toHaveBeenCalled();
    expect(chamadas.find((c) => c.nome === "ged_registrar_erro_conexao")?.args).toEqual({ p_codigo: "recusado", p_state: STATE });
    expect(r.location).toBe("https://neoadmin.exemplo.invalid/configuracoes/documentos?ged=recusado&codigo=recusado");
  });

  const casos: [string, Parameters<typeof deps>[0], string][] = [
    ["escopo a mais (drive)", { token: () => respostaToken({ scope: `${ESCOPOS} https://www.googleapis.com/auth/drive` }) }, "escopo_divergente"],
    ["escopo a menos (sem drive.readonly)", { token: () => respostaToken({ scope: "openid email" }) }, "escopo_divergente"],
    ["escopo só parecido", { token: () => respostaToken({ scope: `openid ${ESCOPO_DRIVE_LEITURA}x` }) }, "escopo_divergente"],
    ["aud errado", { token: () => respostaToken({ id_token: idToken({ aud: "outro-cliente" }) }) }, "identidade_invalida"],
    ["iss errado", { token: () => respostaToken({ id_token: idToken({ iss: "https://falso.invalid" }) }) }, "identidade_invalida"],
    ["exp vencido", { token: () => respostaToken({ id_token: idToken({ exp: AGORA - 1 }) }) }, "identidade_invalida"],
    ["email_verified ausente", { token: () => respostaToken({ id_token: idToken({ email_verified: undefined }) }) }, "identidade_invalida"],
    ["email_verified falso", { token: () => respostaToken({ id_token: idToken({ email_verified: false }) }) }, "identidade_invalida"],
    ["hd de outro domínio", { token: () => respostaToken({ id_token: idToken({ hd: "outro.invalid" }) }) }, "identidade_invalida"],
    ["sem sub", { token: () => respostaToken({ id_token: idToken({ sub: "" }) }) }, "identidade_invalida"],
    ["id_token ilegível", { token: () => respostaToken({ id_token: "lixo" }) }, "identidade_invalida"],
    ["conta divergente", { token: () => respostaToken({ id_token: idToken({ email: "outra@neoformas.com.br" }) }) }, "conta_divergente"],
    ["refresh token ausente", { token: () => respostaToken({ refresh_token: undefined }) }, "token_ausente"],
    ["Google responde 400 na troca", { token: () => new Response("{\"error\":\"invalid_grant\"}", { status: 400 }) }, "http"],
    ["falha de rede/timeout na troca", { token: () => Promise.reject(new Error("timeout")) }, "http"],
    ["banco recusa (D-TROCA)", { erroConcluir: "ged:conta_divergente" }, "conta_divergente"],
    ["banco com erro desconhecido", { erroConcluir: "falha interna" }, "http"],
  ];
  for (const [nome, o, codigo] of casos) {
    it(`recusa: ${nome} → ${codigo}, sem conectar e sem vazar`, async () => {
      const { d, chamadas } = deps(o);
      const r = await volta(d);
      expect(r.location).toBe(`https://neoadmin.exemplo.invalid/configuracoes/documentos?ged=erro&codigo=${codigo}`);
      expect(chamadas.find((c) => c.nome === "ged_registrar_erro_conexao")?.args).toEqual({ p_codigo: codigo, p_state: STATE });
      if (!o?.erroConcluir) expect(chamadas.map((c) => c.nome)).not.toContain("ged_concluir_conexao");
      semVazamento(r, chamadas.filter((c) => c.nome === "ged_registrar_erro_conexao"));
    });
  }

  it("conclusão com state vencido no banco (2 min): 'expirou', sem registrar erro", async () => {
    const { d, chamadas } = deps({ erroConcluir: "ged:estado_invalido" });
    expect((await volta(d)).corpo).toContain("expirou");
    expect(chamadas.map((c) => c.nome)).not.toContain("ged_registrar_erro_conexao");
  });
});

describe("regras isoladas", () => {
  it("escopos: conjunto exato", () => {
    expect(escoposConcedidos(ESCOPOS)).toEqual(ESCOPOS.split(" "));
    expect(escoposConcedidos(`email ${ESCOPO_DRIVE_LEITURA}`)).not.toBeNull();
    expect(escoposConcedidos(undefined)).toBeNull();
    expect(escoposConcedidos(`${ESCOPO_DRIVE_LEITURA} https://www.googleapis.com/auth/drive.file`)).toBeNull();
  });

  it("identidade: e-mail comparado sem diferenciar maiúsculas", () => {
    const r = conferirIdToken(idToken({ email: "Teste.Ficticio.GED@NeoFormas.com.br" }), { clientId: ENV.GED_DRIVE_CLIENT_ID, conta: CONTA, agoraSeg: AGORA });
    expect(r).toEqual({ ok: true, email: CONTA, sub: "sub-123" });
  });

  it("retorno: só caminho relativo e mesma origem; open redirect recusado", () => {
    for (const ruim of ["//evil.invalid", "/\\evil", "https://evil.invalid/x", "/%2F%2Fevil", "/a/../b", "/a\r\nx", "javascript:alert(1)"]) {
      expect(urlRetornoGed(ENV.NEO_ADMIN_URL, ruim, "conectado"), ruim).toBeNull();
    }
    expect(urlRetornoGed(ENV.NEO_ADMIN_URL, "/configuracoes/documentos", "erro", "http")).toBe(
      "https://neoadmin.exemplo.invalid/configuracoes/documentos?ged=erro&codigo=http",
    );
  });

  it("URL de autorização não depende de parâmetro recebido para o redirect_uri", () => {
    const cfg = configConexao((k) => ENV[k])!;
    expect(new URL(urlAutorizacaoGoogle(cfg, STATE, "x", CONTA)).searchParams.get("redirect_uri")).toBe(ENV.GED_DRIVE_REDIRECT_URI);
  });
});

describe("desconexão", () => {
  function depsD(o: { perfil?: string | null; revogar?: boolean; token?: string | null; revoke?: () => Response | Promise<Response>; erroLocal?: boolean } = {}) {
    const base = deps();
    const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
    const fetch = vi.fn(async () => (o.revoke ? o.revoke() : new Response("", { status: 200 })));
    const d: DepsDesconexao = {
      ...base.d,
      fetch,
      rpc: async (nome, args) => {
        chamadas.push({ nome, args });
        if (nome === "ged_refresh_token") return { data: o.token === null ? null : { refresh_token: o.token ?? "rt-ficticio" }, error: null };
        if (nome === "ged_desconectar" && o.erroLocal) return { data: null, error: { message: "falha" } };
        return { data: null, error: null };
      },
      perfilAdmin: async () => (o.perfil === undefined ? "perfil-admin" : o.perfil),
      revogarNoGoogle: async () => o.revogar ?? true,
    };
    return { d, chamadas, fetch };
  }
  const desconectar = (d: DepsDesconexao, jwt: string | null = "jwt-ficticio", method = "POST") => tratarDesconexao({ method, jwt }, d);

  it("só POST com JWT de admin", async () => {
    expect((await desconectar(depsD().d, "x", "GET")).status).toBe(405);
    expect((await desconectar(depsD().d, null)).status).toBe(401);
    const { d, chamadas } = depsD({ perfil: null });
    expect((await desconectar(d)).status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  const revogacoes: [string, Parameters<typeof depsD>[0], string][] = [
    ["revogação 200", { revoke: () => new Response("", { status: 200 }) }, "ok"],
    ["token já revogado (400 invalid_token)", { revoke: () => new Response("{\"error\":\"invalid_token\"}", { status: 400 }) }, "ok"],
    ["Google 500", { revoke: () => new Response("", { status: 500 }) }, "falhou"],
    ["timeout/rede", { revoke: () => Promise.reject(new Error("timeout")) }, "falhou"],
    ["D-REV desligada", { revogar: false }, "nao_tentada"],
    ["sem conexão ativa (sem token)", { token: null }, "nao_tentada"],
  ];
  for (const [nome, o, esperado] of revogacoes) {
    it(`${nome}: desconecta localmente SEMPRE e registra '${esperado}'`, async () => {
      const { d, chamadas, fetch } = depsD(o);
      const r = await desconectar(d);
      expect(r).toEqual({ status: 200, corpo: JSON.stringify({ desconectado: true, revogacao: esperado }) });
      expect(chamadas.at(-1)).toEqual({ nome: "ged_desconectar", args: { p_perfil: "perfil-admin", p_revogacao: esperado } });
      if (esperado !== "nao_tentada") {
        const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string }];
        expect(url).toBe("https://oauth2.googleapis.com/revoke");
        expect(init.body).toBe("token=rt-ficticio");
      }
      semVazamento(r);
    });
  }

  it("falha na gravação local: 500 genérico (repetir é seguro: a desconexão é idempotente)", async () => {
    const r = await desconectar(depsD({ erroLocal: true }).d);
    expect(r).toEqual({ status: 500, corpo: "Não foi possível desconectar. Tente de novo." });
  });
});
