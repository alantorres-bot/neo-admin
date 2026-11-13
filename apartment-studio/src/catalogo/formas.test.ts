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

  it("rack segue o desenho do fabricante: tampo 175, corpo 170, pés de 15, corpo de 33, nicho de 55", () => {
    const rack = CATALOGO.find((i) => i.id === "rack-ripado")!;
    expect([rack.largura, rack.profundidade, rack.altura]).toEqual([175, 38, 50.2]);
    const pecas = pecasDoMovel(rack.forma, { L: rack.largura, P: rack.profundidade, A: rack.altura }, rack.opcoes ?? {});
    const faixaX = (ps: typeof pecas) => [Math.min(...ps.map((p) => p.p[0] - p.s[0] / 2)), Math.max(...ps.map((p) => p.p[0] + p.s[0] / 2))];
    const faixaY = (ps: typeof pecas) => [Math.min(...ps.map((p) => p.p[1] - p.s[1] / 2)), Math.max(...ps.map((p) => p.p[1] + p.s[1] / 2))];
    const tampo = pecas.filter((p) => p.slot === "tampo");
    expect(faixaX(tampo)).toEqual([-87.5, 87.5]);
    expect(faixaY(tampo)[1]).toBeCloseTo(50.2, 5);
    const corpo = pecas.filter((p) => p.slot === "corpo");
    expect(faixaX(corpo)).toEqual([-85, 85]);
    expect(faixaY(corpo)[0]).toBeCloseTo(15, 5); // começa em cima dos pés
    expect(faixaY(corpo)[1] - faixaY(corpo)[0]).toBeCloseTo(33, 1);
    // pés: 4 palito (inclinados) nas pontas + 4 retos sob as divisórias do nicho
    const pes = pecas.filter((p) => p.slot === "pes");
    expect(pes.filter((p) => p.r)).toHaveLength(4);
    const retos = pes.filter((p) => !p.r);
    expect(retos).toHaveLength(4);
    for (const pe of retos) {
      expect(Math.abs(pe.p[0])).toBeCloseTo(27.5, 5);
      expect(pe.s[1]).toBeCloseTo(15, 5);
    }
    // nicho central de 55 cm, aberto: fundo próprio, prateleira no meio e nenhuma ripa na frente dele
    const nicho = pecas.filter((p) => p.slot === "nicho");
    expect(nicho).toHaveLength(1);
    expect(nicho[0].s[0]).toBeCloseTo(55, 5);
    const ripas = pecas.filter((p) => p.slot === "frente");
    expect(ripas.length).toBeGreaterThanOrEqual(16); // 8 ripas por porta
    for (const r of ripas) expect(Math.abs(r.p[0]) - r.s[0] / 2).toBeGreaterThanOrEqual(27.5);
  });

  it("puxador cava: a frente fica 2,4 cm mais baixa e ganha um rebaixo escuro em cima", () => {
    const sem = pecasDoMovel("armario", { L: 70, P: 60, A: 87 }, { portas: 2, rodape: 10 });
    const com = pecasDoMovel("armario", { L: 70, P: 60, A: 87 }, { portas: 2, rodape: 10, cava: true });
    const frentes = (ps: typeof sem) => ps.filter((p) => p.slot === "frente");
    expect(frentes(com)).toHaveLength(2);
    expect(frentes(sem)[0].s[1] - frentes(com)[0].s[1]).toBeCloseTo(2.4, 5);
    const cavas = com.filter((p) => p.slot === "cava");
    expect(cavas).toHaveLength(2);
    // o rebaixo fica logo acima da frente, sem passar do corpo
    expect(cavas[0].p[1] - cavas[0].s[1] / 2).toBeCloseTo(frentes(com)[0].p[1] + frentes(com)[0].s[1] / 2, 5);
    expect(sem.some((p) => p.slot === "cava")).toBe(false);
  });

  it("cadeira: encosto inclinado para trás e apoiado na frente dos montantes", () => {
    const pecas = pecasDoMovel("cadeira", { L: 47, P: 47, A: 86 }, {});
    const encosto = pecas.filter((p) => p.r);
    expect(encosto).toHaveLength(2); // quadro de madeira + painel de palhinha
    expect(encosto.map((p) => p.slot).sort()).toEqual(["encosto", "madeira"]);
    for (const p of encosto) expect(p.r![0]).toBeLessThan(0);
    const montantes = pecas.filter((p) => p.slot === "madeira" && !p.r && p.p[2] < 0 && p.s[1] > 60);
    expect(montantes).toHaveLength(2);
    // a face de trás do encosto começa onde termina a frente dos montantes
    const frenteMontante = Math.max(...montantes.map((p) => p.p[2] + p.s[2] / 2));
    expect(encosto[0].p[2] - encosto[0].s[2] / 2).toBeGreaterThanOrEqual(frenteMontante);
  });

  it("opções do móvel substituem as do catálogo", () => {
    expect(opcoesDoMovel({ catalogoId: "armario-base", opcoes: { portas: 1 } })).toMatchObject({ portas: 1, rodape: 10 });
  });
});
