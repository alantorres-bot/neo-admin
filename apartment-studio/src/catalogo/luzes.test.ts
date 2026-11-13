import { describe, expect, it } from "vitest";
import { criarProjetoBase } from "../modelo/projetoBase";
import { CATALOGO, criarMovel } from "./catalogo";
import { ambienteTemLuzDeTeto, luzDeTeto, luzesDoMovel } from "./luzes";

describe("luzes dos móveis", () => {
  it("só os itens de iluminação emitem luz", () => {
    const comLuz = CATALOGO.filter((i) => i.luz).map((i) => i.id).sort();
    expect(comLuz).toEqual(["abajur", "fita-led", "fita-led-teto", "luminaria-piso", "pendente", "plafon"]);
    expect(luzesDoMovel(criarMovel("sofa-3", 0, 0))).toEqual([]);
  });

  it("fita de LED: emite pelo comprimento inteiro, para baixo, e acompanha o redimensionamento", () => {
    const fita = criarMovel("fita-led", 0, 0, { largura: 246, profundidade: 2.5 });
    const [luz] = luzesDoMovel(fita);
    expect(luz.tipo).toBe("fita");
    expect(luz.direcao).toBe("baixo");
    expect(luz.tamanho).toEqual([246, 3]); // largura mínima de 3 cm para a conta da luz
    expect(luzesDoMovel({ ...fita, largura: 100 })[0].tamanho[0]).toBe(100);
  });

  it("opções do móvel: brilho multiplica, direção troca e 'apagada' desliga", () => {
    const fita = criarMovel("fita-led", 0, 0);
    const base = luzesDoMovel(fita)[0].intensidade;
    expect(luzesDoMovel({ ...fita, opcoes: { brilho: 0.5 } })[0].intensidade).toBeCloseTo(base / 2, 6);
    expect(luzesDoMovel({ ...fita, opcoes: { direcao: "frente" } })[0].direcao).toBe("frente");
    expect(luzesDoMovel({ ...fita, opcoes: { apagada: true } })).toEqual([]);
    expect(luzesDoMovel({ ...fita, opcoes: { corLuz: "#eaf2ff" } })[0].cor).toBe("#eaf2ff");
  });

  it("plafon ilumina logo abaixo dele; luminária de piso, na cúpula", () => {
    const plafon = criarMovel("plafon", 0, 0);
    expect(plafon.elevacao + plafon.altura).toBe(260);
    expect(luzesDoMovel(plafon)[0].p[1]).toBeLessThan(0);
    const piso = criarMovel("luminaria-piso", 0, 0);
    const y = luzesDoMovel(piso)[0].p[1];
    expect(y).toBeGreaterThan(110);
    expect(y).toBeLessThan(piso.altura);
  });

  it("luz de teto: plafon, pendente e fita no teto contam; fita sob o armário e luminária de piso, não", () => {
    const pe = 260;
    expect(luzDeTeto(criarMovel("plafon", 0, 0), pe)).toBe(true);
    expect(luzDeTeto(criarMovel("pendente", 0, 0), pe)).toBe(true);
    expect(luzDeTeto(criarMovel("fita-led-teto", 0, 0), pe)).toBe(true);
    expect(luzDeTeto(criarMovel("fita-led", 0, 0), pe)).toBe(false);
    expect(luzDeTeto(criarMovel("luminaria-piso", 0, 0), pe)).toBe(false);
    expect(luzDeTeto(criarMovel("sofa-3", 0, 0), pe)).toBe(false);
  });

  it("no projeto do Alan a cozinha tem as fitas no teto; a sala fica com o plafon automático", () => {
    const projeto = criarProjetoBase();
    const amb = (id: string) => projeto.planta.ambientes.find((a) => a.id === id)!;
    expect(ambienteTemLuzDeTeto(projeto, amb("amb-cozinha"))).toBe(true);
    expect(ambienteTemLuzDeTeto(projeto, amb("amb-sala"))).toBe(false);
    expect(ambienteTemLuzDeTeto(projeto, amb("amb-banheiro"))).toBe(false);
  });
});
