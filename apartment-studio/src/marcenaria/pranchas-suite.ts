/** Pranchas da suíte: planta, elevações externas e internas e cortes do guarda-roupa e dos complementos. */
import { Desenho, clarear } from "./desenho";
import { PADROES, type Marcenaria } from "./projeto";
import { corteDoConjunto, paredesNoQuadro, vaoDaAbertura } from "./pranchas-cozinha";
import { converter, retanguloNoQuadro } from "./quadros";
import { ALTURAS, PUXADOR } from "./suite";
import type { Caixa3, Modulo, Solido } from "./tipos";
import { desenharElevacao, desenharPisoETeto, niveisDoVao } from "./vistas";

export { niveisDoVao };

const ESCALA = 15;
const mod = (mc: Marcenaria, cod: string): Modulo => mc.modulos.find((m) => m.cod === cod)!;

export function solidosSuiteA(mc: Marcenaria): Solido[] {
  const qa = mc.quadros["sui-a"];
  const qb = mc.quadros["sui-b"];
  // os puxadores do G4, vistos de lado, cairiam sobre a porta do G2: ficam de fora desta vista
  return [
    ...mc.modulos.filter((m) => m.conjunto === qa.id).flatMap((m) => m.solidos),
    ...mc.modulos.filter((m) => m.conjunto === qb.id).flatMap((m) => m.solidos.filter((s) => s.classe !== "puxador").map((s) => converter(s, qb, qa))),
  ];
}

