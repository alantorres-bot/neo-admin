/** Pranchas da cozinha: planta, elevações, cortes e área de serviço. */
import { Desenho, clarear } from "./desenho";
import { PADROES, type Marcenaria } from "./projeto";
import { converter, retanguloNoQuadro } from "./quadros";
import type { Caixa3, Modulo, Quadro, Solido } from "./tipos";
import { desenharCorte, desenharElevacao, desenharPisoETeto, niveisDoVao } from "./vistas";

export interface Prancha {
  cod: string;
  titulo: string;
  escala: string;
  html: string;
}

const ESCALA = 15;

/** Tudo o que aparece olhando a parede A (módulos, aparelhos, pedras e o que há no canto da janela). */
export function solidosCozinhaA(mc: Marcenaria): Solido[] {
  const qa = mc.quadros["coz-a"];
  const qb = mc.quadros["coz-b"];
  const daA = [...mc.modulos.filter((m) => m.conjunto === qa.id).flatMap((m) => m.solidos), ...mc.contexto[qa.id]];
  const daB = [...mc.modulos.filter((m) => m.conjunto === qb.id).flatMap((m) => m.solidos), ...mc.contexto[qb.id]].map((s) => converter(s, qb, qa));
  return [...daA, ...daB];
}

export function solidosCozinhaB(mc: Marcenaria): Solido[] {
  const qa = mc.quadros["coz-a"];
  const qb = mc.quadros["coz-b"];
  const daB = [...mc.modulos.filter((m) => m.conjunto === qb.id).flatMap((m) => m.solidos), ...mc.contexto[qb.id]];
  const daA = [...mc.modulos.filter((m) => m.conjunto === qa.id).flatMap((m) => m.solidos), ...mc.contexto[qa.id]].map((s) => converter(s, qa, qb));
  return [...daB, ...daA];
}

const mod = (mc: Marcenaria, cod: string): Modulo => mc.modulos.find((m) => m.cod === cod)!;

/** Janela da área de serviço no quadro da parede A (vista de lado) e no da parede B (de frente). */
function janelaServico(mc: Marcenaria) {
  const pl = mc.projeto.planta;
  const j = pl.aberturas.find((a) => a.id === "j-servico")!;
  const parede = pl.paredes.find((p) => p.id === j.paredeId)!;
  const a = pl.vertices.find((v) => v.id === parede.a)!;
  const x0 = a.x + j.posicao.valor - j.largura.valor / 2;
  const x1 = x0 + j.largura.valor;
  const esp = parede.espessura.valor;
  const y0 = a.y - esp / 2;
  const y1 = a.y + esp / 2;
  return { x0, x1, y0, y1, peitoril: j.peitoril.valor * 10, topo: (j.peitoril.valor + j.altura.valor) * 10 };
}

