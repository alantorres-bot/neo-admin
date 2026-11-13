/**
 * Desenho técnico em SVG, em escala. O mundo é medido em mm reais (u para a direita, v para cima);
 * o papel, em mm de impressão. Um SVG de largura W mm impresso sem ajuste sai na escala indicada.
 */

/** Marca de origem da medida ao lado da cota (sem marca = medida do móvel no 3D aprovado). */
export type Marca = "P" | "E" | "L" | "T" | "A" | undefined;

export const fmt = (v: number): string => {
  const r = Math.round(Math.abs(v) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export interface OpcoesTexto {
  tam?: number; // mm de papel
  ancora?: "start" | "middle" | "end";
  rot?: number;
  cls?: string;
  cor?: string;
  peso?: number;
  /** Fundo branco atrás do texto (para ler sobre linhas). */
  fundo?: boolean;
  dx?: number; // deslocamento no papel
  dy?: number;
}

export interface OpcoesCota {
  /** Lado do texto e do afastamento: +1 acima/à direita, −1 abaixo/à esquerda. */
  lado?: 1 | -1;
  marca?: Marca | Marca[];
  /** Coordenada do objeto, de onde partem as linhas de chamada. */
  ref?: number;
  tam?: number;
  /** Texto no lugar do número (ex.: "600 livres"). */
  textos?: (string | undefined)[];
  cls?: string;
}

export class Desenho {
  private camadas: string[][] = [[], [], [], []];
  constructor(
    readonly u0: number,
    readonly v0: number,
    readonly u1: number,
    readonly v1: number,
    readonly escala: number,
  ) {}

  get largura(): number {
    return (this.u1 - this.u0) / this.escala;
  }
  get altura(): number {
    return (this.v1 - this.v0) / this.escala;
  }
  x(u: number): number {
    return (u - this.u0) / this.escala;
  }
  y(v: number): number {
    return (this.v1 - v) / this.escala;
  }
  /** mm de papel → mm do mundo. */
  mm(papel: number): number {
    return papel * this.escala;
  }

  private por(camada: number, s: string) {
    this.camadas[camada].push(s);
  }

  ret(u0: number, v0: number, u1: number, v1: number, cls: string, o: { fill?: string; camada?: number; extra?: string } = {}) {
    const x = Math.min(this.x(u0), this.x(u1));
    const y = Math.min(this.y(v0), this.y(v1));
    const w = Math.abs(this.x(u1) - this.x(u0));
    const h = Math.abs(this.y(v1) - this.y(v0));
    this.por(o.camada ?? 1, `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.fill ? ` style="fill:${o.fill}"` : ""}${o.extra ?? ""}/>`);
  }

  lin(u0: number, v0: number, u1: number, v1: number, cls: string, camada = 1) {
    this.por(camada, `<line class="${cls}" x1="${n(this.x(u0))}" y1="${n(this.y(v0))}" x2="${n(this.x(u1))}" y2="${n(this.y(v1))}"/>`);
  }

  poli(pontos: [number, number][], cls: string, o: { fill?: string; camada?: number; fechar?: boolean } = {}) {
    const d = pontos.map(([u, v], i) => `${i ? "L" : "M"}${n(this.x(u))} ${n(this.y(v))}`).join(" ") + (o.fechar ? " Z" : "");
    this.por(o.camada ?? 1, `<path class="${cls}" d="${d}"${o.fill ? ` style="fill:${o.fill}"` : ' style="fill:none"'}/>`);
  }

  /** Arco de círculo (abertura de porta em planta), ângulos em graus no mundo (anti-horário, v para cima). */
  arco(cu: number, cv: number, raio: number, a0: number, a1: number, cls: string, camada = 1) {
    const p = (a: number): [number, number] => [cu + raio * Math.cos((a * Math.PI) / 180), cv + raio * Math.sin((a * Math.PI) / 180)];
    const [ua, va] = p(a0);
    const [ub, vb] = p(a1);
    const r = raio / this.escala;
    const horario = a1 > a0 ? 0 : 1; // no papel o v é invertido
    this.por(camada, `<path class="${cls}" fill="none" d="M${n(this.x(ua))} ${n(this.y(va))} A${n(r)} ${n(r)} 0 0 ${horario} ${n(this.x(ub))} ${n(this.y(vb))}"/>`);
  }

  elipse(cu: number, cv: number, ru: number, rv: number, cls: string, o: { fill?: string; camada?: number } = {}) {
    this.por(o.camada ?? 1, `<ellipse class="${cls}" cx="${n(this.x(cu))}" cy="${n(this.y(cv))}" rx="${n(ru / this.escala)}" ry="${n(rv / this.escala)}"${o.fill ? ` style="fill:${o.fill}"` : ' style="fill:none"'}/>`);
  }

  txt(u: number, v: number, texto: string, o: OpcoesTexto = {}) {
    const tam = o.tam ?? 2.3;
    const x = this.x(u) + (o.dx ?? 0);
    const y = this.y(v) + (o.dy ?? 0);
    const rot = o.rot ? ` transform="rotate(${n(o.rot)} ${n(x)} ${n(y)})"` : "";
    const estilo = `font-size:${n(tam)}px;${o.cor ? `fill:${o.cor};` : ""}${o.peso ? `font-weight:${o.peso};` : ""}`;
    const attrs = `x="${n(x)}" y="${n(y)}" text-anchor="${o.ancora ?? "middle"}" dominant-baseline="central" style="${estilo}"${rot}`;
    if (o.fundo) {
      const w = texto.length * tam * 0.5 + 0.8;
      const h = tam * 1.15;
      const ancora = o.ancora ?? "middle";
      const x0 = ancora === "middle" ? x - w / 2 : ancora === "start" ? x - 0.4 : x - w + 0.4;
      this.por(3, `<rect class="fd" x="${n(x0)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}"${rot}/>`);
    }
    this.por(3, `<text class="tx ${o.cls ?? ""}" ${attrs}>${esc(texto)}</text>`);
  }

  /** Texto de cota: número + marca de origem em cor. */
  private txtCota(x: number, y: number, texto: string, marca: Marca, tam: number, rot = 0) {
    const r = rot ? ` transform="rotate(${rot} ${n(x)} ${n(y)})"` : "";
    const m = marca ? `<tspan class="og og-${marca}" dx="0.35" dy="${n(-tam * 0.28)}" style="font-size:${n(tam * 0.62)}px">${marca}</tspan>` : "";
    const base = `x="${n(x)}" y="${n(y)}" text-anchor="middle" style="font-size:${n(tam)}px"${r}`;
    const w = this.larguraTexto(texto, tam, marca);
    this.por(3, `<rect class="fd" x="${n(x - w / 2)}" y="${n(y - tam * 0.85)}" width="${n(w)}" height="${n(tam * 1.1)}"${r}/>`);
    this.por(3, `<text class="tx ct-t${marca ? ` og-${marca}` : ""}" ${base}>${esc(texto)}${m}</text>`);
  }

  private larguraTexto(texto: string, tam: number, marca: Marca): number {
    return texto.length * tam * 0.56 + (marca ? tam * 0.6 : 0) + 0.8;
  }

  /** Cotas em cadeia na horizontal, na altura v (mundo). */
  cadeiaH(pontos: number[], v: number, o: OpcoesCota = {}) {
    const ps = [...pontos].sort((a, b) => a - b);
    const lado = o.lado ?? 1;
    const tam = o.tam ?? 2.2;
    const y = this.y(v);
    const cls = o.cls ?? "ct";
    this.por(2, `<line class="${cls}" x1="${n(this.x(ps[0]) - 1)}" y1="${n(y)}" x2="${n(this.x(ps[ps.length - 1]) + 1)}" y2="${n(y)}"/>`);
    for (const p of ps) {
      const x = this.x(p);
      this.por(2, `<line class="${cls} ct-tk" x1="${n(x - 0.8)}" y1="${n(y + 0.8)}" x2="${n(x + 0.8)}" y2="${n(y - 0.8)}"/>`);
      if (o.ref !== undefined) {
        const yr = this.y(o.ref);
        const dir = yr > y ? 1 : -1;
        this.por(2, `<line class="${cls} ct-ch" x1="${n(x)}" y1="${n(yr - dir * 0.8)}" x2="${n(x)}" y2="${n(y - dir * 1.2)}"/>`);
      }
    }
    let nivel = 0;
    for (let i = 0; i < ps.length - 1; i++) {
      const marca = Array.isArray(o.marca) ? o.marca[i] : o.marca;
      const texto = o.textos?.[i] ?? fmt(ps[i + 1] - ps[i]);
      if (texto === "") continue;
      const larg = this.x(ps[i + 1]) - this.x(ps[i]);
      const apertado = this.larguraTexto(texto, tam, marca) > larg;
      nivel = apertado ? (nivel === 1 ? 2 : 1) : 0;
      const afast = lado > 0 ? -(0.9 + tam * 0.35 + (nivel === 2 ? tam * 1.15 : 0)) : 0.9 + tam * 0.75 + (nivel === 2 ? tam * 1.15 : 0);
      this.txtCota((this.x(ps[i]) + this.x(ps[i + 1])) / 2, y + afast, texto, marca, tam);
    }
  }

  /** Cotas em cadeia na vertical, na posição u (mundo). O texto fica do lado indicado, lido de baixo para cima. */
  cadeiaV(pontos: number[], u: number, o: OpcoesCota = {}) {
    const ps = [...pontos].sort((a, b) => a - b);
    const lado = o.lado ?? -1;
    const tam = o.tam ?? 2.2;
    const x = this.x(u);
    const cls = o.cls ?? "ct";
    this.por(2, `<line class="${cls}" x1="${n(x)}" y1="${n(this.y(ps[0]) + 1)}" x2="${n(x)}" y2="${n(this.y(ps[ps.length - 1]) - 1)}"/>`);
    for (const p of ps) {
      const y = this.y(p);
      this.por(2, `<line class="${cls} ct-tk" x1="${n(x - 0.8)}" y1="${n(y + 0.8)}" x2="${n(x + 0.8)}" y2="${n(y - 0.8)}"/>`);
      if (o.ref !== undefined) {
        const xr = this.x(o.ref);
        const dir = xr > x ? 1 : -1;
        this.por(2, `<line class="${cls} ct-ch" x1="${n(xr - dir * 0.8)}" y1="${n(y)}" x2="${n(x - dir * 1.2)}" y2="${n(y)}"/>`);
      }
    }
    let nivel = 0;
    for (let i = 0; i < ps.length - 1; i++) {
      const marca = Array.isArray(o.marca) ? o.marca[i] : o.marca;
      const texto = o.textos?.[i] ?? fmt(ps[i + 1] - ps[i]);
      if (texto === "") continue;
      const alt = Math.abs(this.y(ps[i + 1]) - this.y(ps[i]));
      const apertado = this.larguraTexto(texto, tam, marca) > alt;
      nivel = apertado ? (nivel === 1 ? 2 : 1) : 0;
      const afast = lado < 0 ? -(0.9 + tam * 0.3 + (nivel === 2 ? tam * 1.15 : 0)) : 0.9 + tam * 0.8 + (nivel === 2 ? tam * 1.15 : 0);
      this.txtCota(x + afast, (this.y(ps[i]) + this.y(ps[i + 1])) / 2, texto, marca, tam, -90);
    }
  }

  /** Balão numerado (identificação de peça). */
  balao(u: number, v: number, numero: number | string, o: { dx?: number; dy?: number } = {}) {
    const x = this.x(u) + (o.dx ?? 0);
    const y = this.y(v) + (o.dy ?? 0);
    if (o.dx || o.dy) this.por(3, `<line class="bl-l" x1="${n(this.x(u))}" y1="${n(this.y(v))}" x2="${n(x)}" y2="${n(y)}"/>`);
    this.por(3, `<circle class="bl" cx="${n(x)}" cy="${n(y)}" r="1.9"/><text class="tx bl-t" x="${n(x)}" y="${n(y)}" text-anchor="middle" dominant-baseline="central">${numero}</text>`);
  }

  /** Chamada: texto com linha até um ponto. */
  chamada(u: number, v: number, texto: string, dx: number, dy: number, o: OpcoesTexto = {}) {
    const x = this.x(u);
    const y = this.y(v);
    this.por(3, `<line class="bl-l" x1="${n(x)}" y1="${n(y)}" x2="${n(x + dx)}" y2="${n(y + dy)}"/><circle cx="${n(x)}" cy="${n(y)}" r="0.35" fill="#111"/>`);
    this.txt(u, v, texto, { ancora: dx >= 0 ? "start" : "end", ...o, dx: dx + (dx >= 0 ? 0.6 : -0.6), dy, fundo: true });
  }

  bruto(svg: string, camada = 3) {
    this.por(camada, svg);
  }

  svg(titulo?: string): string {
    const w = this.largura;
    const h = this.altura;
    return `<svg class="des" xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}"${titulo ? ` role="img" aria-label="${esc(titulo)}"` : ""}>${this.camadas.map((c) => c.join("")).join("")}</svg>`;
  }
}

/** Mistura uma cor hex com branco (t = 0 mantém, 1 = branco). */
export function clarear(hex: string, t: number): string {
  const v = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  const m = c.map((x) => Math.round(x + (255 - x) * t));
  return `#${m.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Estilos dos desenhos (entram uma vez no documento). */
export const CSS_DESENHO = `
.des{display:block;overflow:visible}
.des .tx{font-family:"Liberation Sans",Arial,Helvetica,sans-serif;fill:#111}
.des .fd{fill:#fff;fill-opacity:0.92;stroke:none}
.des .pc{stroke:#1f2328;stroke-width:0.16px;fill:#fff}
.des .pf{stroke:#1f2328;stroke-width:0.2px}
.des .pg{stroke:#1f2328;stroke-width:0.3px}
.des .fino{stroke:#6b7280;stroke-width:0.1px;fill:none}
.des .oc{stroke:#4b5563;stroke-width:0.14px;stroke-dasharray:1.1 0.7;fill:none}
.des .eixo{stroke:#9ca3af;stroke-width:0.1px;stroke-dasharray:3 0.8 0.5 0.8;fill:none}
.des .ab{stroke:#6b7280;stroke-width:0.1px;stroke-dasharray:0.9 0.6;fill:none}
.des .ct{stroke:#30363d;stroke-width:0.1px;fill:none}
.des .ct-tk{stroke-width:0.22px}
.des .ct-ch{stroke:#8b949e}
.des .ct-t{fill:#111}
.des .og{font-weight:700}
.des .og-P{fill:#15803d}.des .og-E{fill:#c2410c}.des .og-L{fill:#b91c1c}.des .og-T{fill:#6d28d9}.des .og-A{fill:#0369a1}
.des text.og-P,.des text.og-E,.des text.og-L,.des text.og-T,.des text.og-A{font-weight:600}
.des .bl{fill:#fff;stroke:#111;stroke-width:0.14px}
.des .bl-t{font-size:2.1px;font-weight:700}
.des .bl-l{stroke:#111;stroke-width:0.1px}
.des .par{fill:#cfd4da;stroke:#111;stroke-width:0.3px}
.des .vz{fill:#f1f2f4;stroke:#6b7280;stroke-width:0.14px;stroke-dasharray:1.4 0.8}
.des .piso{stroke:#111;stroke-width:0.45px}
.des .teto{stroke:#111;stroke-width:0.3px;stroke-dasharray:2.4 1}
.des .at{stroke:#b91c1c;stroke-width:0.22px;fill:#fff}
.des .at-t{fill:#b91c1c;font-weight:700}
`;

/** Reservado para definições compartilhadas dos desenhos (hoje não há: paredes e vazios usam cor chapada, que pesa menos no PDF). */
export const DEFS_HACHURAS = "";
