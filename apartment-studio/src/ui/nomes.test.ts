import { describe, expect, it } from "vitest";
import { criarPlantaReal } from "../modelo/plantaReal";
import { nomeParede } from "./nomes";

describe("nomes de parede", () => {
  const p = criarPlantaReal();
  const nome = (id: string) => nomeParede(p, p.paredes.find((x) => x.id === id)!);
  it("deriva dos ambientes vizinhos, inclusive por paredes colineares", () => {
    expect(nome("p-fundo-jantar")).toBe("Cozinha e área de serviço / Sala de jantar");
    expect(nome("p-q2-q1")).toBe("Corredor / Quarto 2 / Quarto principal");
    expect(nome("p-coz-sala")).toBe("Cozinha e área de serviço / Sala de estar");
    expect(nome("p-topo-q1")).toBe("Quarto principal · externa");
  });
  it("usa o nome próprio quando existe", () => {
    expect(nome("p-shaft")).toBe("Nicho técnico (shaft) da área de serviço");
  });
  it("nenhuma parede fica sem nome amigável", () => {
    expect(p.paredes.map((x) => nomeParede(p, x)).filter((n) => n.startsWith("Parede "))).toEqual([]);
  });
});
