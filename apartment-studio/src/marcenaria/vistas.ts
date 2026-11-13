/**
 * Vistas geradas dos sólidos: elevação (frente), corte (lado) e balões das peças.
 * Pintor: desenha do mais distante para o mais próximo, com preenchimento — o que fica atrás some sozinho.
 */
import { Desenho, clarear } from "./desenho";
import { PADROES, ehPecaDeCorte } from "./projeto";
import type { Solido } from "./tipos";

export interface Pintura {
  cls: string;
  fill?: string;
}

const FRENTES = new Set(["porta", "frente-gaveta", "frente-fixa"]);

/** Como desenhar um sólido visto de frente; null = não aparece nesta vista. */
export function pinturaDeFrente(sol: Solido, interno: boolean): Pintura | null {
  if (interno) {
    if (sol.classe === "porta" || sol.classe === "frente-fixa" || sol.classe === "espelho" || sol.classe === "puxador") return null;
    if (sol.classe === "frente-gaveta" && !sol.soInterno) return null;
    if (sol.classe === "perfil" && !sol.nome.includes("LED") && !sol.nome.includes("friso")) return null;
    if (sol.classe === "aparelho") return { cls: "oc" };
  } else if (sol.soInterno) return null;
  if (sol.classe === "fundo") return { cls: "pc", fill: "#f4f4f1" };
  if (sol.classe === "contexto") return { cls: "fino", fill: sol.cor ?? "#f3f4f6" };
  if (sol.classe === "aparelho") return { cls: "pc", fill: clarear(sol.cor ?? "#cccccc", 0.2) };
  if (sol.classe === "pedra") return { cls: "pc", fill: sol.cor ?? "#eeeeee" };
  if (sol.classe === "espelho") return { cls: "pc", fill: "#dbe6ec" };
  if (sol.classe === "puxador" || sol.classe === "varao") return { cls: "pc", fill: sol.cor ?? "#b9bdc2" };
  if (sol.classe === "perfil") return { cls: "pc", fill: sol.cor ?? "#333333" };
  if (sol.padrao) {
    const cor = PADROES[sol.padrao].cor;
    if (sol.padrao === "branco") return { cls: "pc pf", fill: "#ffffff" };
    return { cls: "pc pf", fill: clarear(cor, interno && !FRENTES.has(sol.classe) ? 0.55 : 0.25) };
  }
  return { cls: "pc" };
}

export interface OpcoesElevacao {
  interno?: boolean;
  /** Posição no papel (mundo) de cada s: identidade, ou espelhada (comprimento − s). */
  u: (s: number) => number;
  /** Mostrar o símbolo de abertura das portas. */
  aberturas?: boolean;
  /** Só sólidos até esta profundidade (plano de corte da vista). */
  dMax?: number;
  rotulos?: boolean;
}

/** Elevação: projeta (s, z). */
export function desenharElevacao(d: Desenho, solidos: Solido[], o: OpcoesElevacao) {
  const visiveis = solidos.filter((s) => o.dMax === undefined || s.d0 < o.dMax).sort((a, b) => a.d1 - b.d1 || a.d0 - b.d0);
  for (const sol of visiveis) {
    const p = pinturaDeFrente(sol, !!o.interno);
    if (!p) continue;
    d.ret(o.u(sol.s0), sol.z0, o.u(sol.s1), sol.z1, p.cls, { fill: p.fill ?? "none" });
    // cubas ficam atrás das portas: na vista externa o nome delas só confunde
    if (sol.classe === "aparelho" && o.rotulos !== false && (o.interno || !/cuba/i.test(sol.nome))) {
      const larg = Math.abs(o.u(sol.s1) - o.u(sol.s0)) / d.escala;
      const alt = (sol.z1 - sol.z0) / d.escala;
      if (larg > 16 && alt > 4) d.txt((o.u(sol.s0) + o.u(sol.s1)) / 2, (sol.z0 + sol.z1) / 2, sol.nome, { tam: 2, cor: o.interno ? "#4b5563" : "#111", fundo: !!o.interno });
    }
  }
  if (o.aberturas && !o.interno) {
    for (const sol of visiveis) {
      if (sol.classe !== "porta" || !sol.dobr) continue;
      const uDob = o.u(sol.dobr === "s0" ? sol.s0 : sol.s1);
      const uOutro = o.u(sol.dobr === "s0" ? sol.s1 : sol.s0);
      const zm = (sol.z0 + sol.z1) / 2;
      d.poli(
        [
          [uOutro, sol.z0],
          [uDob, zm],
          [uOutro, sol.z1],
        ],
        "ab",
        { camada: 2 },
      );
    }
  }
}

export interface OpcoesCorte {
  /** Posição do plano de corte (s) e para que lado se olha (+1 = s crescente). */
  s: number;
  olhar: 1 | -1;
  /** Até onde enxergar além do plano (mm). */
  alcance?: number;
  /** Parede à esquerda (padrão) ou à direita. */
  u?: (dProf: number) => number;
}

