/**
 * Peças-padrão do sistema construtivo de referência: caixa (gabinete), porta, gaveta, prateleira.
 * Sistema: laterais inteiras; base e tampo entre as laterais; fundo de 6 mm sobreposto atrás;
 * frentes de 18 mm sobrepostas, com 2 mm de batente e 3 mm de folga entre frentes.
 */
import type { Caixa3, Classe, Fita, Padrao, Solido } from "./tipos";

export const ESP = { caixa: 15, frente: 18, fundo: 6 } as const;
/** Folga entre frentes vizinhas. */
export const FOLGA = 3;
/** Espaço da frente: chapa de 18 + 2 de batente. */
export const VAO_FRENTE = ESP.frente + 2;
/** Altura aparente do puxador cava no topo de cada frente (igual ao 3D: 2,4 cm). */
export const CAVA = 24;
/** Recuo do rodapé em relação ao plano das frentes (igual ao 3D: 6 cm). */
export const RECUO_RODAPE = 60;
/** Espaço de cada corrediça telescópica (12,7 mm). */
export const FOLGA_CORREDICA = 13;
/** Largura das travessas de amarração. */
export const TRAVESSA = 100;

const FITA_PADRAO: Partial<Record<Classe, (c: Caixa3) => Fita>> = {
  porta: () => ({ s: 2, z: 2 }),
  "frente-gaveta": () => ({ s: 2, z: 2 }),
  "frente-fixa": () => ({ s: 2, z: 2 }),
  lateral: () => ({ z: 1 }),
  divisoria: () => ({ z: 1 }),
  base: () => ({ s: 1 }),
  tampo: () => ({ s: 1 }),
  prateleira: () => ({ s: 1 }),
  travessa: () => ({ s: 1 }),
  rodape: () => ({ s: 1 }),
};

export function solido(nome: string, classe: Classe, padrao: Padrao | undefined, c: Caixa3, extra: Partial<Solido> = {}): Solido {
  if (c.s1 <= c.s0 || c.d1 <= c.d0 || c.z1 <= c.z0) throw new Error(`Sólido sem volume: ${nome} ${JSON.stringify(c)}`);
  return { nome, classe, padrao, ...c, fita: extra.fita ?? FITA_PADRAO[classe]?.(c), ...extra };
}

export interface OpcoesCaixa {
  /** Envoltória do módulo (com a frente). */
  c: Caixa3;
  /** Reserva 20 mm na frente para portas/gavetas. */
  frente: boolean;
  padrao?: Padrao;
  /** Padrão das laterais aparentes. */
  latS0?: Padrao;
  latS1?: Padrao;
  espLateral?: number;
  base?: { padrao?: Padrao; esp?: number } | false;
  /** Tampo inteiro, duas travessas deitadas, duas travessas em pé (cuba/cooktop) ou só a de trás em pé. */
  tampo?: "painel" | "travessas" | "travessas-pe" | "tras-pe" | false;
  padraoTampo?: Padrao;
  espTampo?: number;
  fundo?: boolean;
  padraoFundo?: Padrao;
  obsFundo?: string;
}

/** Gabinete: devolve as peças e o vão interno (para prateleiras, gavetas e portas). */
export function caixa(o: OpcoesCaixa): { solidos: Solido[]; vao: Caixa3 } {
  const { c } = o;
  const p = o.padrao ?? "branco";
  const e = o.espLateral ?? ESP.caixa;
  const comFundo = o.fundo !== false;
  const d0 = c.d0 + (comFundo ? ESP.fundo : 0);
  const d1 = c.d1 - (o.frente ? VAO_FRENTE : 0);
  const solidos: Solido[] = [
    solido("Lateral", "lateral", o.latS0 ?? p, { s0: c.s0, s1: c.s0 + e, d0, d1, z0: c.z0, z1: c.z1 }),
    solido("Lateral", "lateral", o.latS1 ?? p, { s0: c.s1 - e, s1: c.s1, d0, d1, z0: c.z0, z1: c.z1 }),
  ];
  const s0 = c.s0 + e;
  const s1 = c.s1 - e;
  let z0 = c.z0;
  let z1 = c.z1;
  if (o.base !== false) {
    const eb = o.base?.esp ?? ESP.caixa;
    solidos.push(solido("Base", "base", o.base?.padrao ?? p, { s0, s1, d0, d1, z0: c.z0, z1: c.z0 + eb }));
    z0 = c.z0 + eb;
  }
  const tampo = o.tampo ?? "painel";
  const pt = o.padraoTampo ?? p;
  if (tampo === "painel") {
    const et = o.espTampo ?? ESP.caixa;
    solidos.push(solido("Tampo", "tampo", pt, { s0, s1, d0, d1, z0: c.z1 - et, z1: c.z1 }));
    z1 = c.z1 - et;
  } else if (tampo === "travessas") {
    solidos.push(
      solido("Travessa superior (frente)", "travessa", pt, { s0, s1, d0: d1 - TRAVESSA, d1, z0: c.z1 - ESP.caixa, z1: c.z1 }),
      solido("Travessa superior (fundo)", "travessa", pt, { s0, s1, d0, d1: d0 + TRAVESSA, z0: c.z1 - ESP.caixa, z1: c.z1 }),
    );
    z1 = c.z1 - ESP.caixa;
  } else if (tampo === "travessas-pe" || tampo === "tras-pe") {
    if (tampo === "travessas-pe") {
      solidos.push(solido("Travessa superior em pé (frente)", "travessa", pt, { s0, s1, d0: d1 - ESP.caixa, d1, z0: c.z1 - TRAVESSA, z1: c.z1 }, { fita: { s: 1 } }));
    }
    solidos.push(solido("Travessa superior em pé (fundo)", "travessa", pt, { s0, s1, d0, d1: d0 + ESP.caixa, z0: c.z1 - TRAVESSA, z1: c.z1 }, { fita: { s: 1 } }));
  }
  if (comFundo) {
    solidos.push(
      solido("Fundo", "fundo", o.padraoFundo ?? "branco", { s0: c.s0 + 2, s1: c.s1 - 2, d0: c.d0, d1: c.d0 + ESP.fundo, z0: c.z0 + 2, z1: c.z1 - 2 }, { obs: o.obsFundo }),
    );
  }
  return { solidos, vao: { s0, s1, d0, d1, z0, z1 } };
}

