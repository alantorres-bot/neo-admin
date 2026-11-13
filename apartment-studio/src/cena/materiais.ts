/**
 * Materiais e texturas procedurais (sem arquivos de imagem): madeira com veio, granilite, granito,
 * palhinha, a arte do quadro e os remos. Materiais são compartilhados por (acabamento, cor, escala).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Acabamento, Peca } from "../catalogo/formas";

/** Gerador pseudoaleatório determinístico: a mesma textura em toda abertura do app. */
function semente(n: number) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexParaRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

const tom = (hex: string, fator: number, alfa = 1) => {
  const [r, g, b] = hexParaRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * fator)));
  return `rgba(${f(r)},${f(g)},${f(b)},${alfa})`;
};

const texturas = new Map<string, THREE.CanvasTexture>();

function textura(chave: string, w: number, h: number, desenhar: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  let t = texturas.get(chave);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    desenhar(c.getContext("2d")!, w, h);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    texturas.set(chave, t);
  }
  return t;
}

function texMadeira(cor: string) {
  return textura(`madeira|${cor}`, 512, 512, (g, w, h) => {
    const rnd = semente(7);
    g.fillStyle = cor;
    g.fillRect(0, 0, w, h);
    // faixas largas e suaves de variação de tom
    for (let i = 0; i < 12; i++) {
      g.fillStyle = tom(cor, rnd() > 0.5 ? 1.06 : 0.93, 0.1);
      const x = rnd() * w;
      g.fillRect(x, 0, 8 + rnd() * 30, h);
    }
    // veios finos, quase retos
    for (let i = 0; i < 150; i++) {
      g.strokeStyle = tom(cor, 0.7 + rnd() * 0.2, 0.06 + rnd() * 0.1);
      g.lineWidth = 0.4 + rnd() * 1.1;
      g.beginPath();
      let x = rnd() * w;
      g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 32) {
        x += (rnd() - 0.5) * 2.2;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function texSalpicado(cor: string, tipo: "granilite" | "granito") {
  return textura(`${tipo}|${cor}`, 256, 256, (g, w, h) => {
    const rnd = semente(tipo === "granito" ? 31 : 13);
    g.fillStyle = cor;
    g.fillRect(0, 0, w, h);
    const tons = tipo === "granito" ? ["#2b2a29", "#a9a49e", "#4a4846", "#d2cdc6", "#8a8580"] : ["#8d8a85", "#b9b4ad", "#6d6a66", "#cfcac2"];
    const n = tipo === "granito" ? 2600 : 420;
    for (let i = 0; i < n; i++) {
      g.fillStyle = tons[i % tons.length];
      const r = rnd() * (tipo === "granito" ? 1.6 : 1.2) + 0.3;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, r, 0, 7);
      g.fill();
    }
  });
}

function texPalhinha(cor: string) {
  return textura(`palhinha|${cor}`, 128, 128, (g, w, h) => {
    g.fillStyle = cor;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(60,40,20,.55)";
    for (let y = 0; y < h; y += 8) {
      for (let x = ((y / 8) % 2) * 4; x < w; x += 8) {
        g.beginPath();
        g.arc(x, y, 2.4, 0, 7);
        g.fill();
      }
    }
  });
}

/** Arte geométrica do quadro do Alan: bege com blocos vermelho e azul-marinho. */
function texArte() {
  const t = textura("arte", 180, 240, (g, w, h) => {
    g.fillStyle = "#b9a583";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#b5442f";
    g.fillRect(0, 0, w * 0.38, h * 0.5);
    g.fillStyle = "#1c2444";
    g.fillRect(w * 0.38, 0, w * 0.62, h * 0.5);
    g.fillStyle = "#b9a583";
    g.fillRect(w * 0.38, h * 0.42, w * 0.4, h * 0.1);
    g.fillRect(w * 0.8, h * 0.36, w * 0.2, h * 0.14);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Remo decorativo: cabo e pá em madeira clara, punho laranja, faixas azul, branca e laranja. */
function texRemo() {
  const t = textura("remo", 128, 640, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    g.fillStyle = "#e0b676";
    g.fillRect(cx - 9, 70, 18, 270);
    g.fillStyle = "#e8551f";
    g.beginPath();
    g.moveTo(cx - 34, 6);
    g.lineTo(cx + 34, 6);
    g.lineTo(cx + 30, 40);
    g.lineTo(cx + 10, 95);
    g.lineTo(cx - 10, 95);
    g.lineTo(cx - 30, 40);
    g.closePath();
    g.fill();
    g.save();
    g.beginPath();
    g.moveTo(cx - 9, 320);
    g.quadraticCurveTo(cx - 52, 380, cx - 54, 440);
    g.lineTo(cx - 54, 620);
    g.quadraticCurveTo(cx - 54, 634, cx - 40, 634);
    g.lineTo(cx + 40, 634);
    g.quadraticCurveTo(cx + 54, 634, cx + 54, 620);
    g.lineTo(cx + 54, 440);
    g.quadraticCurveTo(cx + 52, 380, cx + 9, 320);
    g.closePath();
    g.clip();
    g.fillStyle = "#e0b676";
    g.fillRect(0, 300, w, 340);
    g.fillStyle = "#2f4a6b";
    g.fillRect(0, 300, w, 135);
    g.fillRect(0, 604, w, 40);
    g.fillStyle = "#f3efe6";
    g.fillRect(0, 430, w, 80);
    g.fillStyle = "#e8551f";
    [556, 572, 588].forEach((y) => g.fillRect(0, y, w, 9));
    g.fillStyle = "#e0b676";
    g.beginPath();
    g.moveTo(cx, 440);
    g.lineTo(cx + 30, 470);
    g.lineTo(cx, 500);
    g.lineTo(cx - 30, 470);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = "#e0b676";
    g.fillRect(cx - 3, 300, 6, 150);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Relevo do veio da madeira (tons de cinza): sulcos finos ao longo do veio, igual para todas as cores. */
function relevoMadeira() {
  return textura("madeira-relevo", 512, 512, (g, w, h) => {
    const rnd = semente(7);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const v = rnd() > 0.5 ? 40 : 200;
      g.strokeStyle = `rgba(${v},${v},${v},${0.1 + rnd() * 0.25})`;
      g.lineWidth = 0.5 + rnd() * 1.4;
      g.beginPath();
      let x = rnd() * w;
      g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 32) {
        x += (rnd() - 0.5) * 2.2;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Relevo de tecido: trama fina de fios cruzados. */
function relevoTecido() {
  return textura("tecido-relevo", 128, 128, (g, w, h) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const claro = (x / 4 + y / 4) % 2 === 0;
        g.fillStyle = claro ? "#a8a8a8" : "#5c5c5c";
        g.fillRect(x, y, claro ? 4 : 3, claro ? 3 : 4);
      }
    }
  });
}

/** Tamanho real (cm) de um ladrilho de cada textura. */
const ESCALA: Partial<Record<Acabamento, number>> = { madeira: 110, granilite: 70, granito: 45, palhinha: 14, tecido: 9 };

/** Repetição da textura para a face dominante da peça: [u, v, girar 90°]. */
function repeticao(peca: Peca, acab: Acabamento): [number, number, boolean] {
  const esc = ESCALA[acab];
  if (!esc || peca.g !== "caixa") return [1, 1, false];
  const [sx, sy, sz] = peca.s;
  let u: number;
  let v: number;
  let girar = false;
  if (sx <= sy && sx <= sz) {
    u = sz;
    v = sy;
  } else if (sy <= sx && sy <= sz) {
    u = sx;
    v = sz;
    girar = acab === "madeira" && sx > sz; // veio ao longo do comprimento em tampos e prateleiras
  } else {
    u = sx;
    v = sy;
    girar = acab === "madeira" && sx > sy * 1.6; // frentes de gaveta: veio horizontal
  }
  const q = (n: number) => Math.max(0.25, Math.round((n / esc) * 4) / 4);
  return girar ? [q(v), q(u), true] : [q(u), q(v), false];
}

const materiais = new Map<string, THREE.Material>();

export function materialDaPeca(peca: Peca, cor: string, acab: Acabamento, aceso = true): THREE.Material {
  // difusor de LED apagado: branco fosco, sem brilho próprio
  if (acab === "led" && !aceso) return unico("led-apagado", () => new THREE.MeshStandardMaterial({ color: "#e9e6df", roughness: 0.6 }));
  if (peca.tex === "arte") return unico("tex-arte", () => new THREE.MeshStandardMaterial({ map: texArte(), roughness: 0.9 }));
  if (peca.tex === "remo") {
    return unico("tex-remo", () => new THREE.MeshStandardMaterial({ map: texRemo(), transparent: true, alphaTest: 0.5, roughness: 0.8, side: THREE.DoubleSide }));
  }
  const [ru, rv, girar] = repeticao(peca, acab);
  // cortina e cúpula são superfícies abertas: visíveis dos dois lados
  const duasFaces = peca.g === "onda" || peca.g === "cone";
  const chave = `${acab}|${cor}|${ru}|${rv}|${girar ? 1 : 0}|${duasFaces ? 2 : 1}`;
  return unico(chave, () => {
    const m = criar(cor, acab, ru, rv, girar, peca.g === "onda");
    if (duasFaces) m.side = THREE.DoubleSide;
    return m;
  });
}

function unico(chave: string, fabrica: () => THREE.Material): THREE.Material {
  let m = materiais.get(chave);
  if (!m) {
    m = fabrica();
    materiais.set(chave, m);
  }
  return m;
}

function comMapa(base: THREE.CanvasTexture, ru: number, rv: number, girar: boolean): THREE.Texture {
  const t = base.clone();
  t.needsUpdate = true;
  t.repeat.set(ru, rv);
  if (girar) {
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
  }
  return t;
}

/** Cortinas acesas pela claridade de fora: materiais que ganham um brilho próprio de dia (ver luzDoDiaNosTecidos). */
const cortinas = new Set<THREE.MeshStandardMaterial>();
let claridade = 1;

/** Chamado pela cena quando a hora muda: de dia a cortina deixa a luz atravessar; à noite, não. */
export function luzDoDiaNosTecidos(dia: number) {
  claridade = dia;
  for (const m of cortinas) m.emissiveIntensity = 0.3 * dia;
}

function criar(cor: string, acab: Acabamento, ru: number, rv: number, girar: boolean, cortina = false): THREE.Material {
  const P = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  switch (acab) {
    case "madeira":
      return P({ map: comMapa(texMadeira(cor), ru, rv, girar), bumpMap: comMapa(relevoMadeira(), ru, rv, girar), bumpScale: 0.7, roughness: 0.58 });
    case "granilite":
      return P({ map: comMapa(texSalpicado(cor, "granilite"), ru, rv, girar), roughness: 0.5 });
    case "granito":
      return P({ map: comMapa(texSalpicado(cor, "granito"), ru, rv, girar), roughness: 0.2, envMapIntensity: 1.3 });
    case "palhinha":
      return P({ map: comMapa(texPalhinha(cor), ru, rv, girar), roughness: 0.8 });
    case "pedra":
      // quartzo ou porcelanato polido
      return P({ color: cor, roughness: 0.18, envMapIntensity: 1.3 });
    case "fosco":
      // laca fosca / MDF: quase sem brilho, mas não chapado
      return P({ color: cor, roughness: 0.72 });
    case "tecido": {
      if (cortina) {
        const m = P({ color: cor, roughness: 1, emissive: cor, emissiveIntensity: 0.3 * claridade });
        cortinas.add(m);
        return m;
      }
      // estofado: brilho aveludado nas bordas e trama em relevo
      const comTrama = ru !== 1 || rv !== 1;
      return new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: 0.95,
        sheen: 0.55,
        sheenRoughness: 0.7,
        sheenColor: new THREE.Color(cor).lerp(new THREE.Color("#ffffff"), 0.5),
        ...(comTrama ? { bumpMap: comMapa(relevoTecido(), ru, rv, false), bumpScale: 0.6 } : {}),
      });
    }
    case "inox":
      // escovado: parte da luz espalha (não é espelho), senão a geladeira fica escura dentro de casa
      return P({ color: cor, roughness: 0.36, metalness: 0.6, envMapIntensity: 2.2 });
    case "metal":
      return P({ color: cor, roughness: 0.45, metalness: 0.6, envMapIntensity: 1.3 });
    case "cromado":
      return P({ color: cor, roughness: 0.12, metalness: 1, envMapIntensity: 1.8 });
    case "louca":
      return P({ color: cor, roughness: 0.12, envMapIntensity: 1.3 });
    case "vidro-preto":
      return P({ color: cor, roughness: 0.06, metalness: 0.5, envMapIntensity: 1.5 });
    case "espelho":
      return P({ color: cor, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 });
    case "led":
      return P({ color: cor, emissive: cor, emissiveIntensity: 2.4 });
    case "vidro":
      return new THREE.MeshPhysicalMaterial({ color: cor, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide });
    default:
      return P({ color: cor, roughness: 0.55 });
  }
}

// ------------------------------------------------------------------------------------ paredes

/** Textura de revestimento de parede; as faces usam coordenadas em metros, então `repeat` = 1 / tamanho real. */
function texRevestimento(tipo: "azulejo" | "cimento" | "tijolinho", cor: string): THREE.Texture {
  if (tipo === "azulejo") {
    // 2 × 4 peças de 60 × 30 cm, quase brancas, com junta fina: a cor do material tinge
    const t = textura("azulejo", 512, 512, (g, w, h) => {
      const rnd = semente(5);
      const lw = w / 2;
      const lh = h / 4;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 4; j++) {
          const v = 246 + Math.round(rnd() * 8);
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(i * lw, j * lh, lw, lh);
        }
      }
      g.strokeStyle = "rgba(120,120,120,0.55)";
      g.lineWidth = 2;
      for (let i = 0; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * lw, 0);
        g.lineTo(i * lw, h);
        g.stroke();
      }
      for (let j = 0; j <= 4; j++) {
        g.beginPath();
        g.moveTo(0, j * lh);
        g.lineTo(w, j * lh);
        g.stroke();
      }
    });
    t.repeat.set(1 / 1.2, 1 / 1.2);
    return t;
  }
  if (tipo === "cimento") {
    // cimento queimado: manchas largas e suaves, 2 × 2 m
    const t = textura("cimento", 512, 512, (g, w, h) => {
      const rnd = semente(23);
      g.fillStyle = "#f2f2f2";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = 20 + rnd() * 90;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const v = rnd() > 0.5 ? 255 : 150;
        grad.addColorStop(0, `rgba(${v},${v},${v},${0.05 + rnd() * 0.07})`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    t.repeat.set(1 / 2, 1 / 2);
    return t;
  }
  // tijolinho: 4 tijolos de 22 × 6,5 cm por fiada, 8 fiadas, junta de 1 cm (92 × 60 cm), já na cor escolhida
  const t = textura(`tijolinho|${cor}`, 736, 480, (g, w, h) => {
    const rnd = semente(47);
    g.fillStyle = tom(cor, 0.62);
    g.fillRect(0, 0, w, h);
    const bw = w / 4;
    const bh = h / 8;
    const junta = 8;
    for (let j = 0; j < 8; j++) {
      const desloc = j % 2 ? bw / 2 : 0;
      for (let i = -1; i < 5; i++) {
        g.fillStyle = tom(cor, 0.86 + rnd() * 0.28);
        g.fillRect(i * bw + desloc + junta / 2, j * bh + junta / 2, bw - junta, bh - junta);
      }
    }
  });
  t.repeat.set(1 / 0.92, 1 / 0.6);
  return t;
}

const COR_TOPO_PAREDE = "#4b4e53";

/**
 * Material de um grupo de faces de parede (ver geometriaParede.ts): "topo", "rodape" ou "revestimento|#cor".
 * `modo`: "planta" pinta tudo de escuro (desenho técnico); "selecionada" realça a parede sem esconder a cor dela.
 */
export function materialDaParede(chave: string, modo: "normal" | "planta" | "selecionada" = "normal", corPlanta = COR_TOPO_PAREDE): THREE.Material {
  const P = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  if (chave === "topo") return unico("parede|topo", () => P({ color: COR_TOPO_PAREDE, roughness: 0.9 }));
  if (modo === "planta") return unico(`parede|planta|${corPlanta}`, () => P({ color: corPlanta, roughness: 0.92 }));
  // selecionada: a mesma pintura com um realce azulado por cima — a cor que está sendo escolhida continua à vista
  if (modo === "selecionada") {
    return unico(`parede|selecionada|${chave}`, () => {
      const m = (materialDaParede(chave) as THREE.MeshStandardMaterial).clone();
      m.emissive = new THREE.Color("#5b9dff");
      m.emissiveIntensity = 0.22;
      return m;
    });
  }
  if (chave === "rodape") return unico("parede|rodape", () => P({ color: "#f6f4ef", roughness: 0.45 }));
  const [revestimento, cor] = chave.split("|");
  return unico(`parede|${chave}`, () => {
    switch (revestimento) {
      case "azulejo":
        return P({ color: cor, map: texRevestimento("azulejo", cor), roughness: 0.2 });
      case "cimento":
        return P({ color: cor, map: texRevestimento("cimento", cor), roughness: 0.82 });
      case "tijolinho":
        return P({ map: texRevestimento("tijolinho", cor), roughness: 0.9 });
      default:
        // tinta de parede: fosca
        return P({ color: cor, roughness: 0.9 });
    }
  });
}

// ---------------------------------------------------------------------------------- geometrias
const caixaUnit = new THREE.BoxGeometry(1, 1, 1);
const esferaUnit = new THREE.SphereGeometry(0.5, 24, 16);
const coneUnit = new THREE.ConeGeometry(0.5, 1, 28, 1, true);
const planoUnit = new THREE.PlaneGeometry(1, 1);
const cilindros = new Map<string, THREE.CylinderGeometry>();
const ondas = new Map<number, THREE.PlaneGeometry>();
const arredondadas = new Map<string, THREE.BufferGeometry>();

/** Caixa arredondada em metros reais (não dá para escalar a unitária: o raio deformaria). */
function caixaArredondada(peca: Peca): THREE.BufferGeometry {
  const [sx, sy, sz] = peca.s.map((v) => Math.round(v * 2) / 2);
  const raio = Math.min(peca.arred ?? 0, sx / 2 - 0.1, sy / 2 - 0.1, sz / 2 - 0.1);
  const chave = `${sx}|${sy}|${sz}|${raio}`;
  let g = arredondadas.get(chave);
  if (!g) {
    g = new RoundedBoxGeometry(sx / 100, sy / 100, sz / 100, 4, raio / 100);
    arredondadas.set(chave, g);
  }
  return g;
}

/** Peças com geometria em tamanho real não recebem escala na cena. */
export function tamanhoReal(peca: Peca): boolean {
  return peca.g === "caixa" && (peca.arred ?? 0) > 0.4 && Math.min(...peca.s) > 1.2;
}

export function geometriaDaPeca(peca: Peca): THREE.BufferGeometry {
  switch (peca.g) {
    case "cilindro": {
      const rt = peca.rt ?? 1;
      const rb = peca.rb ?? 1;
      const chave = `${rt}|${rb}`;
      let g = cilindros.get(chave);
      if (!g) {
        g = new THREE.CylinderGeometry(0.5 * rt, 0.5 * rb, 1, 32);
        cilindros.set(chave, g);
      }
      return g;
    }
    case "esfera":
      return esferaUnit;
    case "cone":
      return coneUnit;
    case "plano":
      return planoUnit;
    case "onda": {
      // cortina: uma dobra a cada ≈ 11 cm de largura
      const n = Math.max(4, Math.round(peca.s[0] / 11));
      let g = ondas.get(n);
      if (!g) {
        g = new THREE.PlaneGeometry(1, 1, n * 8, 1);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * n * Math.PI * 2) * 0.5);
        g.computeVertexNormals();
        ondas.set(n, g);
      }
      return g;
    }
    default:
      return tamanhoReal(peca) ? caixaArredondada(peca) : caixaUnit;
  }
}