export function elevacaoCozinhaA(mc: Marcenaria, interno: boolean): string {
  const q = mc.quadros["coz-a"];
  const comp = q.comprimento;
  const pd = mc.peDireito;
  const u = (s: number) => comp - s;
  const jan = janelaServico(mc);
  const paredeJanela = retanguloNoQuadro(q, 0, 400, jan.y0, jan.y1); // faixa s da parede da janela
  const sShaft0 = paredeJanela.s1; // face interna da parede da janela (início do shaft)
  const fundoEsp = 100;
  const d = new Desenho(-fundoEsp - 470, -600, u(paredeJanela.s0) + 470, pd + 500, ESCALA);

  // paredes em corte nas pontas, piso e teto
  d.ret(-fundoEsp, 0, 0, pd, "par", { camada: 0 });
  d.ret(u(sShaft0), 0, u(paredeJanela.s0), jan.peitoril, "par", { camada: 0 });
  d.ret(u(sShaft0), jan.topo, u(paredeJanela.s0), pd, "par", { camada: 0 });
  d.ret(u(sShaft0), jan.peitoril, u(paredeJanela.s0), jan.topo, "pc", { camada: 0, fill: "#eef6fb" });
  d.ret(u(0), 0, u(sShaft0), pd, "vz", { camada: 0 });
  d.txt((u(0) + u(sShaft0)) / 2, pd - 420, "shaft", { tam: 2.2, cor: "#4b5563" });
  d.txt((u(0) + u(sShaft0)) / 2, pd - 520, "(em vista)", { tam: 1.8, cor: "#4b5563" });
  desenharPisoETeto(d, -fundoEsp, u(paredeJanela.s0), pd);

  const mT1 = mod(mc, "T1");
  const dCorte = converter(mT1.caixa, mc.quadros["coz-b"], q).d1 + 10; // plano da vista: logo à frente do módulo do tanque
  desenharElevacao(d, solidosCozinhaA(mc), { interno, u, aberturas: true, dMax: dCorte });

  // ---- cotas
  const base = ["M1", "M2", "M3", "M4", "M5", "PG"].map((c) => mod(mc, c).caixa);
  const pontosBase = [base[0].s0, ...base.map((c) => c.s1), comp].map(u);
  d.cadeiaH(pontosBase, -190, { lado: -1, ref: 0 });
  d.cadeiaH([u(comp), u(0), u(sShaft0)], -400, { lado: -1, marca: ["P", "E"], ref: -190 });
  const as = mod(mc, "AS").caixa;
  const ag = mod(mc, "AG").caixa;
  const nAS = 4;
  const pontosSup = [...Array.from({ length: nAS + 1 }, (_, i) => as.s0 + (i * (as.s1 - as.s0)) / nAS), ag.s0, (ag.s0 + ag.s1) / 2, ag.s1].map(u);
  d.cadeiaH(pontosSup, pd + 200, { lado: 1, ref: pd });
  const am = mod(mc, "AM").caixa;
  const nm = mod(mc, "NM").caixa;
  const nAM = 5;
  d.cadeiaH([...Array.from({ length: nAM + 1 }, (_, i) => am.s0 + (i * (am.s1 - am.s0)) / nAM), nm.s1].map(u), am.z0 - 150, { lado: -1, ref: am.z0 });
  const fv = mod(mc, "FV").caixa;
  const uDir = u(paredeJanela.s0) + 210;
  d.cadeiaV([0, 100, 870, 900, am.z0, am.z1, fv.z1, pd], uDir, { lado: 1, ref: u(sShaft0), marca: [undefined, undefined, undefined, undefined, undefined, undefined, "E"] });
  d.cadeiaV([0, pd], uDir + 200, { lado: 1, marca: "E" });
  const gel = mc.contexto[q.id].find((s) => s.nome === "Geladeira")!;
  d.cadeiaV([0, gel.z1, ag.z0, pd], -fundoEsp - 190, { lado: -1, ref: -fundoEsp, marca: ["A", undefined, "E"] });

  // ---- rótulos dos módulos
  const rot = (cod: string, v: number) => {
    const c = mod(mc, cod).caixa;
    d.txt((u(c.s0) + u(c.s1)) / 2, v, cod, { tam: 2.7, peso: 700, fundo: true });
  };
  for (const c of ["M1", "M2", "M3", "M4", "M5"]) rot(c, 52);
  rot("AS", (as.z0 + as.z1) / 2);
  rot("AG", (ag.z0 + ag.z1) / 2);
  rot("FV", (fv.z0 + fv.z1) / 2);
  rot("AM", (am.z0 + am.z1) / 2 + (interno ? 0 : 0));
  rot("NM", nm.z1 - 60);
  const pg = mod(mc, "PG").caixa;
  d.chamada((u(pg.s0) + u(pg.s1)) / 2, 1250, "PG", -7, -6, { tam: 2.7, peso: 700 });
  const t1 = converter(mT1.caixa, mc.quadros["coz-b"], q);
  d.txt((u(t1.s0) + u(t1.s1)) / 2, 52, "T1", { tam: 2.7, peso: 700, fundo: true });
  d.txt((u(t1.s0) + u(t1.s1)) / 2, 480, "(lateral)", { tam: 1.9, cor: "#374151", fundo: true });
  d.txt(u(comp) + (u(pg.s1) - u(comp)) / 2, 2060 - 1960, "vão da geladeira", { tam: 1.9, cor: "#374151", fundo: true, dy: -3 });
  d.txt(u(paredeJanela.s0) + 30, (jan.peitoril + jan.topo) / 2, "janela", { tam: 1.9, cor: "#374151", rot: -90, ancora: "middle", dx: 3 });
  d.txt(-fundoEsp / 2, pd / 2, "parede do fundo", { tam: 1.9, cor: "#374151", rot: -90, fundo: true });
  d.txt(u(comp / 2), pd + 60, "teto — pé-direito estimado", { tam: 1.9, cor: "#c2410c", fundo: true });
  return d.svg(interno ? "Elevação A da cozinha — vista interna" : "Elevação A da cozinha — vista externa");
}


