import { describe, expect, it } from "vitest";
import { descreverDuracao, hrefAtividades, lerFiltrosAtividades, resumirTipos } from "./atividades";

const EU = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const OUTRO = "1b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

describe("lerFiltrosAtividades", () => {
  it("padrão: últimos 7 dias, com acessos, sem pessoa para quem acompanha", () => {
    expect(lerFiltrosAtividades({}, "2026-10-22", EU, true)).toEqual({ pessoa: null, de: "2026-10-16", ate: "2026-10-22", acessos: true, ref: null, modulo: null });
  });
  it("quem não acompanha a equipe vê só as próprias, mesmo pedindo outra pessoa", () => {
    expect(lerFiltrosAtividades({ pessoa: OUTRO }, "2026-10-22", EU, false).pessoa).toBe(EU);
    expect(lerFiltrosAtividades({ pessoa: OUTRO }, "2026-10-22", EU, true).pessoa).toBe(OUTRO);
  });
  it("troca datas invertidas, limita a 366 dias e ignora valores inválidos", () => {
    expect(lerFiltrosAtividades({ de: "2026-10-22", ate: "2026-10-01" }, "2026-10-22", EU, true)).toMatchObject({ de: "2026-10-01", ate: "2026-10-22" });
    expect(lerFiltrosAtividades({ de: "2020-01-01", ate: "2026-10-22" }, "2026-10-22", EU, true).de).toBe("2025-10-22");
    expect(lerFiltrosAtividades({ pessoa: "x", ref: "y", modulo: "a;b", de: "2026-99-99", acessos: "nao" }, "2026-10-22", EU, true))
      .toEqual({ pessoa: null, de: "2026-10-16", ate: "2026-10-22", acessos: false, ref: null, modulo: null });
  });
});

describe("textos", () => {
  it("hrefAtividades mantém os filtros", () => {
    const f = { pessoa: EU, de: "2026-10-16", ate: "2026-10-22", acessos: false, ref: null, modulo: "rh.folha" };
    expect(hrefAtividades(f, { modulo: null })).toBe(`/gestao/atividades?pessoa=${EU}&de=2026-10-16&ate=2026-10-22&acessos=nao`);
  });
  it("descreverDuracao", () => {
    expect(descreverDuracao(null)).toBe("—");
    expect(descreverDuracao(0.4)).toBe("menos de 1 h");
    expect(descreverDuracao("5.6")).toBe("6 h");
    expect(descreverDuracao(60)).toBe("2,5 dias");
  });
  it("resumirTipos: mais frequentes primeiro, com o nome do catálogo", () => {
    const nomes = new Map([["a", "Confirmou pagamento"], ["b", "Anexou boleto"]]);
    expect(resumirTipos({ b: 5, a: 12 }, nomes)).toBe("Confirmou pagamento: 12 · Anexou boleto: 5");
    expect(resumirTipos({ a: 1, b: 1, c: 1 }, nomes, 2)).toBe("Confirmou pagamento: 1 · Anexou boleto: 1 · +1 tipos");
    expect(resumirTipos({}, nomes)).toBe("—");
  });
});
