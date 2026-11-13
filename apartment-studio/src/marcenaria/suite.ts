/**
 * Suíte: guarda-roupa em L (espelho + portas cinza), coluna, e os complementos (armário-ponte, painel,
 * cabeceira e criados). Envoltórias do modelo 3D; interior é PROPOSTA técnica, a aprovar.
 */
import type { Projeto } from "../modelo/tipos";
import { ESP, FOLGA, RECUO_RODAPE, caixa, dobradicasPorAltura, frente, gaveta, prateleira, solido } from "./construtor";
import type { Conjunto } from "./cozinha";
import { caixaDoMovel, movelDoProjeto } from "./quadros";
import type { Caixa3, Modulo, Quadro, Solido } from "./tipos";

/** Altura do centro do puxador barra a partir do piso e comprimento (iguais ao 3D). */
export const PUXADOR = { centro: 1120, comprimento: 300, afastamento: 40 } as const;
/** Alturas propostas dos varões e prateleiras fixas (do piso). */
export const ALTURAS = {
  varaoBaixo: 1040,
  prateleiraEntreVaroes: 1085,
  varaoAlto: 2040,
  maleiro: 2085,
  varaoLongo: 1800,
  prateleiraSobreVaraoLongo: 1845,
  sapateira: 425,
} as const;

const m = (v: number) => Math.round(v * 1000) / 1000;

function puxador(sEixo: number, d0: number): Solido {
  return solido(
    "Puxador barra",
    "puxador",
    undefined,
    { s0: sEixo - 6, s1: sEixo + 6, d0, d1: d0 + 28, z0: PUXADOR.centro - PUXADOR.comprimento / 2, z1: PUXADOR.centro + PUXADOR.comprimento / 2 },
    { cor: "#c9ccd0" },
  );
}

function varao(vao: Caixa3, zEixo: number, dEixo: number): Solido {
  return solido("Varão cabideiro", "varao", undefined, { s0: vao.s0, s1: vao.s1, d0: dEixo - 15, d1: dEixo + 15, z0: zEixo - 7.5, z1: zEixo + 7.5 }, { cor: "#b9bdc2" });
}

