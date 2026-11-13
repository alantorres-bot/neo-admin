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
  /** Cor da pintura da parede inteira (as duas faces), quando não há acabamento próprio no trecho. */
  cor?: string;
  /** Acabamento próprio de cada face, por ambiente: "a parede atrás do sofá, do lado da sala". */
  acabamentos?: AcabamentoParede[];
}

/** O que cobre a face de uma parede. */
export type Revestimento = "pintura" | "azulejo" | "cimento" | "tijolinho";

/**
 * Lado de uma parede: andando do vértice `a` para o `b` (na planta, com y para baixo), "direita" é a face
 * do lado direito de quem anda e "esquerda" a do outro lado (ver geometria.ts).
 */
export type LadoParede = "direita" | "esquerda";

/** Acabamento de um trecho de face: o lado da parede voltado para um ambiente. */
export interface AcabamentoParede {
  lado: LadoParede;
  /** Id do ambiente para o qual o trecho está voltado. Sem ambiente: a face inteira desse lado. */
  ambiente?: string;
  cor?: string;
  revestimento?: Revestimento;
}

export type TipoAbertura = "porta" | "porta-correr" | "janela" | "vao";

/** Porta em madeira aparente (com veio) ou pintada (lisa). */
export type AcabamentoPorta = "madeira" | "pintura";

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
  /** Quanto a folha aparece aberta no desenho, em graus (padrão 75; 0 = fechada). */
  aberta?: number;
  /** Acabamento da porta — folha, batente e guarnição (padrão: madeira, como as portas do apartamento). */
  acabamento?: AcabamentoPorta;
  /** Cor da porta (padrão: a do acabamento — ver COR_PORTA_PADRAO no catálogo). */
  cor?: string;
}

export type MaterialPiso = "porcelanato" | "madeira" | "cimento";

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
  /** Cor do piso. */
  piso?: string;
  /** Material do piso (padrão: porcelanato). */
  pisoMaterial?: MaterialPiso;
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

/** Situação do item no inventário do Alan (docs/PREFERENCIAS.md). */
export type Situacao = "tenho" | "comprar" | "sob-medida" | "sugestao";

/**
 * Móvel, eletrodoméstico ou objeto posicionado no apartamento.
 * Referencial próprio: largura ao longo do eixo x local, profundidade no eixo z local,
 * FRENTE apontando para +z local. Com rotacao = 0 a frente aponta para +y da planta (para baixo no desenho);
 * rotação positiva = anti-horária vista de cima (90 → frente para +x; 180 → para −y; 270 → para −x).
 */
export interface Movel {
  id: string;
  /** Item do catálogo (src/catalogo/catalogo.ts) que define a forma e os acabamentos. */
  catalogoId: string;
  nome: string;
  /** Centro da base, em cm, nas coordenadas da planta. */
  x: number;
  y: number;
  /** Altura da base em relação ao piso, cm (0 = no chão; aéreos, quadros e prateleiras têm elevação). */
  elevacao: number;
  /** Graus, anti-horário visto de cima. */
  rotacao: number;
  largura: number; // cm
  profundidade: number; // cm
  altura: number; // cm
  /** Cores que substituem as do catálogo, por parte ("frente", "corpo", "tampo"…). */
  cores?: Record<string, string>;
  /** Acabamentos que substituem os do catálogo, por parte ("madeira", "liso", "pedra"…). */
  acabamentos?: Record<string, string>;
  /** Parâmetros da forma (portas, gavetas, tipo…) que substituem os do catálogo. */
  opcoes?: Record<string, number | string | boolean>;
  /** Peças do mesmo conjunto (ex.: "cozinha") podem se sobrepor sem gerar aviso. */
  grupo?: string;
  situacao?: Situacao;
  obs?: string;
  travado?: boolean;
  /** Evolução futura: modelo 3D importado, loja e preço. */
  modelo?: { tipo: "gltf"; url: string };
  loja?: { nome?: string; url?: string; preco?: number };
}

/** Ponto de vista interno salvo (botões de perspectiva por ambiente). Medidas em cm. */
export interface Vista {
  id: string;
  nome: string;
  ambienteId?: string;
  de: { x: number; y: number; altura: number };
  para: { x: number; y: number; altura: number };
}

export interface Projeto {
  id: string;
  nome: string;
  versaoModelo: 2;
  /** Revisão do projeto-base feita pelo Claude (src/modelo/projetoBase.ts). */
  base: string;
  /** true depois que o Alan altera algo no app; controla a adoção automática de uma base nova. */
  alteradoPeloUsuario?: boolean;
  criadoEm: string;
  atualizadoEm: string;
  planta: Planta;
  moveis: Movel[];
  vistas: Vista[];
}

export type Selecao =
  | { tipo: "parede"; id: string }
  | { tipo: "abertura"; id: string }
  | { tipo: "ambiente"; id: string }
  | { tipo: "vertice"; id: string }
  | { tipo: "movel"; id: string }
  | null;
