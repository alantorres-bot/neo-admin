/**
 * Formas paramétricas dos móveis. Funções PURAS: recebem as dimensões (cm) e as opções e devolvem
 * a lista de peças (caixas, cilindros…) que compõem o móvel. A cena só desenha essas peças.
 *
 * Referencial do móvel (cm): x ∈ [−L/2, L/2] (largura), y ∈ [0, A] (altura, a partir da base),
 * z ∈ [−P/2, P/2] (profundidade). A FRENTE fica em +z; o fundo (lado da parede) em −z.
 */

export type Acabamento =
  | "liso"
  | "fosco"
  | "madeira"
  | "pedra"
  | "granilite"
  | "granito"
  | "inox"
  | "metal"
  | "vidro"
  | "vidro-preto"
  | "espelho"
  | "tecido"
  | "palhinha"
  | "louca"
  | "cromado"
  | "led";

export interface Peca {
  /** Geometria: caixa, cilindro (eixo vertical), esfera, cone, onda (cortina) ou plano (com textura recortada). */
  g: "caixa" | "cilindro" | "esfera" | "cone" | "onda" | "plano";
  /** Centro da peça (x, y, z), cm. */
  p: [number, number, number];
  /** Tamanho (x, y, z), cm. Cilindro/cone: diâmetro em x e z, altura em y. */
  s: [number, number, number];
  /** Parte do móvel — define cor e acabamento (ver catálogo). */
  slot: string;
  /** Rotação em graus (x, y, z). */
  r?: [number, number, number];
  /** Cilindro: fator do raio no topo e na base (1 = reto). */
  rt?: number;
  rb?: number;
  /** Caixa com cantos arredondados (raio em cm) — estofados, colchão, travesseiros. */
  arred?: number;
  /** Textura desenhada: "arte" (quadro) ou "remo". */
  tex?: "arte" | "remo";
  /** Peça que pode sair da caixa L × P × A (puxador, almofada solta, torneira…). */
  fora?: boolean;
}

export interface Dim {
  L: number;
  P: number;
  A: number;
}
export type Opcoes = Record<string, number | string | boolean | undefined>;
export type Forma = (d: Dim, o: Opcoes) => Peca[];

type Extra = Partial<Pick<Peca, "r" | "rt" | "rb" | "tex" | "fora" | "arred">>;

/** Caixa pelos limites (x0..x1, y0..y1, z0..z1). */
const cx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, slot: string, extra: Extra = {}): Peca => ({
  g: "caixa",
  p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  s: [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)],
  slot,
  ...extra,
});

/** Cilindro vertical: centro (x, z), de y0 a y1, diâmetros dx e dz. */
const cil = (x: number, z: number, y0: number, y1: number, dx: number, dz: number, slot: string, extra: Extra = {}): Peca => ({
  g: "cilindro",
  p: [x, (y0 + y1) / 2, z],
  s: [dx, Math.abs(y1 - y0), dz],
  slot,
  ...extra,
});

const num = (v: unknown, padrao: number): number => (typeof v === "number" && Number.isFinite(v) ? v : padrao);
const ESP_FRENTE = 2; // espessura de portas e frentes de gaveta
const FOLGA = 0.3; // folga entre frentes

