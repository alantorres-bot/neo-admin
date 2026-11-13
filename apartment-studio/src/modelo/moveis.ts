/**
 * Regras dos móveis no espaço (funções puras, cm): área ocupada em planta, conflitos com paredes,
 * portas e outros móveis, e encaixe automático ao arrastar. Testado em moveis.test.ts.
 */
import {
  anguloParede,
  ambienteDoPonto,
  extremos,
  retanguloParede,
  type Ponto,
} from "./geometria";
import type { Abertura, Movel, Planta, Projeto } from "./tipos";

const RAD = Math.PI / 180;

/** Direção da frente do móvel em planta (unitário). */
export function frenteDoMovel(m: Pick<Movel, "rotacao">): Ponto {
  return { x: Math.sin(m.rotacao * RAD), y: Math.cos(m.rotacao * RAD) };
}

/** Converte um ponto do referencial do móvel (lx ao longo da largura, lz para a frente) para a planta. */
export function localParaPlanta(m: Pick<Movel, "x" | "y" | "rotacao">, lx: number, lz: number): Ponto {
  const c = Math.cos(m.rotacao * RAD);
  const s = Math.sin(m.rotacao * RAD);
  return { x: m.x + lx * c + lz * s, y: m.y - lx * s + lz * c };
}

/** Os 4 cantos do móvel em planta. */
export function cantosMovel(m: Pick<Movel, "x" | "y" | "rotacao" | "largura" | "profundidade">): Ponto[] {
  const hx = m.largura / 2;
  const hz = m.profundidade / 2;
  return [localParaPlanta(m, -hx, -hz), localParaPlanta(m, hx, -hz), localParaPlanta(m, hx, hz), localParaPlanta(m, -hx, hz)];
}

export interface Caixa2D {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function envolvente(pontos: Ponto[]): Caixa2D {
  return {
    x0: Math.min(...pontos.map((p) => p.x)),
    x1: Math.max(...pontos.map((p) => p.x)),
    y0: Math.min(...pontos.map((p) => p.y)),
    y1: Math.max(...pontos.map((p) => p.y)),
  };
}

/**
 * Quanto dois polígonos convexos se sobrepõem (cm de penetração no eixo de menor sobreposição).
 * 0 = não se tocam ou apenas encostam. Teorema do eixo separador.
 */
export function sobreposicao(a: Ponto[], b: Ponto[]): number {
  let menor = Infinity;
  for (const poligono of [a, b]) {
    for (let i = 0; i < poligono.length; i++) {
      const p = poligono[i];
      const q = poligono[(i + 1) % poligono.length];
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < 1e-9) continue;
      const nx = -(q.y - p.y) / L;
      const ny = (q.x - p.x) / L;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.y * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = v.x * nx + v.y * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o <= 0) return 0;
      menor = Math.min(menor, o);
    }
  }
  return Number.isFinite(menor) ? menor : 0;
}

/** Área varrida pela folha de uma porta de abrir (setor de 90°), como polígono convexo. */
export function setorPorta(planta: Planta, ab: Abertura): Ponto[] | null {
  if (ab.tipo !== "porta") return null;
  const parede = planta.paredes.find((p) => p.id === ab.paredeId);
  if (!parede) return null;
  const [a, b] = extremos(planta, parede);
  const ang = anguloParede(a, b);
  const u = { x: Math.cos(ang), y: Math.sin(ang) };
  const n = { x: -Math.sin(ang), y: Math.cos(ang) }; // mesmo eixo "z local" usado em cena/Aberturas.tsx
  const lado = ab.abrePara === "direita" ? -1 : 1;
  const naInicial = ab.dobradica !== "fim";
  const pos = ab.posicao.valor + (naInicial ? -1 : 1) * (ab.largura.valor / 2);
  const meia = parede.espessura.valor / 2;
  const h = { x: a.x + u.x * pos + n.x * lado * meia, y: a.y + u.y * pos + n.y * lado * meia };
  const raio = ab.largura.valor - 6;
  const d0 = { x: u.x * (naInicial ? 1 : -1), y: u.y * (naInicial ? 1 : -1) };
  const d1 = { x: n.x * lado, y: n.y * lado };
  const pts: Ponto[] = [h];
  for (let g = 0; g <= 90; g += 15) {
    const c = Math.cos(g * RAD);
    const s = Math.sin(g * RAD);
    pts.push({ x: h.x + raio * (d0.x * c + d1.x * s), y: h.y + raio * (d0.y * c + d1.y * s) });
  }
  return pts;
}

