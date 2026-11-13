/**
 * PLANTA REAL do apartamento — leitura da imagem `public/referencia/planta-apartamento.webp`.
 * Detalhes de cada medida e da origem dela em docs/ANALISE_PLANTA.md.
 *
 * Como foi montada:
 * - Escala: 0,772 cm/px (≈ 129,5 px/m). As 14 cotas legíveis concordam entre si nessa escala
 *   quando lidas como VÃO INTERNO (face a face das paredes).
 * - Origem (0, 0) = canto externo superior esquerdo (pixel 169, 80 da imagem).
 * - Eixos das paredes posicionados para que os vãos internos sejam exatamente as cotas
 *   (origem "derivada"); espessuras de parede medidas na imagem (origem "estimada").
 * - Portas e janelas: largura e posição medidas na imagem calibrada ("estimada");
 *   alturas e peitoris não aparecem na planta ("estimada", padrão de mercado).
 */
import type { Abertura, Ambiente, CotaPlanta, Medida, OrigemMedida, Parede, Planta, Projeto, RefCota, Vertice } from "./tipos";

export const ESCALA_CM_POR_PX = 0.772;
const ORIGEM_PX = { x: 169, y: 80 };

const est = (valor: number, obs?: string): Medida => ({ valor, origem: "estimada", obs });
const v = (id: string, x: number, y: number, origem: OrigemMedida = "derivada"): Vertice => ({ id, x, y, origem });

/** Espessuras medidas na imagem (pixels × escala), arredondadas. */
const ESP = {
  externa: () => est(10, "medida na imagem (13 px)"),
  interna: () => est(7, "medida na imagem (9 px)"),
  pilar: () => est(18.5, "medida na imagem (24 px) — trecho estrutural/shaft"),
  hall: () => est(18, "medida na imagem (23 px) — trecho estrutural/shaft"),
  divQ1: () => est(8, "medida na imagem (9–12 px)"),
};