export function criarSuite(projeto: Projeto, qa: Quadro, qb: Quadro): Conjunto {
  const cxA = (id: string) => caixaDoMovel(movelDoProjeto(projeto, id), qa);
  const cxB = (id: string) => caixaDoMovel(movelDoProjeto(projeto, id), qb);
  const opc = (id: string, chave: string) => Number(movelDoProjeto(projeto, id).opcoes?.[chave] ?? 0);
  const pd = projeto.planta.peDireito.valor * 10;
  const modulos: Modulo[] = [];

  // ------------------------------------------------------------------ CO — coluna em carvalho
  {
    const b = cxA("sui-gr-coluna");
    const e = ESP.frente;
    const travas = [300, 900, 1500, 2100].map((z) => solido("Trava interna", "travessa", "branco", { s0: b.s0 + e, s1: b.s1, d0: 220, d1: 320, z0: z, z1: z + ESP.caixa }, { fita: {} }));
    modulos.push({
      cod: "CO",
      nome: "Coluna em carvalho",
      lote: "B1",
      conjunto: qa.id,
      movelIds: ["sui-gr-coluna"],
      caixa: b,
      externo: `Coluna de ${b.s1 - b.s0} × ${b.d1 - b.d0} mm, do piso ao teto, em carvalho claro: separa o armário-ponte do guarda-roupa.`,
      interno: "Oca (frente + lateral aparente em L, com travas internas). Pode receber a fiação dos interruptores da cabeceira.",
      abertura: "—",
      solidos: [
        solido("Frente da coluna", "painel", "carvalho", { ...b, d0: b.d1 - e }, { fita: { z: 2 } }),
        solido("Lateral aparente (lado da cama)", "painel", "carvalho", { ...b, s1: b.s0 + e, d1: b.d1 - e }, { fita: { z: 1 } }),
        ...travas,
      ],
      ferragens: [{ item: "fix-painel", qtd: 1 }],
      notas: [`Altura = pé-direito (${pd} mm, estimado).`],
    });
  }

  // ------------------------------------------------------------------ G2 — guarda-roupa de portas de espelho
  {
    const b = cxA("sui-gr-espelho");
    const rod = opc("sui-gr-espelho", "rodape") * 10;
    const corpo = { ...b, z0: rod };
    const { solidos, vao } = caixa({ c: corpo, frente: true, tampo: "painel" });
    const meio = (b.s0 + b.s1) / 2;
    const z0 = rod + FOLGA;
    const z1 = b.z1 - FOLGA;
    const dRod = b.d1 - RECUO_RODAPE;
    solidos.push(
      prateleira("Prateleira fixa entre os varões", vao, ALTURAS.prateleiraEntreVaroes, { esp: ESP.frente, fixa: true }),
      prateleira("Prateleira do maleiro", vao, ALTURAS.maleiro, { esp: ESP.frente, fixa: true }),
      varao(vao, ALTURAS.varaoBaixo, 278),
      varao(vao, ALTURAS.varaoAlto, 278),
      ...frente({ nome: "Porta (base do espelho)", s0: b.s0, s1: meio, z0, z1, d1: b.d1, padrao: "carvalho", dobr: "s0" }),
      ...frente({ nome: "Porta (base do espelho)", s0: meio, s1: b.s1, z0, z1, d1: b.d1, padrao: "carvalho", dobr: "s1" }),
      solido("Espelho colado", "espelho", undefined, { s0: b.s0 + FOLGA / 2 + 2, s1: meio - FOLGA / 2 - 2, d0: b.d1, d1: b.d1 + 3, z0: z0 + 2, z1: z1 - 2 }, { cor: "#cfd8dc" }),
      solido("Espelho colado", "espelho", undefined, { s0: meio + FOLGA / 2 + 2, s1: b.s1 - FOLGA / 2 - 2, d0: b.d1, d1: b.d1 + 3, z0: z0 + 2, z1: z1 - 2 }, { cor: "#cfd8dc" }),
      puxador(meio - FOLGA / 2 - PUXADOR.afastamento, b.d1 + 3),
      puxador(meio + FOLGA / 2 + PUXADOR.afastamento, b.d1 + 3),
      solido("Rodapé frontal", "rodape", "cinza", { s0: b.s0, s1: b.s1, d0: dRod - ESP.frente, d1: dRod, z0: 0, z1: rod }),
    );
    const larguraPorta = meio - b.s0 - FOLGA;
    modulos.push({
      cod: "G2",
      nome: "Guarda-roupa de portas de espelho",
      lote: "B1",
      conjunto: qa.id,
      movelIds: ["sui-gr-espelho"],
      caixa: b,
      externo: `2 portas de ${larguraPorta} × ${z1 - z0} mm revestidas de espelho, puxador barra de ${PUXADOR.comprimento} mm, rodapé cinza recuado de ${rod} mm.`,
      interno: `PROPOSTA — cabideiro duplo em vão único de ${vao.s1 - vao.s0} mm: varão baixo a ${ALTURAS.varaoBaixo} mm e varão alto a ${ALTURAS.varaoAlto} mm (camisas, blazers, calças dobradas), maleiro de ${vao.z1 - ALTURAS.maleiro - ESP.frente} mm no topo.`,
      abertura: "Portas de giro abrindo do centro, dobradiças retas com amortecimento (5 por porta) e tensor embutido.",
      solidos,
      ferragens: [
        { item: "dob-reta", qtd: 2 * dobradicasPorAltura(z1 - z0) },
        { item: "tensor", qtd: 2 },
        { item: "pux-barra", qtd: 2, obs: "fixado através do espelho (2 furos por porta)" },
        { item: "espelho", qtd: m((2 * (larguraPorta - 4) * (z1 - z0 - 4)) / 1e6), obs: `2 peças de ${larguraPorta - 4} × ${z1 - z0 - 4} mm, 3 mm, bordas lapidadas` },
        { item: "varao", qtd: m((2 * (vao.s1 - vao.s0)) / 1000) },
        { item: "sup-varao", qtd: 4 },
        { item: "pe-80", qtd: 4 },
      ],
      notas: [
        `Portas inteiras de ${z1 - z0} mm (pé-direito de ${pd} mm, estimado): exigem tensor e montagem no local.`,
        "A porta do lado do canto abre contra a frente do G4: limitar a abertura a 90° (dobradiça com limitador). Alternativa: régua de 40 mm em carvalho junto ao canto — muda a paginação; só com autorização.",
        "Varão alto a 2,04 m: confortável para quem alcança ≈ 2,0 m. Alternativa: cabideiro basculante (cotar à parte).",
      ],
    });
  }

  // ------------------------------------------------------------------ G4 — guarda-roupa de portas cinza + canto
  {
    const g = cxB("sui-gr-cinza");
    const canto = cxB("sui-gr-canto");
    const b: Caixa3 = { s0: canto.s0, s1: g.s1, d0: g.d0, d1: g.d1, z0: 0, z1: g.z1 };
    const rod = opc("sui-gr-cinza", "rodape") * 10;
    const mold = opc("sui-gr-cinza", "moldura") * 10;
    const E = ESP.caixa;
    const EF = ESP.frente;
    const dCaixa0 = b.d0 + ESP.fundo;
    const dCaixa1 = b.d1 - EF - 2;
    const zBase = rod + E;
    const zTopo = b.z1 - E;
    const sLatEsq = g.s1 - mold; // face interna da lateral do lado da porta do quarto
    const sPortas0 = g.s0 + mold;
    const sMeio = (sPortas0 + sLatEsq) / 2;
    const sDiv0 = Math.floor(sMeio - E / 2); // divisória atrás do encontro das portas (meio milímetro fora do centro)
    const sDiv1 = sDiv0 + E;
    const montante = { d0: dCaixa1 - 65, d1: dCaixa1 };
    const pecaCanto = { chave: "divisoria-canto", comp: zTopo - zBase, larg: dCaixa1 - dCaixa0, obs: `peça única em L: recorte de ${zTopo - ALTURAS.sapateira} × ${montante.d0 - dCaixa0} mm para a passagem das roupas` };
    const solidos: Solido[] = [
      solido("Lateral (parede do canto)", "lateral", "branco", { s0: b.s0, s1: b.s0 + E, d0: dCaixa0, d1: dCaixa1, z0: rod, z1: b.z1 }),
      solido("Lateral (lado da porta do quarto)", "lateral", "branco", { s0: sLatEsq, s1: sLatEsq + E, d0: dCaixa0, d1: dCaixa1, z0: rod, z1: b.z1 }),
      solido("Tamponamento lateral aparente", "painel", "carvalho", { s0: g.s1 - EF, s1: g.s1, d0: b.d0, d1: b.d1 - EF, z0: rod, z1: b.z1 }, { fita: { z: 1 } }),
      solido("Moldura (lado da porta do quarto)", "arremate", "carvalho", { s0: sLatEsq, s1: g.s1, d0: b.d1 - EF, d1: b.d1, z0: rod, z1: b.z1 }, { fita: { z: 2 } }),
      solido("Moldura (canto)", "arremate", "carvalho", { s0: g.s0, s1: sPortas0, d0: b.d1 - EF, d1: b.d1, z0: rod, z1: b.z1 }, { fita: { z: 2 } }),
      solido("Base", "base", "branco", { s0: b.s0 + E, s1: sLatEsq, d0: dCaixa0, d1: dCaixa1, z0: rod, z1: zBase }),
      solido("Tampo", "tampo", "branco", { s0: b.s0 + E, s1: sLatEsq, d0: dCaixa0, d1: dCaixa1, z0: zTopo, z1: b.z1 }),
      solido("Divisória central", "divisoria", "branco", { s0: sDiv0, s1: sDiv1, d0: dCaixa0, d1: dCaixa1, z0: zBase, z1: zTopo }),
      // divisória do canto: parte baixa inteira + montante das dobradiças até o topo (uma peça só, recortada)
      solido("Divisória do canto com montante", "divisoria", "branco", { s0: sPortas0 - E, s1: sPortas0, d0: dCaixa0, d1: dCaixa1, z0: zBase, z1: ALTURAS.sapateira }, { peca: pecaCanto }),
      solido("Divisória do canto com montante", "divisoria", "branco", { s0: sPortas0 - E, s1: sPortas0, ...montante, z0: ALTURAS.sapateira, z1: zTopo }, { peca: pecaCanto }),
      solido("Fundo", "fundo", "branco", { s0: b.s0 + 2, s1: (b.s0 + g.s1 - EF) / 2, d0: b.d0, d1: b.d0 + ESP.fundo, z0: rod + 2, z1: b.z1 - 2 }),
      solido("Fundo", "fundo", "branco", { s0: (b.s0 + g.s1 - EF) / 2, s1: g.s1 - EF - 2, d0: b.d0, d1: b.d0 + ESP.fundo, z0: rod + 2, z1: b.z1 - 2 }),
    ];
    // ---- vão da esquerda (lado da porta do quarto): gaveteiro interno + prateleiras
    const vaoE: Caixa3 = { s0: sDiv1, s1: sLatEsq, d0: dCaixa0, d1: dCaixa1, z0: zBase, z1: zTopo };
    const CALCO = 30;
    const sGav1 = vaoE.s1 - CALCO;
    const frentesGav = [200, 200, 200, 140]; // de baixo para cima
    const caixasGav = [150, 150, 150, 95];
    let z = zBase + FOLGA;
    const dFrenteGav = dCaixa1 - 20; // 22 mm atrás da porta
    frentesGav.forEach((h, i) => {
      const tipo = h === 140 ? "de acessórios (140)" : `de roupas (${h})`; // as três de 200 são iguais
      solidos.push(
        ...frente({ nome: `Frente interna da gaveta ${tipo}`, classe: "frente-gaveta", s0: vaoE.s0, s1: sGav1, z0: z, z1: z + h, d1: dFrenteGav, padrao: "carvalho", obs: "pega usinada no topo (sem puxador saliente)" }).map((x) => ({ ...x, soInterno: true })),
        ...gaveta({ nome: `Gaveta ${tipo}`, s0: vaoE.s0, s1: sGav1, d1: dFrenteGav - EF, comp: 450, z0: z + 15, h: caixasGav[i] }),
      );
      z += h + FOLGA;
    });
    const zTampoGav = z; // topo das frentes + folga
    solidos.push(
      solido("Calço das corrediças (30 mm)", "divisoria", "branco", { s0: sGav1, s1: vaoE.s1, d0: dCaixa1 - 500, d1: dCaixa1, z0: zBase, z1: zTampoGav }, { chapas: 2, fita: { z: 1 }, obs: "2 chapas de 15 mm; afasta as gavetas da porta aberta" }),
      prateleira("Tampo do gaveteiro interno", vaoE, zTampoGav, { fixa: true }),
    );
    const zLivre0 = zTampoGav + E;
    const passo = (ALTURAS.maleiro - zLivre0 - 3 * E) / 4;
    for (let i = 1; i <= 3; i++) solidos.push(prateleira("Prateleira regulável", vaoE, Math.round(zLivre0 + i * passo + (i - 1) * E)));
    solidos.push(prateleira("Prateleira do maleiro", vaoE, ALTURAS.maleiro, { fixa: true }));
    // ---- vão da direita + canto: sapateira, cabideiro longo e maleiro alto
    const vaoD: Caixa3 = { s0: b.s0 + E, s1: sDiv0, d0: dCaixa0, d1: montante.d0, z0: zBase, z1: zTopo };
    solidos.push(
      solido("Prateleira fixa sobre a sapateira", "prateleira", "branco", { ...vaoD, z0: ALTURAS.sapateira, z1: ALTURAS.sapateira + EF }, { obs: "18 mm, apoiada na divisória do canto" }),
      prateleira("Prateleira da sapateira (regulável)", { ...vaoD, s0: sPortas0, d1: dCaixa1 }, 245),
      varao({ ...vaoD }, ALTURAS.varaoLongo, 255),
      solido("Prateleira fixa sobre o varão", "prateleira", "branco", { ...vaoD, z0: ALTURAS.prateleiraSobreVaraoLongo, z1: ALTURAS.prateleiraSobreVaraoLongo + EF }, { obs: "18 mm, presa também ao montante (apoio no meio do vão)" }),
    );
    // ---- portas, puxadores e rodapé
    const z0 = rod + FOLGA;
    const z1 = b.z1 - FOLGA;
    const dRod = b.d1 - RECUO_RODAPE;
    solidos.push(
      ...frente({ nome: "Porta", s0: sPortas0, s1: sMeio, z0, z1, d1: b.d1, padrao: "cinza", dobr: "s0" }),
      ...frente({ nome: "Porta", s0: sMeio, s1: sLatEsq, z0, z1, d1: b.d1, padrao: "cinza", dobr: "s1" }),
      puxador(sMeio - FOLGA / 2 - PUXADOR.afastamento, b.d1),
      puxador(sMeio + FOLGA / 2 + PUXADOR.afastamento, b.d1),
      solido("Rodapé frontal", "rodape", "cinza", { s0: g.s0, s1: g.s1, d0: dRod - EF, d1: dRod, z0: 0, z1: rod }),
      solido("Rodapé lateral aparente", "rodape", "cinza", { s0: g.s1 - EF, s1: g.s1, d0: b.d0, d1: dRod - EF, z0: 0, z1: rod }, { fita: { d: 1 } }),
    );
    const larguraPorta = sMeio - sPortas0 - FOLGA;
    modulos.push({
      cod: "G4",
      nome: "Guarda-roupa de portas cinza + canto",
      lote: "B2",
      conjunto: qb.id,
      movelIds: ["sui-gr-cinza", "sui-gr-canto"],
      caixa: b,
      externo: `2 portas cinza de ${larguraPorta} × ${z1 - z0} mm embutidas entre molduras de carvalho de ${mold} mm; lateral aparente em carvalho; rodapé cinza recuado. O canto de ${canto.s1 - canto.s0} × ${canto.d1 - canto.d0} mm fica atrás do G2 e é aproveitado por dentro.`,
      interno: `PROPOSTA — vão esquerdo (${vaoE.s1 - vaoE.s0} mm): 4 gavetas internas (1 de acessórios + 3 de roupas), 3 prateleiras reguláveis e maleiro. Vão direito + canto (${vaoD.s1 - vaoD.s0} mm contínuos): sapateira de 2 níveis, cabideiro longo a ${ALTURAS.varaoLongo} mm (≈ ${ALTURAS.varaoLongo - 22 - ALTURAS.sapateira - EF} mm livres) e maleiro alto de ${zTopo - ALTURAS.prateleiraSobreVaraoLongo - EF} mm para malas.`,
      abertura: "Portas de giro embutidas (dobradiças supercurvas com amortecimento, 5 por porta) abrindo do centro; tensor embutido; puxador barra.",
      solidos,
      ferragens: [
        { item: "dob-super", qtd: 2 * dobradicasPorAltura(z1 - z0) },
        { item: "tensor", qtd: 2 },
        { item: "pux-barra", qtd: 2 },
        { item: "cor-450", qtd: 4 },
        { item: "sup-prat", qtd: 16 },
        { item: "varao", qtd: m((vaoD.s1 - vaoD.s0) / 1000) },
        { item: "sup-varao", qtd: 2 },
        { item: "sup-varao-central", qtd: 1 },
        { item: "pe-80", qtd: 6 },
      ],
      notas: [
        "O canto é cego: o acesso é pela porta da direita, passando por trás do montante das dobradiças (65 mm). O varão é contínuo; as roupas do canto são as de menor uso.",
        `A folha da porta do quarto, aberta, fica a ≈ 26 mm da lateral deste módulo (medidas estimadas): conferir no local antes de fechar a largura de ${g.s1 - g.s0} mm.`,
        `Portas inteiras de ${z1 - z0} mm (pé-direito de ${pd} mm, estimado): exigem tensor e montagem no local.`,
        "Capacidade da sapateira é pequena (≈ 6 pares à mão + espaço no canto): se precisar de mais, trocar o cabideiro longo por prateleiras ou incluir sapateira deslizante — definir.",
      ],
    });
  }

  // ------------------------------------------------------------------ AP — armário-ponte
  {
    const b = cxA("sui-ponte");
    const nPortas = opc("sui-ponte", "portas") || 6;
    const largPorta = (b.s1 - b.s0) / nPortas;
    const solidos: Solido[] = [];
    const z0 = b.z0 + FOLGA;
    const z1 = b.z1 - FOLGA;
    for (let k = 0; k < nPortas / 2; k++) {
      const c = { ...b, s0: b.s0 + 2 * k * largPorta, s1: b.s0 + 2 * (k + 1) * largPorta };
      const cx = caixa({ c, frente: true, base: { padrao: "carvalho" }, tampo: "painel" });
      const meio = (c.s0 + c.s1) / 2;
      const passo = (cx.vao.z1 - cx.vao.z0 - 2 * ESP.caixa) / 3;
      solidos.push(
        ...cx.solidos,
        prateleira("Prateleira regulável", cx.vao, Math.round(cx.vao.z0 + passo)),
        prateleira("Prateleira regulável", cx.vao, Math.round(cx.vao.z0 + 2 * passo + ESP.caixa)),
        ...frente({ nome: "Porta", s0: c.s0, s1: meio, z0, z1, d1: b.d1, padrao: "carvalho", dobr: "s0" }),
        ...frente({ nome: "Porta", s0: meio, s1: c.s1, z0, z1, d1: b.d1, padrao: "carvalho", dobr: "s1" }),
      );
    }
    modulos.push({
      cod: "AP",
      nome: "Armário-ponte sobre a cama",
      lote: "C1",
      conjunto: qa.id,
      movelIds: ["sui-ponte"],
      caixa: b,
      externo: `${nPortas} portas em carvalho claro de ${largPorta - FOLGA} × ${z1 - z0} mm, sem puxador, do topo da cabeceira ao teto.`,
      interno: "3 caixas de 2 portas, 2 prateleiras reguláveis por caixa (roupa de cama, malas pequenas). Base aparente em carvalho.",
      abertura: "Portas de giro em pares com fecho toque (dobradiças sem amortecedor, 3 por porta).",
      solidos,
      ferragens: [
        { item: "dob-toque", qtd: nPortas * dobradicasPorAltura(z1 - z0) },
        { item: "fecho-toque", qtd: nPortas },
        { item: "sup-prat", qtd: nPortas * 4 },
        { item: "fix-aereo", qtd: 6, obs: "reforçado: armário sobre a cama" },
      ],
      notas: [
        `Altura = pé-direito − ${b.z0} mm (${b.z1 - b.z0} mm com pé-direito estimado de ${pd} mm).`,
        "Fixação estrutural na alvenaria (parede externa) com buchas adequadas e apoio no painel lateral e na coluna: armário fica sobre a cama.",
        "No 3D a base aparece em tom um pouco mais fechado; adotado o mesmo carvalho das portas — confirmar.",
      ],
    });
  }

  // ------------------------------------------------------------------ PJ — painel lateral da ponte
  {
    const b = cxA("sui-painel-janela");
    modulos.push({
      cod: "PJ",
      nome: "Painel lateral da ponte (lado da janela)",
      lote: "C2",
      conjunto: qa.id,
      movelIds: ["sui-painel-janela"],
      caixa: b,
      externo: `Painel em carvalho de ${b.s1 - b.s0} mm (engrossado), ${b.d1 - b.d0} mm de profundidade, do piso ao teto.`,
      interno: "—",
      abertura: "—",
      solidos: [solido("Painel lateral (engrossado 30 mm)", "painel", "carvalho", b, { chapas: 2, fita: { z: 1 }, obs: "2 chapas de 15 mm coladas" })],
      ferragens: [{ item: "fix-painel", qtd: 1 }],
      notas: [`Altura = pé-direito (${pd} mm, estimado).`, "Fica a ≈ 148 mm do vão da janela (posição da janela estimada): conferir, inclusive o trilho/varão da cortina."],
    });
  }

  // ------------------------------------------------------------------ CB — cabeceira em painel
  {
    const b = cxA("sui-cabeceira");
    const frisos = opc("sui-cabeceira", "frisos") || 2;
    const FRISO = 10;
    const passo = (b.s1 - b.s0) / (frisos + 1);
    const solidos: Solido[] = [];
    for (let i = 0; i <= frisos; i++) {
      const s0 = i === 0 ? b.s0 : b.s0 + i * passo + FRISO / 2;
      const s1 = i === frisos ? b.s1 : b.s0 + (i + 1) * passo - FRISO / 2;
      solidos.push(solido("Painel da cabeceira", "painel", "carvalho", { s0, s1, d0: b.d1 - ESP.frente, d1: b.d1, z0: b.z0, z1: b.z1 }, { fita: { z: 2, s: 1 } }));
      if (i < frisos) solidos.push(solido("Fundo do friso (tom escuro)", "perfil", undefined, { s0: s1, s1: s1 + FRISO, d0: b.d0, d1: b.d0 + 3, z0: b.z0, z1: b.z1 }, { cor: "#8f7a5c" }));
    }
    modulos.push({
      cod: "CB",
      nome: "Cabeceira em painel",
      lote: "C3",
      conjunto: qa.id,
      movelIds: ["sui-cabeceira"],
      caixa: b,
      externo: `${frisos + 1} painéis de carvalho de 18 mm com ${frisos} frisos verticais (juntas de ${FRISO} mm com fundo escuro), do piso à base do armário-ponte.`,
      interno: "—",
      abertura: "—",
      solidos,
      ferragens: [{ item: "fix-painel", qtd: 1 }],
      notas: ["Recortes para tomadas e interruptores da cabeceira: posições não constam na planta — levantar no local."],
    });
  }

  // ------------------------------------------------------------------ CR — criados suspensos
  for (const [n, id] of [
    [1, "sui-criado-1"],
    [2, "sui-criado-2"],
  ] as const) {
    const b = cxA(id);
    const { solidos, vao } = caixa({ c: b, frente: true, padrao: "carvalho", tampo: "painel" });
    solidos.push(
      ...frente({ nome: "Frente da gaveta", classe: "frente-gaveta", s0: b.s0, s1: b.s1, z0: b.z0 + FOLGA, z1: b.z1 - FOLGA, d1: b.d1, padrao: "carvalho", obs: "lisa, abertura por toque" }),
      ...gaveta({ nome: "Gaveta", s0: vao.s0, s1: vao.s1, d1: vao.d1, comp: 300, z0: vao.z0 + 5, h: 45 }),
    );
    modulos.push({
      cod: `CR${n}`,
      nome: `Criado suspenso ${n}`,
      lote: "C4",
      conjunto: qa.id,
      movelIds: [id],
      caixa: b,
      externo: `Criado suspenso em carvalho de ${b.s1 - b.s0} × ${b.z1 - b.z0} × ${b.d1 - b.d0} mm, a ${b.z0} mm do piso, 1 gaveta sem puxador.`,
      interno: "Gaveta rasa (caixa de 45 mm).",
      abertura: "Corrediça telescópica de 300 mm com abertura por toque.",
      solidos,
      ferragens: [
        { item: "cor-300-toque", qtd: 1 },
        { item: "sup-criado", qtd: 1 },
      ],
      notas: ["Fixado sobre a cabeceira, com suporte oculto preso à alvenaria."],
    });
  }

  // ------------------------------------------------------------------ contexto
  const cama = cxA("sui-cama");
  return {
    modulos,
    contexto: { [qa.id]: [solido("Cama (sugestão 138 × 188)", "contexto", undefined, cama, { cor: "#e8e6e1" })], [qb.id]: [] },
  };
}