/** Corte transversal genérico de um conjunto: parede à esquerda, frente à direita. */
export function corteDoConjunto(
  mc: Marcenaria,
  solidos: Solido[],
  modulos: Modulo[],
  o: { s: number; olhar?: 1 | -1; titulo: string; legenda?: string; escala?: number; cotaTotal?: boolean; alcance?: number; profMax?: number; niveis?: boolean; extras?: (d: Desenho) => void },
): string {
  const pd = mc.peDireito;
  const esc = o.escala ?? ESCALA;
  const cortados = solidos.filter((x) => x.s0 < o.s && x.s1 > o.s && x.classe !== "contexto");
  const mods = modulos.filter((m) => m.caixa.s0 < o.s && m.caixa.s1 > o.s && m.cod !== "RA");
  const profMax = o.profMax ?? Math.max(...cortados.map((x) => x.d1), 300);
  const margemEsq = o.cotaTotal ? 100 + 13 * esc : 100 + 3 * esc;
  const d = new Desenho(-margemEsq, -29 * esc, profMax + 15 * esc, pd + 22 * esc, esc);
  d.ret(-100, 0, 0, pd, "par", { camada: 0 });
  desenharPisoETeto(d, -100, profMax + 5 * esc, pd);
  desenharCorte(d, solidos, { s: o.s, olhar: o.olhar ?? 1, alcance: o.alcance ?? 400 });
  const pedra = cortados.find((x) => x.classe === "pedra" && x.d1 - x.d0 > 100);
  const profs = [...new Set([...mods.map((m) => m.caixa.d1), ...(pedra ? [pedra.d1] : [])])].sort((a, b) => a - b);
  profs.forEach((p, i) => d.cadeiaH([0, p], -(8 + i * 5.2) * esc, { lado: -1, ref: 0 }));
  const zs = [...new Set([0, pd, ...mods.flatMap((m) => [m.caixa.z0, m.caixa.z1]), ...(pedra ? [pedra.z0, pedra.z1] : []), ...cortados.filter((x) => x.classe === "aparelho").flatMap((x) => [x.z0, x.z1])])]
    .filter((z) => z >= 0 && z <= pd)
    .sort((a, b) => a - b);
  const niveis = zs.filter((z, i) => i === 0 || z - zs[i - 1] >= 12);
  if (o.niveis) {
    // alturas livres entre base, prateleiras e tampo (interior proposto)
    const nv = niveisDoVao(solidos, o.s);
    const pontos = [...new Set([...nv.pontos, ...niveis.filter((z) => z === 0)])].sort((a, b) => a - b);
    d.cadeiaV(pontos, profMax + 7 * esc, { lado: 1, textos: pontos.slice(1).map((z, i) => (z - pontos[i] < 25 ? "" : undefined)), marca: "T" });
  } else d.cadeiaV(niveis, profMax + 7 * esc, { lado: 1 });
  if (o.cotaTotal) d.cadeiaV([0, pd], -100 - 6 * esc, { lado: -1, marca: "E" });
  const meio = (profMax - 100) / 2;
  d.txt(meio, pd + 15 * esc, o.titulo, { tam: 2.6, peso: 700 });
  d.txt(meio, pd + 8 * esc, o.legenda ?? mods.map((m) => m.cod).join(" · "), { tam: 2, cor: "#374151" });
  o.extras?.(d);
  return d.svg(o.titulo);
}

/** Posições dos cortes transversais da parede A (s, a partir do shaft). */
export const CORTES_A: { n: number; s: number; legenda: string }[] = [
  { n: 1, s: 400, legenda: "M1 · AM · FV · AS" },
  { n: 2, s: 1120, legenda: "M2 · cooktop · depurador" },
  { n: 3, s: 1725, legenda: "M3 · lava-louças" },
  { n: 4, s: 2380, legenda: "M4 · cuba" },
  { n: 5, s: 2900, legenda: "M5 · nicho do micro-ondas" },
  { n: 6, s: 3500, legenda: "torre da geladeira · AG" },
];

export function cortesCozinhaA(mc: Marcenaria): string {
  const q = mc.quadros["coz-a"];
  const solidos = solidosCozinhaA(mc).filter((x) => x.s1 > 0);
  const modulos = mc.modulos.filter((m) => m.conjunto === q.id);
  return CORTES_A.map((c, i) => corteDoConjunto(mc, solidos, modulos, { s: c.s, titulo: `Corte ${c.n}`, legenda: c.legenda, cotaTotal: i === 0, alcance: c.n === 4 ? 150 : 300, escala: 20 })).join("");
}

interface RetPlanta {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}

