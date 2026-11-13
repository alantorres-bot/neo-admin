import { describe, expect, it } from "vitest";
import { itemCatalogo } from "../catalogo/catalogo";
import { ambienteDoPonto, extensoesParede, retanguloParede } from "./geometria";
import { cantosMovel, conflitosDoMovel, conflitosDoProjeto, encaixar, envolvente, folgaFrontal, frenteDoMovel, setorPorta, sobreposicao } from "./moveis";
import { criarProjetoBase } from "./projetoBase";

const quadrado = (x: number, y: number, l: number) => [
  { x, y },
  { x: x + l, y },
  { x: x + l, y: y + l },
  { x, y: y + l },
];

describe("geometria dos móveis", () => {
  it("rotação: 0 = frente para baixo, 90 = para a direita, 180 = para cima, 270 = para a esquerda", () => {
    const f = (r: number) => {
      const d = frenteDoMovel({ rotacao: r });
      return [Math.round(d.x) + 0, Math.round(d.y) + 0];
    };
    expect(f(0)).toEqual([0, 1]);
    expect(f(90)).toEqual([1, 0]);
    expect(f(180)).toEqual([0, -1]);
    expect(f(270)).toEqual([-1, 0]);
  });

  it("a 90° a largura fica ao longo de y", () => {
    const c = envolvente(cantosMovel({ x: 217, y: 201, rotacao: 90, largura: 230, profundidade: 100 }));
    expect([c.x0, c.x1, c.y0, c.y1].map(Math.round)).toEqual([167, 267, 86, 316]);
  });

  it("sobreposição: encostar não conta, invadir conta", () => {
    expect(sobreposicao(quadrado(0, 0, 10), quadrado(10, 0, 10))).toBe(0);
    expect(sobreposicao(quadrado(0, 0, 10), quadrado(7, 0, 10))).toBeCloseTo(3, 6);
    expect(sobreposicao(quadrado(0, 0, 10), quadrado(30, 30, 10))).toBe(0);
  });
});

describe("encontros de parede", () => {
  const { planta } = criarProjetoBase();
  const ext = (id: string) => extensoesParede(planta, planta.paredes.find((p) => p.id === id)!);
  it("shaft da cozinha termina exatamente em y = 139 (ponta livre)", () => {
    expect(ext("p-shaft")).toEqual([0, 0]);
    const r = envolvente(retanguloParede(planta, planta.paredes.find((p) => p.id === "p-shaft")!));
    expect([r.x0, r.x1, r.y1]).toEqual([10, 32, 139]);
  });
  it("canto em L fecha com meia espessura da outra parede", () => {
    expect(ext("p-q1-dir")).toEqual([5, 5]);
    // parede da TV: canto com a parede do quarto 2 embaixo → vai até 304 (cota 2,30)
    expect(ext("p-sala-q2")[1]).toBe(3.5);
  });
  it("divisória da cozinha: ponta livre do lado do jantar", () => {
    expect(ext("p-coz-sala")[1]).toBe(0);
  });
});

describe("projeto-base do Alan", () => {
  const projeto = criarProjetoBase();

  it("todos os móveis usam itens existentes do catálogo e têm id único", () => {
    for (const m of projeto.moveis) expect(itemCatalogo(m.catalogoId), m.id).toBeDefined();
    expect(new Set(projeto.moveis.map((m) => m.id)).size).toBe(projeto.moveis.length);
  });

  it("nenhum móvel atravessa parede, invade giro de porta ou se sobrepõe a outro", () => {
    const conflitos = [...conflitosDoProjeto(projeto).entries()].map(([id, c]) => `${id}: ${c.map((x) => x.mensagem).join("; ")}`);
    expect(conflitos).toEqual([]);
  });

  it("todo móvel está dentro de algum ambiente", () => {
    const fora = projeto.moveis.filter((m) => !ambienteDoPonto(projeto.planta, m)).map((m) => m.id);
    expect(fora).toEqual([]);
  });

  it("os módulos da cozinha somam os 3,87 m da cota, do shaft à parede da porta", () => {
    const ids = ["coz-gaveteiro", "coz-base-forno", "coz-base-lavaloucas", "coz-base-pia", "coz-base-porta"];
    const soma = ids.reduce((s, id) => s + projeto.moveis.find((m) => m.id === id)!.largura, 0);
    const torre = 3 + 75; // painel + vão da geladeira
    expect(soma + torre).toBe(387);
  });

  it("circulações: corredor da cozinha ≈ 88 cm; sofá–rack ≈ 102 cm; pé da cama ≈ 61 cm", () => {
    const m = (id: string) => projeto.moveis.find((x) => x.id === id)!;
    expect(folgaFrontal(projeto, m("coz-bancada"))).toBe(88);
    expect(folgaFrontal(projeto, m("sala-sofa"))).toBe(102);
    expect(folgaFrontal(projeto, m("sui-cama"))).toBe(61);
  });

  it("a porta de entrada abre sem bater nas cadeiras", () => {
    const porta = projeto.planta.aberturas.find((a) => a.id === "pt-entrada")!;
    const setor = setorPorta(projeto.planta, porta)!;
    const s = envolvente(setor);
    // setor para dentro do apartamento, encostado na parede do hall
    expect(s.y1).toBeCloseTo(526, 0);
    expect(s.x1).toBeCloseTo(388, 0);
    for (const id of ["jan-cadeira-3", "jan-cadeira-4"]) {
      expect(sobreposicao(cantosMovel(projeto.moveis.find((m) => m.id === id)!), setor)).toBe(0);
    }
  });

  it("acusa conflito quando o sofá é empurrado para dentro da parede", () => {
    const sofa = { ...projeto.moveis.find((m) => m.id === "sala-sofa")!, x: 200 };
    const c = conflitosDoMovel(projeto, sofa);
    expect(c.some((x) => x.tipo === "parede")).toBe(true);
  });

  it("vistas apontam para ambientes existentes", () => {
    const ids = new Set(projeto.planta.ambientes.map((a) => a.id));
    expect(projeto.vistas.every((v) => v.ambienteId && ids.has(v.ambienteId))).toBe(true);
  });
});

describe("encaixe ao arrastar", () => {
  const projeto = criarProjetoBase();
  const sofa = projeto.moveis.find((m) => m.id === "sala-sofa")!;
  it("encosta na face da parede quando chega perto", () => {
    // a 4 cm da divisória (face em x = 167): encosta
    expect(encaixar(projeto, sofa, 221, 201).x).toBe(217);
  });
  it("longe de tudo, só arredonda para 1 cm", () => {
    const solto = { ...sofa, id: "x", largura: 40, profundidade: 40, rotacao: 0 };
    expect(encaixar({ ...projeto, moveis: [] }, solto, 300.4, 400.6)).toEqual({ x: 300, y: 401 });
  });
});
