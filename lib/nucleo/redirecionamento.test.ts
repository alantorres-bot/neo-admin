import { describe, expect, it } from "vitest";
import { destinoSeguro, origemDaRequisicao } from "./redirecionamento";

describe("destinoSeguro", () => {
  it("aceita caminhos internos, com query", () => {
    expect(destinoSeguro("/financeiro/recebiveis")).toBe("/financeiro/recebiveis");
    expect(destinoSeguro("/inicio?visao=equipe")).toBe("/inicio?visao=equipe");
  });

  it("recusa destino externo ou disfarçado e volta ao padrão", () => {
    for (const ruim of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "", null, undefined, "/ok\nSet-Cookie: x"]) {
      expect(destinoSeguro(ruim)).toBe("/inicio");
    }
  });
});

describe("origemDaRequisicao", () => {
  it("atrás do Cloud Run usa os cabeçalhos x-forwarded-*", () => {
    const h = new Headers({ host: "neo-admin.a.run.app", "x-forwarded-proto": "https", "x-forwarded-host": "neo-admin.a.run.app" });
    expect(origemDaRequisicao(h)).toBe("https://neo-admin.a.run.app");
  });

  it("sem proxy: https por padrão, http só em localhost", () => {
    expect(origemDaRequisicao(new Headers({ host: "painel.neoformas.com.br" }))).toBe("https://painel.neoformas.com.br");
    expect(origemDaRequisicao(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(origemDaRequisicao(new Headers({ host: "127.0.0.1:3100" }))).toBe("http://127.0.0.1:3100");
  });

  it("com lista de proxies, vale o primeiro", () => {
    const h = new Headers({ host: "interno", "x-forwarded-proto": "https, http", "x-forwarded-host": "a.run.app, interno" });
    expect(origemDaRequisicao(h)).toBe("https://a.run.app");
  });
});