/** Paredes da planta dentro de uma janela (cm), no quadro. */
export function paredesNoQuadro(mc: Marcenaria, q: Quadro, limite: { x0: number; x1: number; y0: number; y1: number }): (RetPlanta & { id: string })[] {
  const pl = mc.projeto.planta;
  const saida: (RetPlanta & { id: string })[] = [];
  for (const p of pl.paredes) {
    if (p.tipo === "guarda-corpo") continue;
    const a = pl.vertices.find((v) => v.id === p.a)!;
    const b = pl.vertices.find((v) => v.id === p.b)!;
    const e = p.espessura.valor / 2;
    const vertical = Math.abs(a.x - b.x) < 0.01;
    const r = vertical ? { x0: a.x - e, x1: a.x + e, y0: Math.min(a.y, b.y) - 0, y1: Math.max(a.y, b.y) + 0 } : { x0: Math.min(a.x, b.x) - 0, x1: Math.max(a.x, b.x) + 0, y0: a.y - e, y1: a.y + e };
    const x0 = Math.max(r.x0, limite.x0);
    const x1 = Math.min(r.x1, limite.x1);
    const y0 = Math.max(r.y0, limite.y0);
    const y1 = Math.min(r.y1, limite.y1);
    if (x1 - x0 <= 0.01 || y1 - y0 <= 0.01) continue;
    saida.push({ id: p.id, ...retanguloNoQuadro(q, x0, x1, y0, y1) });
  }
  return saida;
}

/** Vão de uma abertura (porta/janela) na planta, em cm: retângulo que atravessa a parede. */
export function vaoDaAbertura(mc: Marcenaria, id: string): { x0: number; x1: number; y0: number; y1: number; peitoril: number; topo: number; vertical: boolean } {
  const pl = mc.projeto.planta;
  const ab = pl.aberturas.find((x) => x.id === id)!;
  const p = pl.paredes.find((x) => x.id === ab.paredeId)!;
  const a = pl.vertices.find((v) => v.id === p.a)!;
  const b = pl.vertices.find((v) => v.id === p.b)!;
  const e = p.espessura.valor / 2;
  const vertical = Math.abs(a.x - b.x) < 0.01;
  const sinal = vertical ? Math.sign(b.y - a.y) : Math.sign(b.x - a.x);
  const centro = (vertical ? a.y : a.x) + sinal * ab.posicao.valor;
  const m0 = centro - ab.largura.valor / 2;
  const m1 = centro + ab.largura.valor / 2;
  const base = vertical ? { x0: a.x - e, x1: a.x + e, y0: m0, y1: m1 } : { x0: m0, x1: m1, y0: a.y - e, y1: a.y + e };
  return { ...base, peitoril: ab.peitoril.valor * 10, topo: (ab.peitoril.valor + ab.altura.valor) * 10, vertical };
}

const corPadrao = (m: Modulo): string => {
  const frente = m.solidos.find((x) => x.classe === "porta" || x.classe === "frente-gaveta" || x.classe === "frente-fixa" || x.classe === "painel" || x.classe === "arremate");
  return frente?.padrao ? clarear(PADROES[frente.padrao].cor, 0.35) : "#ffffff";
};

