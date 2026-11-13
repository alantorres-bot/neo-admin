import { describe, expect, it } from "vitest";
import { AMOSTRAS, mediana, registrarQuadro } from "./desempenho";

const rodar = (intervalos: number[]) => {
  let amostras: number[] = [];
  let lento = false;
  for (const dt of intervalos) {
    const r = registrarQuadro(amostras, dt);
    amostras = r.amostras;
    lento = lento || r.lento;
  }
  return { amostras, lento };
};

describe("vigia de desempenho do modo realista", () => {
  it("mediana", () => {
    expect(mediana([])).toBe(0);
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });

  it("aparelho rápido (60 quadros por segundo) nunca é dado como lento", () => {
    expect(rodar(Array(200).fill(16.7)).lento).toBe(false);
  });

  it("aparelho lento (5 quadros por segundo) é detectado depois de 24 quadros seguidos", () => {
    expect(rodar(Array(AMOSTRAS - 1).fill(200)).lento).toBe(false);
    expect(rodar(Array(AMOSTRAS).fill(200)).lento).toBe(true);
  });

  it("alguns quadros demorados no meio de quadros rápidos não contam", () => {
    const mistura = Array.from({ length: AMOSTRAS }, (_, i) => (i % 6 === 0 ? 600 : 20));
    expect(rodar(mistura).lento).toBe(false);
  });

  it("aparelho muito lento (um quadro a cada 2 s) também é detectado quando os quadros vêm em sequência", () => {
    let amostras: number[] = [];
    let lento = false;
    for (let i = 0; i < AMOSTRAS; i++) {
      const r = registrarQuadro(amostras, 2000, true);
      amostras = r.amostras;
      lento = lento || r.lento;
    }
    expect(lento).toBe(true);
    // o mesmo intervalo, sem a cena estar em movimento, é só a pessoa parada
    expect(rodar(Array(AMOSTRAS).fill(2000)).lento).toBe(false);
  });

  it("um quadro travado por meio minuto conta como 5 s, não mais", () => {
    expect(registrarQuadro([], 30_000, true).amostras).toEqual([5000]);
  });

  it("parar de mexer zera a contagem", () => {
    const r = rodar([...Array(AMOSTRAS - 2).fill(200), 5000, 200, 200]);
    expect(r.lento).toBe(false);
    expect(r.amostras).toEqual([200, 200]);
  });
});
