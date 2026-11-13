/** Funções puras de geometria do modelo (cm). Testadas em geometria.test.ts. */
import type { Abertura, Ambiente, Parede, Planta, Vertice } from "./tipos";

export interface Ponto {
  x: number;
  y: number;
}

export function mapaVertices(planta: Planta): Map<string, Vertice> {
  return new Map(planta.vertices.map((v) => [v.id, v]));
}

export function extremos(planta: Planta, parede: Parede): [Ponto, Ponto] {
  const m = mapaVertices(planta);
  const a = m.get(parede.a);
  const b = m.get(parede.b);
  if (!a || !b) throw new Error(`Parede ${parede.id} com vértice inexistente`);
  return [a, b];
}

export function comprimento(a: Ponto, b: Ponto): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function comprimentoParede(planta: Planta, parede: Parede): number {
  const [a, b] = extremos(planta, parede);
  return comprimento(a, b);
}

/** Ângulo da parede em radianos (no plano da planta, X→Y). */
export function anguloParede(a: Ponto, b: Ponto): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Área de polígono (shoelace), em cm². Sempre positiva. */
export function areaPoligono(pontos: Ponto[]): number {
  let s = 0;
  for (let i = 0; i < pontos.length; i++) {
    const p = pontos[i];
    const q = pontos[(i + 1) % pontos.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function pontosAmbiente(planta: Planta, ambiente: Ambiente): Ponto[] {
  const m = mapaVertices(planta);
  return ambiente.poligono.map((id) => {
    const v = m.get(id);
    if (!v) throw new Error(`Ambiente ${ambiente.nome} com vértice inexistente ${id}`);
    return v;
  });
}

/** Área do ambiente em m² (pelo eixo das paredes — a área útil é um pouco menor). */
export function areaAmbienteM2(planta: Planta, ambiente: Ambiente): number {
  return areaPoligono(pontosAmbiente(planta, ambiente)) / 10_000;
}

export function centroide(pontos: Ponto[]): Ponto {
  // centroide de área; cai para média simples em polígono degenerado
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pontos.length; i++) {
    const p = pontos[i];
    const q = pontos[(i + 1) % pontos.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pontos.length || 1;
    return {
      x: pontos.reduce((s, p) => s + p.x, 0) / n,
      y: pontos.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Trecho retangular de parede, em coordenadas locais (u ao longo da parede, v vertical), cm. */
export interface Trecho {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Divide a parede em trechos cheios, deixando os vãos das aberturas.
 * u vai de 0 (vértice a) a L (vértice b); as pontas são estendidas em `extensao`
 * (meia espessura) para fechar os cantos entre paredes.
 */
export function trechosParede(
  L: number,
  altura: number,
  aberturas: Pick<Abertura, "posicao" | "largura" | "altura" | "peitoril">[],
  extensao = 0,
): Trecho[] {
  const vaos = aberturas
    .map((ab) => {
      const u0 = Math.max(0, ab.posicao.valor - ab.largura.valor / 2);
      const u1 = Math.min(L, ab.posicao.valor + ab.largura.valor / 2);
      const v0 = Math.max(0, Math.min(altura, ab.peitoril.valor));
      const v1 = Math.max(v0, Math.min(altura, ab.peitoril.valor + ab.altura.valor));
      return { u0, u1, v0, v1 };
    })
    .filter((v) => v.u1 > v.u0)
    .sort((p, q) => p.u0 - q.u0);

  const trechos: Trecho[] = [];
  let cursor = 0 - extensao;
  for (const vao of vaos) {
    const ini = Math.max(vao.u0, cursor);
    if (ini > cursor) trechos.push({ u0: cursor, u1: ini, v0: 0, v1: altura });
    if (vao.u1 > ini) {
      if (vao.v0 > 0) trechos.push({ u0: ini, u1: vao.u1, v0: 0, v1: vao.v0 });
      if (vao.v1 < altura) trechos.push({ u0: ini, u1: vao.u1, v0: vao.v1, v1: altura });
    }
    cursor = Math.max(cursor, vao.u1);
  }
  if (L + extensao > cursor) trechos.push({ u0: cursor, u1: L + extensao, v0: 0, v1: altura });
  return trechos.filter((t) => t.u1 - t.u0 > 0.01 && t.v1 - t.v0 > 0.01);
}

/** Recorta trechos em uma altura máxima (modo "paredes recortadas"). */
export function recortarTrechos(trechos: Trecho[], alturaMax: number): Trecho[] {
  return trechos
    .filter((t) => t.v0 < alturaMax)
    .map((t) => ({ ...t, v1: Math.min(t.v1, alturaMax) }));
}

export interface ProblemaModelo {
  nivel: "erro" | "aviso";
  mensagem: string;
  ref?: string;
}

/** Confere coerência do modelo: aberturas dentro da parede, sem sobreposição, vértices válidos. */
export function validarPlanta(planta: Planta): ProblemaModelo[] {
  const problemas: ProblemaModelo[] = [];
  const m = mapaVertices(planta);
  const paredes = new Map(planta.paredes.map((p) => [p.id, p]));

  for (const p of planta.paredes) {
    if (!m.has(p.a) || !m.has(p.b)) {
      problemas.push({ nivel: "erro", mensagem: `Parede ${p.id} liga vértice inexistente`, ref: p.id });
    }
  }
  const porParede = new Map<string, Abertura[]>();
  for (const ab of planta.aberturas) {
    const parede = paredes.get(ab.paredeId);
    if (!parede) {
      problemas.push({ nivel: "erro", mensagem: `Abertura ${ab.id} sem parede`, ref: ab.id });
      continue;
    }
    const L = comprimentoParede(planta, parede);
    const ini = ab.posicao.valor - ab.largura.valor / 2;
    const fim = ab.posicao.valor + ab.largura.valor / 2;
    if (ini < -0.5 || fim > L + 0.5) {
      problemas.push({ nivel: "aviso", mensagem: `Abertura ${ab.id} ultrapassa a parede (${L.toFixed(0)} cm)`, ref: ab.id });
    }
    const alturaParede = parede.altura?.valor ?? planta.peDireito.valor;
    if (ab.peitoril.valor + ab.altura.valor > alturaParede + 0.5) {
      problemas.push({ nivel: "aviso", mensagem: `Abertura ${ab.id} mais alta que a parede`, ref: ab.id });
    }
    const lista = porParede.get(ab.paredeId) ?? [];
    lista.push(ab);
    porParede.set(ab.paredeId, lista);
  }
  for (const lista of porParede.values()) {
    const ord = [...lista].sort((p, q) => p.posicao.valor - q.posicao.valor);
    for (let i = 1; i < ord.length; i++) {
      const fimAnt = ord[i - 1].posicao.valor + ord[i - 1].largura.valor / 2;
      const iniAtual = ord[i].posicao.valor - ord[i].largura.valor / 2;
      if (iniAtual < fimAnt - 0.5) {
        problemas.push({ nivel: "aviso", mensagem: `Aberturas ${ord[i - 1].id} e ${ord[i].id} se sobrepõem`, ref: ord[i].id });
      }
    }
  }
  for (const amb of planta.ambientes) {
    if (amb.poligono.length < 3 || amb.poligono.some((id) => !m.has(id))) {
      problemas.push({ nivel: "erro", mensagem: `Ambiente ${amb.nome} com polígono inválido`, ref: amb.id });
    }
  }
  return problemas;
}

/** Limites da planta em cm. */
export function limites(planta: Planta) {
  const xs = planta.vertices.map((v) => v.x);
  const ys = planta.vertices.map((v) => v.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * Altera o comprimento de uma parede movendo o vértice "b" ao longo da própria direção.
 * Paredes ligadas a "b" acompanham (o modelo é por vértices).
 */
export function definirComprimento(planta: Planta, paredeId: string, novoCm: number): Planta {
  const parede = planta.paredes.find((p) => p.id === paredeId);
  if (!parede || novoCm <= 0) return planta;
  const [a, b] = extremos(planta, parede);
  const L = comprimento(a, b);
  if (L === 0) return planta;
  const nx = a.x + ((b.x - a.x) / L) * novoCm;
  const ny = a.y + ((b.y - a.y) / L) * novoCm;
  return {
    ...planta,
    vertices: planta.vertices.map((v) =>
      v.id === parede.b ? { ...v, x: round1(nx), y: round1(ny), origem: "manual" } : v,
    ),
  };
}

/** Calibração da imagem: cm por pixel a partir de uma cota conhecida. */
export function calibrarEscala(cotaCm: number, medidoPx: number): number {
  if (cotaCm <= 0 || medidoPx <= 0) throw new Error("Cota e medida precisam ser positivas");
  return cotaCm / medidoPx;
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Distância do ponto p, na direção (dx, dy) unitária, até a borda do polígono (cm). */
export function distanciaAteBorda(p: Ponto, dx: number, dy: number, poligono: Ponto[]): number {
  let melhor = Infinity;
  for (let i = 0; i < poligono.length; i++) {
    const a = poligono[i];
    const b = poligono[(i + 1) % poligono.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den; // ao longo do raio
    const s = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den; // ao longo da aresta
    if (t > 1e-6 && s >= 0 && s <= 1) melhor = Math.min(melhor, t);
  }
  return melhor;
}

/**
 * Ponto de vista para "entrar" num ambiente: encosta perto da parede oposta à maior
 * profundidade do cômodo e olha para ela — mostra o ambiente inteiro.
 */
export function pontoDeVista(poligono: Ponto[], recuo = 45): { x: number; y: number; dx: number; dy: number } {
  const c = centroide(poligono);
  let melhor = { dx: 1, dy: 0, frente: 0, tras: 0 };
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const frente = distanciaAteBorda(c, dx, dy, poligono);
    const tras = distanciaAteBorda(c, -dx, -dy, poligono);
    if (Number.isFinite(frente) && Number.isFinite(tras) && frente + tras > melhor.frente + melhor.tras + 1e-6) {
      melhor = { dx, dy, frente, tras };
    }
  }
  const voltar = Math.max(0, melhor.tras - recuo);
  return { x: c.x - melhor.dx * voltar, y: c.y - melhor.dy * voltar, dx: melhor.dx, dy: melhor.dy };
}
