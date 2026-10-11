import { describe, expect, it } from "vitest";
import { codigoDeErroLogin, emailDoDominio, entrouPorOAuth, mensagemDeErroLogin } from "./login";

describe("codigoDeErroLogin", () => {
  it("traduz os códigos do Supabase para os avisos da tela", () => {
    expect(codigoDeErroLogin("signup_disabled")).toBe("sem_cadastro");
    expect(codigoDeErroLogin("user_banned")).toBe("desativado");
  });

  it("qualquer outra coisa vira erro genérico do Google", () => {
    for (const c of ["server_error", "access_denied", "", null, undefined]) expect(codigoDeErroLogin(c)).toBe("google");
  });
});

describe("mensagemDeErroLogin", () => {
  it("devolve o texto em português do código conhecido (aceita lista da query string)", () => {
    expect(mensagemDeErroLogin("sem_cadastro")).toMatch(/ainda não tem acesso/);
    expect(mensagemDeErroLogin(["dominio"])).toMatch(/@neoformas\.com\.br/);
  });

  it("ignora código desconhecido, vazio ou que tenta ler o protótipo", () => {
    for (const c of ["xpto", "", null, undefined, "constructor", "toString"]) expect(mensagemDeErroLogin(c)).toBeNull();
  });
});

describe("emailDoDominio", () => {
  it("aceita só e-mail da empresa, sem diferenciar maiúsculas", () => {
    expect(emailDoDominio("alan@neoformas.com.br")).toBe(true);
    expect(emailDoDominio("  Alan@NeoFormas.com.br ")).toBe(true);
  });

  it("recusa outros domínios, subdomínios, dois @ e vazio", () => {
    for (const e of ["alan@gmail.com", "alan@neoformas.com", "alan@x.neoformas.com.br", "a@b@neoformas.com.br", "@neoformas.com.br", "", null, undefined]) {
      expect(emailDoDominio(e)).toBe(false);
    }
  });
});

describe("entrouPorOAuth", () => {
  it("reconhece a sessão iniciada pelo Google pela claim amr", () => {
    expect(entrouPorOAuth({ amr: [{ method: "oauth", timestamp: 1 }] })).toBe(true);
    expect(entrouPorOAuth({ amr: [{ method: "password", timestamp: 1 }, { method: "oauth", timestamp: 2 }] })).toBe(true);
  });

  it("sem amr, ou só senha, assume senha (nunca libera por engano)", () => {
    expect(entrouPorOAuth({ amr: [{ method: "password", timestamp: 1 }] })).toBe(false);
    expect(entrouPorOAuth({})).toBe(false);
    expect(entrouPorOAuth(null)).toBe(false);
    expect(entrouPorOAuth({ amr: "oauth" })).toBe(false);
    expect(entrouPorOAuth({ amr: [null, "oauth"] })).toBe(false);
  });
});