/** Corte: projeta (d, z). Peças cortadas pelo plano aparecem hachuradas; as de trás, em vista. */
export function desenharCorte(d: Desenho, solidos: Solido[], o: OpcoesCorte) {
  const u = o.u ?? ((x: number) => x);
  const alcance = o.alcance ?? 900;
  const cortados = solidos.filter((sol) => sol.s0 < o.s && sol.s1 > o.s);
  const atras = solidos
    .filter((sol) => (o.olhar > 0 ? sol.s0 >= o.s && sol.s0 < o.s + alcance : sol.s1 <= o.s && sol.s1 > o.s - alcance))
    .sort((a, b) => (o.olhar > 0 ? b.s0 - a.s0 : a.s1 - b.s1));
  for (const sol of atras) {
    if (sol.classe === "contexto" || sol.classe === "puxador") continue;
    const p = pinturaDeFrente(sol, false);
    const fill = sol.classe === "aparelho" || sol.classe === "pedra" ? clarear(sol.cor ?? "#dddddd", 0.6) : sol.padrao && sol.padrao !== "branco" ? clarear(PADROES[sol.padrao].cor, 0.7) : "#ffffff";
    if (!p && !sol.soInterno) continue;
    d.ret(u(sol.d0), sol.z0, u(sol.d1), sol.z1, "pc fino-b", { fill });
  }
  for (const sol of cortados) {
    if (sol.classe === "contexto") continue;
    if (sol.classe === "aparelho") {
      d.ret(u(sol.d0), sol.z0, u(sol.d1), sol.z1, "oc", { fill: clarear(sol.cor ?? "#cccccc", 0.75), camada: 2 });
      const larg = Math.abs(u(sol.d1) - u(sol.d0)) / d.escala;
      if (larg > 14 && (sol.z1 - sol.z0) / d.escala > 5) d.txt((u(sol.d0) + u(sol.d1)) / 2, (sol.z0 + sol.z1) / 2, sol.nome, { tam: 1.9, cor: "#374151", fundo: true });
      continue;
    }
    if (sol.classe === "varao") {
      d.elipse((u(sol.d0) + u(sol.d1)) / 2, (sol.z0 + sol.z1) / 2, 15, 7.5, "pc pg", { fill: "#b9bdc2", camada: 2 });
      continue;
    }
    if (sol.classe === "pedra") {
      d.ret(u(sol.d0), sol.z0, u(sol.d1), sol.z1, "pc pg", { fill: "#9ca3af", camada: 2 });
      continue;
    }
    const fill = sol.classe === "espelho" ? "#7aa7bd" : sol.classe === "perfil" ? (sol.cor ?? "#333") : sol.padrao && sol.padrao !== "branco" ? clarear(PADROES[sol.padrao].cor, 0.1) : "#d9dde2";
    d.ret(u(sol.d0), sol.z0, u(sol.d1), sol.z1, "pc pg", { fill, camada: 2 });
  }
}

/** Fundo comum das elevações e cortes: piso, teto e a faixa de parede. */
export function desenharPisoETeto(d: Desenho, uEsq: number, uDir: number, peDireito: number) {
  d.lin(uEsq, 0, uDir, 0, "piso", 2);
  d.lin(uEsq, peDireito, uDir, peDireito, "teto", 2);
}

export interface Balao {
  x: number; // papel
  y: number;
}

/**
 * Balões das peças numa vista: cada número aparece uma vez, no centro da peça, se não esbarrar em outro.
 * Devolve os números que ficaram sem lugar (para tentar na outra vista).
 */
export function colocarBaloes(
  d: Desenho,
  pecas: { sol: Solido; n: number }[],
  projetar: (sol: Solido) => { u: number; v: number; w: number; h: number } | null,
  postos: Set<number>,
  ocupados: Balao[] = [],
): Balao[] {
  const livre = (x: number, y: number) => ocupados.every((b) => Math.hypot(b.x - x, b.y - y) > 4.1);
  for (const { sol, n } of pecas) {
    if (postos.has(n)) continue;
    const pr = projetar(sol);
    if (!pr) continue;
    const candidatos: [number, number][] = [[pr.u, pr.v]];
    // ao longo do lado maior da peça
    for (const f of [-0.3, 0.3, -0.42, 0.42]) candidatos.push(pr.w >= pr.h ? [pr.u + f * pr.w, pr.v] : [pr.u, pr.v + f * pr.h]);
    for (const [u, v] of candidatos) {
      const x = d.x(u);
      const y = d.y(v);
      if (!livre(x, y)) continue;
      d.balao(u, v, n);
      ocupados.push({ x, y });
      postos.add(n);
      break;
    }
  }
  return ocupados;
}

/** Faces das prateleiras/base/tampo que cruzam a posição s: alturas para a cadeia de cotas do vão. */
export function niveisDoVao(solidos: Solido[], s: number): { pontos: number[]; textos: (string | undefined)[] } {
  const horizontais = solidos.filter((x) => (x.classe === "base" || x.classe === "tampo" || x.classe === "prateleira") && x.s0 < s && x.s1 > s && !x.soInterno);
  const pontos = [...new Set(horizontais.flatMap((x) => [x.z0, x.z1]))].sort((a, b) => a - b);
  const textos = pontos.slice(1).map((z, i) => (z - pontos[i] < 25 ? "" : undefined));
  return { pontos, textos };
}


export { ehPecaDeCorte };