// ---------------------------------------------------------------------------------------------
// Marcenaria: armário, gaveteiro, nicho, rack, guarda-roupa, gabinete…
// ---------------------------------------------------------------------------------------------
const armario: Forma = ({ L, P, A }, o) => {
  const pecas: Peca[] = [];
  const pes = num(o.pes, 0);
  const rodape = num(o.rodape, 0);
  const tampo = o.tampo ? num(o.espessuraTampo, 4) : 0;
  const moldura = num(o.moldura, 0);
  const nicho = num(o.nichoCentral, 0);
  const recuo = num(o.recuoCorpo, 0); // corpo mais estreito que o tampo (aba do tampo de cada lado)
  const y0 = Math.max(pes, rodape);
  const y1 = A - tampo;
  const x0 = -L / 2 + recuo;
  const x1 = L / 2 - recuo;
  const z0 = -P / 2;
  const z1 = P / 2;
  const zf = z1 - ESP_FRENTE; // plano onde as frentes começam
  const comNicho = !o.aberto && nicho > 0 && nicho < x1 - x0 - 20;

  if (rodape > 0) pecas.push(cx(x0, x1, 0, rodape, z0, z1 - 6, "rodape"));
  if (pes > 0) {
    for (const sz of [-1, 1]) {
      const pz = sz * (P / 2 - 6);
      for (const sx of [-1, 1]) {
        const px = sx * ((x1 - x0) / 2 - 8);
        if (o.estiloPes === "palito") {
          // pé palito: abre para fora na base
          pecas.push({ g: "caixa", p: [px, pes / 2, pz], s: [4, pes + 1.4, 4], r: [0, 0, sx * 16], slot: "pes", fora: true });
        } else {
          pecas.push(cx(px - 2.2, px + 2.2, 0, pes, pz - 2.2, pz + 2.2, "pes"));
        }
      }
      // com nicho central, dois pés retos sob as divisórias
      if (comNicho && o.estiloPes === "palito") {
        for (const sx of [-1, 1]) pecas.push(cx(sx * (nicho / 2) - 1.8, sx * (nicho / 2) + 1.8, 0, pes, pz - 1.8, pz + 1.8, "pes"));
      }
    }
  }

  if (o.aberto) {
    // nicho aberto: fundo, laterais, base e topo
    const e = 2;
    pecas.push(
      cx(x0, x1, y0, y1, z0, z0 + 1, "corpo"),
      cx(x0, x0 + e, y0, y1, z0, z1, "corpo"),
      cx(x1 - e, x1, y0, y1, z0, z1, "corpo"),
      cx(x0, x1, y0, y0 + e, z0, z1, "corpo"),
      cx(x0, x1, y1 - e, y1, z0, z1, "corpo"),
    );
    const prateleiras = num(o.prateleiras, 0);
    for (let i = 1; i <= prateleiras; i++) {
      const y = y0 + (i * (y1 - y0)) / (prateleiras + 1);
      pecas.push(cx(x0 + e, x1 - e, y - 1, y + 1, z0 + 1, z1 - 1, "corpo"));
    }
  } else {
    if (comNicho) {
      // corpo só atrás das portas; o nicho do meio é aberto de verdade: fundo, base, topo e prateleira
      const e = 1.8;
      const ym = (y0 + y1) / 2;
      pecas.push(
        cx(x0, -nicho / 2, y0, y1, z0, zf, "corpo"),
        cx(nicho / 2, x1, y0, y1, z0, zf, "corpo"),
        cx(-nicho / 2, nicho / 2, y0, y1, z0, z0 + 1.2, "nicho"),
        cx(-nicho / 2, nicho / 2, y0, y0 + e, z0, z1 - 0.5, "corpo"),
        cx(-nicho / 2, nicho / 2, y1 - e, y1, z0, z1 - 0.5, "corpo"),
        cx(-nicho / 2, nicho / 2, ym - 0.9, ym + 0.9, z0 + 1.2, z1 - 1.5, "corpo"),
      );
    } else {
      pecas.push(cx(x0, x1, y0, y1, z0, zf, "corpo"));
    }
    const soleira = num(o.soleira, 0); // travessa de baixo aparente: as frentes começam acima dela
    if (soleira > 0) pecas.push(cx(x0, x1, y0, y0 + soleira, zf, z1, "corpo"));
    const fy0 = y0 + soleira + FOLGA;
    const fy1 = y1 - FOLGA;
    const fx0 = x0 + moldura;
    const fx1 = x1 - moldura;
    if (moldura > 0) {
      pecas.push(cx(x0, fx0, y0, y1, zf, z1, "corpo"), cx(fx1, x1, y0, y1, zf, z1, "corpo"));
    }
    const gavetas = num(o.gavetas, 0);
    const portas = num(o.portas, gavetas > 0 ? 0 : Math.max(1, Math.round((fx1 - fx0) / 50)));
    const slotFrente = o.espelho ? "espelho" : "frente";
    const puxador = typeof o.puxador === "string" ? o.puxador : "nenhum";
    const alto = A >= 170;

    const frente = (xa: number, xb: number, ya: number, ybOriginal: number) => {
      // puxador cava: a frente termina um pouco abaixo e deixa um rebaixo escuro no topo
      const cava = o.cava && ybOriginal - ya > 12 ? 2.4 : 0;
      const yb = ybOriginal - cava;
      if (cava > 0) pecas.push(cx(xa + FOLGA, xb - FOLGA, yb, ybOriginal, zf, zf + 0.5, "cava"));
      if (o.ripado) {
        pecas.push(cx(xa + FOLGA, xb - FOLGA, ya, yb, zf, zf + 0.6, "interior"));
        const n = Math.max(2, Math.floor((yb - ya) / 3.8));
        const passo = (yb - ya) / n;
        for (let i = 0; i < n; i++) pecas.push(cx(xa + FOLGA, xb - FOLGA, ya + i * passo, ya + (i + 1) * passo - 1.5, zf, z1, slotFrente));
        // montantes verticais nas pontas da porta ripada
        pecas.push(cx(xa + FOLGA, xa + FOLGA + 2.2, ya, yb, zf, z1 - 0.3, slotFrente), cx(xb - FOLGA - 2.2, xb - FOLGA, ya, yb, zf, z1 - 0.3, slotFrente));
      } else {
        pecas.push(cx(xa + FOLGA, xb - FOLGA, ya, yb, zf, z1, slotFrente));
      }
    };

    if (gavetas > 0) {
      // gavetas empilhadas, a de baixo um pouco mais alta
      const pesos = Array.from({ length: gavetas }, (_, i) => 1 + 0.22 * i); // de cima para baixo
      const total = pesos.reduce((soma, peso) => soma + peso, 0);
      let topo = fy1;
      pesos.forEach((peso) => {
        const h = ((fy1 - fy0) * peso) / total;
        frente(fx0, fx1, topo - h + FOLGA / 2, topo - FOLGA / 2);
        const ym = topo - h / 2;
        if (puxador === "barra") pecas.push(cx(-(fx1 - fx0) * 0.2, (fx1 - fx0) * 0.2, ym - 0.7, ym + 0.7, z1, z1 + 2.6, "puxador", { fora: true }));
        if (puxador === "botao") pecas.push({ g: "esfera", p: [(fx0 + fx1) / 2, ym, z1 + 1.4], s: [3.2, 3.2, 3.2], slot: "puxador", fora: true });
        topo -= h;
      });
    } else if (portas > 0) {
      // com nicho central (rack): portas só nas laterais
      const regioes: [number, number, number][] = comNicho
        ? [
            [fx0, -nicho / 2, Math.max(1, Math.floor(portas / 2))],
            [nicho / 2, fx1, Math.max(1, Math.floor(portas / 2))],
          ]
        : [[fx0, fx1, portas]];
      for (const [ra, rb, n] of regioes) {
        const w = (rb - ra) / n;
        for (let i = 0; i < n; i++) {
          const xa = ra + i * w;
          const xb = xa + w;
          frente(xa, xb, fy0, fy1);
          // puxador do lado em que a porta abre (pares abrem do centro)
          const lado = n === 1 ? 1 : i % 2 === 0 ? 1 : -1;
          const xp = lado > 0 ? xb - 4 : xa + 4;
          const centro = alto ? Math.min(fy1 - 20, 112) : (fy0 + fy1) / 2;
          if (puxador === "barra") {
            const meio = Math.min(15, (fy1 - fy0) * 0.22);
            pecas.push(cx(xp - 0.8, xp + 0.8, centro - meio, centro + meio, z1, z1 + 2.8, "puxador", { fora: true }));
          }
          if (puxador === "botao") {
            pecas.push({ g: "esfera", p: [xp, alto ? centro : fy1 - 9, z1 + 1.4], s: [3.2, 3.2, 3.2], slot: "puxador", fora: true });
          }
        }
      }
    }
  }
  if (tampo > 0) pecas.push(recuo > 0 ? cx(-L / 2, L / 2, y1, A, z0, z1, "tampo") : cx(x0 - 1, x1 + 1, y1, A, z0, z1 + 1, "tampo"));
  return pecas;
};

