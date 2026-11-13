/**
 * Quadros de referência: cada conjunto de marcenaria é medido a partir de uma parede do apartamento.
 * As faces das paredes saem da planta (eixo ± meia espessura) — nada é digitado à mão.
 */
import type { Movel, Planta, Projeto } from "../modelo/tipos";
import type { Caixa3, Quadro, Solido } from "./tipos";

const MM = 10; // cm → mm

/** Coordenada (cm) da face de uma parede reta, do lado +1 (direita/baixo) ou −1 (esquerda/cima). */
export function faceDaParede(planta: Planta, paredeId: string, lado: 1 | -1): number {
  const parede = planta.paredes.find((p) => p.id === paredeId);
  if (!parede) throw new Error(`Parede inexistente: ${paredeId}`);
  const a = planta.vertices.find((v) => v.id === parede.a)!;
  const b = planta.vertices.find((v) => v.id === parede.b)!;
  const vertical = Math.abs(a.x - b.x) < 0.01;
  return (vertical ? a.x : a.y) + (lado * parede.espessura.valor) / 2;
}

const arred = (v: number) => Math.round(v * 100) / 100 + 0; // "+ 0" tira o zero negativo

export function criarQuadros(planta: Planta): Record<"coz-a" | "coz-b" | "sui-a" | "sui-b", Quadro> {
  const xCozEsq = faceDaParede(planta, "p-coz-esq", 1);
  const xShaft = faceDaParede(planta, "p-shaft", 1);
  const shaft = planta.paredes.find((p) => p.id === "p-shaft")!;
  const yFimShaft = planta.vertices.find((v) => v.id === shaft.b)!.y;
  const yJanela = faceDaParede(planta, "p-serv-varanda", 1);
  const yFundoCoz = faceDaParede(planta, "p-fundo-jantar", -1);
  const xDivisoria = faceDaParede(planta, "p-coz-sala", -1);
  const xSuiDir = faceDaParede(planta, "p-q1-dir", -1);
  const xSuiEsq = faceDaParede(planta, "p-q2-q1", 1);
  const ySuiTopo = faceDaParede(planta, "p-topo-q1", 1);
  const ySuiFundo = faceDaParede(planta, "p-q1-fundo", -1);
  return {
    "coz-a": {
      id: "coz-a",
      nome: "Cozinha — parede A (bancada de 3,87 m)",
      origem: { x: xCozEsq, y: yFimShaft },
      eixoS: { x: 0, y: 1 },
      eixoD: { x: 1, y: 0 },
      comprimento: arred((yFundoCoz - yFimShaft) * MM),
      espelhado: true,
    },
    "coz-b": {
      id: "coz-b",
      nome: "Cozinha — parede B (janela / área de serviço)",
      origem: { x: xShaft, y: yJanela },
      eixoS: { x: 1, y: 0 },
      eixoD: { x: 0, y: 1 },
      comprimento: arred((xDivisoria - xShaft) * MM),
      espelhado: false,
    },
    "sui-a": {
      id: "sui-a",
      nome: "Suíte — parede A (cabeceira e guarda-roupa de espelho)",
      origem: { x: xSuiDir, y: ySuiTopo },
      eixoS: { x: 0, y: 1 },
      eixoD: { x: -1, y: 0 },
      comprimento: arred((ySuiFundo - ySuiTopo) * MM),
      espelhado: false,
    },
    "sui-b": {
      id: "sui-b",
      nome: "Suíte — parede B (guarda-roupa de portas cinza)",
      origem: { x: xSuiDir, y: ySuiFundo },
      eixoS: { x: -1, y: 0 },
      eixoD: { x: 0, y: -1 },
      comprimento: arred((xSuiDir - xSuiEsq) * MM),
      espelhado: false,
    },
  };
}

/** Retângulo da planta (cm) → faixa (s, d) do quadro, em mm. */
export function retanguloNoQuadro(q: Quadro, x0: number, x1: number, y0: number, y1: number): Pick<Caixa3, "s0" | "s1" | "d0" | "d1"> {
  const cantos = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => ({
    s: ((x - q.origem.x) * q.eixoS.x + (y - q.origem.y) * q.eixoS.y) * MM,
    d: ((x - q.origem.x) * q.eixoD.x + (y - q.origem.y) * q.eixoD.y) * MM,
  }));
  return {
    s0: arred(Math.min(...cantos.map((c) => c.s))),
    s1: arred(Math.max(...cantos.map((c) => c.s))),
    d0: arred(Math.min(...cantos.map((c) => c.d))),
    d1: arred(Math.max(...cantos.map((c) => c.d))),
  };
}

/** Envoltória de um móvel do modelo 3D no quadro (mm). */
export function caixaDoMovel(m: Movel, q: Quadro): Caixa3 {
  const deitado = Math.round(m.rotacao / 90) % 2 !== 0; // 90 ou 270: a largura corre no eixo y da planta
  const mx = (deitado ? m.profundidade : m.largura) / 2;
  const my = (deitado ? m.largura : m.profundidade) / 2;
  return { ...retanguloNoQuadro(q, m.x - mx, m.x + mx, m.y - my, m.y + my), z0: arred(m.elevacao * MM), z1: arred((m.elevacao + m.altura) * MM) };
}

export function movelDoProjeto(projeto: Projeto, id: string): Movel {
  const m = projeto.moveis.find((x) => x.id === id);
  if (!m) throw new Error(`Móvel inexistente no modelo 3D: ${id}`);
  return m;
}

/** Leva um sólido de um quadro para outro (os dois são alinhados aos eixos da planta). */
export function converter<T extends Caixa3>(sol: T, de: Quadro, para: Quadro): T {
  const px = (s: number, d: number) => de.origem.x + (s * de.eixoS.x + d * de.eixoD.x) / MM;
  const py = (s: number, d: number) => de.origem.y + (s * de.eixoS.y + d * de.eixoD.y) / MM;
  const xs = [px(sol.s0, sol.d0), px(sol.s1, sol.d1)];
  const ys = [py(sol.s0, sol.d0), py(sol.s1, sol.d1)];
  return { ...sol, ...retanguloNoQuadro(para, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)) };
}

export type SolidoDeContexto = Solido;