export interface Conflito {
  tipo: "parede" | "movel" | "porta";
  alvoId: string;
  mensagem: string;
  /** Penetração aproximada, cm. */
  profundidade: number;
}

const ALTURA_PORTA = 205;

function faixasSeCruzam(a0: number, a1: number, b0: number, b1: number, folga = 1): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > folga;
}

/**
 * Conflitos de um móvel: atravessa parede, invade a área de giro de uma porta ou se sobrepõe a outro móvel.
 * Móveis do mesmo `grupo` (conjunto planejado) podem se sobrepor. Só avisa — não impede.
 */
export function conflitosDoMovel(projeto: Projeto, movel: Movel, tolerancia = 1.5): Conflito[] {
  const conflitos: Conflito[] = [];
  const { planta } = projeto;
  const cantos = cantosMovel(movel);
  const base = movel.elevacao;
  const topo = movel.elevacao + movel.altura;

  for (const parede of planta.paredes) {
    const alturaParede = parede.altura?.valor ?? planta.peDireito.valor;
    if (base >= alturaParede) continue;
    const prof = sobreposicao(cantos, retanguloParede(planta, parede));
    if (prof > tolerancia) {
      conflitos.push({ tipo: "parede", alvoId: parede.id, mensagem: `Atravessa uma parede em ${prof.toFixed(0)} cm`, profundidade: prof });
    }
  }
  if (base < ALTURA_PORTA) {
    for (const ab of planta.aberturas) {
      const setor = setorPorta(planta, ab);
      if (!setor) continue;
      const prof = sobreposicao(cantos, setor);
      if (prof > tolerancia + 1) {
        conflitos.push({ tipo: "porta", alvoId: ab.id, mensagem: "Fica na área de abertura de uma porta", profundidade: prof });
      }
    }
  }
  for (const outro of projeto.moveis) {
    if (outro.id === movel.id) continue;
    if (movel.grupo && movel.grupo === outro.grupo) continue;
    if (!faixasSeCruzam(base, topo, outro.elevacao, outro.elevacao + outro.altura)) continue;
    const prof = sobreposicao(cantos, cantosMovel(outro));
    if (prof > tolerancia) {
      conflitos.push({ tipo: "movel", alvoId: outro.id, mensagem: `Sobrepõe "${outro.nome}" em ${prof.toFixed(0)} cm`, profundidade: prof });
    }
  }
  return conflitos;
}

/** Todos os conflitos do projeto, por id do móvel. */
export function conflitosDoProjeto(projeto: Projeto): Map<string, Conflito[]> {
  const mapa = new Map<string, Conflito[]>();
  for (const m of projeto.moveis) {
    const c = conflitosDoMovel(projeto, m);
    if (c.length) mapa.set(m.id, c);
  }
  return mapa;
}

/** Meias dimensões do móvel alinhado aos eixos (só para rotações múltiplas de 90°). */
function meiasDimensoes(m: Pick<Movel, "rotacao" | "largura" | "profundidade">): { hx: number; hy: number } | null {
  const r = ((m.rotacao % 360) + 360) % 360;
  const resto = r % 90;
  if (resto > 0.5 && resto < 89.5) return null;
  const deitado = Math.round(r / 90) % 2 === 1;
  return deitado ? { hx: m.profundidade / 2, hy: m.largura / 2 } : { hx: m.largura / 2, hy: m.profundidade / 2 };
}