const caixa: Forma = ({ L, P, A }) => [cx(-L / 2, L / 2, 0, A, -P / 2, P / 2, "principal")];

const cilindro: Forma = ({ L, P, A }, o) => [cil(0, 0, 0, A, L, P, "principal", { rt: num(o.afunila, 1) })];

/** Painel de parede (cabeceira, painel de TV) com frisos verticais opcionais. */
const painel: Forma = ({ L, P, A }, o) => {
  const pecas = [cx(-L / 2, L / 2, 0, A, -P / 2, P / 2, "principal")];
  const frisos = num(o.frisos, 0);
  for (let i = 1; i <= frisos; i++) {
    const x = -L / 2 + (i * L) / (frisos + 1);
    pecas.push(cx(x - 0.5, x + 0.5, 0, A, P / 2 - 0.2, P / 2 + 0.25, "friso", { fora: true }));
  }
  return pecas;
};

const prateleira: Forma = ({ L, P, A }, o) => {
  const e = Math.min(A, 4);
  const pecas = [cx(-L / 2, L / 2, 0, e, -P / 2, P / 2, "madeira")];
  if (o.objetos) {
    const d = Math.min(8, P * 0.45);
    pecas.push(
      cil(-L * 0.44, 0, e, e + 20, d, d, "objeto1", { fora: true, rt: 0.85 }),
      cil(L * 0.43, 0, e, e + 26, d, d, "objeto2", { fora: true, rt: 0.85 }),
      cil(L * 0.38, 0, e, e + 28, d, d, "objeto3", { fora: true, rt: 0.85 }),
      cx(L * 0.2, L * 0.2 + 16, e, e + 5, -P * 0.3, P * 0.3, "objeto2", { fora: true }),
    );
  }
  return pecas;
};

