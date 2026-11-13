/**
 * Cozinha: módulos executivos derivados do modelo 3D (src/modelo/mobilia.ts).
 * Envoltórias (largura, altura, profundidade, posição) vêm do 3D; o interior é proposta técnica.
 */
import type { Projeto } from "../modelo/tipos";
import { CAVA, ESP, FOLGA, RECUO_RODAPE, caixa, dobradicasPorAltura, frente, gaveta, prateleira, solido } from "./construtor";
import { caixaDoMovel, converter, movelDoProjeto } from "./quadros";
import type { Caixa3, Modulo, Quadro, Solido } from "./tipos";

/** Alturas das frentes de gaveta empilhadas, de cima para baixo, na mesma proporção do 3D (a de baixo é a mais alta). */
export function alturasDasGavetas(n: number, alturaUtil: number): number[] {
  const pesos = Array.from({ length: n }, (_, i) => 1 + 0.22 * i);
  const total = pesos.reduce((a, b) => a + b, 0);
  const disponivel = alturaUtil - (n - 1) * FOLGA;
  const alturas = pesos.map((p) => Math.round((disponivel * p) / total));
  alturas[n - 1] += disponivel - alturas.reduce((a, b) => a + b, 0);
  return alturas;
}

const m = (v: number) => Math.round(v * 1000) / 1000;
/** Número para texto corrido (vírgula decimal). */
const t = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

export interface Conjunto {
  modulos: Modulo[];
  /** Sólidos de contexto (aparelhos, pedras, paredes), por quadro. */
  contexto: Record<string, Solido[]>;
}