export interface OpcoesFrente {
  nome: string;
  classe?: "porta" | "frente-gaveta" | "frente-fixa";
  /** Zona da frente ao longo da parede (a chapa fica 1,5 mm para dentro de cada lado). */
  s0: number;
  s1: number;
  /** Altura real da frente (já com as folgas), incluindo o puxador cava quando houver. */
  z0: number;
  z1: number;
  /** Plano onde a frente termina (face externa). */
  d1: number;
  padrao: Padrao;
  dobr?: "s0" | "s1";
  cava?: boolean;
  obs?: string;
}

/** Porta ou frente de gaveta de 18 mm; com cava, a chapa termina 24 mm antes e o perfil ocupa o topo. */
export function frente(o: OpcoesFrente): Solido[] {
  const s0 = o.s0 + FOLGA / 2;
  const s1 = o.s1 - FOLGA / 2;
  const d0 = o.d1 - ESP.frente;
  const topo = o.cava ? o.z1 - CAVA : o.z1;
  const pecas = [solido(o.nome, o.classe ?? "porta", o.padrao, { s0, s1, d0, d1: o.d1, z0: o.z0, z1: topo }, { dobr: o.dobr, obs: o.obs })];
  if (o.cava) pecas.push(solido("Perfil puxador cava", "perfil", undefined, { s0, s1, d0, d1: d0 + 6, z0: topo, z1: o.z1 }, { cor: "#3a4233" }));
  return pecas;
}

export interface OpcoesGaveta {
  nome: string;
  /** Vão livre entre as laterais (ou calços) onde a gaveta corre. */
  s0: number;
  s1: number;
  /** Face da frente da caixa da gaveta (borda da frente do gabinete). */
  d1: number;
  /** Comprimento da corrediça = profundidade da caixa da gaveta. */
  comp: number;
  /** Base da caixa da gaveta (por baixo do fundo) e altura das laterais. */
  z0: number;
  h: number;
}

/** Caixa da gaveta: 2 laterais, contrafrente, traseira (15 mm) e fundo de 6 mm por baixo. */
export function gaveta(o: OpcoesGaveta): Solido[] {
  const s0 = o.s0 + FOLGA_CORREDICA;
  const s1 = o.s1 - FOLGA_CORREDICA;
  const d0 = o.d1 - o.comp;
  const zf = o.z0 + ESP.fundo;
  const z1 = zf + o.h;
  const e = ESP.caixa;
  const int = { soInterno: true };
  return [
    solido(`${o.nome}: lateral`, "gaveta", "branco", { s0, s1: s0 + e, d0, d1: o.d1, z0: zf, z1 }, { ...int, fita: { d: 1 } }),
    solido(`${o.nome}: lateral`, "gaveta", "branco", { s0: s1 - e, s1, d0, d1: o.d1, z0: zf, z1 }, { ...int, fita: { d: 1 } }),
    solido(`${o.nome}: contrafrente`, "gaveta", "branco", { s0: s0 + e, s1: s1 - e, d0: o.d1 - e, d1: o.d1, z0: zf, z1 }, { ...int, fita: { s: 1 } }),
    solido(`${o.nome}: traseira`, "gaveta", "branco", { s0: s0 + e, s1: s1 - e, d0, d1: d0 + e, z0: zf, z1 }, { ...int, fita: { s: 1 } }),
    solido(`${o.nome}: fundo`, "fundo", "branco", { s0, s1, d0, d1: o.d1, z0: o.z0, z1: zf }, int),
  ];
}

/** Prateleira entre laterais. Regulável: 1 mm de folga de cada lado e 20 mm de recuo na frente. */
export function prateleira(nome: string, vao: Caixa3, z0: number, o: { esp?: number; padrao?: Padrao; fixa?: boolean; recuo?: number; obs?: string } = {}): Solido {
  const esp = o.esp ?? ESP.caixa;
  const folga = o.fixa ? 0 : 1;
  const recuo = o.recuo ?? (o.fixa ? 14 : 20);
  return solido(nome, "prateleira", o.padrao ?? "branco", { s0: vao.s0 + folga, s1: vao.s1 - folga, d0: vao.d0, d1: vao.d1 - recuo, z0, z1: z0 + esp }, { obs: o.obs });
}

/** Quantidade de dobradiças pela altura da porta (regra usual dos fabricantes; confirmar com o da ferragem escolhida). */
export function dobradicasPorAltura(alturaMm: number): number {
  if (alturaMm <= 900) return 2;
  if (alturaMm <= 1600) return 3;
  if (alturaMm <= 2000) return 4;
  return 5;
}