// ---------------------------------------------------------------------------------------------
// Estofados, mesas e cadeiras
// ---------------------------------------------------------------------------------------------
const sofa: Forma = ({ L, P, A }, o) => {
  const x0 = -L / 2;
  const x1 = L / 2;
  const z0 = -P / 2;
  const z1 = P / 2;
  const braco = Math.min(14, L * 0.12);
  const hBase = A * 0.28;
  const hAssento = A * 0.52;
  const hBraco = A * 0.68;
  const modulos = Math.max(1, Math.round(num(o.modulos, (L - 2 * braco) / 95)));
  const pecas: Peca[] = [
    cx(x0, x1, 0, hBase, z0, z1 - 2, "tecido", { arred: 3 }),
    cx(x0, x0 + braco, hBase - 3, hBraco, z0, z1 - 2, "tecido", { arred: 5 }),
    cx(x1 - braco, x1, hBase - 3, hBraco, z0, z1 - 2, "tecido", { arred: 5 }),
    cx(x0 + braco - 2, x1 - braco + 2, hBase - 3, A * 0.9, z0, z0 + 10, "tecido", { arred: 4 }),
  ];
  const w = (L - 2 * braco) / modulos;
  const fundoAssento = z0 + Math.min(26, P * 0.3);
  for (let i = 0; i < modulos; i++) {
    const xa = x0 + braco + i * w;
    pecas.push(cx(xa + 0.5, xa + w - 0.5, hBase - 2, hAssento, fundoAssento, z1, "almofada", { arred: 6 }));
    pecas.push(cx(xa + 1, xa + w - 1, hAssento - 4, A, z0 + 8, fundoAssento + 2, "almofada", { arred: 7 }));
  }
  if (o.almofadas !== false && L > 120) {
    const xa = x0 + braco + w * 0.3;
    pecas.push(
      { g: "caixa", p: [xa, hAssento + 17, fundoAssento + 12], s: [38, 38, 10], r: [-18, 25, 0], slot: "almofada", fora: true, arred: 4.5 },
      { g: "caixa", p: [xa + 24, hAssento + 16, fundoAssento + 20], s: [36, 36, 10], r: [-22, -18, 0], slot: "almofada", fora: true, arred: 4.5 },
    );
  }
  return pecas;
};

const mesa: Forma = ({ L, P, A }, o) => {
  const e = 3;
  const pes = typeof o.pes === "string" ? o.pes : "quatro";
  const pecas: Peca[] = [o.redonda ? cil(0, 0, A - e, A, L, P, "tampo") : cx(-L / 2, L / 2, A - e, A, -P / 2, P / 2, "tampo")];
  if (pes === "quatro") {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (L / 2 - 6);
        const z = sz * (P / 2 - 6);
        pecas.push(cx(x - 2.5, x + 2.5, 0, A - e, z - 2.5, z + 2.5, "pes"));
      }
    }
  } else if (pes === "U") {
    // quadros em U invertido; com apoio na parede, só o da ponta solta (+x)
    const posicoes = o.apoioParede ? [L / 2 - 8] : [-(L / 2 - 14), L / 2 - 14];
    const zl = P / 2 - Math.min(18, P * 0.22);
    for (const x of posicoes) {
      pecas.push(
        cx(x - 2, x + 2, 0, A - e, -zl - 2, -zl + 2, "pes"),
        cx(x - 2, x + 2, 0, A - e, zl - 2, zl + 2, "pes"),
        cx(x - 2, x + 2, 0, 4, -zl, zl, "pes"),
        cx(x - 2, x + 2, A - e - 5, A - e, -zl, zl, "pes"),
      );
    }
    if (o.apoioParede) pecas.push(cx(-L / 2, -L / 2 + 3, A - e - 12, A - e, -P / 2 + 4, P / 2 - 4, "tampo"));
  } else if (pes === "central") {
    const d = Math.min(L, P);
    pecas.push(cil(0, 0, 3, A - e, d * 0.12, d * 0.12, "pes"), cil(0, 0, 0, 3, d * 0.55, d * 0.55, "pes"));
  } else {
    // painéis laterais (escrivaninha)
    pecas.push(cx(-L / 2 + 2, -L / 2 + 5, 0, A - e, -P / 2 + 3, P / 2 - 3, "pes"), cx(L / 2 - 5, L / 2 - 2, 0, A - e, -P / 2 + 3, P / 2 - 3, "pes"));
    pecas.push(cx(-L / 2 + 5, L / 2 - 5, A * 0.45, A - e, -P / 2 + 3, -P / 2 + 5, "pes"));
  }
  return pecas;
};