export function criarCozinha(projeto: Projeto, qa: Quadro, qb: Quadro): Conjunto {
  const cxA = (id: string) => caixaDoMovel(movelDoProjeto(projeto, id), qa);
  const cxB = (id: string) => caixaDoMovel(movelDoProjeto(projeto, id), qb);
  const opc = (id: string, chave: string) => Number(movelDoProjeto(projeto, id).opcoes?.[chave] ?? 0);
  const pd = projeto.planta.peDireito.valor * 10;
  const modulos: Modulo[] = [];

  // ------------------------------------------------------------------ M1 — gaveteiro
  {
    const b = cxA("coz-gaveteiro");
    const rod = opc("coz-gaveteiro", "rodape") * 10;
    const corpo = { ...b, z0: b.z0 + rod };
    const { solidos, vao } = caixa({ c: corpo, frente: true, tampo: "travessas" });
    const alturas = alturasDasGavetas(opc("coz-gaveteiro", "gavetas"), corpo.z1 - corpo.z0 - 2 * FOLGA);
    const caixas = [120, 180, 220];
    let topo = corpo.z1 - FOLGA;
    alturas.forEach((h, i) => {
      const z0 = topo - h;
      solidos.push(...frente({ nome: `Frente da gaveta ${i + 1}`, classe: "frente-gaveta", s0: b.s0, s1: b.s1, z0, z1: topo, d1: b.d1, padrao: "verde", cava: true }));
      solidos.push(...gaveta({ nome: `Gaveta ${i + 1}`, s0: vao.s0, s1: vao.s1, d1: vao.d1, comp: 500, z0: z0 + 20, h: caixas[i] ?? 180 }));
      topo = z0 - FOLGA;
    });
    modulos.push({
      cod: "M1",
      nome: "Gaveteiro do canto",
      lote: "A1",
      conjunto: qa.id,
      movelIds: ["coz-gaveteiro"],
      caixa: b,
      externo: "3 gavetas verde sálvia com puxador cava no topo de cada frente; a de baixo é a mais alta (proporção do 3D).",
      interno: "Gaveta 1 (talheres, caixa de 120 mm) e 2 gavetões (caixas de 180 e 220 mm), corrediças telescópicas de 500 mm.",
      abertura: "Gavetas com corrediça telescópica de extração total e amortecimento; puxador cava.",
      solidos,
      ferragens: [
        { item: "cor-500", qtd: 3, obs: "gavetões: carga ≥ 45 kg" },
        { item: "cava", qtd: m((3 * (b.s1 - b.s0 - FOLGA)) / 1000) },
        { item: "pe-100", qtd: 4 },
        { item: "org-talheres", qtd: 1, obs: "opcional — cotar à parte" },
      ],
      notas: [
        "Encosta no shaft (medida estimada) — o comprimento exato do módulo se ajusta na medição.",
        "As frentes correm rente à porta do módulo do tanque (T1): ver detalhe do canto na prancha C-05.",
      ],
    });
  }

  // ------------------------------------------------------------------ M2 — forno e cooktop
  {
    const b = cxA("coz-base-forno");
    const forno = cxA("coz-forno");
    const corpo = { ...b, z0: b.z0 + opc("coz-base-forno", "rodape") * 10 };
    const { solidos, vao } = caixa({ c: corpo, frente: true, base: false, tampo: "travessas-pe", fundo: false });
    solidos.push(
      solido("Base de apoio do forno", "base", "branco", { s0: vao.s0, s1: vao.s1, d0: vao.d0, d1: vao.d1, z0: forno.z0 - ESP.frente, z1: forno.z0 }, { obs: "18 mm; recebe o peso do forno" }),
      ...frente({ nome: "Régua inferior fixa", classe: "frente-fixa", s0: b.s0, s1: b.s1, z0: corpo.z0 + FOLGA, z1: forno.z0 - FOLGA, d1: b.d1, padrao: "verde" }),
      ...frente({ nome: "Frente fixa superior (sob o cooktop)", classe: "frente-fixa", s0: b.s0, s1: b.s1, z0: forno.z1 + FOLGA, z1: corpo.z1 - FOLGA, d1: b.d1, padrao: "verde", cava: true }),
    );
    modulos.push({
      cod: "M2",
      nome: "Módulo do forno e cooktop",
      lote: "A1",
      conjunto: qa.id,
      movelIds: ["coz-base-forno"],
      caixa: b,
      externo: "Forno de embutir à vista; régua fixa de 54 mm embaixo e frente fixa de 114 mm em cima (com a linha do cava alinhada aos vizinhos).",
      interno: `Nicho do forno: ${vao.s1 - vao.s0} L × ${forno.z1 - forno.z0} A × ${vao.d1 - vao.d0} P, sem fundo (ventilação e tomada). Sob o tampo, só travessas em pé: o corpo do cooktop ocupa esse espaço.`,
      abertura: "Sem portas (frentes fixas).",
      solidos,
      ferragens: [
        { item: "cava", qtd: m((b.s1 - b.s0 - FOLGA) / 1000), obs: "decorativo, alinhado aos vizinhos" },
        { item: "pe-100", qtd: 4 },
      ],
      notas: [
        "Medidas do nicho pelo padrão de forno de embutir de 60 cm — forno e cooktop ainda não definidos: conferir os dois manuais antes de cortar.",
        "Tomada do forno fora da área do nicho (módulo vizinho ou abaixo), conforme o manual.",
      ],
    });
  }

  // ------------------------------------------------------------------ M3 — lava-louças compacta
  {
    const b = cxA("coz-base-lavaloucas");
    const lv = cxA("coz-lavaloucas");
    const corpo = { ...b, z0: b.z0 + opc("coz-base-lavaloucas", "rodape") * 10 };
    const { solidos, vao } = caixa({ c: corpo, frente: true, latS0: "verde", latS1: "verde", tampo: "tras-pe", obsFundo: "recortes para mangueiras e tomada" });
    const zGaveta = corpo.z0 + FOLGA;
    solidos.push(
      solido("Prateleira de apoio da lava-louças", "prateleira", "verde", { s0: vao.s0, s1: vao.s1, d0: vao.d0, d1: vao.d1, z0: lv.z0 - ESP.frente, z1: lv.z0 }, { obs: "18 mm, fixa; aparelho ≈ 30 kg" }),
      ...frente({ nome: "Frente da gaveta inferior", classe: "frente-gaveta", s0: b.s0, s1: b.s1, z0: zGaveta, z1: lv.z0 - FOLGA, d1: b.d1, padrao: "verde", obs: "lisa, abertura por toque" }),
      ...gaveta({ nome: "Gaveta inferior", s0: vao.s0, s1: vao.s1, d1: vao.d1, comp: 500, z0: zGaveta + 20, h: 100 }),
      solido("Perfil de arremate sobre a lava-louças", "perfil", undefined, { s0: b.s0 + FOLGA / 2, s1: b.s1 - FOLGA / 2, d0: b.d1 - ESP.frente, d1: b.d1 - ESP.frente + 6, z0: lv.z1, z1: corpo.z1 - FOLGA }, { cor: "#3a4233" }),
    );
    modulos.push({
      cod: "M3",
      nome: "Módulo da lava-louças compacta",
      lote: "A1",
      conjunto: qa.id,
      movelIds: ["coz-base-lavaloucas"],
      caixa: b,
      externo: "Lava-louças à vista em nicho elevado; gaveta baixa embaixo (frente lisa de 154 mm, como no 3D).",
      interno: `Nicho: ${vao.s1 - vao.s0} L × ${lv.z1 - lv.z0} A × ${vao.d1 - vao.d0} P, laterais internas verdes (ficam à vista ao redor do aparelho). Gaveta inferior com caixa de 100 mm.`,
      abertura: "Gaveta com corrediça telescópica e abertura por toque (sem puxador, como no 3D).",
      solidos,
      ferragens: [
        { item: "cor-500-toque", qtd: 1 },
        { item: "pe-100", qtd: 4 },
      ],
      notas: [
        `Altura livre do nicho = ${lv.z1 - lv.z0} mm, igual à altura típica do aparelho (folga zero): conferir o modelo; se preciso, reduzir a gaveta de baixo.`,
        "Água, esgoto e tomada pelo módulo da pia (M4): prever furos de passagem na lateral.",
        "Alternativa para a gaveta: puxador cava como nas demais frentes (muda levemente o visual — depende de autorização).",
      ],
    });
  }

  // ------------------------------------------------------------------ M4 — pia
  {
    const b = cxA("coz-base-pia");
    const corpo = { ...b, z0: b.z0 + opc("coz-base-pia", "rodape") * 10 };
    const { solidos } = caixa({ c: corpo, frente: true, tampo: "travessas-pe", obsFundo: "recortes para água e esgoto" });
    const meio = (b.s0 + b.s1) / 2;
    const z0 = corpo.z0 + FOLGA;
    const z1 = corpo.z1 - FOLGA;
    solidos.push(
      ...frente({ nome: "Porta", s0: b.s0, s1: meio, z0, z1, d1: b.d1, padrao: "verde", cava: true, dobr: "s0" }),
      ...frente({ nome: "Porta", s0: meio, s1: b.s1, z0, z1, d1: b.d1, padrao: "verde", cava: true, dobr: "s1" }),
    );
    modulos.push({
      cod: "M4",
      nome: "Armário da pia",
      lote: "A1",
      conjunto: qa.id,
      movelIds: ["coz-base-pia"],
      caixa: b,
      externo: "2 portas verde sálvia com puxador cava.",
      interno: "Vão livre para sifão, registro e lixeira; sem prateleira. Travessas superiores em pé (a cuba ocupa o espaço sob o tampo). Base com proteção contra umidade.",
      abertura: "Portas de giro abrindo do centro; dobradiças retas com amortecimento.",
      solidos,
      ferragens: [
        { item: "dob-reta", qtd: 2 * dobradicasPorAltura(z1 - z0) },
        { item: "cava", qtd: m((b.s1 - b.s0 - 2 * FOLGA) / 1000) },
        { item: "pe-100", qtd: 4 },
        { item: "protetor-pia", qtd: 1 },
      ],
      notas: ["Posição dos pontos de água e esgoto não consta na planta: levantar no local antes de recortar o fundo."],
    });
  }

  // ------------------------------------------------------------------ M5 — armário de 1 porta
  {
    const b = cxA("coz-base-porta");
    const corpo = { ...b, z0: b.z0 + opc("coz-base-porta", "rodape") * 10 };
    const { solidos, vao } = caixa({ c: corpo, frente: true, tampo: "travessas" });
    const z0 = corpo.z0 + FOLGA;
    const z1 = corpo.z1 - FOLGA;
    solidos.push(prateleira("Prateleira regulável", vao, 470), ...frente({ nome: "Porta", s0: b.s0, s1: b.s1, z0, z1, d1: b.d1, padrao: "verde", cava: true, dobr: "s1" }));
    modulos.push({
      cod: "M5",
      nome: "Armário de 1 porta",
      lote: "A1",
      conjunto: qa.id,
      movelIds: ["coz-base-porta"],
      caixa: b,
      externo: "1 porta verde sálvia com puxador cava.",
      interno: "1 prateleira regulável (furação para 3 posições).",
      abertura: "Porta de giro com dobradiças do lado do painel da geladeira; amortecimento.",
      solidos,
      ferragens: [
        { item: "dob-reta", qtd: dobradicasPorAltura(z1 - z0) },
        { item: "cava", qtd: m((b.s1 - b.s0 - FOLGA) / 1000) },
        { item: "pe-100", qtd: 4 },
        { item: "sup-prat", qtd: 4 },
      ],
      notas: [],
    });
  }

  // ------------------------------------------------------------------ RA — rodapé da parede A
  {
    const ini = cxA("coz-gaveteiro");
    const fim = cxA("coz-base-porta");
    const rod = opc("coz-gaveteiro", "rodape") * 10;
    const meio = (ini.s0 + fim.s1) / 2;
    const d1 = ini.d1 - RECUO_RODAPE;
    const peca = (s0: number, s1: number) => solido("Rodapé (saia)", "rodape", "verde", { s0, s1, d0: d1 - ESP.frente, d1, z0: 0, z1: rod }, { obs: "removível, preso por clipes aos pés" });
    modulos.push({
      cod: "RA",
      nome: "Rodapé da bancada (parede A)",
      lote: "A1",
      conjunto: qa.id,
      movelIds: [],
      caixa: { s0: ini.s0, s1: fim.s1, d0: d1 - ESP.frente, d1, z0: 0, z1: rod },
      externo: `Rodapé recuado ${RECUO_RODAPE} mm do plano das frentes, altura ${rod} mm, do canto ao painel da geladeira.`,
      interno: "—",
      abertura: "Removível (clipes), para acesso aos pés reguláveis.",
      solidos: [peca(ini.s0, meio), peca(meio, fim.s1)],
      ferragens: [],
      notas: ["No 3D o rodapé aparece em verde mais fechado que as frentes. Para orçamento: mesmo padrão verde das frentes — confirmar se prefere tom mais escuro."],
    });
  }

  // ------------------------------------------------------------------ PG — painel da torre da geladeira
  {
    const b = cxA("coz-painel-geladeira");
    modulos.push({
      cod: "PG",
      nome: "Painel lateral da torre da geladeira",
      lote: "A2",
      conjunto: qa.id,
      movelIds: ["coz-painel-geladeira"],
      caixa: b,
      externo: `Painel off-white de ${b.s1 - b.s0} mm (engrossado), do piso ao teto, ${b.d1 - b.d0} mm de profundidade.`,
      interno: "—",
      abertura: "—",
      solidos: [solido("Painel lateral (engrossado 30 mm)", "painel", "offwhite", b, { chapas: 2, fita: { z: 1 }, obs: "2 chapas de 15 mm coladas; 2 faces aparentes" })],
      ferragens: [{ item: "fix-painel", qtd: 1 }],
      notas: [`Altura = pé-direito (${pd} mm, estimado): cortar na medida real, com folga de montagem.`, "A bancada, o frontão e os aéreos morrem neste painel."],
    });
  }

  // ------------------------------------------------------------------ AG — aéreo sobre a geladeira
  {
    const b = cxA("coz-aereo-geladeira");
    const { solidos, vao } = caixa({ c: b, frente: true, base: { padrao: "offwhite" }, tampo: "painel" });
    const meio = (b.s0 + b.s1) / 2;
    const z0 = b.z0 + FOLGA;
    const z1 = b.z1 - FOLGA;
    solidos.push(
      prateleira("Prateleira regulável", vao, Math.round((vao.z0 + vao.z1) / 2 - ESP.caixa / 2)),
      ...frente({ nome: "Porta", s0: b.s0, s1: meio, z0, z1, d1: b.d1, padrao: "offwhite", dobr: "s0" }),
      ...frente({ nome: "Porta", s0: meio, s1: b.s1, z0, z1, d1: b.d1, padrao: "offwhite", dobr: "s1" }),
    );
    modulos.push({
      cod: "AG",
      nome: "Armário sobre a geladeira",
      lote: "A2",
      conjunto: qa.id,
      movelIds: ["coz-aereo-geladeira"],
      caixa: b,
      externo: "2 portas off-white lisas, sem puxador, até o teto.",
      interno: "1 prateleira regulável. Base aparente (vista por baixo, acima da geladeira) em off-white.",
      abertura: "Portas de giro abrindo do centro, com fecho toque (dobradiças sem amortecedor).",
      solidos,
      ferragens: [
        { item: "dob-toque", qtd: 2 * dobradicasPorAltura(z1 - z0) },
        { item: "fecho-toque", qtd: 2 },
        { item: "sup-prat", qtd: 4 },
        { item: "fix-aereo", qtd: 2 },
      ],
      notas: [`Altura = pé-direito − ${b.z0} mm. Com pé-direito de ${pd} mm (estimado) dá ${b.z1 - b.z0} mm; prever régua de ajuste no teto.`, "Encosta na parede do fundo: prever régua de ajuste de prumo."],
    });
  }

  // ------------------------------------------------------------------ AS — aéreo superior off-white (2 caixas, 4 portas)
  {
    const b = cxA("coz-aereo-superior");
    const nPortas = opc("coz-aereo-superior", "portas");
    const largPorta = (b.s1 - b.s0) / nPortas;
    const solidos: Solido[] = [];
    const z0 = b.z0 + FOLGA;
    const z1 = b.z1 - FOLGA;
    for (let k = 0; k < nPortas / 2; k++) {
      const c = { ...b, s0: b.s0 + 2 * k * largPorta, s1: b.s0 + 2 * (k + 1) * largPorta };
      const cx = caixa({ c, frente: true, latS0: k === 0 ? "offwhite" : undefined, tampo: "painel" });
      const meio = (c.s0 + c.s1) / 2;
      solidos.push(...cx.solidos, solido("Divisória central", "divisoria", "branco", { s0: meio - ESP.caixa / 2, s1: meio + ESP.caixa / 2, d0: cx.vao.d0, d1: cx.vao.d1, z0: cx.vao.z0, z1: cx.vao.z1 }));
      const zPrat = Math.round((cx.vao.z0 + cx.vao.z1) / 2 - ESP.caixa / 2);
      solidos.push(
        prateleira("Prateleira regulável", { ...cx.vao, s1: meio - ESP.caixa / 2 }, zPrat),
        prateleira("Prateleira regulável", { ...cx.vao, s0: meio + ESP.caixa / 2 }, zPrat),
        ...frente({ nome: "Porta", s0: c.s0, s1: meio, z0, z1, d1: b.d1, padrao: "offwhite", dobr: "s0" }),
        ...frente({ nome: "Porta", s0: meio, s1: c.s1, z0, z1, d1: b.d1, padrao: "offwhite", dobr: "s1" }),
      );
    }
    modulos.push({
      cod: "AS",
      nome: "Aéreo superior off-white",
      lote: "A3",
      conjunto: qa.id,
      movelIds: ["coz-aereo-superior"],
      caixa: b,
      externo: `${nPortas} portas off-white lisas de ${t(largPorta - FOLGA)} × ${z1 - z0} mm, sem puxador, até o teto.`,
      interno: "2 caixas de 2 portas; divisória central e 1 prateleira regulável por vão (4 vãos).",
      abertura: "Portas de giro em pares, abrindo do centro de cada caixa, com fecho toque (dobradiças sem amortecedor).",
      solidos,
      ferragens: [
        { item: "dob-toque", qtd: nPortas * 3, obs: "3 por porta (largura acima de 600 mm)" },
        { item: "fecho-toque", qtd: nPortas },
        { item: "sup-prat", qtd: nPortas * 4 },
        { item: "fix-aereo", qtd: 4 },
      ],
      notas: [
        `Altura = pé-direito − ${b.z0} mm. Com pé-direito de ${pd} mm (estimado) dá ${b.z1 - b.z0} mm; prever régua de ajuste no teto.`,
        `Portas de ${t(largPorta - FOLGA)} mm de largura: acima do usual para porta de giro (até ≈ 600 mm). Mantido o desenho aprovado (4 portas), com 3 dobradiças por porta. Alternativa: 6 portas de ≈ 512 mm — só com autorização.`,
        "Lateral da ponta do shaft fica à vista: em off-white.",
      ],
    });
  }

  // ------------------------------------------------------------------ FV — faixa verde
  {
    const b = cxA("coz-faixa-verde");
    const am = cxA("coz-aereo-madeira");
    const meio = (b.s0 + b.s1) / 2;
    const e = ESP.frente;
    const fr = (s0: number, s1: number) => solido("Régua frontal", "arremate", "verde", { s0, s1, d0: b.d1 - e, d1: b.d1, z0: b.z0, z1: b.z1 }, { fita: { s: 2, z: 1 } });
    const inf = (s0: number, s1: number) => solido("Fechamento inferior", "arremate", "verde", { s0, s1, d0: am.d1 - 38, d1: b.d1 - e, z0: b.z0, z1: b.z0 + e }, { fita: { s: 1 } });
    modulos.push({
      cod: "FV",
      nome: "Faixa verde entre os aéreos",
      lote: "A3",
      conjunto: qa.id,
      movelIds: ["coz-faixa-verde"],
      caixa: b,
      externo: `Faixa verde sálvia de ${b.z1 - b.z0} mm de altura em toda a extensão dos aéreos, no mesmo plano do aéreo superior.`,
      interno: "Vazio de 80 mm atrás da régua: passagem da fiação e alojamento da fonte do LED.",
      abertura: "—",
      solidos: [
        fr(b.s0, meio),
        fr(meio, b.s1),
        inf(b.s0 + e, meio),
        inf(meio, b.s1),
        solido("Tampa lateral (ponta do shaft)", "arremate", "verde", { s0: b.s0, s1: b.s0 + e, d0: b.d0, d1: b.d1 - e, z0: b.z0, z1: b.z1 }, { fita: { d: 2 } }),
      ],
      ferragens: [],
      notas: ["Em 2 peças, com emenda alinhada ao encontro das portas do aéreo superior (a chapa tem 2.750 mm)."],
    });
  }

  // ------------------------------------------------------------------ AM — aéreo inferior em madeira (2 caixas, 5 portas)
  {
    const b = cxA("coz-aereo-madeira");
    const led = cxA("coz-led");
    const nPortas = opc("coz-aereo-madeira", "portas");
    const largPorta = (b.s1 - b.s0) / nPortas;
    const solidos: Solido[] = [];
    const z0 = b.z0 + FOLGA;
    const z1 = b.z1 - FOLGA;
    const caixas: [number, number][] = [
      [0, 2],
      [2, nPortas],
    ];
    const dobr: ("s0" | "s1")[] = ["s0", "s1", "s0", "s1", "s1"];
    for (const [ini, fim] of caixas) {
      const c = { ...b, s0: b.s0 + ini * largPorta, s1: b.s0 + fim * largPorta };
      const cx = caixa({ c, frente: true, padrao: "madeira", tampo: "painel" });
      solidos.push(...cx.solidos);
      for (let k = ini + 1; k < fim; k++) {
        const s = b.s0 + k * largPorta;
        solidos.push(solido("Divisória", "divisoria", "madeira", { s0: s - ESP.caixa / 2, s1: s + ESP.caixa / 2, d0: cx.vao.d0, d1: cx.vao.d1, z0: cx.vao.z0, z1: cx.vao.z1 }));
      }
      for (let k = ini; k < fim; k++) {
        solidos.push(...frente({ nome: "Porta", s0: b.s0 + k * largPorta, s1: b.s0 + (k + 1) * largPorta, z0, z1, d1: b.d1, padrao: "madeira", dobr: dobr[k] ?? "s0" }));
      }
    }
    solidos.push(solido("Perfil de LED embutido na base", "perfil", undefined, { ...led, z1: b.z0 }, { cor: "#ffe2b0" }));
    modulos.push({
      cod: "AM",
      nome: "Aéreo inferior em madeira clara",
      lote: "A3",
      conjunto: qa.id,
      movelIds: ["coz-aereo-madeira"],
      caixa: b,
      externo: `${nPortas} portas em madeira clara de ${t(largPorta - FOLGA)} × ${z1 - z0} mm, sem puxador. Recuado 40 mm em relação à faixa verde.`,
      interno: "2 caixas (2 + 3 portas), um vão por porta, sem prateleira. Base e lateral da ponta do shaft ficam à vista: caixa no padrão madeira.",
      abertura: "Portas de giro com fecho toque (dobradiças sem amortecedor).",
      solidos,
      ferragens: [
        { item: "dob-toque", qtd: nPortas * dobradicasPorAltura(z1 - z0), obs: "2 delas curvas (meia sobreposição): a porta do meio da caixa de 3 fica presa na divisória" },
        { item: "fecho-toque", qtd: nPortas },
        { item: "fix-aereo", qtd: 4 },
        { item: "led-perfil", qtd: m((led.s1 - led.s0) / 1000), obs: "opcional — cotar à parte" },
        { item: "led-fonte", qtd: 1, obs: "opcional — cotar à parte" },
      ],
      notas: [
        "O depurador fica sob este aéreo, acima do cooktop: o modelo ainda não foi definido — conferir se exige recorte na base/fundo e tomada dentro do aéreo.",
        "Fita de LED em perfil embutido na base, junto ao frontão (tom quente).",
      ],
    });
  }

  // ------------------------------------------------------------------ NM — nicho do micro-ondas
  {
    const b = cxA("coz-nicho-micro");
    const { solidos, vao } = caixa({ c: b, frente: false, padrao: "madeira", espLateral: ESP.frente, base: { esp: ESP.frente }, tampo: "painel", espTampo: ESP.frente, padraoFundo: "madeira" });
    modulos.push({
      cod: "NM",
      nome: "Nicho do micro-ondas",
      lote: "A3",
      conjunto: qa.id,
      movelIds: ["coz-nicho-micro"],
      caixa: b,
      externo: "Nicho aberto em madeira clara, 18 mm, 40 mm mais fundo que a faixa verde e 80 mm mais fundo que o aéreo de madeira.",
      interno: `Vão livre: ${vao.s1 - vao.s0} L × ${vao.z1 - vao.z0} A × ${vao.d1 - vao.d0} P. Fundo no padrão madeira, com furo para a tomada.`,
      abertura: "Aberto.",
      solidos,
      ferragens: [{ item: "fix-aereo", qtd: 2 }],
      notas: ["Micro-ondas típico de 460 × 270 × 350 mm (modelo não informado): conferir a ventilação pedida no manual."],
    });
  }

  // ------------------------------------------------------------------ T1 — módulo do tanque (canto cego), parede B
  {
    const b = cxB("coz-base-tanque");
    const rod = opc("coz-base-tanque", "rodape") * 10;
    const corpo = { ...b, z0: b.z0 + rod };
    const frenteM1 = converter(cxA("coz-gaveteiro"), qa, qb).s1; // onde o gaveteiro deixa de cobrir a frente
    const { solidos } = caixa({ c: corpo, frente: true, latS1: "verde", tampo: "travessas-pe", obsFundo: "recortes para água e esgoto do tanque" });
    const REGUA = 40;
    const z0 = corpo.z0 + FOLGA;
    const z1 = corpo.z1 - FOLGA;
    const dRod = b.d1 - RECUO_RODAPE;
    solidos.push(
      ...frente({ nome: "Régua de canto fixa", classe: "frente-fixa", s0: frenteM1, s1: frenteM1 + REGUA, z0, z1, d1: b.d1, padrao: "verde" }),
      ...frente({ nome: "Porta", s0: frenteM1 + REGUA, s1: b.s1, z0, z1, d1: b.d1, padrao: "verde", cava: true, dobr: "s1" }),
      solido("Rodapé (saia)", "rodape", "verde", { s0: frenteM1, s1: b.s1, d0: dRod - ESP.frente, d1: dRod, z0: 0, z1: rod }),
    );
    modulos.push({
      cod: "T1",
      nome: "Módulo do tanque (canto cego)",
      lote: "A4",
      conjunto: qb.id,
      movelIds: ["coz-base-tanque"],
      caixa: b,
      externo: `Do módulo de ${b.s1 - b.s0} mm só ${b.s1 - frenteM1} mm ficam à vista (o resto fica atrás do gaveteiro M1): régua de canto de ${REGUA} mm + 1 porta de ${b.s1 - frenteM1 - REGUA - FOLGA} mm com puxador cava.`,
      interno: "Vão único sob o tanque (sifão e registros). A parte atrás do M1 é canto cego, acessível pela porta.",
      abertura: "Porta de giro com dobradiças do lado da lava e seca (abre para longe das gavetas do M1).",
      solidos,
      ferragens: [
        { item: "dob-reta", qtd: dobradicasPorAltura(z1 - z0) },
        { item: "cava", qtd: m((b.s1 - frenteM1 - REGUA - FOLGA) / 1000) },
        { item: "pe-100", qtd: 4 },
        { item: "protetor-pia", qtd: 1 },
      ],
      notas: [
        "Proposta técnica para o canto do L: a régua fixa de 40 mm evita que a porta raspe nas frentes do M1. O 3D mostra o módulo com 2 portas, mas a maior parte fica encoberta.",
        "Largura depende do shaft (220 mm, estimado) e da lava e seca: conferir no local.",
        "Lateral voltada para a lava e seca em verde (fica à vista no vão da máquina).",
      ],
    });
  }

  // ------------------------------------------------------------------ contexto (não é marcenaria)
  const pedra = "#eceae4";
  const eletro = "#c9ccd0";
  const ctxA: Solido[] = [
    solido("Bancada de quartzo", "pedra", undefined, cxA("coz-bancada"), { cor: pedra }),
    solido("Frontão granilite", "pedra", undefined, cxA("coz-frontao"), { cor: "#f1efe9" }),
    solido("Forno de embutir", "aparelho", undefined, cxA("coz-forno"), { cor: "#3a3a3c" }),
    solido("Cooktop", "aparelho", undefined, cxA("coz-cooktop"), { cor: "#3a3a3c" }),
    solido("Lava-louças", "aparelho", undefined, cxA("coz-lavaloucas"), { cor: eletro }),
    solido("Micro-ondas", "aparelho", undefined, cxA("coz-microondas"), { cor: "#e9e9e9" }),
    solido("Depurador", "aparelho", undefined, cxA("coz-depurador"), { cor: eletro }),
    solido("Geladeira", "aparelho", undefined, cxA("coz-geladeira"), { cor: eletro }),
  ];
  const cuba = cxA("coz-cuba");
  ctxA.push(solido("Cuba", "aparelho", undefined, { ...cuba, z0: 870 - 190, z1: 870 }, { cor: "#aeb3b7" }));
  const tanque = cxB("coz-tanque");
  const ctxB: Solido[] = [
    solido("Pedra sob a janela", "pedra", undefined, cxB("coz-pedra-janela"), { cor: pedra }),
    solido("Frontão sob a janela", "pedra", undefined, cxB("coz-frontao-janela"), { cor: "#f1efe9" }),
    solido("Lava e seca", "aparelho", undefined, cxB("coz-lava-e-seca"), { cor: "#55585c" }),
    solido("Tanque (cuba)", "aparelho", undefined, { ...tanque, z0: 870 - 190, z1: 870 }, { cor: "#aeb3b7" }),
  ];
  return { modulos, contexto: { [qa.id]: ctxA, [qb.id]: ctxB } };
}

export { CAVA };
export type { Caixa3 };