/** Planta da cozinha, na mesma orientação da elevação A (geladeira à esquerda, janela à direita). */
export function plantaCozinha(mc: Marcenaria): string {
  const qa = mc.quadros["coz-a"];
  const qb = mc.quadros["coz-b"];
  const comp = qa.comprimento;
  const u = (s: number) => comp - s;
  const v = (dd: number) => -dd;
  const jan = vaoDaAbertura(mc, "j-servico");
  const paredes = paredesNoQuadro(mc, qa, { x0: -5, x1: 175, y0: 55, y1: 545 });
  const sMin = Math.min(...paredes.map((p) => p.s0));
  const sMax = Math.max(...paredes.map((p) => p.s1));
  const dMaxParede = Math.max(...paredes.map((p) => p.d1));
  const d = new Desenho(u(sMax) - 430, v(dMaxParede) - 330, u(sMin) + 520, 100 + 560, ESCALA);
  for (const p of paredes) d.ret(u(p.s0), v(p.d0), u(p.s1), v(p.d1), p.id === "p-shaft" ? "vz" : "par", { camada: 0 });
  const rj = retanguloNoQuadro(qa, jan.x0, jan.x1, jan.y0, jan.y1);
  d.ret(u(rj.s0), v(rj.d0), u(rj.s1), v(rj.d1), "pc", { fill: "#eef6fb", camada: 1 });
  d.lin(u((rj.s0 + rj.s1) / 2), v(rj.d0), u((rj.s0 + rj.s1) / 2), v(rj.d1), "pc", 1);

  const noA = (m: Modulo): Caixa3 => (m.conjunto === qa.id ? m.caixa : converter(m.caixa, qb, qa));
  const baixos = mc.modulos.filter((m) => (m.conjunto === qa.id || m.conjunto === qb.id) && m.caixa.z0 < 800 && m.cod !== "RA");
  const altos = mc.modulos.filter((m) => m.conjunto === qa.id && m.caixa.z0 >= 800);
  for (const m of baixos) {
    const c = noA(m);
    d.ret(u(c.s0), v(c.d0), u(c.s1), v(c.d1), "pc pf", { fill: corPadrao(m) });
  }
  // pedras, aparelhos e cubas
  const ctx = [...mc.contexto[qa.id], ...mc.contexto[qb.id].map((x) => converter(x, qb, qa))];
  for (const x of ctx.filter((y) => y.classe === "pedra" && y.d1 - y.d0 > 100)) d.ret(u(x.s0), v(x.d0), u(x.s1), v(x.d1), "pg", { fill: "none", camada: 2 });
  for (const x of ctx.filter((y) => y.classe === "aparelho")) {
    const alto = x.nome === "Micro-ondas" || x.nome === "Depurador";
    if (alto) continue;
    const solto = x.nome === "Geladeira" || x.nome === "Lava e seca";
    const embutido = x.nome === "Forno de embutir" || x.nome === "Lava-louças";
    if (embutido) continue;
    d.ret(u(x.s0), v(x.d0), u(x.s1), v(x.d1), solto ? "pc" : "pc", { fill: solto ? "#e5e7eb" : x.nome === "Cooktop" ? "#4b5563" : "#cbd5e1", camada: 2 });
    d.txt((u(x.s0) + u(x.s1)) / 2, (v(x.d0) + v(x.d1)) / 2, x.nome.replace(" (cuba)", "").replace(" (abertura frontal)", ""), { tam: 1.9, cor: x.nome === "Cooktop" ? "#fff" : "#111", fundo: x.nome !== "Cooktop" });
  }
  for (const m of altos) {
    const c = m.caixa;
    d.ret(u(c.s0), v(c.d0), u(c.s1), v(c.d1), "oc", { fill: "none", camada: 2 });
  }
  // rótulos dos módulos de baixo
  for (const m of baixos) {
    const c = noA(m);
    if (m.cod === "PG") continue;
    d.txt((u(c.s0) + u(c.s1)) / 2, v(c.d1) + (m.cod === "T1" ? 150 : 120), m.cod, { tam: 2.6, peso: 700, fundo: true });
  }
  const pg = mod(mc, "PG").caixa;
  d.chamada((u(pg.s0) + u(pg.s1)) / 2, v(700), "PG — painel 30", 6, 7, { tam: 2.1, peso: 700 });
  d.txt(u(comp / 2), v(1400), "tracejado = aéreos em projeção: AM 320 · FV/AS 360 · NM 400 · AG 720", { tam: 1.9, cor: "#4b5563", fundo: true });

  // marcas dos cortes
  for (const c of CORTES_A) {
    d.lin(u(c.s), v(-60), u(c.s), v(980), "eixo", 2);
    d.balao(u(c.s), v(1040), c.n);
  }
  d.txt(u(comp / 2), v(1150), "balões numerados = cortes da prancha C-04", { tam: 1.9, cor: "#4b5563", fundo: true });

  // cotas
  const base = ["M1", "M2", "M3", "M4", "M5", "PG"].map((c) => mod(mc, c).caixa);
  d.cadeiaH([base[0].s0, ...base.map((c) => c.s1), comp].map(u), 100 + 190, { lado: 1, ref: 100 });
  const sJanela = paredes.find((p) => p.id === "p-serv-varanda")!.s1;
  d.cadeiaH([u(comp), u(0), u(sJanela)], 100 + 400, { lado: 1, marca: ["P", "E"], ref: 100 + 190 });
  const larg = retanguloNoQuadro(qa, 160, 160, 0, 0).d0; // face da divisória (largura da cozinha)
  const bancada = ctx.find((x) => x.nome === "Bancada de quartzo")!;
  const uEsq = u(sMax) - 190;
  d.cadeiaV([v(0), v(bancada.d1), v(larg)], uEsq, { lado: -1, ref: u(sMax), textos: [`${larg - bancada.d1} livre`, undefined] });
  d.cadeiaV([v(0), v(larg)], uEsq - 190, { lado: -1, marca: "P" });
  const t1 = noA(mod(mc, "T1"));
  const uDir = u(sMin) + 190;
  d.cadeiaV([v(0), v(t1.d0), v(t1.d1), v(larg)], uDir, { lado: 1, ref: u(sMin), marca: ["A", undefined, "E"] });
  d.txt(uDir + 150, v((t1.d1 + larg) / 2), "vão da lava e seca", { tam: 1.8, cor: "#4b5563", rot: -90 });
  const pedraB = ctx.find((x) => x.nome === "Pedra sob a janela")!;
  d.cadeiaH([u(pedraB.s0), u(pedraB.s1)], v(larg) - 170, { lado: -1, ref: v(larg) });
  // textos de apoio
  d.txt(u(900), v(larg) - 150, "divisória da sala (termina aqui — posição estimada)", { tam: 1.9, cor: "#4b5563" });
  d.txt(u(2900), v(larg) - 60, "aberto para a sala de jantar", { tam: 1.9, cor: "#4b5563" });
  d.txt(u(-325), v(110), "shaft", { tam: 2, cor: "#374151", fundo: true });
  d.txt(u(comp / 2), v(1280), `corredor livre ${larg - bancada.d1}`, { tam: 2.2, cor: "#111", fundo: true });
  d.txt(u(rj.s0) + 120, v((rj.d0 + rj.d1) / 2), "janela", { tam: 1.8, cor: "#374151", rot: -90, fundo: true });
  return d.svg("Planta da cozinha");
}