const cadeira: Forma = ({ L, P, A }, o) => {
  const hs = Math.round(A * 0.52); // altura do assento
  const x = L / 2 - 3;
  const zf = P / 2 - 4;
  const zt = -P / 2 + 4;
  const encosto = typeof o.encosto === "string" ? o.encosto : "palhinha";
  const hEnc = Math.min(32, A * 0.36); // altura do quadro do encosto
  const yEnc = A - hEnc / 2;
  return [
    // pés da frente e de trás (os de trás sobem até o encosto)
    cx(-x - 1.9, -x + 1.9, 0, hs - 2, zf - 2, zf + 2, "madeira"),
    cx(x - 1.9, x + 1.9, 0, hs - 2, zf - 2, zf + 2, "madeira"),
    cx(-x - 1.9, -x + 1.9, 0, A - hEnc * 0.55, zt - 2.2, zt + 2.2, "madeira"),
    cx(x - 1.9, x + 1.9, 0, A - hEnc * 0.55, zt - 2.2, zt + 2.2, "madeira"),
    // travessas laterais e bandeja do assento
    cx(-x - 1.6, -x + 1.6, hs - 9, hs - 4.5, zt, zf, "madeira"),
    cx(x - 1.6, x + 1.6, hs - 9, hs - 4.5, zt, zf, "madeira"),
    cx(-L / 2 + 0.5, L / 2 - 0.5, hs - 3, hs - 0.5, -P / 2 + 3, P / 2 - 0.5, "madeira"),
    cx(-L / 2 + 2, L / 2 - 2, hs - 0.5, hs + 4, -P / 2 + 5, P / 2 - 1.5, "assento", { arred: 2 }),
    // encosto: quadro de madeira com painel, levemente inclinado para trás, apoiado na frente dos montantes
    { g: "caixa", p: [0, yEnc, zt + 3.6], s: [L, hEnc, 2.6], r: [-9, 0, 0], slot: "madeira", arred: 1 },
    { g: "caixa", p: [0, yEnc, zt + 3.6], s: [L - 7, hEnc - 7, 3.2], r: [-9, 0, 0], slot: encosto === "madeira" ? "madeira" : encosto === "estofado" ? "assento" : "encosto" },
  ];
};

const banqueta: Forma = ({ L, P, A }, o) => {
  const pecas: Peca[] = [o.redonda ? cil(0, 0, A - 4, A, L, P, "assento") : cx(-L / 2, L / 2, A - 4, A, -P / 2, P / 2, "assento")];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (L / 2 - 5);
      const z = sz * (P / 2 - 5);
      pecas.push(cx(x - 1.5, x + 1.5, 0, A - 4, z - 1.5, z + 1.5, "madeira"));
    }
  }
  const ha = A * 0.35;
  pecas.push(cx(-L / 2 + 5, L / 2 - 5, ha - 1, ha + 1, P / 2 - 6, P / 2 - 4, "madeira"), cx(-L / 2 + 5, L / 2 - 5, ha - 1, ha + 1, -P / 2 + 4, -P / 2 + 6, "madeira"));
  return pecas;
};

const cama: Forma = ({ L, P, A }, o) => {
  const hc = num(o.cabeceira, 0); // altura da cabeceira (0 = sem)
  const ec = hc > 0 ? 4 : 0;
  const x0 = -L / 2;
  const x1 = L / 2;
  const zc = -P / 2 + ec;
  const z1 = P / 2;
  const hBase = Math.min(28, A * 0.5);
  const hColchao = Math.min(52, A * 0.9);
  const pecas: Peca[] = [
    cx(x0 + 2, x1 - 2, 4, hBase, zc + 2, z1 - 2, "base"),
    cx(x0, x1, hBase, hColchao, zc, z1, "colchao", { arred: 6 }),
    cx(x0, x1, hColchao - 6, Math.min(A, hColchao + 2), zc + P * 0.3, z1, "manta", { arred: 3.5 }),
  ];
  const n = L >= 120 ? 2 : 1;
  const wt = Math.min(62, L / n - 6);
  for (let i = 0; i < n; i++) {
    const xm = n === 1 ? 0 : (i === 0 ? -1 : 1) * (L / 4);
    pecas.push(cx(xm - wt / 2, xm + wt / 2, hColchao - 1, Math.min(A, hColchao + 12), zc + 5, zc + 43, "travesseiro", { arred: 5.5 }));
  }
  if (hc > 0) pecas.push(cx(x0, x1, 0, Math.min(A, hc), -P / 2, zc, "cabeceira"));
  return pecas;
};

