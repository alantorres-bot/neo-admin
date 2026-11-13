import { describe, expect, it } from "vitest";
import { CATALOGO, opcoesDoMovel } from "./catalogo";
import { FORMAS, pecasDoMovel } from "./formas";

/** Toda peça (exceto as marcadas `fora`) precisa caber na caixa L × P × A do móvel. */
function foraDaCaixa(L: number, P: number, A: number, forma: string, opcoes: Record<string, unknown>): string[] {
  const tol = 1.6;
  const erros: string[] = [];
  for (const p of pecasDoMovel(forma, { L, P, A }, opcoes as never)) {
    if (p.fora || p.r) continue;
    const [x, y, z] = p.p;
    const [sx, sy, sz] = p.s;
    if (x - sx / 2 < -L / 2 - tol || x + sx / 2 > L / 2 + tol) erros.push(`${p.slot}: x`);
    if (y - sy / 2 < -tol || y + sy / 2 > A + tol) erros.push(`${p.slot}: y (${(y - sy / 2).toFixed(1)}..${(y + sy / 2).toFixed(1)} de ${A})`);
    if (p.g !== "plano" && (z - sz / 2 < -P / 2 - tol || z + sz / 2 > P / 2 + tol)) erros.push(`${p.slot}: z`);
  }
  return erros;
}

describe("catálogo e formas", () => {
  it("todo item aponta para uma forma existente e tem cor para cada parte desenhada", () => {
    for (const item of CATALOGO) {
      expect(FORMAS[item.forma], item.id).toBeTypeOf("function");
      const pecas = pecasDoMovel(item.forma, { L: item.largura, P: item.profundidade, A: item.altura }, item.opcoes ?? {});
      expect(pecas.length, item.id).toBeGreaterThan(0);
      for (const p of pecas) expect(item.slots[p.slot], `${item.id} → ${p.slot}`).toBeDefined();
    }
  });

  it("ids do catálogo são únicos", () => {
    expect(new Set(CATALOGO.map((i) => i.id)).size).toBe(CATALOGO.length);
  });

  it("as peças cabem na caixa do móvel no tamanho padrão", () => {
    for (const item of CATALOGO) {
      expect(foraDaCaixa(item.largura, item.profundidade, item.altura, item.forma, item.opcoes ?? {}), item.id).toEqual([]);
    }
  });

  it("continuam cabendo ao redimensionar (80% e 130%)", () => {
    for (const item of CATALOGO) {
      for (const f of [0.8, 1.3]) {
        const erros = foraDaCaixa(item.largura * f, item.profundidade * f, item.altura * f, item.forma, item.opcoes ?? {});
        expect(erros, `${item.id} × ${f}`).toEqual([]);
      }
    }
  });

  it("gaveteiro tem uma frente por gaveta; armário, uma por porta", () => {
    const gav = pecasDoMovel("armario", { L: 82, P: 60, A: 87 }, { gavetas: 3, rodape: 10 }).filter((p) => p.slot === "frente");
    expect(gav).toHaveLength(3);
    const portas = pecasDoMovel("armario", { L: 309, P: 36, A: 62 }, { portas: 4 }).filter((p) => p.slot === "frente");
    expect(portas).toHaveLength(4);
    // 4 portas de ≈77 cm em 309 cm
    expect(portas[0].s[0]).toBeCloseTo(309 / 4 - 0.6, 1);
  });

  it("opções do móvel substituem as do catálogo", () => {
    expect(opcoesDoMovel({ catalogoId: "armario-base", opcoes: { portas: 1 } })).toMatchObject({ portas: 1, rodape: 10 });
  });
});
