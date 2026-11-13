import { describe, expect, it } from "vitest";
import {
  areaAmbienteM2,
  areaPoligono,
  calibrarEscala,
  comprimentoParede,
  conferirCotas,
  definirComprimento,
  medirCota,
  distanciaAteBorda,
  pontoDeVista,
  recortarTrechos,
  trechosParede,
  validarPlanta,
} from "./geometria";
import { criarPlantaReal } from "./plantaReal";
import type { Medida } from "./tipos";

const m = (valor: number): Medida => ({ valor, origem: "estimada" });

describe("área", () => {
  it("retângulo 300 × 400 cm = 12 m²", () => {
    expect(areaPoligono([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }]) / 10_000).toBe(12);
  });
  it("independe do sentido do polígono", () => {
    const p = [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 300, y: 400 }, { x: 300, y: 0 }];
    expect(areaPoligono(p)).toBe(120_000);
  });
  it("quarto principal pelo eixo: 260 × 402 cm", () => {
    const planta = criarPlantaReal();
    const q1 = planta.ambientes.find((a) => a.id === "amb-quarto1")!;
    expect(areaAmbienteM2(planta, q1)).toBeCloseTo(10.452, 3);
  });
});

describe("trechos de parede", () => {
  it("parede sem abertura = um trecho estendido nas pontas", () => {
    expect(trechosParede(400, 260, [], 7.5)).toEqual([{ u0: -7.5, u1: 407.5, v0: 0, v1: 260 }]);
  });

  it("janela gera trechos laterais, peitoril e verga", () => {
    const t = trechosParede(400, 260, [{ posicao: m(200), largura: m(100), altura: m(120), peitoril: m(100) }]);
    expect(t).toEqual([
      { u0: 0, u1: 150, v0: 0, v1: 260 },
      { u0: 150, u1: 250, v0: 0, v1: 100 },
      { u0: 150, u1: 250, v0: 220, v1: 260 },
      { u0: 250, u1: 400, v0: 0, v1: 260 },
    ]);
  });

  it("porta não gera peitoril", () => {
    const t = trechosParede(300, 260, [{ posicao: m(50), largura: m(80), altura: m(210), peitoril: m(0) }]);
    expect(t).toEqual([
      { u0: 0, u1: 10, v0: 0, v1: 260 },
      { u0: 10, u1: 90, v0: 210, v1: 260 },
      { u0: 90, u1: 300, v0: 0, v1: 260 },
    ]);
  });

  it("abertura encostada na ponta não cria trecho vazio", () => {
    const t = trechosParede(100, 260, [{ posicao: m(40), largura: m(80), altura: m(210), peitoril: m(0) }]);
    expect(t).toEqual([
      { u0: 0, u1: 80, v0: 210, v1: 260 },
      { u0: 80, u1: 100, v0: 0, v1: 260 },
    ]);
  });

  it("recorte em 100 cm remove vergas e limita a altura", () => {
    const t = trechosParede(400, 260, [{ posicao: m(200), largura: m(100), altura: m(120), peitoril: m(100) }]);
    const r = recortarTrechos(t, 100);
    expect(r.every((x) => x.v1 <= 100)).toBe(true);
    expect(r).toHaveLength(3);
  });
});

describe("planta real", () => {
  it("é coerente (sem erros nem avisos)", () => {
    expect(validarPlanta(criarPlantaReal())).toEqual([]);
  });

  it("todas as cotas confirmadas da planta batem com o modelo (±0,5 cm)", () => {
    const planta = criarPlantaReal();
    const confirmadas = planta.cotas!.filter((c) => c.situacao === "confirmada");
    expect(confirmadas.length).toBe(14);
    for (const c of confirmadas) {
      expect({ id: c.id, valor: Math.round(medirCota(planta, c) * 10) / 10 }).toEqual({ id: c.id, valor: c.valor });
    }
  });

  it("cotas a confirmar ficam sinalizadas, sem forçar o modelo", () => {
    const lista = conferirCotas(criarPlantaReal());
    const duvidas = lista.filter((c) => c.cota.situacao === "a-confirmar").map((c) => c.cota.texto);
    expect(duvidas.sort()).toEqual(["1,32", "2,52"]);
  });

  it("8 ambientes da planta", () => {
    expect(criarPlantaReal().ambientes.map((a) => a.nome)).toEqual([
      "Varanda",
      "Cozinha e área de serviço",
      "Sala de estar",
      "Sala de jantar",
      "Corredor",
      "Banheiro",
      "Quarto 2",
      "Quarto principal",
    ]);
  });

  it("nenhuma medida está marcada como cota sem ser escrita na planta", () => {
    const p = criarPlantaReal();
    expect(p.vertices.some((v) => v.origem === "cota")).toBe(false);
    expect(p.aberturas.every((a) => a.largura.origem === "estimada" && a.altura.origem === "estimada")).toBe(true);
    expect(p.peDireito.origem).toBe("estimada");
  });

  it("alterar a parede da sala desfaz a conferência da cota da sala", () => {
    const p = criarPlantaReal();
    const mexida = { ...p, vertices: p.vertices.map((v) => (v.id === "W2a" || v.id === "W2b" ? { ...v, x: v.x + 10 } : v)) };
    const sala = conferirCotas(mexida).find((c) => c.cota.id === "c-sala-larg")!;
    expect(sala.confere).toBe(false);
    expect(sala.diferenca).toBeCloseTo(10, 5);
  });
});

describe("edição", () => {
  it("alterar comprimento move o vértice final e marca como manual", () => {
    const p = criarPlantaReal();
    const nova = definirComprimento(p, "p-topo-q1", 300);
    const parede = nova.paredes.find((x) => x.id === "p-topo-q1")!;
    expect(comprimentoParede(nova, parede)).toBeCloseTo(300, 5);
    expect(nova.vertices.find((v) => v.id === "R0")!.origem).toBe("manual");
    // modelo original intocado
    expect(p.vertices.find((v) => v.id === "R0")!.x).toBe(918);
  });

  it("calibração: cota de 350 cm medindo 700 px = 0,5 cm/px", () => {
    expect(calibrarEscala(350, 700)).toBe(0.5);
    expect(() => calibrarEscala(0, 10)).toThrow();
  });
});

describe("ponto de vista interno", () => {
  it("em cômodo 300 × 600 fica no fundo, a 50 cm da borda, olhando o comprimento", () => {
    const sala = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
    const pv = pontoDeVista(sala, 50);
    expect(pv.x).toBeGreaterThan(0);
    expect(pv.x).toBeLessThan(300);
    expect(pv.y).toBeGreaterThan(0);
    expect(pv.y).toBeLessThan(600);
    // olha predominantemente ao longo do lado maior (diagonal canto a canto é aceita)
    expect(Math.abs(pv.dy)).toBeGreaterThan(Math.abs(pv.dx));
    expect(distanciaAteBorda(pv, -pv.dx, -pv.dy, sala)).toBeCloseTo(50, 5);
    expect(distanciaAteBorda(pv, pv.dx, pv.dy, sala)).toBeGreaterThan(550);
  });
  it("distância até a borda", () => {
    const q = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(distanciaAteBorda({ x: 50, y: 50 }, 1, 0, q)).toBeCloseTo(50, 6);
  });
});