// ---------------------------------------------------------------------------------------------
// Eletros
// ---------------------------------------------------------------------------------------------
const eletro: Forma = ({ L, P, A }, o) => {
  const x0 = -L / 2;
  const x1 = L / 2;
  const z0 = -P / 2;
  const z1 = P / 2;
  const tipo = typeof o.tipo === "string" ? o.tipo : "caixa";
  switch (tipo) {
    case "geladeira": {
      const ep = 6; // espessura das portas
      const pecas: Peca[] = [cx(x0, x1, 0, A, z0, z1 - ep, "corpo")];
      const freezer = typeof o.freezer === "string" ? o.freezer : "embaixo";
      if (freezer === "lado") {
        pecas.push(
          cx(x0 + 0.3, -0.3, 3, A - 0.3, z1 - ep, z1, "corpo"),
          cx(0.3, x1 - 0.3, 3, A - 0.3, z1 - ep, z1, "corpo"),
          cx(-3.2, -1.6, A * 0.3, A * 0.75, z1, z1 + 2.5, "detalhe", { fora: true }),
          cx(1.6, 3.2, A * 0.3, A * 0.75, z1, z1 + 2.5, "detalhe", { fora: true }),
        );
      } else {
        const corte = A * (freezer === "embaixo" ? 0.38 : 0.7);
        pecas.push(
          cx(x0 + 0.3, x1 - 0.3, 3, corte - 0.5, z1 - ep, z1, "corpo"),
          cx(x0 + 0.3, x1 - 0.3, corte + 0.5, A - 0.3, z1 - ep, z1, "corpo"),
          cx(x0 + 2, x1 - 2, corte - 0.5, corte + 0.5, z1 - ep, z1 - 1.5, "painel"),
          // visor vertical na porta de cima
          cx(-3.2, 3.2, A * 0.75, A * 0.865, z1, z1 + 0.3, "painel", { fora: true }),
        );
      }
      return pecas;
    }
    case "forno":
      return [
        cx(x0, x1, 0, A, z0, z1 - 2, "corpo"),
        cx(x0 + 1, x1 - 1, 1, A * 0.78, z1 - 2, z1, "vidro"),
        cx(x0 + 1, x1 - 1, A * 0.8, A - 1, z1 - 2, z1, "painel"),
        cx(x0 + 6, x1 - 6, A * 0.72, A * 0.72 + 2, z1, z1 + 3, "detalhe", { fora: true }),
      ];
    case "cooktop": {
      const pecas: Peca[] = [cx(x0, x1, 0, A, z0, z1, "vidro")];
      [[-1, -1, 17], [-1, 1, 13], [1, -1, 13], [1, 1, 17]].forEach(([sx, sz, d]) => {
        pecas.push(cil(sx * L * 0.23, sz * P * 0.22, A, A + 0.25, d, d, "detalhe", { fora: true }));
      });
      return pecas;
    }
    case "fogao": {
      const pecas: Peca[] = [
        cx(x0, x1, 0, A - 3, z0, z1 - 2, "corpo"),
        cx(x0, x1, A - 3, A, z0, z1, "vidro"),
        cx(x0 + 3, x1 - 3, 12, A * 0.62, z1 - 2, z1, "vidro"),
        cx(x0 + 2, x1 - 2, A * 0.7, A - 5, z1 - 2, z1, "painel"),
        cx(x0 + 6, x1 - 6, A * 0.64, A * 0.64 + 2, z1, z1 + 3, "detalhe", { fora: true }),
      ];
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => pecas.push(cil(sx * L * 0.23, sz * P * 0.22, A, A + 1.2, 12, 12, "detalhe", { fora: true })));
      return pecas;
    }
    case "microondas":
      return [
        cx(x0, x1, 0, A, z0, z1 - 1.5, "corpo"),
        cx(x0 + 0.5, x0 + L * 0.74, 0.5, A - 0.5, z1 - 1.5, z1, "vidro"),
        cx(x0 + L * 0.75, x1 - 0.5, 0.5, A - 0.5, z1 - 1.5, z1, "painel"),
        cx(x0 + L * 0.69, x0 + L * 0.72, 3, A - 3, z1, z1 + 1.5, "detalhe", { fora: true }),
      ];
    case "lavaloucas":
      return [
        cx(x0, x1, 0, A, z0, z1 - 2, "corpo"),
        cx(x0 + 0.3, x1 - 0.3, 0.3, A * 0.82, z1 - 2, z1, "corpo"),
        cx(x0 + 0.3, x1 - 0.3, A * 0.83, A - 0.3, z1 - 2, z1, "painel"),
        cx(-L * 0.2, L * 0.2, A * 0.86, A * 0.93, z1, z1 + 0.6, "detalhe", { fora: true }),
        cx(x0 + 0.3, x1 - 0.3, A * 0.115, A * 0.127, z1, z1 + 0.2, "painel", { fora: true }),
      ];
    case "lavadora":
      return [
        cx(x0, x1, 0, A, z0, z1 - 1, "corpo"),
        cx(x0 + 1, x1 - 1, A * 0.87, A - 1, z1 - 1, z1, "painel"),
        cx(-L * 0.12, L * 0.12, A * 0.9, A * 0.955, z1, z1 + 0.2, "vidro", { fora: true }),
        { g: "cilindro", p: [0, A * 0.47, z1], s: [L * 0.78, 3, L * 0.78], r: [90, 0, 0], slot: "detalhe", fora: true },
        { g: "cilindro", p: [0, A * 0.47, z1 + 0.4], s: [L * 0.6, 3, L * 0.6], r: [90, 0, 0], slot: "vidro", fora: true },
        // gaveta do sabão em cima à esquerda e tampa redonda do filtro embaixo à direita
        cx(-L * 0.43, -L * 0.16, A * 0.895, A * 0.96, z1, z1 + 0.3, "detalhe", { fora: true }),
        { g: "cilindro", p: [L * 0.33, A * 0.1, z1 - 0.3], s: [L * 0.17, 1, L * 0.17], r: [90, 0, 0], slot: "detalhe", fora: true },
      ];
    case "ar":
      return [cx(x0, x1, 0, A, z0, z1, "corpo"), cx(x0 + 4, x1 - 4, 2, 5, z1, z1 + 0.3, "detalhe", { fora: true })];
    default:
      return [cx(x0, x1, 0, A, z0, z1, "corpo")];
  }
};