export function elevacaoSuiteA(mc: Marcenaria, interno: boolean): string {
  const q = mc.quadros["sui-a"];
  const comp = q.comprimento;
  const pd = mc.peDireito;
  const d = new Desenho(-100 - 470, -600, comp + 100 + 420, pd + 430, ESCALA);
  d.ret(-100, 0, 0, pd, "par", { camada: 0 });
  d.ret(comp, 0, comp + 100, pd, "par", { camada: 0 });
  desenharPisoETeto(d, -100, comp + 100, pd);
  desenharElevacao(d, solidosSuiteA(mc), { interno, u: (s) => s, aberturas: true });
  const cama = mc.contexto[q.id].find((x) => x.nome.startsWith("Cama"))!;
  d.ret(cama.s0, cama.z0, cama.s1, cama.z1, "oc", { fill: "none", camada: 2 });
  d.txt((cama.s0 + cama.s1) / 2, cama.z1 - 110, "cama 1380 × 1880 (sugestão) — em projeção", { tam: 1.9, cor: "#4b5563", fundo: true });

  const pj = mod(mc, "PJ").caixa;
  const ap = mod(mc, "AP").caixa;
  const cb = mod(mc, "CB").caixa;
  const co = mod(mc, "CO").caixa;
  const g2 = mod(mc, "G2").caixa;
  const cr1 = mod(mc, "CR1").caixa;
  const cr2 = mod(mc, "CR2").caixa;
  d.cadeiaH([pj.s0, pj.s1, ap.s1, co.s1, g2.s1, comp], -190, { lado: -1, ref: 0 });
  d.cadeiaH([0, comp], -400, { lado: -1, marca: "P", ref: -190 });
  const nAP = 6;
  d.cadeiaH([...Array.from({ length: nAP + 1 }, (_, i) => ap.s0 + (i * (ap.s1 - ap.s0)) / nAP), g2.s0, (g2.s0 + g2.s1) / 2, g2.s1], pd + 200, { lado: 1, ref: pd });
  d.cadeiaV([0, cr1.z0, cr1.z1, cb.z1, pd], -100 - 190, { lado: -1, ref: -100, marca: [undefined, undefined, undefined, "E"] });
  d.cadeiaV([0, pd], -100 - 380, { lado: -1, marca: "E" });
  d.cadeiaV([0, 80, pd], comp + 100 + 190, { lado: 1, ref: comp + 100 });
  d.cadeiaH([cr1.s0, cr1.s1], cr1.z0 - 110, { lado: -1, ref: cr1.z0 });
  d.cadeiaH([cr2.s0, cr2.s1], cr2.z0 - 110, { lado: -1, ref: cr2.z0 });

  const rot = (cod: string, v: number, u?: number) => {
    const c = mod(mc, cod).caixa;
    d.txt(u ?? (c.s0 + c.s1) / 2, v, cod, { tam: 2.7, peso: 700, fundo: true });
  };
  rot("AP", (ap.z0 + ap.z1) / 2);
  rot("CB", 1100);
  rot("CR1", cr1.z1 + 90);
  rot("CR2", cr2.z1 + 90);
  rot("G2", 1750);
  d.chamada((pj.s0 + pj.s1) / 2, 1320, "PJ", 6, -6, { tam: 2.7, peso: 700 });
  d.chamada((co.s0 + co.s1) / 2, 1500, "CO", -8, -6, { tam: 2.7, peso: 700 });
  d.txt((g2.s1 + comp) / 2, 1750, "G4", { tam: 2.7, peso: 700, fundo: true });
  d.txt((g2.s1 + comp) / 2, 1640, "(lateral em carvalho)", { tam: 1.9, cor: "#374151", fundo: true });
  d.txt(comp / 2, pd + 60, "teto — pé-direito estimado", { tam: 1.9, cor: "#c2410c", fundo: true });
  d.txt(-50, pd / 2, "parede da janela", { tam: 1.9, cor: "#374151", rot: -90, fundo: true });
  d.txt(comp + 50, pd / 2, "parede do fundo", { tam: 1.9, cor: "#374151", rot: -90, fundo: true });
  if (interno) {
    const sG2 = g2.s0 + 150;
    const nv = niveisDoVao(mod(mc, "G2").solidos, (g2.s0 + g2.s1) / 2);
    d.cadeiaV(nv.pontos, sG2, { lado: 1, textos: nv.textos, marca: "T" });
    d.chamada((g2.s0 + g2.s1) / 2 + 150, ALTURAS.varaoBaixo, `varão — eixo a ${ALTURAS.varaoBaixo}`, 5, 6, { tam: 1.9 });
    d.chamada((g2.s0 + g2.s1) / 2 + 150, ALTURAS.varaoAlto, `varão — eixo a ${ALTURAS.varaoAlto}`, 5, 6, { tam: 1.9 });
    d.txt((g2.s0 + g2.s1) / 2 + 60, 2350, "maleiro", { tam: 2, cor: "#374151", fundo: true });
    const nvAP = niveisDoVao(mod(mc, "AP").solidos, ap.s0 + 300);
    d.cadeiaV(nvAP.pontos, ap.s0 + 150, { lado: 1, textos: nvAP.textos, marca: "T" });
    d.txt(ap.s0 + 1170, (ap.z0 + ap.z1) / 2 - 170, "3 caixas iguais de 780 · 2 prateleiras reguláveis cada", { tam: 1.9, cor: "#374151", fundo: true });
  } else {
    d.chamada((g2.s0 + g2.s1) / 2 + 43, PUXADOR.centro, `puxador ${PUXADOR.comprimento} · centro a ${PUXADOR.centro} do piso`, 9, 11, { tam: 1.9 });
    d.txt((g2.s0 + g2.s1) / 2, 2250, "espelho", { tam: 2, cor: "#374151", fundo: true });
  }
  return d.svg(interno ? "Elevação A da suíte — vista interna" : "Elevação A da suíte — vista externa");
}

