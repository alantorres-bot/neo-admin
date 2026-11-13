/**
 * PLANTA PROVISÓRIA — layout genérico de 2 quartos (~60 m²) usado só para a primeira versão funcionar.
 * TODAS as medidas são "estimada": a planta real do apartamento ainda não foi recebida.
 * Quando a planta chegar, este arquivo é substituído pela leitura dela (ver docs/ANALISE_PLANTA.md).
 */
import type { Abertura, Ambiente, Medida, Parede, Planta, Projeto, Vertice } from "./tipos";

const est = (valor: number, obs?: string): Medida => ({ valor, origem: "estimada", obs });

const v = (id: string, x: number, y: number): Vertice => ({ id, x, y, origem: "estimada" });

const ESP_EXT = () => est(15, "padrão parede externa");
const ESP_INT = () => est(12, "padrão parede interna");

export function criarPlantaProvisoria(): Planta {
  const vertices: Vertice[] = [
    v("A", 0, 0),
    v("B", 280, 0),
    v("C", 450, 0),
    v("D", 760, 0),
    v("E", 760, 330),
    v("F", 760, 700),
    v("G", 450, 700),
    v("H", 0, 700),
    v("I", 0, 300),
    v("J", 280, 300),
    v("K", 280, 220),
    v("L", 450, 220),
    v("M", 450, 330),
    v("N", 0, 860),
    v("O", 450, 860),
  ];

  const ext = (id: string, a: string, b: string): Parede => ({ id, a, b, tipo: "alvenaria", espessura: ESP_EXT() });
  const int = (id: string, a: string, b: string): Parede => ({ id, a, b, tipo: "alvenaria", espessura: ESP_INT() });
  const gc = (id: string, a: string, b: string): Parede => ({
    id,
    a,
    b,
    tipo: "guarda-corpo",
    espessura: est(15),
    altura: est(110, "altura usual de guarda-corpo"),
  });

  const paredes: Parede[] = [
    ext("p-coz-frente", "A", "B"),
    ext("p-ban-frente", "B", "C"),
    ext("p-q2-frente", "C", "D"),
    ext("p-q2-lateral", "D", "E"),
    ext("p-q1-lateral", "E", "F"),
    ext("p-q1-fundo", "F", "G"),
    ext("p-sala-varanda", "G", "H"),
    ext("p-sala-entrada", "H", "I"),
    ext("p-coz-lateral", "I", "A"),
    int("p-coz-sala", "I", "J"),
    int("p-coz-ban", "B", "K"),
    int("p-coz-hall", "K", "J"),
    int("p-ban-hall", "K", "L"),
    int("p-ban-q2", "C", "L"),
    int("p-hall-q2", "L", "M"),
    int("p-q2-q1", "E", "M"),
    int("p-sala-q1", "M", "G"),
    gc("p-var-esq", "H", "N"),
    gc("p-var-frente", "N", "O"),
    gc("p-var-dir", "O", "G"),
  ];

  const janela = (id: string, paredeId: string, posicao: number, largura: number, altura: number, peitoril: number): Abertura => ({
    id,
    paredeId,
    tipo: "janela",
    posicao: est(posicao),
    largura: est(largura),
    altura: est(altura),
    peitoril: est(peitoril),
  });
  const porta = (id: string, paredeId: string, posicao: number, largura: number, extra?: Partial<Abertura>): Abertura => ({
    id,
    paredeId,
    tipo: "porta",
    posicao: est(posicao),
    largura: est(largura),
    altura: est(210, "altura padrão de porta"),
    peitoril: est(0),
    dobradica: "inicio",
    abrePara: "esquerda",
    ...extra,
  });

  const aberturas: Abertura[] = [
    janela("j-cozinha", "p-coz-frente", 140, 120, 100, 110),
    janela("j-banheiro", "p-ban-frente", 85, 60, 50, 160),
    janela("j-quarto2", "p-q2-frente", 155, 150, 120, 100),
    janela("j-quarto1", "p-q1-lateral", 185, 180, 120, 100),
    porta("pt-varanda", "p-sala-varanda", 225, 300, { tipo: "porta-correr", dobradica: undefined, abrePara: undefined }),
    porta("pt-entrada", "p-sala-entrada", 330, 90),
    porta("vao-cozinha", "p-coz-sala", 160, 180, { tipo: "vao", altura: est(220), dobradica: undefined, abrePara: undefined }),
    porta("pt-banheiro", "p-ban-hall", 85, 70),
    porta("pt-quarto2", "p-hall-q2", 55, 80),
    porta("pt-quarto1", "p-sala-q1", 60, 80),
  ];

  const ambientes: Ambiente[] = [
    { id: "amb-cozinha", nome: "Cozinha", tipo: "cozinha", poligono: ["A", "B", "K", "J", "I"], piso: "#d9d4cc" },
    { id: "amb-banheiro", nome: "Banheiro", tipo: "banheiro", poligono: ["B", "C", "L", "K"], piso: "#e4e2de" },
    { id: "amb-quarto2", nome: "Quarto 2", tipo: "quarto", poligono: ["C", "D", "E", "M", "L"], piso: "#b98d62" },
    { id: "amb-quarto1", nome: "Quarto principal", tipo: "quarto", poligono: ["M", "E", "F", "G"], piso: "#b98d62" },
    { id: "amb-sala", nome: "Sala de estar e jantar", tipo: "sala", poligono: ["I", "J", "K", "L", "M", "G", "H"], piso: "#cdbfae" },
    { id: "amb-varanda", nome: "Varanda", tipo: "varanda", poligono: ["H", "G", "O", "N"], piso: "#9f9a92", externo: true },
  ];

  return {
    peDireito: est(260, "padrão residencial"),
    vertices,
    paredes,
    aberturas,
    ambientes,
    provisoria: true,
  };
}

export function criarProjetoInicial(): Projeto {
  const agora = new Date().toISOString();
  return {
    id: "principal",
    nome: "Meu apartamento",
    versaoModelo: 1,
    criadoEm: agora,
    atualizadoEm: agora,
    planta: criarPlantaProvisoria(),
    moveis: [],
  };
}