/** Cuba de embutir (pia, tanque, lavatório) com torneira. Fica sobre a bancada. */
const cuba: Forma = ({ L, P, A }, o) => {
  const pecas: Peca[] = o.oval
    ? [cil(0, 0, 0, 1, L, P, "cuba"), cil(0, 0, 1, 1.3, L * 0.8, P * 0.76, "fundo", { fora: true })]
    : [cx(-L / 2, L / 2, 0, 1, -P / 2, P / 2, "cuba"), cx(-L / 2 + 3, L / 2 - 3, 1, 1.3, -P / 2 + 3, P / 2 - 3, "fundo", { fora: true })];
  const torneira = typeof o.torneira === "string" ? o.torneira : "fundo";
  const h = Math.max(12, A - 2);
  if (torneira === "fundo") {
    const z = -P / 2 - 4;
    pecas.push(cil(0, z, 0, h, 2.6, 2.6, "metal", { fora: true }), cx(-1, 1, h - 2, h, z, z + Math.min(16, P * 0.45), "metal", { fora: true }));
  } else if (torneira === "lado") {
    const x = -L / 2 - 4;
    pecas.push(cil(x, 0, 0, h, 2.6, 2.6, "metal", { fora: true }), cx(x, x + Math.min(16, L * 0.4), h - 2, h, -1, 1, "metal", { fora: true }));
  }
  return pecas;
};

// ---------------------------------------------------------------------------------------------
// Banheiro
// ---------------------------------------------------------------------------------------------
const vasoSanitario: Forma = ({ L, P, A }) => {
  const zCaixa = -P / 2 + P * 0.27;
  const zc = (zCaixa + P / 2) / 2;
  return [
    cx(-L * 0.47, L * 0.47, 0, A, -P / 2, zCaixa, "louca"),
    cil(0, zc, 0, A * 0.5, L * 0.92, P * 0.73, "louca", { rb: 0.74 }),
    cil(0, zc, A * 0.5, A * 0.5 + 2.5, L * 0.95, P * 0.74, "louca"),
  ];
};

const box: Forma = ({ L, P, A }, o) => {
  const tipo = typeof o.tipo === "string" ? o.tipo : "frontal";
  const painelVidro = (x0: number, x1: number, z: number): Peca[] => [
    cx(x0, x1, 0, A - 3, z - 0.4, z + 0.4, "vidro"),
    cx(x0, x1, A - 3, A, z - 1.5, z + 1.5, "perfil"),
  ];
  if (tipo === "canto") {
    return [
      ...painelVidro(-L / 2, L / 2, P / 2 - 1.5),
      cx(L / 2 - 1.9, L / 2 - 1.1, 0, A - 3, -P / 2, P / 2 - 1.5, "vidro"),
      cx(L / 2 - 3, L / 2, A - 3, A, -P / 2, P / 2 - 1.5, "perfil"),
      cx(-L * 0.1 - 1, -L * 0.1 + 1, A * 0.48, A * 0.48 + 14, P / 2 - 1, P / 2 + 2.5, "detalhe", { fora: true }),
    ];
  }
  return [
    ...painelVidro(-L / 2, L / 2, 0),
    cx(-0.6, 0.6, 0, A - 3, -0.8, 0.8, "perfil"),
    cx(L * 0.08 - 1, L * 0.08 + 1, A * 0.48, A * 0.48 + 14, 0.4, 3.4, "detalhe", { fora: true }),
  ];
};

