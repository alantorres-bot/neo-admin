/**
 * Projeto executivo de marcenaria (cozinha e suíte), derivado do modelo 3D.
 *
 * Tudo em MILÍMETROS. Cada conjunto de móveis é descrito num "quadro" preso a uma parede:
 *   s = ao longo da parede · d = distância da face da parede (profundidade) · z = altura a partir do piso.
 * Cada peça é um sólido alinhado aos eixos. Vistas, cortes, lista de peças, fitas e áreas saem todos
 * desses mesmos sólidos — é o que garante que o desenho, a planilha e o 3D contem a mesma história.
 */

/** Padrão (cor/acabamento) do painel. */
export type Padrao = "branco" | "verde" | "offwhite" | "madeira" | "carvalho" | "cinza";

/** O que a peça é. As classes de contexto (aparelho, pedra…) aparecem no desenho e não entram na lista de corte. */
export type Classe =
  | "lateral"
  | "base"
  | "tampo"
  | "travessa"
  | "divisoria"
  | "prateleira"
  | "fundo"
  | "porta"
  | "frente-gaveta"
  | "frente-fixa"
  | "gaveta"
  | "rodape"
  | "painel"
  | "arremate"
  | "espelho"
  | "perfil"
  | "varao"
  | "puxador"
  | "aparelho"
  | "pedra"
  | "contexto";

/** De onde vem uma medida. Nunca apresentar estimada como confirmada. */
export type Origem =
  | "planta" // cota escrita na planta da construtora
  | "estimada" // lida pela escala da imagem ou padrão adotado — conferir no local
  | "levantar" // sem valor disponível — medir no local
  | "modelo" // medida do móvel no 3D aprovado
  | "proposta" // detalhe executivo proposto (interior, ferragem) — aprovar
  | "aparelho"; // medida típica do aparelho — modelo não informado

export interface Caixa3 {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  z0: number;
  z1: number;
}

/** Bordas que levam fita, contadas por eixo ao longo do qual a borda corre. */
export interface Fita {
  s?: number;
  d?: number;
  z?: number;
}

export interface Solido extends Caixa3 {
  nome: string;
  classe: Classe;
  padrao?: Padrao;
  fita?: Fita;
  /** Porta de giro: lado da dobradiça (extremo s0 ou s1 da folha). */
  dobr?: "s0" | "s1";
  obs?: string;
  /** Engrossado: a espessura é formada por N chapas coladas (painel de 30 = 2 × 15). */
  chapas?: number;
  /** Cor de desenho (aparelhos, pedras). */
  cor?: string;
  /** Vários sólidos que são UMA peça recortada (ex.: divisória em L): viram uma linha só na lista de corte. */
  peca?: { chave: string; comp: number; larg: number; obs: string };
  /** Não desenhar nas elevações (peças internas das gavetas, por exemplo, só aparecem na vista interna). */
  soInterno?: boolean;
}

export interface Ferragem {
  item: string; // chave em FERRAGENS
  qtd: number;
  obs?: string;
}

export interface Modulo {
  cod: string;
  nome: string;
  lote: string;
  conjunto: string; // id do quadro
  /** Ids dos móveis do modelo 3D que este módulo executa (a envoltória tem de bater com eles). */
  movelIds: string[];
  /** Envoltória externa do módulo (do modelo 3D). */
  caixa: Caixa3;
  externo: string;
  interno: string;
  abertura: string;
  solidos: Solido[];
  ferragens: Ferragem[];
  notas: string[];
}

export interface LinhaPeca {
  modulo: string;
  n: number;
  nome: string;
  qtd: number;
  comp: number;
  larg: number;
  esp: number;
  padrao: Padrao;
  material: string;
  /** Bordas com fita no comprimento e na largura. */
  fitaC: number;
  fitaL: number;
  fitaM: number; // metros
  areaM2: number;
  obs?: string;
}

export interface Pendencia {
  cod: string;
  onde: string;
  texto: string;
  tipo: "medir" | "decidir" | "aparelho" | "tecnico";
  /** true = sem isto o orçamento pode mudar de valor. */
  afetaPreco: boolean;
}

export interface Quadro {
  id: string;
  nome: string;
  /** Origem do quadro na planta (cm) e direções de s e d. */
  origem: { x: number; y: number };
  eixoS: { x: number; y: number };
  eixoD: { x: number; y: number };
  comprimento: number; // mm
  /** Elevação desenhada com s crescendo para a esquerda (quem olha a parede vê s ao contrário). */
  espelhado: boolean;
}