export function criarPlantaReal(): Planta {
  const vertices: Vertice[] = [
    // varanda
    v("VA0", 9.25, 5),
    v("VA1", 9.25, 70.5),
    v("PV0", 404.75, 5),
    v("PV1", 404.75, 70.5),
    // cozinha / área de serviço
    v("K0", 5, 70.5),
    v("K1", 5, 531),
    v("SH0", 21, 70.5, "estimada"),
    v("SH1", 21, 139),
    v("D0", 163.5, 70.5),
    v("D1", 163.5, 316, "estimada"),
    v("KB", 163.5, 531),
    // sala / corredor
    v("X1", 405, 316, "estimada"),
    v("W2a", 410.5, 5),
    v("W2b", 410.5, 300.5),
    v("B2R", 658, 300.5),
    // quartos
    v("W3a", 658, 5),
    v("W3b", 658, 407),
    v("R0", 918, 5),
    v("R1", 918, 407),
    // banheiro / hall de entrada
    v("BT0", 405, 402.5),
    v("BT1", 658, 402.5),
    v("BB0", 405, 531),
    v("BB1", 658, 531),
  ];

  const parede = (id: string, a: string, b: string, espessura: Medida, extra?: Partial<Parede>): Parede => ({
    id,
    a,
    b,
    tipo: "alvenaria",
    espessura,
    ...extra,
  });

  const paredes: Parede[] = [
    parede("p-var-guarda", "VA0", "PV0", est(4, "guarda-corpo (traço fino na planta)"), {
      tipo: "guarda-corpo",
      nome: "Guarda-corpo da varanda",
      altura: est(110, "altura usual de guarda-corpo — conferir"),
    }),
    parede("p-var-esq", "VA0", "VA1", ESP.pilar(), { nome: "Varanda · lateral esquerda" }),
    parede("p-var-dir", "PV0", "PV1", ESP.pilar(), { nome: "Varanda · pilar direito" }),
    parede("p-serv-varanda", "K0", "D0", ESP.interna()),
    parede("p-sala-varanda", "D0", "PV1", ESP.interna()),
    parede("p-coz-esq", "K0", "K1", ESP.externa()),
    parede("p-shaft", "SH0", "SH1", est(22, "nicho/shaft ao lado do tanque — conferir"), { nome: "Nicho técnico (shaft) da área de serviço" }),
    parede("p-coz-sala", "D0", "D1", ESP.interna()),
    parede("p-fundo-jantar", "K1", "BB0", ESP.externa()),
    parede("p-hall-banho", "BT0", "BB0", ESP.hall(), { nome: "Hall de entrada / Banheiro" }),
    parede("p-banho-corredor", "BT0", "BT1", ESP.interna()),
    parede("p-banho-ext", "BT1", "BB1", ESP.divQ1()),
    parede("p-fundo-banho", "BB0", "BB1", ESP.externa()),
    parede("p-sala-q2", "W2a", "W2b", ESP.interna()),
    parede("p-q2-corredor", "W2b", "B2R", ESP.interna()),
    parede("p-q2-q1", "W3a", "W3b", ESP.divQ1()),
    parede("p-topo-q2", "W2a", "W3a", ESP.externa()),
    parede("p-topo-q1", "W3a", "R0", ESP.externa()),
    parede("p-q1-dir", "R0", "R1", ESP.externa()),
    parede("p-q1-fundo", "W3b", "R1", ESP.externa()),
  ];

  const imagem = (obs = "medida na imagem calibrada") => obs;
  const ab = (
    id: string,
    paredeId: string,
    tipo: Abertura["tipo"],
    posicao: number,
    largura: number,
    altura: Medida,
    peitoril: Medida,
    extra?: Partial<Abertura>,
  ): Abertura => ({
    id,
    paredeId,
    tipo,
    posicao: est(posicao, imagem()),
    largura: est(largura, imagem()),
    altura,
    peitoril,
    ...extra,
  });
  const PORTA_H = () => est(210, "altura padrão de porta — não consta na planta");
  const ZERO = () => est(0);

  const aberturas: Abertura[] = [
    ab("j-servico", "p-serv-varanda", "janela", 119.3, 65, est(100, "não consta na planta"), est(110, "não consta na planta"), {}),
    ab("pt-varanda", "p-sala-varanda", "porta-correr", 120.6, 153, PORTA_H(), ZERO()),
    ab("pt-entrada", "p-fundo-jantar", "porta", 337, 92, PORTA_H(), ZERO(), { dobradica: "fim", abrePara: "direita" }),
    ab("pt-banheiro", "p-banho-corredor", "porta", 210.7, 73, PORTA_H(), ZERO(), { dobradica: "fim", abrePara: "esquerda" }),
    ab("j-banheiro", "p-banho-ext", "janela", 65, 55, est(60, "não consta na planta"), est(150, "não consta na planta")),
    ab("pt-quarto2", "p-q2-corredor", "porta", 201.3, 82.6, PORTA_H(), ZERO(), { dobradica: "fim", abrePara: "direita" }),
    ab("pt-quarto1", "p-q2-q1", "porta", 348.6, 83.4, PORTA_H(), ZERO(), { dobradica: "fim", abrePara: "direita" }),
    ab("j-quarto2", "p-topo-q2", "janela", 116.5, 124, est(120, "não consta na planta"), est(100, "não consta na planta")),
    ab("j-quarto1", "p-topo-q1", "janela", 136.4, 123.5, est(120, "não consta na planta"), est(100, "não consta na planta")),
  ];

  const PISO = "#d3d0cb"; // porcelanato cinza claro, como na imagem
  const ambientes: Ambiente[] = [
    { id: "amb-varanda", nome: "Varanda", tipo: "varanda", poligono: ["VA0", "PV0", "PV1", "VA1"], piso: "#bdb9b3", externo: true },
    { id: "amb-cozinha", nome: "Cozinha e área de serviço", tipo: "cozinha", poligono: ["K0", "D0", "D1", "KB", "K1"], piso: PISO },
    { id: "amb-sala", nome: "Sala de estar", tipo: "sala", poligono: ["D0", "PV1", "W2b", "X1", "D1"], piso: PISO },
    { id: "amb-jantar", nome: "Sala de jantar", tipo: "jantar", poligono: ["D1", "X1", "BT0", "BB0", "KB"], piso: PISO },
    { id: "amb-corredor", nome: "Corredor", tipo: "circulacao", poligono: ["W2b", "B2R", "BT1", "BT0", "X1"], piso: PISO },
    { id: "amb-banheiro", nome: "Banheiro", tipo: "banheiro", poligono: ["BT0", "BT1", "BB1", "BB0"], piso: "#dedbd6" },
    { id: "amb-quarto2", nome: "Quarto 2", tipo: "quarto", poligono: ["W2a", "W3a", "B2R", "W2b"], piso: PISO },
    { id: "amb-quarto1", nome: "Quarto principal", tipo: "quarto", poligono: ["W3a", "R0", "R1", "W3b"], piso: PISO },
  ];

  const P = (parede: string, face: "-" | "+"): RefCota => ({ parede, face });
  const px = (x: number, y: number) => ({ x: (x - ORIGEM_PX.x) * ESCALA_CM_POR_PX, y: (y - ORIGEM_PX.y) * ESCALA_CM_POR_PX });
  const cota = (
    id: string,
    texto: string,
    descricao: string,
    eixo: "x" | "y",
    a: RefCota,
    b: RefCota,
    rotuloPx: [number, number],
    situacao: CotaPlanta["situacao"] = "confirmada",
    obs?: string,
  ): CotaPlanta => ({
    id,
    texto,
    valor: Math.round(Number(texto.replace(",", ".")) * 100),
    descricao,
    eixo,
    a,
    b,
    rotulo: px(...rotuloPx),
    situacao,
    obs,
  });

  const cotas: CotaPlanta[] = [
    cota("c-var-larg", "3,77", "Varanda — largura", "x", P("p-var-esq", "+"), P("p-var-dir", "-"), [397, 108]),
    cota("c-var-prof", "0,60", "Varanda — profundidade", "y", P("p-var-guarda", "+"), P("p-sala-varanda", "-"), [660, 128], "confirmada",
      "Na imagem o vão mede ≈ 0,67; vale a cota escrita."),
    cota("c-coz-larg", "1,50", "Cozinha — largura", "x", P("p-coz-esq", "+"), P("p-coz-sala", "-"), [312, 375]),
    cota("c-coz-comp", "3,87", "Cozinha — bancada até a parede do fundo", "y", { vertice: "SH1" }, P("p-fundo-jantar", "-"), [197, 350]),
    cota("c-sala-larg", "2,40", "Sala de estar — largura", "x", P("p-coz-sala", "+"), P("p-sala-q2", "-"), [583, 201]),
    cota("c-sala-prof", "4,52", "Sala de estar + jantar — profundidade", "y", P("p-sala-varanda", "+"), P("p-fundo-jantar", "-"), [405, 435]),
    cota("c-sala-tv", "2,30", "Parede da TV", "y", P("p-sala-varanda", "+"), P("p-q2-corredor", "+"), [680, 315]),
    cota("c-q2-larg", "2,40", "Quarto 2 — largura", "x", P("p-sala-q2", "+"), P("p-q2-q1", "-"), [900, 110]),
    cota("c-q2-prof", "2,87", "Quarto 2 — profundidade", "y", P("p-topo-q2", "+"), P("p-q2-corredor", "-"), [728, 375]),
    cota("c-q1-larg", "2,51", "Quarto principal — largura", "x", P("p-q2-q1", "+"), P("p-q1-dir", "-"), [1183, 107]),
    cota("c-q1-prof", "3,92", "Quarto principal — profundidade", "y", P("p-topo-q1", "+"), P("p-q1-fundo", "-"), [1045, 415]),
    cota("c-ban-larg", "2,40", "Banheiro — largura", "x", P("p-hall-banho", "+"), P("p-banho-ext", "-"), [866, 628]),
    cota("c-ban-prof", "1,20", "Banheiro — profundidade", "y", P("p-banho-corredor", "+"), P("p-fundo-banho", "-"), [990, 640]),
    cota("c-jantar-larg", "3,86", "Jantar — largura (cozinha até o hall)", "x", P("p-coz-esq", "+"), P("p-hall-banho", "-"), [432, 746]),
    cota("c-corredor", "2,52", "Corredor — comprimento (interpretação)", "x", P("p-sala-q2", "-"), P("p-q2-q1", "+"), [832, 494], "a-confirmar",
      "Não está claro a que trecho se refere; o mais próximo é da face da parede da sala até a face da parede do quarto principal."),
    cota("c-hall", "1,32", "Hall de entrada — profundidade (interpretação)", "y", P("p-banho-corredor", "-"), P("p-fundo-jantar", "-"), [662, 625], "a-confirmar",
      "Lida como do corredor até a parede da porta de entrada; o modelo dá ≈ 1,27."),
  ];

  return {
    nome: "Apartamento — planta de referência",
    peDireito: est(260, "não consta na planta — padrão residencial, conferir"),
    vertices,
    paredes,
    aberturas,
    ambientes,
    provisoria: false,
    cotas,
    referencia: {
      imagem: `${import.meta.env.BASE_URL}referencia/planta-apartamento.webp`,
      larguraPx: 1536,
      alturaPx: 864,
      cmPorPx: ESCALA_CM_POR_PX,
      x: -ORIGEM_PX.x * ESCALA_CM_POR_PX,
      y: -ORIGEM_PX.y * ESCALA_CM_POR_PX,
      rotacao: 0,
      opacidade: 0.55,
      visivel: false,
      calibracao: { cotaCm: 386, medidoPx: 498 },
    },
  };
}

export function criarProjetoReal(): Projeto {
  const agora = new Date().toISOString();
  return {
    id: "principal",
    nome: "Meu apartamento",
    versaoModelo: 1,
    criadoEm: agora,
    atualizadoEm: agora,
    planta: criarPlantaReal(),
    moveis: [],
  };
}
