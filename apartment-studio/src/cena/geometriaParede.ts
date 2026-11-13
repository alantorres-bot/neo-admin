/**
 * Geometria de uma parede, pura (sem three): os trechos cheios viram faces agrupadas pelo material de cada uma.
 * - cada face lateral é dividida nos trechos voltados para cada ambiente, com a pintura ou o revestimento dele;
 * - o topo é escuro (corte de maquete) e as pontas/ombreiras levam a cor da parede;
 * - rodapé nas faces voltadas para ambientes internos (menos banheiro, que é azulejado até o piso).
 * Medidas em cm, no referencial da parede: x ao longo dela a partir do vértice `a`, y para cima,
 * z atravessando a espessura (+z = face "direita").
 */
import {
  acabamentoDaFaixa,
  comprimentoParede,
  COR_PAREDE_PADRAO,
  extensoesParede,
  faixasDaFace,
  LADOS_PAREDE,
  recortarTrechos,
  trechosParede,
  type FaixaFace,
} from "../modelo/geometria";
import type { Parede, Planta, Revestimento } from "../modelo/tipos";

export interface GrupoParede {
  /** Material: "topo", "rodape" ou "revestimento|#cor". */
  chave: string;
  posicoes: number[];
  normais: number[];
  /** Em metros reais, para as texturas de revestimento. */
  uvs: number[];
}

export const CHAVE_TOPO = "topo";
export const CHAVE_RODAPE = "rodape";
export const chaveAcabamento = (revestimento: Revestimento, cor: string) => `${revestimento}|${cor}`;

export const ALTURA_RODAPE = 7; // cm
export const ESPESSURA_RODAPE = 1.2; // cm
const COR_GUARDA_CORPO = "#e9e6e0";

type Eixo = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

/** Uma face de uma caixa [x0,x1]×[y0,y1]×[z0,z1], com os triângulos voltados para fora. */
function face(g: GrupoParede, eixo: Eixo, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  let c: [number, number, number][];
  let n: [number, number, number];
  let uv: (p: [number, number, number]) => [number, number];
  switch (eixo) {
    case "+z":
      c = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      n = [0, 0, 1];
      uv = (p) => [p[0], p[1]];
      break;
    case "-z":
      c = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]];
      n = [0, 0, -1];
      uv = (p) => [p[0], p[1]];
      break;
    case "+y":
      c = [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
      n = [0, 1, 0];
      uv = (p) => [p[0], p[2]];
      break;
    case "-y":
      c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
      n = [0, -1, 0];
      uv = (p) => [p[0], p[2]];
      break;
    case "+x":
      c = [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]];
      n = [1, 0, 0];
      uv = (p) => [p[2], p[1]];
      break;
    default:
      c = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
      n = [-1, 0, 0];
      uv = (p) => [p[2], p[1]];
  }
  for (const i of [0, 1, 2, 0, 2, 3]) {
    g.posicoes.push(...c[i]);
    g.normais.push(...n);
    const [u, v] = uv(c[i]);
    g.uvs.push(u / 100, v / 100);
  }
}

export interface OpcoesParede {
  /** Altura em que a parede é cortada nas vistas de fora (paredes baixas / ocultas). */
  alturaMaxima?: number;
}