/**
 * Posição ajustada ao arrastar: encosta nas faces das paredes e nas bordas de outros móveis quando
 * chega a menos de `tol` cm. Fora disso, arredonda para 1 cm.
 */
export function encaixar(projeto: Projeto, movel: Movel, x: number, y: number, tol = 6): Ponto {
  const meias = meiasDimensoes(movel);
  if (!meias) return { x: Math.round(x), y: Math.round(y) };
  const { hx, hy } = meias;
  const linhasX: { v: number; a: number; b: number }[] = [];
  const linhasY: { v: number; a: number; b: number }[] = [];
  const registrar = (c: Caixa2D) => {
    linhasX.push({ v: c.x0, a: c.y0, b: c.y1 }, { v: c.x1, a: c.y0, b: c.y1 });
    linhasY.push({ v: c.y0, a: c.x0, b: c.x1 }, { v: c.y1, a: c.x0, b: c.x1 });
  };
  for (const parede of projeto.planta.paredes) {
    const alturaParede = parede.altura?.valor ?? projeto.planta.peDireito.valor;
    if (movel.elevacao >= alturaParede) continue;
    registrar(envolvente(retanguloParede(projeto.planta, parede)));
  }
  for (const outro of projeto.moveis) {
    if (outro.id === movel.id) continue;
    if (!faixasSeCruzam(movel.elevacao, movel.elevacao + movel.altura, outro.elevacao, outro.elevacao + outro.altura)) continue;
    registrar(envolvente(cantosMovel(outro)));
  }
  const ajuste = (linhas: { v: number; a: number; b: number }[], centro: number, meia: number, faixa0: number, faixa1: number): number => {
    let melhor: number | null = null;
    for (const l of linhas) {
      if (!faixasSeCruzam(faixa0, faixa1, l.a, l.b)) continue;
      for (const borda of [centro - meia, centro + meia]) {
        const d = l.v - borda;
        if (Math.abs(d) <= tol && (melhor === null || Math.abs(d) < Math.abs(melhor))) melhor = d;
      }
    }
    return melhor ?? Math.round(centro) - centro;
  };
  const nx = x + ajuste(linhasX, x, hx, y - hy, y + hy);
  const ny = y + ajuste(linhasY, y, hy, nx - hx, nx + hx);
  return { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 };
}

/** Nome do ambiente em que o centro do móvel está. */
export function ambienteDoMovel(planta: Planta, m: Pick<Movel, "x" | "y">): string | undefined {
  return ambienteDoPonto(planta, m)?.id;
}

/** Distância livre à frente do móvel até a parede ou móvel mais próximo (cm), para avisos de circulação. */
export function folgaFrontal(projeto: Projeto, movel: Movel, alcance = 300): number {
  const f = frenteDoMovel(movel);
  const origem = localParaPlanta(movel, 0, movel.profundidade / 2);
  let menor = alcance;
  const testar = (poligono: Ponto[]) => {
    for (let i = 0; i < poligono.length; i++) {
      const a = poligono[i];
      const b = poligono[(i + 1) % poligono.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = f.x * ey - f.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - origem.x) * ey - (a.y - origem.y) * ex) / den;
      const s = ((a.x - origem.x) * f.y - (a.y - origem.y) * f.x) / den;
      if (t > 0.5 && s >= 0 && s <= 1) menor = Math.min(menor, t);
    }
  };
  for (const parede of projeto.planta.paredes) testar(retanguloParede(projeto.planta, parede));
  for (const outro of projeto.moveis) {
    if (outro.id === movel.id || outro.elevacao > 100) continue;
    if (movel.grupo && movel.grupo === outro.grupo) continue;
    testar(cantosMovel(outro));
  }
  return Math.round(menor);
}
