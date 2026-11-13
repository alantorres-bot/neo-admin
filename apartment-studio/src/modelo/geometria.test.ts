import { describe, expect, it } from "vitest";
import {
  areaAmbienteM2,
  areaPoligono,
  calibrarEscala,
  comprimentoParede,
  conferirCotas,
  definirComprimento,
  ambientesDaParede,
  haParedeEntre,
  ladoInternoDaAbertura,
  medirCota,
  pontoAoLadoDaParede,
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

describe("lados da parede", () => {
  const planta = criarPlantaReal();
  const parede = (id: string) => planta.paredes.find((p) => p.id === id)!;
  const abertura = (id: string) => planta.aberturas.find((a) => a.id === id)!;

  it("o ponto ao lado fica fora da espessura, do lado pedido", () => {
    const p = parede("p-coz-sala");
    const meio = comprimentoParede(planta, p) / 2;
    const d = pontoAoLadoDaParede(planta, p, meio, "direita", 15);
    const e = pontoAoLadoDaParede(planta, p, meio, "esquerda", 15);
    // os dois pontos ficam a (espessura + 30) cm um do outro, um de cada lado
    expect(Math.hypot(d.x - e.x, d.y - e.y)).toBeCloseTo(p.espessura.valor + 30, 5);
  });

  it("a divisória entre cozinha e sala tem a cozinha de um lado e a sala do outro", () => {
    const lados = ambientesDaParede(planta, parede("p-coz-sala"));
    expect([lados.direita?.id, lados.esquerda?.id].sort()).toEqual(["amb-cozinha", "amb-sala"]);
  });

  it("parede externa só tem ambiente de um lado", () => {
    const lados = ambientesDaParede(planta, parede("p-coz-esq"));
    expect(Object.values(lados).map((a) => a!.id)).toEqual(["amb-cozinha"]);
  });

  it("janelas e a porta da varanda sabem qual é o lado de dentro", () => {
    const dentro = (id: string) => {
      const ab = abertura(id);
      const lado = ladoInternoDaAbertura(planta, ab);
      return lado ? ambientesDaParede(planta, parede(ab.paredeId), ab.posicao.valor)[lado]?.id : null;
    };
    expect(dentro("pt-varanda")).toBe("amb-sala");
    expect(dentro("j-servico")).toBe("amb-cozinha");
    expect(dentro("j-quarto1")).toBe("amb-quarto1");
    expect(dentro("j-quarto2")).toBe("amb-quarto2");
    expect(dentro("j-banheiro")).toBe("amb-banheiro");
  });

  it("porta entre dois ambientes internos não tem lado de dentro", () => {
    expect(ladoInternoDaAbertura(planta, abertura("pt-quarto1"))).toBeNull();
    expect(ladoInternoDaAbertura(planta, abertura("pt-banheiro"))).toBeNull();
  });
});

describe("linha de visão", () => {
  const planta = criarPlantaReal();

  it("dentro do mesmo ambiente não há parede no caminho", () => {
    expect(haParedeEntre(planta, { x: 200, y: 120 }, { x: 380, y: 280 })).toBe(false); // sala
    expect(haParedeEntre(planta, { x: 700, y: 48 }, { x: 850, y: 335 })).toBe(false); // suíte
  });

  it("da sala para o quarto 2 há a parede entre eles", () => {
    expect(haParedeEntre(planta, { x: 300, y: 150 }, { x: 520, y: 150 })).toBe(true);
  });

  it("da suíte não se vê o espelho do banheiro; da porta do banheiro, sim", () => {
    const espelho = { x: 581, y: 512 };
    expect(haParedeEntre(planta, { x: 700, y: 48 }, espelho)).toBe(true);
    expect(haParedeEntre(planta, { x: 440, y: 380 }, { x: 440, y: 512 })).toBe(true); // do corredor, longe da porta
    expect(haParedeEntre(planta, { x: 598, y: 400 }, espelho)).toBe(false); // vista "Banheiro": parada no vão da porta
    const porta = planta.aberturas.find((a) => a.id === "pt-banheiro")!;
    const parede = planta.paredes.find((p) => p.id === porta.paredeId)!;
    const a = planta.vertices.find((v) => v.id === parede.a)!;
    const b = planta.vertices.find((v) => v.id === parede.b)!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    // 40 cm para fora do banheiro, bem na frente da porta: enxerga o espelho pelo vão
    const naPorta = { x: a.x + ((b.x - a.x) * porta.posicao.valor) / L, y: a.y + ((b.y - a.y) * porta.posicao.valor) / L - 40 };
    expect(haParedeEntre(planta, naPorta, { x: naPorta.x, y: 512 })).toBe(false);
  });

  it("o guarda-corpo da varanda não tapa a vista", () => {
    expect(haParedeEntre(planta, { x: 200, y: 40 }, { x: 200, y: -200 })).toBe(false);
  });
});
