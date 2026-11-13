/** Funções puras de geometria do modelo (cm). Testadas em geometria.test.ts. */
import type { Abertura, AcabamentoParede, Ambiente, CotaPlanta, LadoParede, Parede, Planta, RefCota, Revestimento, Vertice } from "./tipos";

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
 * u vai de 0 (vértice a) a L (vértice b); as pontas são estendidas em `extensao` (início) e
 * `extensaoFim` para fechar os cantos entre paredes (ver extensoesParede).
 */
export function trechosParede(
  L: number,
  altura: number,
  aberturas: Pick<Abertura, "posicao" | "largura" | "altura" | "peitoril">[],
  extensao = 0,
  extensaoFim = extensao,
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
  if (L + extensaoFim > cursor) trechos.push({ u0: cursor, u1: L + extensaoFim, v0: 0, v1: altura });
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

/** Coordenada (no eixo) de uma referência de cota: face de parede ortogonal ao eixo, ou vértice. */
export function coordenadaRef(planta: Planta, ref: RefCota, eixo: "x" | "y"): number {
  const m = mapaVertices(planta);
  if ("vertice" in ref) {
    const v = m.get(ref.vertice);
    if (!v) throw new Error(`Vértice ${ref.vertice} inexistente`);
    return v[eixo];
  }
  const parede = planta.paredes.find((p) => p.id === ref.parede);
  if (!parede) throw new Error(`Parede ${ref.parede} inexistente`);
  const [a, b] = extremos(planta, parede);
  if (Math.abs(a[eixo] - b[eixo]) > 0.5) throw new Error(`Parede ${parede.id} não é ortogonal ao eixo ${eixo}`);
  const centro = (a[eixo] + b[eixo]) / 2;
  const meia = parede.espessura.valor / 2;
  return ref.face === "+" ? centro + meia : centro - meia;
}

/** Valor da cota medido no modelo atual (cm). */
export function medirCota(planta: Planta, cota: CotaPlanta): number {
  return Math.abs(coordenadaRef(planta, cota.b, cota.eixo) - coordenadaRef(planta, cota.a, cota.eixo));
}

export interface ConferenciaCota {
  cota: CotaPlanta;
  modelo: number;
  diferenca: number; // modelo − planta, cm
  confere: boolean;
}

export function conferirCotas(planta: Planta, tolerancia = 1): ConferenciaCota[] {
  return (planta.cotas ?? []).map((cota) => {
    let modelo = NaN;
    try {
      modelo = medirCota(planta, cota);
    } catch {
      /* referência quebrada após edição */
    }
    const diferenca = modelo - cota.valor;
    return { cota, modelo, diferenca, confere: Number.isFinite(modelo) && Math.abs(diferenca) <= tolerancia };
  });
}

/** Distância do ponto p ao segmento a–b e posição relativa t (0 = a, 1 = b). */
export function distanciaAoSegmento(p: Ponto, a: Ponto, b: Ponto): { d: number; t: number } {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (L2 === 0) return { d: comprimento(p, a), t: 0 };
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2;
  const tc = Math.max(0, Math.min(1, t));
  return { d: comprimento(p, { x: a.x + tc * (b.x - a.x), y: a.y + tc * (b.y - a.y) }), t };
}

function colineares(a1: Ponto, b1: Ponto, a2: Ponto, b2: Ponto): boolean {
  const L1 = comprimento(a1, b1);
  const L2 = comprimento(a2, b2);
  if (L1 === 0 || L2 === 0) return false;
  const cruz = ((b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x)) / (L1 * L2);
  return Math.abs(cruz) < 0.02;
}

/**
 * Quanto estender cada ponta da parede para fechar o encontro com as vizinhas (cm): [início, fim].
 * - ponta livre, ou que morre no meio de outra parede (T): 0 — ela já termina dentro da outra;
 * - canto em L (as duas terminam no mesmo ponto): meia espessura da outra, para preencher o quadrado do canto;
 * - ponta sobre uma linha contínua formada por duas paredes alinhadas: 0.
 */
export function extensoesParede(planta: Planta, parede: Parede): [number, number] {
  const [a, b] = extremos(planta, parede);
  const calc = (p: Ponto): number => {
    const tocam: { a: Ponto; b: Ponto; esp: number; noMeio: boolean }[] = [];
    for (const outra of planta.paredes) {
      if (outra.id === parede.id) continue;
      const [oa, ob] = extremos(planta, outra);
      const { d, t } = distanciaAoSegmento(p, oa, ob);
      if (d > 1) continue;
      const L = comprimento(oa, ob);
      const noMeio = t * L > 1 && (1 - t) * L > 1;
      tocam.push({ a: oa, b: ob, esp: outra.espessura.valor, noMeio });
    }
    if (tocam.length === 0 || tocam.some((o) => o.noMeio)) return 0;
    const transversais = tocam.filter((o) => !colineares(a, b, o.a, o.b));
    // duas transversais alinhadas entre si formam uma linha contínua: a ponta já está embutida
    for (let i = 0; i < transversais.length; i++) {
      for (let j = i + 1; j < transversais.length; j++) {
        if (colineares(transversais[i].a, transversais[i].b, transversais[j].a, transversais[j].b)) return 0;
      }
    }
    return transversais.reduce((m, o) => Math.max(m, o.esp / 2), 0);
  };
  return [calc(a), calc(b)];
}

/** Retângulo (4 cantos, cm) ocupado pela parede em planta, já com as extensões dos encontros. */
export function retanguloParede(planta: Planta, parede: Parede): Ponto[] {
  const [a, b] = extremos(planta, parede);
  const L = comprimento(a, b) || 1;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const [e0, e1] = extensoesParede(planta, parede);
  const h = parede.espessura.valor / 2;
  const p0 = { x: a.x - ux * e0, y: a.y - uy * e0 };
  const p1 = { x: b.x + ux * e1, y: b.y + uy * e1 };
  // normal (−uy, ux)
  return [
    { x: p0.x - uy * h, y: p0.y + ux * h },
    { x: p1.x - uy * h, y: p1.y + ux * h },
    { x: p1.x + uy * h, y: p1.y - ux * h },
    { x: p0.x + uy * h, y: p0.y - ux * h },
  ];
}

/** Ponto dentro de polígono (ray casting). */
export function pontoNoPoligono(p: Ponto, poligono: Ponto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i];
    const b = poligono[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Ambiente que contém o ponto (cm), se houver. */
export function ambienteDoPonto(planta: Planta, p: Ponto): Ambiente | undefined {
  return planta.ambientes.find((amb) => pontoNoPoligono(p, pontosAmbiente(planta, amb)));
}

// ------------------------------------------------------------------------------- lados da parede

/*
 * Cada parede tem duas faces (tipo LadoParede). Andando do vértice `a` para o `b` (na planta, com y para baixo),
 * "direita" é a face do lado direito de quem anda e "esquerda" a do outro lado.
 * Na cena, "direita" é a face +z do bloco da parede.
 */
export const LADOS_PAREDE: readonly LadoParede[] = ["direita", "esquerda"];

/** Ponto a `dist` cm da face da parede, do lado pedido, a `u` cm do vértice `a` ao longo dela. */
export function pontoAoLadoDaParede(planta: Planta, parede: Parede, u: number, lado: LadoParede, dist = 15): Ponto {
  const [a, b] = extremos(planta, parede);
  const L = comprimento(a, b) || 1;
  const dx = (b.x - a.x) / L;
  const dy = (b.y - a.y) / L;
  const s = (lado === "direita" ? 1 : -1) * (parede.espessura.valor / 2 + dist);
  return { x: a.x + dx * u - dy * s, y: a.y + dy * u + dx * s };
}

/** Ambiente encostado em cada face da parede (amostrado a `u` cm do vértice `a`; padrão: no meio). */
export function ambientesDaParede(planta: Planta, parede: Parede, u?: number): Partial<Record<LadoParede, Ambiente>> {
  const pos = u ?? comprimentoParede(planta, parede) / 2;
  const out: Partial<Record<LadoParede, Ambiente>> = {};
  for (const lado of LADOS_PAREDE) {
    const amb = ambienteDoPonto(planta, pontoAoLadoDaParede(planta, parede, pos, lado));
    if (amb) out[lado] = amb;
  }
  return out;
}

/**
 * Lado de dentro de uma janela ou porta que dá para fora: a face voltada para um ambiente interno,
 * quando do outro lado há a rua ou um ambiente externo (varanda). `null` em abertura entre dois ambientes internos.
 */
export function ladoInternoDaAbertura(planta: Planta, ab: Abertura): LadoParede | null {
  const parede = planta.paredes.find((p) => p.id === ab.paredeId);
  if (!parede) return null;
  const lados = ambientesDaParede(planta, parede, ab.posicao.valor);
  const interno = (l: LadoParede) => !!lados[l] && !lados[l]!.externo;
  if (interno("direita") && !interno("esquerda")) return "direita";
  if (interno("esquerda") && !interno("direita")) return "esquerda";
  return null;
}

/** Trecho de uma face voltado para um ambiente (ou para fora, sem ambiente). `u` em cm a partir do vértice `a`. */
export interface FaixaFace {
  u0: number;
  u1: number;
  ambiente?: Ambiente;
}

/**
 * Divide a face de uma parede nos trechos voltados para cada ambiente. Uma parede comprida pode dar para a
 * sala num pedaço e para a varanda em outro: cada pedaço pode ter a sua pintura.
 */
export function faixasDaFace(planta: Planta, parede: Parede, lado: LadoParede): FaixaFace[] {
  const L = comprimentoParede(planta, parede);
  const em = (u: number) => ambienteDoPonto(planta, pontoAoLadoDaParede(planta, parede, u, lado));
  const PASSO = 4;
  const faixas: FaixaFace[] = [];
  let inicio = 0;
  let atual = em(Math.min(L, 1));
  for (let u = PASSO; u <= L + PASSO; u += PASSO) {
    const fim = u >= L;
    const amb = fim ? atual : em(u);
    if (!fim && amb?.id === atual?.id) continue;
    let corte = L;
    if (!fim) {
      // afina a fronteira entre os dois ambientes por bisseção (até 1 mm)
      let a = u - PASSO;
      let b = u;
      while (b - a > 0.1) {
        const m = (a + b) / 2;
        if (em(m)?.id === atual?.id) a = m;
        else b = m;
      }
      corte = Math.round(((a + b) / 2) * 10) / 10;
    }
    if (corte - inicio > 0.5) faixas.push({ u0: inicio, u1: corte, ambiente: atual });
    else if (faixas.length > 0) faixas[faixas.length - 1].u1 = corte;
    if (fim) break;
    inicio = corte;
    atual = amb;
  }
  if (faixas.length === 0) faixas.push({ u0: 0, u1: L, ambiente: atual });
  faixas[faixas.length - 1].u1 = L;
  // Os ambientes são medidos pelo eixo das paredes: nos encontros sobra uma lasca de poucos centímetros
  // "voltada" para o ambiente vizinho, que na obra fica dentro da outra parede. Ela se junta à faixa ao lado.
  for (let i = 0; i < faixas.length && faixas.length > 1; ) {
    if (faixas[i].u1 - faixas[i].u0 >= LASCA_MAXIMA) {
      i++;
      continue;
    }
    const vizinha = i > 0 ? faixas[i - 1] : faixas[i + 1];
    vizinha.u0 = Math.min(vizinha.u0, faixas[i].u0);
    vizinha.u1 = Math.max(vizinha.u1, faixas[i].u1);
    faixas.splice(i, 1);
    i = Math.max(0, i - 1);
  }
  // vizinhas voltadas para o mesmo ambiente viram uma só
  for (let i = faixas.length - 1; i > 0; i--) {
    if (faixas[i].ambiente?.id !== faixas[i - 1].ambiente?.id) continue;
    faixas[i - 1].u1 = faixas[i].u1;
    faixas.splice(i, 1);
  }
  return faixas;
}

/** Trecho de face mais curto que isto (cm), num encontro de paredes, não conta como face de um ambiente. */
const LASCA_MAXIMA = 14;

export const COR_PAREDE_PADRAO = "#f3f0ea";

/** Cor e revestimento efetivos de um trecho de face (acabamento próprio → cor da parede → padrão). */
export function acabamentoDaFaixa(parede: Parede, lado: LadoParede, ambienteId?: string): { cor: string; revestimento: Revestimento } {
  const doLado = (parede.acabamentos ?? []).filter((a) => a.lado === lado);
  const proprio: AcabamentoParede | undefined = doLado.find((a) => a.ambiente !== undefined && a.ambiente === ambienteId) ?? doLado.find((a) => a.ambiente === undefined);
  return { cor: proprio?.cor ?? parede.cor ?? COR_PAREDE_PADRAO, revestimento: proprio?.revestimento ?? "pintura" };
}

/** Devolve a parede com o acabamento do trecho trocado (ou removido, com `acabamento` vazio). */
export function definirAcabamento(parede: Parede, lado: LadoParede, ambienteId: string | undefined, acabamento: { cor?: string; revestimento?: Revestimento } | null): Parede {
  const outros = (parede.acabamentos ?? []).filter((a) => !(a.lado === lado && a.ambiente === ambienteId));
  const limpo = acabamento && (acabamento.cor || (acabamento.revestimento && acabamento.revestimento !== "pintura")) ? acabamento : null;
  const acabamentos = limpo ? [...outros, { lado, ...(ambienteId ? { ambiente: ambienteId } : {}), ...limpo }] : outros;
  const { acabamentos: _antigos, ...resto } = parede;
  return acabamentos.length > 0 ? { ...resto, acabamentos } : resto;
}

/**
 * Pinta (ou reveste) todas as faces voltadas para um ambiente: "pintar a sala inteira".
 * Só o que vier em `acabamento` muda: trocar a cor mantém o azulejo de quem já tem; `null` volta tudo ao padrão.
 */
export function pintarAmbiente(planta: Planta, ambienteId: string, acabamento: { cor?: string; revestimento?: Revestimento } | null): Planta {
  return {
    ...planta,
    paredes: planta.paredes.map((parede) => {
      if (parede.tipo === "guarda-corpo") return parede;
      let nova = parede;
      for (const lado of LADOS_PAREDE) {
        if (!faixasDaFace(planta, parede, lado).some((f) => f.ambiente?.id === ambienteId)) continue;
        const atual = (nova.acabamentos ?? []).find((a) => a.lado === lado && a.ambiente === ambienteId);
        nova = definirAcabamento(nova, lado, ambienteId, acabamento && { cor: acabamento.cor ?? atual?.cor, revestimento: acabamento.revestimento ?? atual?.revestimento });
      }
      return nova;
    }),
  };
}

/** Cores das faces voltadas para um ambiente (sem repetição) — para mostrar "a sala está pintada de…". */
export function coresDoAmbiente(planta: Planta, ambienteId: string): string[] {
  const cores = new Set<string>();
  for (const parede of planta.paredes) {
    if (parede.tipo === "guarda-corpo") continue;
    for (const lado of LADOS_PAREDE) {
      if (faixasDaFace(planta, parede, lado).some((f) => f.ambiente?.id === ambienteId)) cores.add(acabamentoDaFaixa(parede, lado, ambienteId).cor.toLowerCase());
    }
  }
  return [...cores];
}

// ------------------------------------------------------------------------------- linha de visão

/**
 * Há parede entre os pontos `p` e `q` (cm)? Vale o eixo da parede; passar por dentro de um vão
 * (porta, janela ou passagem) não conta como parede. Usado para saber se um espelho está à vista.
 */
export function haParedeEntre(planta: Planta, p: Ponto, q: Ponto): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const parede of planta.paredes) {
    if (parede.tipo === "guarda-corpo") continue;
    const [a, b] = extremos(planta, parede);
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue; // paralelas
    // p + t·(q − p) = a + s·(b − a)
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const s = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
    if (t <= 0.001 || t >= 0.999 || s < 0 || s > 1) continue;
    const u = s * Math.hypot(ex, ey);
    const noVao = planta.aberturas.some((ab) => ab.paredeId === parede.id && Math.abs(u - ab.posicao.valor) <= ab.largura.valor / 2);
    if (!noVao) return true;
  }
  return false;
}
