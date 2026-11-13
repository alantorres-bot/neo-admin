/**
 * Detalhamento por módulo: vista interna de frente + corte lateral, com balões que numeram as peças,
 * e a lista de peças (medidas individuais, material, fita) e de ferragens do módulo.
 */
import { Desenho, fmt } from "./desenho";
import { FERRAGENS, PADROES, listaDePecas, type Marcenaria } from "./projeto";
import { converter } from "./quadros";
import type { Caixa3, LinhaPeca, Modulo, Solido } from "./tipos";
import { colocarBaloes, desenharCorte, desenharElevacao, ehPecaDeCorte, niveisDoVao, pinturaDeFrente } from "./vistas";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v: number) => fmt(v);

export interface OpcoesCartao {
  escala?: number;
  /** Desenhar só um trecho do módulo (caixas repetidas): faixa de s. */
  recorte?: [number, number];
  /** Posições dos cortes laterais (s). Padrão: um corte a 30% da largura. */
  cortes?: number[];
  avisoDesenho?: string;
  semDesenho?: boolean;
}

/** Sólidos de contexto (aparelhos, pedras) que ocupam a faixa do módulo — só para leitura do desenho. */
function contextoDoModulo(mc: Marcenaria, m: Modulo): Solido[] {
  const proprios = mc.contexto[m.conjunto] ?? [];
  const outros = Object.entries(mc.contexto)
    .filter(([id]) => id !== m.conjunto && id.slice(0, 3) === m.conjunto.slice(0, 3))
    .flatMap(([id, lista]) => lista.map((x) => converter(x, mc.quadros[id as "coz-a"], mc.quadros[m.conjunto as "coz-a"])));
  return [...proprios, ...outros].filter((x) => x.classe !== "contexto" && !(x.classe === "pedra" && x.d1 - x.d0 < 100) && x.z1 - x.z0 < m.caixa.z1 - m.caixa.z0 + 400 && x.s1 > m.caixa.s0 + 1 && x.s0 < m.caixa.s1 - 1 && x.d0 < m.caixa.d1 + 60 && x.z1 > m.caixa.z0 - 60 && x.z0 < m.caixa.z1 + 60);
}

