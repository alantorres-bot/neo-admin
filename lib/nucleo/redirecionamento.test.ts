import { describe, expect, it } from "vitest";
import { destinoSeguro } from "./redirecionamento";

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