/** Elevação da parede B (janela / área de serviço), com a marcenaria da parede A em perfil. */
export function elevacaoCozinhaB(mc: Marcenaria, interno: boolean): string {
  const qa = mc.quadros["coz-a"];
  const q = mc.quadros["coz-b"];
  const pd = mc.peDireito;
  const jan = vaoDaAbertura(mc, "j-servico");
  const rj = retanguloNoQuadro(q, jan.x0, jan.x1, jan.y0, jan.y1);
  const sParedeA = retanguloNoQuadro(q, 10, 10, 0, 0).s0;
  const esc = 12.5;
  const d = new Desenho(sParedeA - 100 - 26 * esc, -36 * esc, q.comprimento + 70 + 26 * esc, pd + 14 * esc, esc);
  d.ret(sParedeA - 100, 0, sParedeA, pd, "par", { camada: 0 });
  d.ret(q.comprimento, 0, q.comprimento + 70, pd, "par", { camada: 0 });
  d.ret(sParedeA, 0, 0, pd, "vz", { camada: 0 });
  d.txt(sParedeA / 2, 2150, "shaft", { tam: 2.1, cor: "#374151", rot: -90 });
  d.ret(rj.s0, jan.peitoril, rj.s1, jan.topo, "pc", { fill: "#eef6fb", camada: 0 });
  d.lin((rj.s0 + rj.s1) / 2, jan.peitoril, (rj.s0 + rj.s1) / 2, jan.topo, "pc", 0);
  d.txt((rj.s0 + rj.s1) / 2, (jan.peitoril + jan.topo) / 2 + 200, "janela (medidas estimadas)", { tam: 1.9, cor: "#c2410c", fundo: true });
  desenharPisoETeto(d, sParedeA - 100, q.comprimento + 70, pd);
  const daB = [...mc.modulos.filter((m) => m.conjunto === q.id).flatMap((m) => m.solidos), ...mc.contexto[q.id]];
  const daA = [...mc.modulos.filter((m) => m.conjunto === qa.id).flatMap((m) => m.solidos), ...mc.contexto[qa.id]].map((s) => converter(s, qa, q));
  const t1 = mod(mc, "T1").caixa;
  const dCorte = t1.d1 + 10;
  desenharElevacao(d, interno ? daB : [...daB, ...daA], { interno, u: (s) => s, aberturas: true, dMax: dCorte, rotulos: interno });
  if (!interno) {
    const les = daB.find((x) => x.nome === "Lava e seca")!;
    d.txt((les.s0 + les.s1) / 2, 430, "lava e seca", { tam: 2, cor: "#fff" });
  }
  const m1 = converter(mod(mc, "M1").caixa, qa, q);
  if (interno) {
    d.ret(m1.s0, 100, m1.s1, 870, "oc", { fill: "none", camada: 2 });
    d.txt((0 + m1.s1) / 2, 520, "canto cego", { tam: 2, cor: "#4b5563", fundo: true });
    d.txt((0 + m1.s1) / 2, 440, "(atrás do M1)", { tam: 1.8, cor: "#4b5563", fundo: true });
  } else {
    d.txt((sParedeA + m1.s1) / 2 + 60, 480, "M1 (em perfil)", { tam: 1.9, cor: "#111", fundo: true });
  }
  d.txt((m1.s1 + t1.s1) / 2, 52, "T1", { tam: 2.7, peso: 700, fundo: true });
  const sRegua = m1.s1 + 40;
  d.cadeiaH([sParedeA, 0, m1.s1, sRegua, t1.s1, q.comprimento], -15 * esc, { lado: -1, ref: 0, marca: ["E", undefined, "T", "T", "A"] });
  d.cadeiaH([sParedeA, q.comprimento], -29 * esc, { lado: -1, marca: "P", ref: -15 * esc });
  d.cadeiaV([0, 100, 870, 900, jan.peitoril, jan.topo, pd], q.comprimento + 70 + 13 * esc, { lado: 1, ref: q.comprimento + 70, marca: [undefined, undefined, undefined, "E", "E", "E"] });
  d.txt((sParedeA + q.comprimento) / 2, pd + 8 * esc, interno ? "Elevação B — vista interna" : "Elevação B — vista externa (com a parede A em perfil)", { tam: 2.6, peso: 700 });
  return d.svg("Elevação B da cozinha");
}