function desenhosDoModulo(mc: Marcenaria, m: Modulo, numero: Map<Solido, number>, o: OpcoesCartao): string {
  const q = mc.quadros[m.conjunto as "coz-a"];
  const e = o.escala ?? 10;
  const c: Caixa3 = o.recorte ? { ...m.caixa, s0: o.recorte[0], s1: o.recorte[1] } : m.caixa;
  const dentro = (x: Solido) => !o.recorte || (x.s0 >= c.s0 - 0.5 && x.s1 <= c.s1 + 0.5);
  const solidos = m.solidos.filter(dentro);
  const ctx = contextoDoModulo(mc, m).filter((x) => x.classe === "aparelho");
  const u = q.espelhado ? (s: number) => c.s0 + c.s1 - s : (s: number) => s;
  const postos = new Set<number>();
  const pecas = solidos.filter(ehPecaDeCorte).map((sol) => ({ sol, n: numero.get(sol)! }));

  // ---------------- vista interna de frente
  const f = new Desenho(c.s0 - 15 * e, c.z0 - 13 * e, c.s1 + 5 * e, c.z1 + 9 * e, e);
  if (c.z0 === 0) f.lin(c.s0 - 3 * e, 0, c.s1 + 3 * e, 0, "piso", 2);
  desenharElevacao(f, [...solidos, ...ctx], { interno: true, u, rotulos: true });
  const visiveisDeFrente = pecas.filter(({ sol }) => pinturaDeFrente(sol, true) !== null && sol.classe !== "gaveta");
  colocarBaloes(f, visiveisDeFrente, (sol) => ({ u: (u(sol.s0) + u(sol.s1)) / 2, v: (sol.z0 + sol.z1) / 2, w: sol.s1 - sol.s0, h: sol.z1 - sol.z0 }), postos);
  f.cadeiaH([c.s0, c.s1], c.z0 - 6 * e, { lado: -1, ref: c.z0 });
  const zRod = Math.min(...solidos.filter((x) => x.classe === "lateral").map((x) => x.z0), c.z1);
  f.cadeiaV(zRod > c.z0 && zRod < c.z1 ? [c.z0, zRod, c.z1] : [c.z0, c.z1], c.s0 - 9 * e, { lado: -1, ref: c.s0 });
  // alturas livres de cada vão (entre base, prateleiras e tampo)
  const verticais = solidos.filter((x) => (x.classe === "lateral" || x.classe === "divisoria") && x.z1 - x.z0 > 0.5 * (c.z1 - c.z0) && !x.chapas).sort((a, b) => a.s0 - b.s0);
  const vistos = new Set<string>();
  for (let i = 0; i < verticais.length - 1; i++) {
    const s0 = verticais[i].s1;
    const s1 = verticais[i + 1].s0;
    if (s1 - s0 < 150) continue;
    const nv = niveisDoVao(solidos, (s0 + s1) / 2);
    const chave = nv.pontos.join(",");
    if (nv.pontos.length < 3 || vistos.has(chave)) continue;
    vistos.add(chave);
    const pos = q.espelhado ? u(s0) - 5.5 * e : u(s0) + 5.5 * e;
    f.cadeiaV(nv.pontos, pos, { lado: q.espelhado ? -1 : 1, textos: nv.textos, marca: "T", tam: 2 });
  }
  f.txt((c.s0 + c.s1) / 2, c.z1 + 5.5 * e, "Vista interna (sem as frentes)", { tam: 2.2, peso: 700 });

  // ---------------- cortes laterais
  const cortes = o.cortes ?? [c.s0 + 0.3 * (c.s1 - c.s0)];
  const svgCortes = cortes.map((sC, i) => {
    const paredeAtras = c.d0 <= 30;
    const g = new Desenho(c.d0 - (paredeAtras ? 100 : 0) - 5 * e, c.z0 - 13 * e, c.d1 + 14 * e, c.z1 + 9 * e, e);
    if (paredeAtras) g.ret(-100, c.z0 - 2 * e, 0, c.z1 + 2 * e, "par", { camada: 0 });
    if (c.z0 === 0) g.lin(-100, 0, c.d1 + 4 * e, 0, "piso", 2);
    desenharCorte(g, [...solidos, ...contextoDoModulo(mc, m)], { s: sC, olhar: 1, alcance: 1 });
    const cortadas = pecas.filter(({ sol }) => sol.s0 < sC && sol.s1 > sC);
    colocarBaloes(g, cortadas, (sol) => ({ u: (sol.d0 + sol.d1) / 2, v: (sol.z0 + sol.z1) / 2, w: sol.d1 - sol.d0, h: sol.z1 - sol.z0 }), postos);
    g.cadeiaH(paredeAtras && c.d0 > 0 ? [0, c.d0, c.d1] : [c.d0, c.d1], c.z0 - 6 * e, { lado: -1, ref: c.z0 });
    const frentes = solidos.filter((x) => (x.classe === "porta" || x.classe === "frente-gaveta" || x.classe === "frente-fixa") && !x.soInterno && x.s0 < sC && x.s1 > sC);
    const zs = [...new Set([c.z0, c.z1, ...frentes.flatMap((x) => [x.z0, x.z1])])].sort((a, b) => a - b);
    const textos = zs.slice(1).map((z, k) => (z - zs[k] < 12 ? "" : undefined));
    g.cadeiaV(zs, c.d1 + 7 * e, { lado: 1, textos, tam: 2 });
    g.txt((c.d0 + c.d1) / 2, c.z1 + 5.5 * e, cortes.length > 1 ? `Corte lateral ${i + 1}` : "Corte lateral", { tam: 2.2, peso: 700 });
    return g.svg(`Corte lateral do módulo ${m.cod}`);
  });
  // peças internas das gavetas que não couberam nos cortes: tenta de frente, por cima do que houver
  const faltam = pecas.filter(({ n }) => !postos.has(n));
  for (const { sol } of faltam) {
    if (sol.classe === "porta" || sol.classe === "frente-fixa" || (sol.classe === "frente-gaveta" && !sol.soInterno)) f.ret(u(sol.s0), sol.z0, u(sol.s1), sol.z1, "oc", { fill: "none", camada: 2 });
  }
  if (faltam.length) colocarBaloes(f, faltam, (sol) => ({ u: (u(sol.s0) + u(sol.s1)) / 2, v: (sol.z0 + sol.z1) / 2, w: sol.s1 - sol.s0, h: sol.z1 - sol.z0 }), postos);
  return `<div class="cartao-des">${f.svg(`Vista interna do módulo ${m.cod}`)}${svgCortes.join("")}</div>`;
}