export function elevacaoSuiteB(mc: Marcenaria, interno: boolean, escala = 20): string {
  const qa = mc.quadros["sui-a"];
  const q = mc.quadros["sui-b"];
  const comp = q.comprimento;
  const pd = mc.peDireito;
  const porta = vaoDaAbertura(mc, "pt-quarto1");
  const k = escala / ESCALA; // afastamentos pensados em 1:15
  const d = new Desenho(-100 - 250 * k, -600 * k, comp + 80 + 400 * k, pd + 430 * k, escala);
  d.ret(-100, 0, 0, pd, "par", { camada: 0 });
  d.ret(comp, porta.topo, comp + 80, pd, "par", { camada: 0 });
  d.ret(comp, 0, comp + 80, porta.topo, "oc", { fill: "#fafafa", camada: 0 });
  d.txt(comp + 40, porta.topo / 2, "porta do quarto (vão)", { tam: 1.9, cor: "#374151", rot: -90, fundo: true });
  desenharPisoETeto(d, -100, comp + 80, pd);
  const g4 = mod(mc, "G4");
  const g2 = converter(mod(mc, "G2").caixa, qa, q);
  const daA = mc.modulos.filter((m) => m.conjunto === qa.id).flatMap((m) => m.solidos.map((s) => converter(s, qa, q)));
  desenharElevacao(d, interno ? g4.solidos : [...g4.solidos, ...daA], { interno, u: (s) => s, aberturas: true, dMax: g4.caixa.d1 + 30 });
  const cz = mc.projeto.moveis.find((m) => m.id === "sui-gr-cinza")!;
  const mold = Number(cz.opcoes?.moldura ?? 0) * 10;
  const s0 = g2.s1; // início do G4 (fim do canto)
  const s1 = g4.caixa.s1;
  d.cadeiaH([0, s0, s0 + mold, (s0 + s1) / 2, s1 - mold, s1, comp], -190 * k, { lado: -1, ref: 0 });
  d.cadeiaH([0, comp], -400 * k, { lado: -1, marca: "P", ref: -190 * k });
  d.cadeiaV([0, 80, pd], comp + 80 + 190 * k, { lado: 1, ref: comp + 80, marca: [undefined, "E"] });
  d.txt(comp / 2, pd + 60 * k, "teto — pé-direito estimado", { tam: 1.9, cor: "#c2410c", fundo: true });
  d.txt((s1 + comp) / 2, 1300, "passagem", { tam: 2, cor: "#374151", fundo: true });
  d.txt(-50, pd / 2, "parede da cabeceira", { tam: 1.9, cor: "#374151", rot: -90, fundo: true });
  if (interno) {
    d.ret(0, 0, s0, pd, "oc", { fill: "none", camada: 2 });
    d.txt(s0 / 2, 2440, "canto (atrás do G2)", { tam: 2, cor: "#374151", fundo: true });
    d.txt(s0 / 2, 250, "caixas / pouco uso", { tam: 1.9, cor: "#374151", fundo: true });
    const sE = (s0 + mold + s1 - mold) / 2 + 250;
    const nvE = niveisDoVao(g4.solidos, sE);
    d.cadeiaV(nvE.pontos, s1 - mold - 110, { lado: -1, textos: nvE.textos, marca: "T" });
    const sD = s0 + mold + 250;
    const nvD = niveisDoVao(g4.solidos, sD);
    d.cadeiaV(nvD.pontos, s0 + mold + 120, { lado: 1, textos: nvD.textos, marca: "T" });
    d.chamada(s0 - 150, ALTURAS.varaoLongo, `varão contínuo — eixo a ${ALTURAS.varaoLongo}`, 4, 9, { tam: 1.9 });
    d.txt(sD + 30, 2250, "maleiro alto (malas)", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt(sD + 30, 1150, "cabideiro longo", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt(sD + 30, 330, "sapateira", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt(sE - 60, 2350, "maleiro", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt(sE - 60, 1320, "prateleiras", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt(sE - 60, 470, "4 gavetas", { tam: 1.9, cor: "#374151", fundo: true });
  } else {
    d.txt(s0 / 2, 1750, "G2", { tam: 2.7, peso: 700, fundo: true });
    d.txt(s0 / 2, 1640, "(em corte)", { tam: 1.9, cor: "#374151", fundo: true });
    d.txt((s0 + s1) / 2, 1750, "G4", { tam: 2.7, peso: 700, fundo: true });
    d.chamada((s0 + s1) / 2 + 43, PUXADOR.centro, `puxador ${PUXADOR.comprimento} · centro a ${PUXADOR.centro}`, 8, 11, { tam: 1.9 });
    d.chamada(s0 + mold / 2, 2200, `moldura ${mold} em carvalho`, 8, -8, { tam: 1.9 });
  }
  d.txt(comp / 2, pd + 300 * k, interno ? "Elevação B — vista interna (G4 + canto, sem as portas)" : "Elevação B — vista externa", { tam: 2.6, peso: 700 });
  return d.svg(interno ? "Elevação B da suíte — vista interna" : "Elevação B da suíte — vista externa");
}

/** Posições dos cortes da suíte. */
export const CORTES_SUITE = [
  { n: 1, quadro: "sui-a" as const, s: 250, legenda: "AP · CB · CR1" },
  { n: 2, quadro: "sui-a" as const, s: 2900, legenda: "G2 — cabideiro duplo" },
  { n: 3, quadro: "sui-b" as const, s: 300, legenda: "canto (atrás do G2)" },
  { n: 4, quadro: "sui-b" as const, s: 860, legenda: "G4 — sapateira e cabideiro longo" },
  { n: 5, quadro: "sui-b" as const, s: 1350, legenda: "G4 — gavetas e prateleiras" },
];

export function cortesSuite(mc: Marcenaria): string {
  return CORTES_SUITE.map((c, i) => {
    const q = mc.quadros[c.quadro];
    const modulos = mc.modulos.filter((m) => m.conjunto === q.id);
    const solidos = modulos.flatMap((m) => m.solidos);
    return corteDoConjunto(mc, solidos, modulos, { s: c.s, titulo: `Corte ${c.n}`, legenda: c.legenda, cotaTotal: i === 0, alcance: c.n === 1 ? 250 : 60, profMax: 600, niveis: c.n !== 1 });
  }).join("");
}

const corDoModulo = (m: Modulo): string => {
  const frente = m.solidos.find((x) => x.classe === "porta" || x.classe === "painel" || x.classe === "frente-gaveta");
  return frente?.padrao ? clarear(PADROES[frente.padrao].cor, 0.35) : "#ffffff";
};

/** Planta da suíte, com a parede da cabeceira em cima (mesma orientação da elevação A). */
export function plantaSuite(mc: Marcenaria): string {
  const qa = mc.quadros["sui-a"];
  const qb = mc.quadros["sui-b"];
  const comp = qa.comprimento;
  const largura = qb.comprimento;
  const esc = 20;
  const v = (dd: number) => -dd;
  const paredes = paredesNoQuadro(mc, qa, { x0: 650, x1: 925, y0: -5, y1: 415 });
  const d = new Desenho(-100 - 24 * esc, v(largura + 80) - 14 * esc, comp + 100 + 24 * esc, 100 + 24 * esc, esc);
  for (const p of paredes) d.ret(p.s0, v(p.d0), p.s1, v(p.d1), "par", { camada: 0 });
  const jan = vaoDaAbertura(mc, "j-quarto1");
  const rj = retanguloNoQuadro(qa, jan.x0, jan.x1, jan.y0, jan.y1);
  d.ret(rj.s0, v(rj.d0), rj.s1, v(rj.d1), "pc", { fill: "#eef6fb", camada: 1 });
  d.txt((rj.s0 + rj.s1) / 2, v((rj.d0 + rj.d1) / 2), "janela (posição estimada)", { tam: 1.9, cor: "#c2410c", rot: -90, fundo: true, dx: 5 });
  const pt = vaoDaAbertura(mc, "pt-quarto1");
  const rp = retanguloNoQuadro(qa, pt.x0, pt.x1, pt.y0, pt.y1);
  d.ret(rp.s0, v(rp.d0), rp.s1, v(rp.d1), "pc", { fill: "#ffffff", camada: 1 });
  // folha da porta do quarto aberta a 90° e o arco de abertura (dobradiça do lado da parede do fundo)
  const folha = rp.s1 - rp.s0;
  d.lin(rp.s1, v(rp.d0), rp.s1, v(rp.d0 - folha), "pg", 2);
  d.arco(rp.s1, v(rp.d0), folha, 180, 90, "ab", 2);
  d.txt(rp.s0 + 180, v(rp.d0 - 330), "porta do quarto", { tam: 1.9, cor: "#374151", fundo: true });

  const noA = (m: Modulo): Caixa3 => (m.conjunto === qa.id ? m.caixa : converter(m.caixa, qb, qa));
  const cama = mc.contexto[qa.id].find((x) => x.nome.startsWith("Cama"))!;
  d.ret(cama.s0, v(cama.d0), cama.s1, v(cama.d1), "oc", { fill: "#fafafa" });
  d.txt((cama.s0 + cama.s1) / 2, v((cama.d0 + cama.d1) / 2), "cama 1380 × 1880 (sugestão)", { tam: 2, cor: "#4b5563" });
  const ordem = ["CB", "PJ", "CO", "G2", "G4", "CR1", "CR2"];
  for (const cod of ordem) {
    const m = mod(mc, cod);
    const c = noA(m);
    d.ret(c.s0, v(c.d0), c.s1, v(c.d1), "pc pf", { fill: corDoModulo(m) });
  }
  const ap = mod(mc, "AP").caixa;
  d.ret(ap.s0, v(ap.d0), ap.s1, v(ap.d1), "oc", { fill: "none", camada: 2 });
  d.txt((ap.s0 + ap.s1) / 2, v(ap.d1) + 60, "AP — armário-ponte (em projeção, de 1580 ao teto)", { tam: 1.9, cor: "#4b5563", fundo: true });
  // canto cego
  const g4 = noA(mod(mc, "G4"));
  const g2 = mod(mc, "G2").caixa;
  d.ret(g2.s1, v(0), comp, v(g2.d1), "vz", { camada: 1 });
  d.txt((g2.s1 + comp) / 2, v(g2.d1 / 2), "canto", { tam: 2, cor: "#374151", fundo: true });
  d.txt((g2.s0 + g2.s1) / 2, v(g2.d1 / 2), "G2", { tam: 2.6, peso: 700, fundo: true });
  d.txt((g2.s1 + comp) / 2, v((g2.d1 + g4.d1) / 2), "G4", { tam: 2.6, peso: 700, fundo: true });
  const co = mod(mc, "CO").caixa;
  d.chamada((co.s0 + co.s1) / 2, v(co.d1 - 60), "CO", -6, 9, { tam: 2.4, peso: 700 });
  const pj = mod(mc, "PJ").caixa;
  d.chamada(pj.s1, v(pj.d1 - 40), "PJ", 6, 8, { tam: 2.4, peso: 700 });
  for (const cod of ["CR1", "CR2"]) {
    const c = mod(mc, cod).caixa;
    d.txt((c.s0 + c.s1) / 2, v((c.d0 + c.d1) / 2), cod, { tam: 2, peso: 700 });
  }
  // abertura das portas do guarda-roupa
  const meioG2 = (g2.s0 + g2.s1) / 2;
  const raioG2 = meioG2 - g2.s0;
  d.arco(g2.s0, v(g2.d1), raioG2, 0, -90, "ab", 2);
  d.lin(g2.s0, v(g2.d1), g2.s0, v(g2.d1 + raioG2), "ab", 2);
  d.arco(g2.s1, v(g2.d1), raioG2, 180, 270, "ab", 2);
  d.lin(g2.s1, v(g2.d1), g2.s1, v(g2.d1 + raioG2), "ab", 2);
  const cz = mc.projeto.moveis.find((m) => m.id === "sui-gr-cinza")!;
  const mold = Number(cz.opcoes?.moldura ?? 0) * 10;
  const dA = g2.d1 + mold; // dobradiça da porta do lado do canto
  const dB = g4.d1 - mold;
  const raioG4 = (dB - dA) / 2;
  d.arco(g4.s0, v(dA), raioG4, 270, 180, "ab", 2);
  d.lin(g4.s0, v(dA), g4.s0 - raioG4, v(dA), "ab", 2);
  d.arco(g4.s0, v(dB), raioG4, 90, 180, "ab", 2);
  d.lin(g4.s0, v(dB), g4.s0 - raioG4, v(dB), "ab", 2);

  // cotas
  d.cadeiaH([pj.s0, pj.s1, ap.s1, co.s1, g2.s1, comp], 100 + 9 * esc, { lado: 1, ref: 100 });
  d.cadeiaH([0, comp], 100 + 18 * esc, { lado: 1, marca: "P", ref: 100 + 9 * esc });
  d.cadeiaV([v(0), v(g2.d1), v(g4.d1), v(largura)], comp + 100 + 9 * esc, { lado: 1, ref: comp + 100, textos: [`${largura - g4.d1} passagem`, undefined, undefined] });
  d.cadeiaV([v(0), v(largura)], comp + 100 + 18 * esc, { lado: 1, marca: "P" });
  d.cadeiaV([v(0), v(ap.d1), v(pj.d1)], -100 - 9 * esc, { lado: -1, ref: -100 });
  d.cadeiaV([v(cama.d1), v(largura)], cama.s0 + 300, { lado: 1, textos: [`${largura - cama.d1} no pé da cama`] });
  const folga = rp.d0 - folha - g4.d1;
  d.chamada(rp.s1, v(g4.d1 + folga / 2), `folga ≈ ${Math.round(folga)} entre a folha aberta e o G4 (estimada)`, -14, -12, { tam: 1.9, cor: "#c2410c" });
  d.txt(comp / 2, v(largura + 80) - 8 * esc, "quarto 2 / corredor", { tam: 1.9, cor: "#4b5563" });
  return d.svg("Planta da suíte");
}