export function construirParede(planta: Planta, parede: Parede, opcoes: OpcoesParede = {}): GrupoParede[] {
  const L = comprimentoParede(planta, parede);
  const altura = parede.altura?.valor ?? planta.peDireito.valor;
  const h = parede.espessura.valor / 2;
  const guarda = parede.tipo === "guarda-corpo";
  const [e0, e1] = extensoesParede(planta, parede);
  const visivel = Math.min(altura, opcoes.alturaMaxima ?? Infinity);
  const aberturas = planta.aberturas.filter((ab) => ab.paredeId === parede.id);
  let trechos = trechosParede(L, altura, aberturas, e0, e1);
  if (visivel < altura) trechos = recortarTrechos(trechos, visivel);

  const grupos = new Map<string, GrupoParede>();
  const grupo = (chave: string) => {
    let g = grupos.get(chave);
    if (!g) grupos.set(chave, (g = { chave, posicoes: [], normais: [], uvs: [] }));
    return g;
  };
  const base = grupo(chaveAcabamento("pintura", guarda ? COR_GUARDA_CORPO : (parede.cor ?? COR_PAREDE_PADRAO)));

  // trechos de cada face por ambiente; a primeira e a última faixa cobrem também o prolongamento dos cantos
  const faixas = Object.fromEntries(
    LADOS_PAREDE.map((lado) => {
      const fs: FaixaFace[] = faixasDaFace(planta, parede, lado).map((f) => ({ ...f }));
      fs[0].u0 = -Infinity;
      fs[fs.length - 1].u1 = Infinity;
      return [lado, fs];
    }),
  ) as Record<(typeof LADOS_PAREDE)[number], FaixaFace[]>;

  for (const t of trechos) {
    for (const lado of LADOS_PAREDE) {
      for (const f of faixas[lado]) {
        const ua = Math.max(t.u0, f.u0);
        const ub = Math.min(t.u1, f.u1);
        if (ub - ua < 0.01) continue;
        const ac = acabamentoDaFaixa(parede, lado, f.ambiente?.id);
        const g = guarda ? base : grupo(chaveAcabamento(ac.revestimento, ac.cor));
        face(g, lado === "direita" ? "+z" : "-z", ua, ub, t.v0, t.v1, -h, h);
      }
    }
    face(t.v1 >= visivel - 0.01 ? grupo(CHAVE_TOPO) : base, "+y", t.u0, t.u1, t.v0, t.v1, -h, h);
    if (t.v0 > 0.01) face(base, "-y", t.u0, t.u1, t.v0, t.v1, -h, h);
    face(base, "+x", t.u0, t.u1, t.v0, t.v1, -h, h);
    face(base, "-x", t.u0, t.u1, t.v0, t.v1, -h, h);
  }

  // rodapé: nas faces voltadas para ambientes internos, onde a parede chega ao piso
  if (!guarda && visivel >= ALTURA_RODAPE * 2) {
    for (const t of trechos) {
      if (t.v0 > 0.01) continue;
      for (const lado of LADOS_PAREDE) {
        const s = lado === "direita" ? 1 : -1;
        for (const f of faixas[lado]) {
          if (!f.ambiente || f.ambiente.externo || f.ambiente.tipo === "banheiro") continue;
          if (acabamentoDaFaixa(parede, lado, f.ambiente.id).revestimento !== "pintura") continue; // parede revestida vai até o piso
          const ua = Math.max(t.u0, f.u0);
          const ub = Math.min(t.u1, f.u1);
          if (ub - ua < 0.01) continue;
          const z0 = s > 0 ? h : -h - ESPESSURA_RODAPE;
          const z1 = s > 0 ? h + ESPESSURA_RODAPE : -h;
          const g = grupo(CHAVE_RODAPE);
          face(g, s > 0 ? "+z" : "-z", ua, ub, 0, ALTURA_RODAPE, z0, z1);
          face(g, "+y", ua, ub, 0, ALTURA_RODAPE, z0, z1);
          face(g, "+x", ua, ub, 0, ALTURA_RODAPE, z0, z1);
          face(g, "-x", ua, ub, 0, ALTURA_RODAPE, z0, z1);
        }
      }
    }
  }
  return [...grupos.values()].filter((g) => g.posicoes.length > 0);
}

/** Área (m²) das faces de um grupo voltadas para um eixo — usada nos testes. */
export function areaDoGrupo(g: GrupoParede, normal: [number, number, number]): number {
  let area = 0;
  for (let i = 0; i < g.posicoes.length; i += 9) {
    if (g.normais[i] !== normal[0] || g.normais[i + 1] !== normal[1] || g.normais[i + 2] !== normal[2]) continue;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = g.posicoes.slice(i, i + 9);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area / 10_000;
}