export function tabelaDePecas(linhas: LinhaPeca[], comModulo = false): string {
  const corpo = linhas
    .map((l) => {
      const fita = l.fitaC + l.fitaL === 0 ? "—" : [l.fitaC ? `${l.fitaC}C` : "", l.fitaL ? `${l.fitaL}L` : ""].filter(Boolean).join(" + ");
      return `<tr>${comModulo ? `<td class="c"><b>${l.modulo}</b></td>` : ""}<td class="c">${l.n}</td><td>${esc(l.nome)}${l.obs ? ` <i>(${esc(l.obs)})</i>` : ""}</td><td class="c">${l.qtd}</td><td class="n">${num(l.comp)} × ${num(l.larg)} × ${num(l.esp)}</td><td><span class="am" style="background:${PADROES[l.padrao].cor}"></span>${esc(PADROES[l.padrao].nome)} ${num(l.esp)}</td><td class="c">${fita}</td></tr>`;
    })
    .join("");
  return `<table class="pecas"><thead><tr>${comModulo ? "<th>Mód.</th>" : ""}<th>Nº</th><th>Peça</th><th>Qtd</th><th>Comp. × Larg. × Esp.</th><th>Material (MDF)</th><th>Fita</th></tr></thead><tbody>${corpo}</tbody></table>`;
}

export function textoDasFerragens(m: Modulo): string {
  if (!m.ferragens.length) return "—";
  return m.ferragens
    .map((f) => {
      const item = FERRAGENS[f.item];
      const qtd = item.unidade === "m" || item.unidade === "m²" ? `${String(f.qtd).replace(".", ",")} ${item.unidade}` : `${f.qtd} ${item.unidade}`;
      return `${qtd} · ${esc(item.nome)}${f.obs ? ` <i>(${esc(f.obs)})</i>` : ""}`;
    })
    .join("; ");
}

export function cartaoModulo(mc: Marcenaria, cod: string, o: OpcoesCartao = {}): string {
  const m = mc.modulos.find((x) => x.cod === cod)!;
  const { linhas, numero } = listaDePecas(m);
  const c = m.caixa;
  const medidas = `${num(c.s1 - c.s0)} L × ${num(c.z1 - c.z0)} A × ${num(c.d1 - c.d0)} P${c.z0 > 0 ? ` · base a ${num(c.z0)} do piso` : ""}`;
  const desenhos = o.semDesenho ? "" : desenhosDoModulo(mc, m, numero, o);
  const notas = [...(o.avisoDesenho ? [o.avisoDesenho] : []), ...m.notas];
  return `<article class="cartao${o.semDesenho ? " sem-desenho" : ""}">
<header><b class="cod">${m.cod}</b><span class="nome">${esc(m.nome)}</span><span class="med">${medidas}</span><span class="lote">Lote ${m.lote} · escala 1:${String(o.escala ?? 10).replace(".", ",")}</span></header>
<div class="cartao-corpo">${desenhos}<div class="cartao-info">
<p><b>Externo.</b> ${esc(m.externo)}${m.interno !== "—" ? ` <b>Interno.</b> ${esc(m.interno)}` : ""}${m.abertura !== "—" ? ` <b>Abertura.</b> ${esc(m.abertura)}` : ""}</p>
${tabelaDePecas(linhas)}
<p class="ferr"><b>Ferragens.</b> ${textoDasFerragens(m)}</p>
${notas.length ? `<ul class="notas">${notas.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
</div></div></article>`;
}
