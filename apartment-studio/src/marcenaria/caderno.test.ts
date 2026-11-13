import { describe, expect, it } from "vitest";
import { gerarCaderno } from "./caderno";
import { fmt } from "./desenho";
import { LOTES, criarMarcenaria, todasAsPecas } from "./projeto";

const caderno = gerarCaderno();

describe("caderno de marcenaria", () => {
  it("traz as pranchas esperadas, cada uma com código único", () => {
    const cods = caderno.pranchas.map((p) => p.cod);
    expect(cods[0]).toBe("CAPA");
    expect(new Set(cods).size).toBe(cods.length);
    for (const c of ["N-01", "C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "G-01", "G-02", "G-03", "G-04", "G-05", "Q-01", "Q-02", "P-01"]) expect(cods).toContain(c);
    expect((caderno.html.match(/<section class="prancha"/g) ?? []).length).toBe(cods.length);
  });

  it("todo módulo tem detalhamento com a lista de peças", () => {
    const mc = criarMarcenaria();
    for (const m of mc.modulos) {
      if (m.cod === "CR2") continue; // igual ao CR1, detalhado uma vez
      expect(caderno.html, m.cod).toContain(`<b class="cod">${m.cod}</b>`);
    }
  });

  it("não deixa escapar valor inválido nem número com ponto decimal no texto", () => {
    expect(caderno.html).not.toMatch(/undefined|NaN|\[object Object\]/);
    const texto = caderno.html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/src="data:[^"]*"/g, "").replace(/style="[^"]*"/g, "");
    // "2.000 mm" (milhar) é válido; "769.5 mm" (decimal com ponto) não
    expect(texto.match(/\d\.\d{1,2} (mm|m²|m\b)/g) ?? []).toEqual([]);
  });

  it("as cotas das pranchas trazem as medidas da planta marcadas como P", () => {
    expect(caderno.html).toMatch(/>3870<tspan class="og og-P"/);
    expect(caderno.html).toMatch(/>3920<tspan class="og og-P"/);
    expect(caderno.html).toMatch(/>2600<tspan class="og og-E"/); // pé-direito: estimado
  });

  it("a planilha tem as mesmas peças e os mesmos lotes do caderno", () => {
    const mc = criarMarcenaria();
    expect(caderno.planilha.pecas.length).toBe(todasAsPecas(mc).length);
    expect(caderno.planilha.lotes.map((l) => l[0])).toEqual(LOTES.map((l) => l.cod));
    expect(caderno.planilha.modulos.length).toBe(mc.modulos.length);
    expect(caderno.planilha.pendencias.length).toBe(mc.pendencias.length);
  });

  it("formata medidas com vírgula", () => {
    expect(fmt(769.5)).toBe("769,5");
    expect(fmt(820)).toBe("820");
  });
});
