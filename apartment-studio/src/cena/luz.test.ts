import { describe, expect, it } from "vitest";
import { condicaoDeLuz, elevacaoSol, HORA_MAX, HORA_MIN, luzesAcesas, misturar, rotuloHora, SOL_PLENO } from "./luz";

describe("luz conforme a hora", () => {
  it("o sol nasce às 6h, culmina ao meio-dia e se põe às 18h", () => {
    expect(elevacaoSol(6)).toBeCloseTo(0, 5);
    expect(elevacaoSol(12)).toBeCloseTo(62, 5);
    expect(elevacaoSol(18)).toBeCloseTo(0, 5);
    expect(elevacaoSol(9)).toBeCloseTo(elevacaoSol(15), 5); // manhã e tarde simétricas
    expect(elevacaoSol(20)).toBeLessThan(-20);
  });

  it("meio-dia: dia claro, sol forte e quase branco, vindo do lado da varanda (z negativo)", () => {
    const c = condicaoDeLuz(12);
    expect(c.dia).toBe(1);
    expect(c.noite).toBe(false);
    expect(c.sol.intensidade).toBeCloseTo(SOL_PLENO, 5);
    expect(c.sol.cor).toBe("#fff4e6");
    expect(c.sol.direcao[0]).toBeCloseTo(0, 5);
    expect(c.sol.direcao[1]).toBeGreaterThan(0.8);
    expect(c.sol.direcao[2]).toBeLessThan(0);
    expect(c.lua).toBe(0);
  });

  it("de manhã o sol vem do leste (x positivo) e à tarde do oeste (x negativo)", () => {
    expect(condicaoDeLuz(8).sol.direcao[0]).toBeGreaterThan(0.4);
    expect(condicaoDeLuz(16).sol.direcao[0]).toBeLessThan(-0.4);
    // vetor unitário
    const [x, y, z] = condicaoDeLuz(8).sol.direcao;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
  });

  it("perto do horizonte a luz é fraca e quente; o céu fica alaranjado", () => {
    const c = condicaoDeLuz(17.5);
    expect(c.sol.intensidade).toBeGreaterThan(0);
    expect(c.sol.intensidade).toBeLessThan(condicaoDeLuz(15).sol.intensidade);
    const vermelho = parseInt(c.sol.cor.slice(1, 3), 16);
    const azul = parseInt(c.sol.cor.slice(5, 7), 16);
    expect(vermelho - azul).toBeGreaterThan(40);
    expect(c.ceu.horizonte).not.toBe(condicaoDeLuz(12).ceu.horizonte);
  });

  it("à noite não há sol, a luz difusa quase some e as luzes acendem sozinhas", () => {
    const c = condicaoDeLuz(21);
    expect(c.dia).toBe(0);
    expect(c.noite).toBe(true);
    expect(c.sol.intensidade).toBe(0);
    expect(c.difusa.intensidade).toBeLessThan(0.1);
    expect(c.lua).toBeGreaterThan(0.1);
    expect(luzesAcesas({ luzArtificial: false, horaSol: 21 })).toBe(true);
    expect(luzesAcesas({ luzArtificial: false, horaSol: 10 })).toBe(false);
    expect(luzesAcesas({ luzArtificial: true, horaSol: 10 })).toBe(true);
  });

  it("a claridade só aumenta do nascer ao meio-dia e só diminui até a noite", () => {
    let anterior = -1;
    for (let h = HORA_MIN; h <= 12; h += 0.5) {
      const d = condicaoDeLuz(h).difusa.intensidade;
      expect(d).toBeGreaterThanOrEqual(anterior);
      anterior = d;
    }
    for (let h = 12; h <= HORA_MAX; h += 0.5) {
      const d = condicaoDeLuz(h).difusa.intensidade;
      expect(d).toBeLessThanOrEqual(anterior);
      anterior = d;
    }
  });

  it("fora da faixa do relógio vale o limite", () => {
    expect(condicaoDeLuz(3)).toEqual(condicaoDeLuz(HORA_MIN));
    expect(condicaoDeLuz(30)).toEqual(condicaoDeLuz(HORA_MAX));
  });

  it("mistura de cores e rótulo do relógio", () => {
    expect(misturar("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(misturar("#102030", "#102030", 0.3)).toBe("#102030");
    expect(rotuloHora(10)).toBe("☀ 10h");
    expect(rotuloHora(20.5)).toBe("☾ 20h30");
  });
});
