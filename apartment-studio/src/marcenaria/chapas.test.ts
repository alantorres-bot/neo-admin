import { describe, expect, it } from "vitest";
import { CHAPA, estimativaDeChapas, lotesDoGrupo, pecasDeCorte, planoDeCorte } from "./chapas";
import { criarMarcenaria, todasAsPecas } from "./projeto";

const mc = criarMarcenaria();

describe("estimativa de chapas", () => {
  it("usa as mesmas peças e a mesma área da lista de corte", () => {
    const pecas = pecasDeCorte(mc);
    const lista = todasAsPecas(mc);
    expect(pecas.length).toBe(lista.reduce((t, l) => t + l.qtd, 0));
    const area = pecas.reduce((t, p) => t + (p.a * p.b) / 1e6, 0);
    expect(area).toBeCloseTo(lista.reduce((t, l) => t + l.areaM2, 0), 1);
  });

  it("padrões com veio não giram e têm o veio na vertical nas peças em pé", () => {
    const pecas = pecasDeCorte(mc);
    expect(pecas.filter((p) => p.padrao === "carvalho" || p.padrao === "madeira").every((p) => !p.girar)).toBe(true);
    expect(pecas.filter((p) => p.padrao === "branco").every((p) => p.girar)).toBe(true);
    const portaG4 = pecas.find((p) => p.padrao === "cinza" && p.a > 2000)!;
    expect(portaG4.a).toBe(2514);
    const cabeceira = pecas.find((p) => p.modulo === "CB")!;
    expect(cabeceira.a).toBe(1580); // altura do painel no sentido do comprimento da chapa
  });

  it("o plano de corte coloca todas as peças, sem sobrepor e dentro da chapa", () => {
    for (const lotes of [undefined, lotesDoGrupo("A"), lotesDoGrupo("B")]) {
      const porMaterial = new Map<string, ReturnType<typeof pecasDeCorte>>();
      for (const p of pecasDeCorte(mc, lotes)) porMaterial.set(`${p.padrao}|${p.esp}`, [...(porMaterial.get(`${p.padrao}|${p.esp}`) ?? []), p]);
      for (const [material, pecas] of porMaterial) {
        const { chapas, encaixes } = planoDeCorte(pecas);
        expect(encaixes.length, material).toBe(pecas.length);
        const utilW = CHAPA.comp - 2 * CHAPA.refilo;
        const utilH = CHAPA.larg - 2 * CHAPA.refilo;
        for (const e of encaixes) {
          expect(e.chapa).toBeLessThan(chapas);
          expect(e.x + e.w, material).toBeLessThanOrEqual(utilW + 0.01);
          expect(e.y + e.h, material).toBeLessThanOrEqual(utilH + 0.01);
        }
        for (let i = 0; i < encaixes.length; i++) {
          for (let j = i + 1; j < encaixes.length; j++) {
            const a = encaixes[i];
            const b = encaixes[j];
            if (a.chapa !== b.chapa) continue;
            // entre duas peças tem de sobrar a espessura da serra
            const separadas = a.x + a.w + CHAPA.serra <= b.x + 0.01 || b.x + b.w + CHAPA.serra <= a.x + 0.01 || a.y + a.h + CHAPA.serra <= b.y + 0.01 || b.y + b.h + CHAPA.serra <= a.y + 0.01;
            expect(separadas, `${material}: peças ${i} e ${j}`).toBe(true);
          }
        }
        // a área das peças tem de corresponder
        const areaPecas = pecas.reduce((t, p) => t + p.a * p.b, 0);
        expect(encaixes.reduce((t, e) => t + e.w * e.h, 0)).toBeCloseTo(areaPecas, 0);
      }
    }
  });

  it("nunca fica abaixo do mínimo teórico nem desperdiça mais que uma chapa e meia por material", () => {
    for (const l of estimativaDeChapas(mc)) {
      expect(l.chapas, l.material).toBeGreaterThanOrEqual(l.minimo);
      expect(l.chapas - l.minimo, l.material).toBeLessThanOrEqual(2);
      expect(l.aproveitamento).toBeGreaterThan(0);
      expect(l.aproveitamento).toBeLessThanOrEqual(100);
    }
  });

  it("comprar por grupo separado nunca pede menos chapas que comprar tudo junto", () => {
    const total = (ls: ReturnType<typeof estimativaDeChapas>) => ls.reduce((t, l) => t + l.chapas, 0);
    const junto = total(estimativaDeChapas(mc));
    const separado = total(estimativaDeChapas(mc, lotesDoGrupo("A"))) + total(estimativaDeChapas(mc, lotesDoGrupo("B"))) + total(estimativaDeChapas(mc, lotesDoGrupo("C")));
    expect(separado).toBeGreaterThanOrEqual(junto);
  });
});