/** Detalhe em planta do canto do L (M1 × T1), com a abertura da porta do T1. */
export function detalheCantoCozinha(mc: Marcenaria): string {
  const qa = mc.quadros["coz-a"];
  const q = mc.quadros["coz-b"];
  const esc = 10;
  const t1 = mod(mc, "T1");
  const m1 = converter(mod(mc, "M1").caixa, qa, q);
  const sParedeA = retanguloNoQuadro(q, 10, 10, 0, 0).s0;
  const v = (dd: number) => -dd;
  const d = new Desenho(sParedeA - 100 - 20 * esc, v(1130) - 6 * esc, 760 + 22 * esc, 70 + 20 * esc, esc);
  d.ret(sParedeA - 100, v(-70), sParedeA, v(1130), "par", { camada: 0 });
  d.ret(sParedeA, v(-70), 760, v(0), "par", { camada: 0 });
  d.ret(sParedeA, v(0), 0, v(650), "vz", { camada: 0 });
  d.txt(sParedeA / 2, v(325), "shaft", { tam: 2.1, cor: "#374151", rot: -90 });
  // T1 em planta: caixa, parte cega, régua e porta
  const c = t1.caixa;
  d.ret(c.s0, v(c.d0), c.s1, v(c.d1 - 20), "pc pf", { fill: "#ffffff" });
  d.ret(c.s0, v(c.d0), m1.s1, v(c.d1 - 20), "vz", { camada: 1 });
  d.txt((c.s0 + m1.s1) / 2, v(330), "canto cego", { tam: 2, cor: "#374151", fundo: true });
  d.txt((c.s0 + m1.s1) / 2, v(400), "acesso pela porta", { tam: 1.8, cor: "#374151", fundo: true });
  const verde = clarear(PADROES.verde.cor, 0.25);
  const sRegua = m1.s1 + 40;
  d.ret(m1.s1 + 1.5, v(c.d1 - 18), sRegua - 1.5, v(c.d1), "pc pf", { fill: verde, camada: 2 });
  d.ret(sRegua + 1.5, v(c.d1 - 18), c.s1 - 1.5, v(c.d1), "pc pf", { fill: verde, camada: 2 });
  const raio = c.s1 - sRegua - 3;
  d.arco(c.s1 - 1.5, c.d1 * -1, raio, 180, 270, "ab", 2);
  d.lin(c.s1 - 1.5, v(c.d1), c.s1 - 1.5, v(c.d1 + raio), "ab", 2);
  // M1 em planta (trecho do canto) com as frentes
  d.ret(m1.s0, v(m1.d0), m1.s1 - 20, v(m1.d0 + 420), "pc pf", { fill: "#ffffff" });
  d.ret(m1.s1 - 18, v(m1.d0 + 1.5), m1.s1, v(m1.d0 + 420), "pc pf", { fill: verde, camada: 2 });
  d.txt((m1.s0 + m1.s1) / 2 - 20, v(m1.d0 + 220), "M1 — gavetas", { tam: 2.1, peso: 700, fundo: true });
  d.txt((m1.s0 + m1.s1) / 2 - 20, v(m1.d0 + 300), "abrem neste sentido →", { tam: 1.8, cor: "#374151", fundo: true });
  d.txt((sRegua + c.s1) / 2, v(c.d1 - 150), "T1", { tam: 2.6, peso: 700, fundo: true });
  d.ret(c.s1 + 15, v(30), 760, v(650), "pc", { fill: "#e5e7eb" });
  d.txt((c.s1 + 760) / 2 + 10, v(340), "lava e seca", { tam: 1.9, cor: "#111", fundo: true, rot: -90 });
  d.chamada((m1.s1 + sRegua) / 2, v(c.d1 - 9), "régua de canto fixa 40", -3, 9, { tam: 2 });
  d.chamada(sRegua + raio / 2, v(c.d1 - 9), `porta ${fmtN(raio)}`, -10, 20, { tam: 2 });
  d.txt(c.s1 - 30, v(c.d1 + raio + 60), "dobradiças do lado da máquina", { tam: 1.8, cor: "#374151", ancora: "end" });
  d.cadeiaH([sParedeA, 0, m1.s1, sRegua, c.s1], 70 + 8 * esc, { lado: 1, ref: 70, marca: ["E", undefined, "T", "T"] });
  d.cadeiaV([v(0), v(c.d0), v(c.d1)], sParedeA - 100 - 8 * esc, { lado: -1, ref: sParedeA - 100 });
  const tq = mc.contexto[q.id].find((x) => x.nome.startsWith("Tanque"))!;
  d.ret(tq.s0, v(tq.d0), tq.s1, v(tq.d1), "oc", { fill: "none", camada: 2 });
  d.txt((tq.s0 + tq.s1) / 2, v(tq.d0 + 60), "tanque (cuba 500 × 400)", { tam: 1.8, cor: "#374151", fundo: true });
  d.txt((sParedeA + 760) / 2, 70 + 16 * esc, "Detalhe do canto em planta", { tam: 2.6, peso: 700 });
  return d.svg("Detalhe do canto do L");
}

