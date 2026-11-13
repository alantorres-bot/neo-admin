/**
 * Estimativa de chapas: encaixa as peças da lista de corte em chapas inteiras (corte guilhotinado, como na
 * seccionadora), com refilo das bordas, espessura da serra e sentido do veio nos padrões madeirados.
 * É estimativa de referência: o plano de corte definitivo é do marceneiro, depois da medição.
 */
import { LOTES, PADROES, ehPecaDeCorte, type Marcenaria } from "./projeto";
import type { Padrao } from "./tipos";

/** Chapa de MDF mais comum no Brasil (há fabricantes com 1.830 ou 1.850 de largura). */
export const CHAPA = { comp: 2750, larg: 1840, refilo: 10, serra: 4 } as const;

/** Padrões com veio: a peça não pode ser girada na chapa. */
const COM_VEIO: Padrao[] = ["madeira", "carvalho"];

export interface PecaDeCorte {
  padrao: Padrao;
  esp: number;
  /** Medida no sentido do comprimento da chapa (o do veio) e a outra. Sem veio, a ordem não importa. */
  a: number;
  b: number;
  girar: boolean;
  modulo: string;
  lote: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Peças de corte, uma a uma (quantidades abertas), com a orientação do veio. */
export function pecasDeCorte(mc: Marcenaria, lotes?: string[]): PecaDeCorte[] {
  const saida: PecaDeCorte[] = [];
  for (const m of mc.modulos) {
    if (lotes && !lotes.includes(m.lote)) continue;
    const unicas = new Set<string>();
    for (const sol of m.solidos) {
      if (!ehPecaDeCorte(sol)) continue;
      const girar = !COM_VEIO.includes(sol.padrao!);
      const ext = { s: r1(sol.s1 - sol.s0), d: r1(sol.d1 - sol.d0), z: r1(sol.z1 - sol.z0) };
      const eixoEsp = (Object.keys(ext) as ("s" | "d" | "z")[]).sort((x, y) => ext[x] - ext[y])[0];
      const chapas = sol.chapas ?? 1;
      const base = { padrao: sol.padrao!, esp: r1(ext[eixoEsp] / chapas), girar, modulo: m.cod, lote: m.lote };
      if (sol.peca) {
        if (unicas.has(sol.peca.chave)) continue;
        unicas.add(sol.peca.chave);
        saida.push({ ...base, esp: Math.min(ext.s, ext.d, ext.z), a: sol.peca.comp, b: sol.peca.larg });
        continue;
      }
      // em pé (espessura em s ou d): veio na vertical; deitada (espessura em z): veio ao longo da largura do móvel
      const [a, b] = eixoEsp === "z" ? [ext.s, ext.d] : [ext.z, eixoEsp === "s" ? ext.d : ext.s];
      for (let i = 0; i < chapas; i++) saida.push({ ...base, a, b });
    }
  }
  return saida;
}

export interface Encaixe {
  chapa: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Livre {
  chapa: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ordem = (p: { a: number; b: number }) => number;
const ORDENS: Ordem[] = [(p) => p.a * p.b, (p) => Math.max(p.a, p.b) * 10000 + Math.min(p.a, p.b), (p) => p.a * 10000 + p.b, (p) => p.b * 10000 + p.a];

function encaixar(pecas: { a: number; b: number; girar: boolean }[], ordem: Ordem, dividirPeloMenor: boolean, chapa: typeof CHAPA): { chapas: number; encaixes: Encaixe[] } {
  // cada peça leva uma serra a mais em cada sentido; a área útil ganha uma serra (o último corte não gasta chapa)
  const W = chapa.comp - 2 * chapa.refilo + chapa.serra;
  const H = chapa.larg - 2 * chapa.refilo + chapa.serra;
  const livres: Livre[] = [];
  const encaixes: Encaixe[] = [];
  let chapas = 0;
  for (const p of [...pecas].sort((x, y) => ordem(y) - ordem(x))) {
    const formas: [number, number][] = [[p.a + chapa.serra, p.b + chapa.serra]];
    if (p.girar) formas.push([p.b + chapa.serra, p.a + chapa.serra]);
    const escolher = () => {
      let melhor: { i: number; w: number; h: number; sobra: number } | null = null;
      livres.forEach((l, i) => {
        for (const [w, h] of formas) {
          if (w > l.w || h > l.h) continue;
          const sobra = Math.min(l.w - w, l.h - h);
          if (!melhor || sobra < melhor.sobra) melhor = { i, w, h, sobra };
        }
      });
      return melhor as { i: number; w: number; h: number; sobra: number } | null;
    };
    let escolha = escolher();
    if (!escolha) {
      livres.push({ chapa: chapas, x: 0, y: 0, w: W, h: H });
      chapas++;
      escolha = escolher();
    }
    if (!escolha) throw new Error(`Peça de ${p.a} × ${p.b} não cabe na chapa de ${chapa.comp} × ${chapa.larg}`);
    const l = livres[escolha.i];
    const { w, h } = escolha;
    encaixes.push({ chapa: l.chapa, x: l.x, y: l.y, w: w - chapa.serra, h: h - chapa.serra });
    livres.splice(escolha.i, 1);
    const sobraW = l.w - w;
    const sobraH = l.h - h;
    // corte guilhotinado: a sobra vira dois retângulos
    const cortarNaVertical = dividirPeloMenor ? sobraW < sobraH : sobraW >= sobraH;
    const direita: Livre = cortarNaVertical ? { chapa: l.chapa, x: l.x + w, y: l.y, w: sobraW, h } : { chapa: l.chapa, x: l.x + w, y: l.y, w: sobraW, h: l.h };
    const abaixo: Livre = cortarNaVertical ? { chapa: l.chapa, x: l.x, y: l.y + h, w: l.w, h: sobraH } : { chapa: l.chapa, x: l.x, y: l.y + h, w, h: sobraH };
    for (const n of [direita, abaixo]) if (n.w >= 40 && n.h >= 40) livres.push(n);
  }
  return { chapas, encaixes };
}

/** Melhor resultado entre algumas ordens de corte (não é o ótimo matemático: um otimizador pode ganhar uma chapa). */
export function planoDeCorte(pecas: { a: number; b: number; girar: boolean }[], chapa: typeof CHAPA = CHAPA): { chapas: number; encaixes: Encaixe[] } {
  let melhor: { chapas: number; encaixes: Encaixe[] } | null = null;
  for (const ordem of ORDENS) {
    for (const menor of [true, false]) {
      const r = encaixar(pecas, ordem, menor, chapa);
      if (!melhor || r.chapas < melhor.chapas) melhor = r;
    }
  }
  return melhor ?? { chapas: 0, encaixes: [] };
}

export interface LinhaChapa {
  padrao: Padrao;
  esp: number;
  material: string;
  pecas: number;
  areaM2: number;
  /** Mínimo teórico: área das peças ÷ área útil da chapa, arredondado para cima. */
  minimo: number;
  /** Chapas pelo plano de corte. */
  chapas: number;
  /** Área das peças ÷ área das chapas compradas. */
  aproveitamento: number;
}

export function estimativaDeChapas(mc: Marcenaria, lotes?: string[]): LinhaChapa[] {
  const grupos = new Map<string, PecaDeCorte[]>();
  for (const p of pecasDeCorte(mc, lotes)) {
    const chave = `${p.padrao}|${p.esp}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }
  const util = ((CHAPA.comp - 2 * CHAPA.refilo) * (CHAPA.larg - 2 * CHAPA.refilo)) / 1e6;
  const inteira = (CHAPA.comp * CHAPA.larg) / 1e6;
  return [...grupos.values()]
    .map((pecas) => {
      const area = pecas.reduce((t, p) => t + (p.a * p.b) / 1e6, 0);
      const { chapas } = planoDeCorte(pecas);
      const { padrao, esp } = pecas[0];
      return { padrao, esp, material: `MDF ${String(esp).replace(".", ",")} mm · ${PADROES[padrao].nome}`, pecas: pecas.length, areaM2: Math.round(area * 100) / 100, minimo: Math.ceil(area / util), chapas, aproveitamento: Math.round((area / (chapas * inteira)) * 100) };
    })
    .sort((x, y) => x.padrao.localeCompare(y.padrao) || y.esp - x.esp);
}

/** Lotes de cada grupo (A cozinha, B guarda-roupa, C complementos). */
export const lotesDoGrupo = (letra: string): string[] => LOTES.filter((l) => l.cod.startsWith(letra)).map((l) => l.cod);
