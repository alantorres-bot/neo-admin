import { describe, expect, it } from "vitest";
import { CATALOGO, slotsDoMovel } from "../catalogo/catalogo";
import { pecasDoMovel } from "../catalogo/formas";
import { criarProjetoBase } from "../modelo/projetoBase";
import { areaDeEspelho } from "./areaEspelho";

const frentes = (id: string) => {
  const m = criarProjetoBase().moveis.find((x) => x.id === id)!;
  const item = CATALOGO.find((i) => i.id === m.catalogoId)!;
  const slots = slotsDoMovel(m);
  return pecasDoMovel(item.forma, { L: m.largura, P: m.profundidade, A: m.altura }, { ...item.opcoes, ...m.opcoes }).filter((p) => slots[p.slot]?.acabamento === "espelho" && p.g === "caixa");
};

describe("área de espelho de um móvel", () => {
  it("armário de espelho do banheiro: um espelho só, cobrindo as 4 portas, com 3 emendas", () => {
    const area = areaDeEspelho(frentes("ban-armario-espelho"))!;
    expect(area.x1 - area.x0).toBeGreaterThan(140);
    expect(area.x1 - area.x0).toBeLessThanOrEqual(146);
    expect(area.y1 - area.y0).toBeGreaterThan(85);
    expect(area.z).toBeCloseTo(6.5, 5); // frente do armário de 13 cm
    expect(area.emendas).toHaveLength(3);
    // emendas igualmente espaçadas
    const passos = [area.emendas[0] - area.x0, area.emendas[1] - area.emendas[0], area.emendas[2] - area.emendas[1]];
    expect(Math.max(...passos) - Math.min(...passos)).toBeLessThan(1);
  });

  it("guarda-roupa da suíte: as portas de espelho viram um espelho de piso a teto", () => {
    const area = areaDeEspelho(frentes("sui-gr-espelho"))!;
    expect(area.y1 - area.y0).toBeGreaterThan(230);
    expect(area.emendas.length).toBeGreaterThanOrEqual(1);
  });

  it("móvel sem espelho, ou espelho minúsculo, não vira espelho de verdade", () => {
    expect(areaDeEspelho([])).toBeNull();
    expect(areaDeEspelho([{ p: [0, 0, 0], s: [5, 5, 1] }])).toBeNull();
  });

  it("peças espelhadas fora do plano da frente ficam de fora", () => {
    const area = areaDeEspelho([
      { p: [0, 50, 5], s: [40, 100, 2] },
      { p: [100, 50, -20], s: [40, 100, 2] },
    ])!;
    expect([area.x0, area.x1]).toEqual([-20, 20]);
    expect(area.emendas).toEqual([]);
  });
});