const fmtN = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));

/** Corte pela área de serviço (módulo do tanque). */
export function corteCozinhaB(mc: Marcenaria): string {
  const q = mc.quadros["coz-b"];
  const jan = vaoDaAbertura(mc, "j-servico");
  const solidos = [...mc.modulos.filter((m) => m.conjunto === q.id).flatMap((m) => m.solidos), ...mc.contexto[q.id]];
  return corteDoConjunto(mc, solidos, mc.modulos.filter((m) => m.conjunto === q.id), {
    s: 500,
    titulo: "Corte 7",
    legenda: "T1 · tanque · janela",
    escala: 12.5,
    cotaTotal: true,
    alcance: 30,
    extras: (d) => {
      d.ret(-100, jan.peitoril, 0, jan.topo, "oc", { fill: "#eef6fb", camada: 1 });
      d.txt(-50, (jan.peitoril + jan.topo) / 2, "janela (além do corte)", { tam: 1.8, cor: "#374151", rot: -90, fundo: true });
      d.chamada(0, jan.peitoril, `peitoril ${jan.peitoril} (estimado)`, 10, -7, { tam: 1.9, cor: "#c2410c" });
    },
  });
}

/** Detalhe-tipo do sistema construtivo: corte de um armário de baixo com as medidas-padrão. */
export function detalheTipo(mc: Marcenaria): string {
  const q = mc.quadros["coz-a"];
  const e = 10;
  const m5 = mod(mc, "M5");
  const sC = (m5.caixa.s0 + m5.caixa.s1) / 2;
  const solidos = solidosCozinhaA(mc).filter((x) => x.s1 > 0 && x.z0 < 905 && x.classe !== "aparelho" && !(x.classe === "pedra" && x.d1 - x.d0 < 100));
  void q;
  const d = new Desenho(-100 - 4 * e, -9 * e, 620 + 70 * e, 900 + 13 * e, e);
  d.ret(-100, 0, 0, 930, "par", { camada: 0 });
  d.lin(-100, 0, 760, 0, "piso", 2);
  desenharCorte(d, solidos, { s: sC, olhar: 1, alcance: 1 });
  const ch = (dd: number, z: number, texto: string, dy: number) => d.chamada(dd, z, texto, 640 / e - dd / e + 6, dy, { tam: 2.1 });
  ch(400, 885, "pedra de 30 mm (marmoraria), 20 mm além das frentes", -4);
  ch(530, 862, "travessas de 100 × 15 (em pé sob cuba e cooktop)", 2);
  ch(588, 855, "perfil puxador cava: 24 mm no topo da frente", 8);
  ch(591, 600, "frente de 18 mm · 2 mm de batente · 3 mm entre frentes", 0);
  ch(450, 477, "prateleira regulável de 15 · recuo de 20 · 4 pinos", 4);
  ch(300, 300, "lateral de 15 (em vista) · interior branco TX", 4);
  ch(3, 180, "fundo de 6 mm sobreposto, 2 mm menor que a caixa", 0);
  ch(300, 107, "base de 15 entre as laterais", 3);
  ch(531, 50, "rodapé de 100 · recuado 60 · removível (clipes)", 2);
  d.cadeiaH([0, 600], -5 * e, { lado: -1, ref: 0 });
  d.cadeiaV([0, 100, 870, 900], -100 - 0.5 * e, { lado: -1, tam: 2 });
  d.txt(300, 900 + 9 * e, "Detalhe-tipo — armário de baixo (corte, 1:10)", { tam: 2.6, peso: 700 });
  return d.svg("Detalhe-tipo do armário de baixo");
}