const chuveiro: Forma = ({ L, P, A }) => [
  { g: "cilindro", p: [0, A - 4, -P / 2 + P * 0.35], s: [2, P * 0.7, 2], r: [90, 0, 0], slot: "cromado" },
  cil(0, -P / 2 + P * 0.72, A - 9, A - 6, L, L, "cromado", { fora: true }),
  cil(0, -P / 2 + 1, 0, 2, 5, 5, "cromado", { r: [90, 0, 0], fora: true }),
];

const toalheiro: Forma = ({ L, P, A }) => [
  { g: "cilindro", p: [0, A / 2, P / 2 - 1.5], s: [1.8, L, 1.8], r: [0, 0, 90], slot: "cromado" },
  cx(-L / 2, -L / 2 + 2, A / 2 - 1.5, A / 2 + 1.5, -P / 2, P / 2 - 1, "cromado"),
  cx(L / 2 - 2, L / 2, A / 2 - 1.5, A / 2 + 1.5, -P / 2, P / 2 - 1, "cromado"),
];

// ---------------------------------------------------------------------------------------------
// Sala e decoração
// ---------------------------------------------------------------------------------------------
const tv: Forma = ({ L, P, A }) => [
  cx(-L / 2, L / 2, 0, A, -P / 2, P / 2 - 0.4, "corpo"),
  cx(-L / 2 + 1, L / 2 - 1, 1, A - 1, P / 2 - 0.4, P / 2, "tela"),
];

const cortina: Forma = ({ L, P, A }) => [
  { g: "onda", p: [0, (A - 3) / 2, 0], s: [L, A - 3, P], slot: "tecido" },
  cx(-L / 2, L / 2, A - 3, A, -1.5, 1.5, "trilho"),
];

const quadro: Forma = ({ L, P, A }) => [
  cx(-L / 2, L / 2, 0, A, -P / 2, P / 2 - 0.6, "moldura"),
  cx(-L / 2 + 2, L / 2 - 2, 2, A - 2, P / 2 - 0.6, P / 2, "arte", { tex: "arte" }),
];

const remo: Forma = ({ L, A }) => [{ g: "plano", p: [0, A / 2, 0], s: [L, A, 1], slot: "remo", tex: "remo" }];

const tapete: Forma = ({ L, P, A }, o) => [o.redondo ? cil(0, 0, 0, A, L, P, "tecido") : cx(-L / 2, L / 2, 0, A, -P / 2, P / 2, "tecido")];

const luminaria: Forma = ({ L, P, A }, o) => {
  const tipo = typeof o.tipo === "string" ? o.tipo : "piso";
  const d = Math.min(L, P);
  if (tipo === "pendente") {
    return [cil(0, 0, A * 0.35, A, 0.8, 0.8, "metal"), cil(0, 0, 0, A * 0.35, L, P, "detalhe", { rt: 0.4 })];
  }
  if (tipo === "abajur") {
    return [cil(0, 0, 0, A * 0.55, L * 0.35, P * 0.35, "detalhe"), cil(0, 0, A * 0.55, A, L, P, "tecido", { rt: 0.7 })];
  }
  return [
    cil(0, 0, 0, 2, d, d, "metal"),
    cil(0, 0, 2, A - 5, 2.4, 2.4, "metal"),
    cil(0, 0, A - 5, A, 6, 6, "detalhe"),
    { g: "cone", p: [d * 0.22, A - 13, d * 0.16], s: [d * 0.85, 20, d * 0.85], r: [0, 0, -28], slot: "metal", fora: true },
  ];
};

const planta: Forma = ({ L, P, A }) => [
  cil(0, 0, 0, A * 0.35, L * 0.6, P * 0.6, "vaso", { rb: 0.78 }),
  { g: "esfera", p: [0, A * 0.66, 0], s: [L, A * 0.68, P], slot: "folha" },
  { g: "esfera", p: [L * 0.16, A * 0.52, P * 0.12], s: [L * 0.62, A * 0.4, P * 0.62], slot: "folha" },
];

export const FORMAS: Record<string, Forma> = {
  armario,
  caixa,
  cilindro,
  painel,
  prateleira,
  sofa,
  mesa,
  cadeira,
  banqueta,
  cama,
  eletro,
  cuba,
  vaso: vasoSanitario,
  box,
  chuveiro,
  toalheiro,
  tv,
  cortina,
  quadro,
  remo,
  tapete,
  luminaria,
  planta,
};

export function pecasDoMovel(forma: string, d: Dim, o: Opcoes): Peca[] {
  const f = FORMAS[forma] ?? caixa;
  return f(d, o).filter((p) => p.s[0] > 0.01 && p.s[1] > 0.01 && (p.g === "plano" || p.s[2] > 0.01));
}
