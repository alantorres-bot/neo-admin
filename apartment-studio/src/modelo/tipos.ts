/**
 * Modelo paramétrico do apartamento.
 * Todas as medidas em CENTÍMETROS. A cena 3D converte para metros (cm / 100).
 * Eixo X da planta = X da cena; eixo Y da planta (para baixo no desenho) = Z da cena.
 */

/** De onde veio a medida. Nunca apresentar "estimada" como se fosse real. */
export type OrigemMedida = "cota" | "derivada" | "estimada" | "manual";

export interface Medida {
  valor: number; // cm
  origem: OrigemMedida;
  obs?: string;
}

export interface Vertice {
  id: string;
  x: number; // cm
  y: number; // cm
  origem: OrigemMedida;
}

export type TipoParede = "alvenaria" | "divisoria" | "guarda-corpo";

export interface Parede {
  id: string;
  a: string; // id do vértice inicial
  b: string; // id do vértice final
  tipo: TipoParede;
  /** Nome próprio (shaft, pilar…); sem nome, a interface deriva dos ambientes vizinhos. */
  nome?: string;
  espessura: Medida;
  /** Altura própria (guarda-corpo, mureta). Sem valor = pé-direito do projeto. */
  altura?: Medida;
  /** Cor das faces (Etapa 5 trocará por materiais). */
  cor?: string;
}

export type TipoAbertura = "porta" | "porta-correr" | "janela" | "vao";

export interface Abertura {
  id: string;
  paredeId: string;
  tipo: TipoAbertura;
  /** Distância do vértice "a" da parede até o CENTRO da abertura, cm. */
  posicao: Medida;
  largura: Medida;
  altura: Medida;
  /** Altura do piso até a base da abertura (0 em portas). */
  peitoril: Medida;
  /** Porta de giro: lado da dobradiça e para que lado da parede abre. */
  dobradica?: "inicio" | "fim";
  abrePara?: "esquerda" | "direita";
}

export type TipoAmbiente =
  | "sala"
  | "jantar"
  | "cozinha"
  | "quarto"
  | "banheiro"
  | "circulacao"
  | "varanda"
  | "servico"
  | "outro";

export interface Ambiente {
  id: string;
  nome: string;
  tipo: TipoAmbiente;
  /** Polígono em ordem (horária ou anti-horária) de ids de vértices. */
  poligono: string[];
  /** Área informada na planta (m²), se houver — serve de conferência. */
  areaInformada?: number;
  piso?: string; // cor do piso (Etapa 5: material)
  /** Ambiente externo não recebe teto. */
  externo?: boolean;
}

/** Imagem da planta usada como fundo/decalque na vista superior. */
export interface ReferenciaPlanta {
  imagem: string; // dataURL
  larguraPx: number;
  alturaPx: number;
  /** Quantos cm reais cada pixel da imagem representa (calibrado por cota). */
  cmPorPx: number;
  /** Deslocamento do canto superior esquerdo da imagem, cm. */
  x: number;
  y: number;
  rotacao: number; // graus
  opacidade: number; // 0..1
  visivel: boolean;
  calibracao?: { cotaCm: number; medidoPx: number };
}

/** Referência de uma cota: face de parede (lado "-" = menor coordenada, "+" = maior) ou vértice. */
export type RefCota = { parede: string; face: "-" | "+" } | { vertice: string };

/** Cota escrita na planta, conferida automaticamente contra o modelo. */
export interface CotaPlanta {
  id: string;
  /** Texto como aparece na planta (ex.: "2,40"). */
  texto: string;
  valor: number; // cm
  descricao: string;
  eixo: "x" | "y";
  a: RefCota;
  b: RefCota;
  /** Onde desenhar o rótulo na vista de planta (cm). */
  rotulo: { x: number; y: number };
  /** "confirmada" = interpretação segura; "a-confirmar" = não está claro a que trecho a cota se refere. */
  situacao: "confirmada" | "a-confirmar";
  obs?: string;
}

export interface Planta {
  nome?: string;
  peDireito: Medida;
  vertices: Vertice[];
  paredes: Parede[];
  aberturas: Abertura[];
  ambientes: Ambiente[];
  /** true enquanto o modelo não foi conferido com a planta real do apartamento. */
  provisoria: boolean;
  referencia?: ReferenciaPlanta;
  cotas?: CotaPlanta[];
}

/** Preparado para a Etapa 4 (editor de móveis). */
export interface Movel {
  id: string;
  catalogoId: string;
  nome: string;
  posicao: { x: number; y: number; z: number }; // cm
  rotacao: number; // graus em torno do eixo vertical
  dimensoes: { largura: number; profundidade: number; altura: number }; // cm
  cor?: string;
  ambienteId?: string;
  modelo?: { tipo: "primitivo" } | { tipo: "gltf"; url: string };
  loja?: { nome?: string; url?: string; preco?: number };
}

export interface Projeto {
  id: string;
  nome: string;
  versaoModelo: 1;
  criadoEm: string;
  atualizadoEm: string;
  planta: Planta;
  moveis: Movel[];
}

export type Selecao =
  | { tipo: "parede"; id: string }
  | { tipo: "abertura"; id: string }
  | { tipo: "ambiente"; id: string }
  | { tipo: "vertice"; id: string }
  | null;
