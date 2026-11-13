/**
 * Biblioteca de móveis, eletros e objetos. Cada item aponta para uma forma paramétrica (formas.ts),
 * com dimensões padrão de mercado em cm e as partes coloríveis ("slots") com cor e acabamento.
 * Medidas de referência: ver .claude/skills/apartment-studio/SKILL.md.
 */
import type { AcabamentoPorta, Movel } from "../modelo/tipos";
import type { Acabamento, Opcoes } from "./formas";

export type Categoria = "sala" | "quartos" | "cozinha" | "banheiro" | "decoracao";

export const NOME_CATEGORIA: Record<Categoria, string> = {
  sala: "Sala",
  quartos: "Quartos",
  cozinha: "Cozinha",
  banheiro: "Banheiro",
  decoracao: "Decoração",
};

export interface SlotCor {
  rotulo: string;
  cor: string;
  acabamento: Acabamento;
}

export interface ItemCatalogo {
  id: string;
  nome: string;
  categoria: Categoria;
  forma: string;
  largura: number;
  profundidade: number;
  altura: number;
  /** Altura padrão da base em relação ao piso (itens de parede e de bancada). */
  elevacao?: number;
  slots: Record<string, SlotCor>;
  opcoes?: Opcoes;
  /** Luz que o item emite quando as luzes da casa estão acesas (ver luzes.ts). */
  luz?: LuzItem;
}

/** Fonte de luz de um item do catálogo. */
export interface LuzItem {
  /** "ponto": lâmpada (plafon, pendente, abajur). "fita": faixa que ilumina para um lado (fita de LED). */
  tipo: "ponto" | "fita";
  cor: string;
  /** Força da luz, na escala da cena (o sol do meio-dia vale ≈ 1,55). */
  intensidade: number;
  /** Só "ponto": até onde a luz chega, em cm. */
  alcance?: number;
  /** Onde a luz nasce, em fração de largura, altura e profundidade do item (0, 0, 0 = centro da base). */
  em?: [number, number, number];
  /** Só "fita": para onde ilumina (padrão: para baixo). */
  direcao?: "baixo" | "cima" | "frente";
}

/** Paleta do projeto do Alan (docs/PREFERENCIAS.md). */
export const PALETA = {
  verdeSalvia: "#7d8a74",
  verdeRodape: "#5d6a56",
  offWhite: "#e2ddd0",
  madeiraClara: "#cfae86",
  madeiraMel: "#c59b6d",
  // portas do apartamento: madeira "um pouco mais escura que os armários da cozinha" (Alan, 13/11) —
  // ≈ 16% mais escura que a madeira clara dos aéreos; tom aproximado, sem foto
  madeiraPorta: "#b78f66",
  nogueira: "#6d5a46",
  nogueiraEscura: "#2a1f18",
  madeiraMedia: "#7a5236",
  carvalhoClaro: "#d9c9ae",
  quartzo: "#f0ede8",
  granilite: "#e7e4de",
  granitoCinza: "#6f6c69",
  branco: "#f1efeb",
  louca: "#fafafa",
  preto: "#141414",
  vidroPreto: "#0e0e10",
  inox: "#a9adb1",
  grafite: "#3b3e42",
  bege: "#cdc5b8",
  begeClaro: "#d6cfc3",
  cinzaCortina: "#c4c2bd",
  cinzaPorta: "#9c9891",
  palhinha: "#e3c99a",
  almofadaCinza: "#d8d5ce",
  espelho: "#d2dde3",
  vidro: "#cfe3ee",
} as const;

/**
 * Força de um plafon de teto, na escala da cena. Calibrada para a parede a 2 m ficar clara sem estourar
 * e para a casa acesa à noite ficar, na média, mais escura que de dia (conferido em verificar-artefato.mjs).
 */
export const FORCA_PLAFON = 3.2;

/** Cor de uma porta que não teve a cor trocada, conforme o acabamento dela. */
export const COR_PORTA_PADRAO: Record<AcabamentoPorta, string> = { madeira: PALETA.madeiraPorta, pintura: "#f2f0eb" };

const S = (rotulo: string, cor: string, acabamento: Acabamento = "liso"): SlotCor => ({ rotulo, cor, acabamento });

/** Partes de um armário; `frente` e `corpo` variam por item. */
const marcenaria = (corpo: SlotCor, frente: SlotCor, extra: Record<string, SlotCor> = {}): Record<string, SlotCor> => ({
  corpo,
  frente,
  rodape: S("Rodapé", "#8a8782"),
  pes: S("Pés", corpo.cor, corpo.acabamento),
  puxador: S("Puxadores", "#2a2a2a", "metal"),
  tampo: S("Tampo", PALETA.quartzo, "pedra"),
  interior: S("Interior", PALETA.nogueiraEscura, "fosco"),
  nicho: S("Fundo do nicho", corpo.cor, corpo.acabamento),
  cava: S("Puxador cava", "#45463f", "fosco"),
  espelho: S("Espelho", PALETA.espelho, "espelho"),
  ...extra,
});

const branco = S("Corpo", PALETA.branco);
const estofado = { tecido: S("Tecido", PALETA.bege, "tecido"), almofada: S("Almofadas", PALETA.begeClaro, "tecido") };
const eletroInox = {
  corpo: S("Corpo", PALETA.inox, "inox"),
  painel: S("Painel", PALETA.vidroPreto, "vidro-preto"),
  vidro: S("Vidro", PALETA.vidroPreto, "vidro-preto"),
  detalhe: S("Detalhes", "#9aa0a4", "inox"),
};
const eletroPreto = { ...eletroInox, corpo: S("Corpo", "#1a1a1c", "metal") };
const camaSlots = {
  base: S("Base", "#d9d2c5", "tecido"),
  colchao: S("Colchão", "#f4f2ee", "tecido"),
  manta: S("Manta", "#eceae4", "tecido"),
  travesseiro: S("Travesseiros", "#fafaf8", "tecido"),
  cabeceira: S("Cabeceira", PALETA.carvalhoClaro, "madeira"),
};
const mesaSlots = { tampo: S("Tampo", PALETA.madeiraClara, "madeira"), pes: S("Pés", "#1b1b1b", "metal") };
const cadeiraSlots = {
  madeira: S("Estrutura", PALETA.madeiraMel, "madeira"),
  assento: S("Almofada", PALETA.almofadaCinza, "tecido"),
  encosto: S("Encosto", PALETA.palhinha, "palhinha"),
};

export const CATALOGO: ItemCatalogo[] = [
  // ----------------------------------------------------------------------------------------- Sala
  { id: "sofa-3", nome: "Sofá 3 lugares", categoria: "sala", forma: "sofa", largura: 210, profundidade: 90, altura: 85, slots: estofado, opcoes: { modulos: 3 } },
  { id: "sofa-2", nome: "Sofá 2 lugares", categoria: "sala", forma: "sofa", largura: 160, profundidade: 90, altura: 85, slots: estofado, opcoes: { modulos: 2 } },
  { id: "sofa-retratil", nome: "Sofá retrátil", categoria: "sala", forma: "sofa", largura: 230, profundidade: 100, altura: 85, slots: estofado, opcoes: { modulos: 2 } },
  { id: "poltrona", nome: "Poltrona", categoria: "sala", forma: "sofa", largura: 80, profundidade: 85, altura: 85, slots: estofado, opcoes: { modulos: 1, almofadas: false } },
  { id: "mesa-centro", nome: "Mesa de centro", categoria: "sala", forma: "mesa", largura: 90, profundidade: 50, altura: 40, slots: mesaSlots, opcoes: { pes: "quatro" } },
  { id: "mesa-lateral", nome: "Mesa lateral", categoria: "sala", forma: "mesa", largura: 45, profundidade: 45, altura: 55, slots: mesaSlots, opcoes: { pes: "quatro" } },
  {
    id: "rack",
    nome: "Rack",
    categoria: "sala",
    forma: "armario",
    largura: 180,
    profundidade: 40,
    altura: 50,
    slots: marcenaria(S("Corpo", PALETA.nogueiraEscura, "madeira"), S("Portas", PALETA.nogueira, "madeira"), { tampo: S("Tampo", PALETA.nogueira, "madeira") }),
    opcoes: { pes: 15, portas: 4, tampo: true },
  },
  {
    id: "rack-ripado",
    nome: "Rack com portas ripadas",
    categoria: "sala",
    forma: "armario",
    largura: 175,
    profundidade: 38,
    altura: 50.2,
    slots: marcenaria(S("Corpo", PALETA.nogueira, "madeira"), S("Portas ripadas", PALETA.nogueira, "madeira"), { tampo: S("Tampo", PALETA.nogueira, "madeira"), pes: S("Pés", PALETA.nogueira, "madeira") }),
    // desenho do fabricante: tampo 175, corpo 170, pés palito de 15 cm, corpo de 33 cm, nicho central de 55 cm
    opcoes: { pes: 15, estiloPes: "palito", portas: 2, ripado: true, nichoCentral: 55, tampo: true, espessuraTampo: 2.2, recuoCorpo: 2.5, moldura: 1.8, soleira: 1.8 },
  },
  { id: "tv-43", nome: 'TV 43"', categoria: "sala", forma: "tv", largura: 96, profundidade: 4, altura: 56, elevacao: 90, slots: { corpo: S("Corpo", "#101012", "metal"), tela: S("Tela", "#0b0b0c", "vidro-preto") } },
  { id: "tv-55", nome: 'TV 55"', categoria: "sala", forma: "tv", largura: 123, profundidade: 4, altura: 71, elevacao: 82, slots: { corpo: S("Corpo", "#101012", "metal"), tela: S("Tela", "#0b0b0c", "vidro-preto") } },
  { id: "tv-65", nome: 'TV 65"', categoria: "sala", forma: "tv", largura: 145, profundidade: 4, altura: 83, elevacao: 80, slots: { corpo: S("Corpo", "#101012", "metal"), tela: S("Tela", "#0b0b0c", "vidro-preto") } },
  { id: "soundbar", nome: "Soundbar", categoria: "sala", forma: "caixa", largura: 60, profundidade: 10, altura: 5, elevacao: 50, slots: { principal: S("Corpo", "#0b0b0c", "metal") } },
  { id: "painel-tv", nome: "Painel de TV", categoria: "sala", forma: "painel", largura: 180, profundidade: 3, altura: 120, elevacao: 60, slots: { principal: S("Painel", PALETA.madeiraClara, "madeira"), friso: S("Frisos", "#8f7a5c") }, opcoes: { frisos: 0 } },
  { id: "prateleira", nome: "Prateleira", categoria: "sala", forma: "prateleira", largura: 120, profundidade: 21, altura: 4, elevacao: 150, slots: { madeira: S("Madeira", PALETA.madeiraMedia, "madeira"), objeto1: S("Objeto 1", "#2f5d3a"), objeto2: S("Objeto 2", "#3a2a20"), objeto3: S("Objeto 3", "#d9cf9a") }, opcoes: { objetos: false } },
  { id: "tapete", nome: "Tapete", categoria: "sala", forma: "tapete", largura: 200, profundidade: 140, altura: 1.5, slots: { tecido: S("Tecido", "#d8d4cc", "tecido") } },
  { id: "tapete-redondo", nome: "Tapete redondo", categoria: "sala", forma: "tapete", largura: 150, profundidade: 150, altura: 1.5, slots: { tecido: S("Tecido", "#d8d4cc", "tecido") }, opcoes: { redondo: true } },
  { id: "cortina", nome: "Cortina", categoria: "sala", forma: "cortina", largura: 240, profundidade: 8, altura: 255, slots: { tecido: S("Tecido", PALETA.cinzaCortina, "tecido"), trilho: S("Trilho", "#e8e6e2") } },
  { id: "ar-split", nome: "Ar-condicionado split", categoria: "sala", forma: "eletro", largura: 88, profundidade: 22, altura: 30, elevacao: 220, slots: { corpo: S("Corpo", "#f5f5f3"), detalhe: S("Saída de ar", "#b9bcc0") }, opcoes: { tipo: "ar" } },

  // -------------------------------------------------------------------------------------- Quartos
  { id: "cama-casal", nome: "Cama de casal (138 × 188)", categoria: "quartos", forma: "cama", largura: 138, profundidade: 188, altura: 64, slots: camaSlots },
  { id: "cama-queen", nome: "Cama queen (158 × 198)", categoria: "quartos", forma: "cama", largura: 158, profundidade: 198, altura: 64, slots: camaSlots },
  { id: "cama-king", nome: "Cama king (193 × 203)", categoria: "quartos", forma: "cama", largura: 193, profundidade: 203, altura: 64, slots: camaSlots },
  { id: "cama-solteiro", nome: "Cama de solteiro (88 × 188)", categoria: "quartos", forma: "cama", largura: 88, profundidade: 188, altura: 64, slots: camaSlots },
  { id: "cabeceira", nome: "Cabeceira em painel", categoria: "quartos", forma: "painel", largura: 160, profundidade: 2, altura: 120, slots: { principal: S("Painel", PALETA.carvalhoClaro, "madeira"), friso: S("Frisos", "#8f7a5c") }, opcoes: { frisos: 2 } },
  { id: "criado-mudo", nome: "Criado-mudo", categoria: "quartos", forma: "armario", largura: 45, profundidade: 35, altura: 55, slots: marcenaria(S("Corpo", PALETA.carvalhoClaro, "madeira"), S("Gavetas", PALETA.carvalhoClaro, "madeira")), opcoes: { gavetas: 2, pes: 10 } },
  { id: "criado-suspenso", nome: "Criado suspenso", categoria: "quartos", forma: "armario", largura: 40, profundidade: 35, altura: 10, elevacao: 42, slots: marcenaria(S("Corpo", PALETA.carvalhoClaro, "madeira"), S("Gaveta", PALETA.carvalhoClaro, "madeira")), opcoes: { gavetas: 1 } },
  { id: "guarda-roupa", nome: "Guarda-roupa", categoria: "quartos", forma: "armario", largura: 150, profundidade: 57, altura: 240, slots: marcenaria(S("Corpo", PALETA.carvalhoClaro, "madeira"), S("Portas", PALETA.cinzaPorta), { puxador: S("Puxadores", "#c9ccd0", "inox") }), opcoes: { portas: 3, puxador: "barra" } },
  { id: "guarda-roupa-espelho", nome: "Guarda-roupa com espelho", categoria: "quartos", forma: "armario", largura: 100, profundidade: 57, altura: 240, slots: marcenaria(S("Corpo", PALETA.carvalhoClaro, "madeira"), S("Portas", PALETA.cinzaPorta), { puxador: S("Puxadores", "#c9ccd0", "inox") }), opcoes: { portas: 2, puxador: "barra", espelho: true } },
  { id: "armario-ponte", nome: "Armário-ponte (sobre a cama)", categoria: "quartos", forma: "armario", largura: 234, profundidade: 40, altura: 102, elevacao: 158, slots: marcenaria(S("Corpo", "#a8926f", "madeira"), S("Portas", PALETA.carvalhoClaro, "madeira")), opcoes: { portas: 6 } },
  { id: "comoda", nome: "Cômoda", categoria: "quartos", forma: "armario", largura: 120, profundidade: 45, altura: 85, slots: marcenaria(S("Corpo", PALETA.carvalhoClaro, "madeira"), S("Gavetas", PALETA.carvalhoClaro, "madeira")), opcoes: { gavetas: 4, puxador: "barra" } },
  { id: "escrivaninha", nome: "Escrivaninha", categoria: "quartos", forma: "mesa", largura: 120, profundidade: 55, altura: 75, slots: { tampo: S("Tampo", PALETA.branco), pes: S("Laterais", PALETA.branco) }, opcoes: { pes: "painel" } },

  // -------------------------------------------------------------------------------------- Cozinha
  { id: "geladeira", nome: "Geladeira (freezer embaixo)", categoria: "cozinha", forma: "eletro", largura: 70, profundidade: 73, altura: 185, slots: eletroInox, opcoes: { tipo: "geladeira", freezer: "embaixo" } },
  { id: "geladeira-duplex", nome: "Geladeira duplex", categoria: "cozinha", forma: "eletro", largura: 70, profundidade: 73, altura: 180, slots: eletroInox, opcoes: { tipo: "geladeira", freezer: "emcima" } },
  { id: "geladeira-side", nome: "Geladeira side by side", categoria: "cozinha", forma: "eletro", largura: 91, profundidade: 75, altura: 178, slots: eletroInox, opcoes: { tipo: "geladeira", freezer: "lado" } },
  { id: "fogao", nome: "Fogão de piso 4 bocas", categoria: "cozinha", forma: "eletro", largura: 50, profundidade: 60, altura: 88, slots: eletroInox, opcoes: { tipo: "fogao" } },
  { id: "cooktop", nome: "Cooktop 4 bocas", categoria: "cozinha", forma: "eletro", largura: 58, profundidade: 51, altura: 1, elevacao: 90, slots: { vidro: S("Vidro", PALETA.vidroPreto, "vidro-preto"), detalhe: S("Zonas", "#2c2c2e") }, opcoes: { tipo: "cooktop" } },
  { id: "forno", nome: "Forno de embutir", categoria: "cozinha", forma: "eletro", largura: 59.5, profundidade: 57, altura: 59, elevacao: 16, slots: eletroPreto, opcoes: { tipo: "forno" } },
  { id: "microondas", nome: "Micro-ondas", categoria: "cozinha", forma: "eletro", largura: 46, profundidade: 35, altura: 27, elevacao: 90, slots: { ...eletroInox, corpo: S("Corpo", "#f4f4f4") }, opcoes: { tipo: "microondas" } },
  { id: "lava-loucas", nome: "Lava-louças 60 cm", categoria: "cozinha", forma: "eletro", largura: 60, profundidade: 60, altura: 82, slots: eletroInox, opcoes: { tipo: "lavaloucas" } },
  { id: "lava-loucas-compacta", nome: "Lava-louças compacta (8 serviços)", categoria: "cozinha", forma: "eletro", largura: 55, profundidade: 52, altura: 59.5, elevacao: 26, slots: eletroInox, opcoes: { tipo: "lavaloucas" } },
  { id: "lava-e-seca", nome: "Lava e seca (abertura frontal)", categoria: "cozinha", forma: "eletro", largura: 60, profundidade: 62, altura: 85, slots: { corpo: S("Corpo", PALETA.grafite, "metal"), painel: S("Painel", "#151617", "vidro-preto"), detalhe: S("Aro da porta", "#232527", "metal"), vidro: S("Vidro", PALETA.vidroPreto, "vidro-preto") }, opcoes: { tipo: "lavadora" } },
  { id: "depurador", nome: "Depurador slim", categoria: "cozinha", forma: "eletro", largura: 56, profundidade: 36, altura: 5, elevacao: 150, slots: { corpo: S("Corpo", "#9aa0a4", "inox") }, opcoes: { tipo: "caixa" } },
  { id: "armario-base", nome: "Armário de baixo (portas)", categoria: "cozinha", forma: "armario", largura: 70, profundidade: 60, altura: 87, slots: marcenaria(S("Corpo", PALETA.verdeSalvia), S("Portas", PALETA.verdeSalvia), { rodape: S("Rodapé", PALETA.verdeRodape), cava: S("Puxador cava", "#3a4233", "fosco") }), opcoes: { portas: 2, rodape: 10, cava: true } },
  { id: "gaveteiro-base", nome: "Gaveteiro de baixo", categoria: "cozinha", forma: "armario", largura: 45, profundidade: 60, altura: 87, slots: marcenaria(S("Corpo", PALETA.verdeSalvia), S("Gavetas", PALETA.verdeSalvia), { rodape: S("Rodapé", PALETA.verdeRodape), cava: S("Puxador cava", "#3a4233", "fosco") }), opcoes: { gavetas: 3, rodape: 10, cava: true } },
  { id: "armario-aereo", nome: "Armário aéreo", categoria: "cozinha", forma: "armario", largura: 80, profundidade: 35, altura: 62, elevacao: 198, slots: marcenaria(S("Corpo", PALETA.offWhite), S("Portas", PALETA.offWhite)), opcoes: { portas: 1 } },
  { id: "aereo-madeira", nome: "Armário aéreo em madeira", categoria: "cozinha", forma: "armario", largura: 80, profundidade: 32, altura: 38, elevacao: 155, slots: marcenaria(S("Corpo", PALETA.madeiraClara, "madeira"), S("Portas", PALETA.madeiraClara, "madeira")), opcoes: { portas: 2 } },
  { id: "peca-marcenaria", nome: "Painel de marcenaria", categoria: "cozinha", forma: "caixa", largura: 60, profundidade: 2, altura: 200, slots: { principal: S("Cor", PALETA.offWhite) } },
  { id: "nicho", nome: "Nicho aberto", categoria: "cozinha", forma: "armario", largura: 60, profundidade: 40, altura: 38, elevacao: 155, slots: marcenaria(S("Madeira", PALETA.madeiraClara, "madeira"), S("Frente", PALETA.madeiraClara, "madeira")), opcoes: { aberto: true } },
  { id: "paneleiro", nome: "Armário alto (paneleiro)", categoria: "cozinha", forma: "armario", largura: 60, profundidade: 60, altura: 220, slots: marcenaria(S("Corpo", PALETA.offWhite), S("Portas", PALETA.offWhite)), opcoes: { portas: 1, rodape: 10 } },
  { id: "bancada", nome: "Bancada de pedra", categoria: "cozinha", forma: "caixa", largura: 120, profundidade: 62, altura: 3, elevacao: 87, slots: { principal: S("Pedra", PALETA.quartzo, "pedra") } },
  { id: "frontao", nome: "Revestimento / frontão", categoria: "cozinha", forma: "caixa", largura: 120, profundidade: 1, altura: 65, elevacao: 90, slots: { principal: S("Revestimento", PALETA.granilite, "granilite") } },
  { id: "cuba-inox", nome: "Cuba inox com torneira", categoria: "cozinha", forma: "cuba", largura: 50, profundidade: 40, altura: 30, elevacao: 89.5, slots: { cuba: S("Cuba", "#9aa0a4", "inox"), fundo: S("Fundo", "#5d6266", "inox"), metal: S("Torneira", "#b9bdc1", "cromado") }, opcoes: { torneira: "fundo" } },
  { id: "mesa-jantar", nome: "Mesa de jantar (pé em U)", categoria: "cozinha", forma: "mesa", largura: 120, profundidade: 80, altura: 75, slots: mesaSlots, opcoes: { pes: "U" } },
  { id: "mesa-jantar-4", nome: "Mesa de jantar (4 pés)", categoria: "cozinha", forma: "mesa", largura: 140, profundidade: 80, altura: 75, slots: { tampo: S("Tampo", PALETA.madeiraClara, "madeira"), pes: S("Pés", PALETA.madeiraClara, "madeira") }, opcoes: { pes: "quatro" } },
  { id: "mesa-redonda", nome: "Mesa redonda", categoria: "cozinha", forma: "mesa", largura: 100, profundidade: 100, altura: 75, slots: { tampo: S("Tampo", "#f4f2ee", "pedra"), pes: S("Pé", "#f4f2ee") }, opcoes: { pes: "central", redonda: true } },
  { id: "cadeira-palhinha", nome: "Cadeira com palhinha", categoria: "cozinha", forma: "cadeira", largura: 47, profundidade: 47, altura: 86, slots: cadeiraSlots, opcoes: { encosto: "palhinha" } },
  { id: "cadeira", nome: "Cadeira estofada", categoria: "cozinha", forma: "cadeira", largura: 46, profundidade: 50, altura: 88, slots: { ...cadeiraSlots, madeira: S("Estrutura", "#1b1b1b", "metal") }, opcoes: { encosto: "estofado" } },
  { id: "banqueta", nome: "Banqueta de bancada", categoria: "cozinha", forma: "banqueta", largura: 38, profundidade: 38, altura: 65, slots: { madeira: S("Estrutura", "#1b1b1b", "metal"), assento: S("Assento", PALETA.madeiraClara, "madeira") } },

  // ------------------------------------------------------------------------------------- Banheiro
  { id: "gabinete", nome: "Gabinete com tampo", categoria: "banheiro", forma: "armario", largura: 80, profundidade: 47, altura: 86, slots: marcenaria(branco, S("Portas", PALETA.branco), { rodape: S("Rodapé", "#dcdad6"), puxador: S("Puxadores", PALETA.preto, "metal"), tampo: S("Tampo", PALETA.granitoCinza, "granito") }), opcoes: { portas: 2, rodape: 12, puxador: "botao", tampo: true } },
  { id: "cuba-oval", nome: "Cuba oval de embutir", categoria: "banheiro", forma: "cuba", largura: 40, profundidade: 30, altura: 24, elevacao: 86, slots: { cuba: S("Louça", PALETA.louca, "louca"), fundo: S("Fundo", "#e9e9e6", "louca"), metal: S("Torneira", "#c9ccd0", "cromado") }, opcoes: { oval: true, torneira: "fundo" } },
  { id: "armario-espelho", nome: "Armário de espelho", categoria: "banheiro", forma: "armario", largura: 80, profundidade: 13, altura: 75, elevacao: 120, slots: marcenaria(branco, S("Portas", PALETA.branco)), opcoes: { portas: 2, espelho: true } },
  { id: "espelho", nome: "Espelho", categoria: "banheiro", forma: "caixa", largura: 80, profundidade: 2, altura: 70, elevacao: 120, slots: { principal: S("Espelho", PALETA.espelho, "espelho") } },
  { id: "box-frontal", nome: "Box de vidro (frontal)", categoria: "banheiro", forma: "box", largura: 95, profundidade: 4, altura: 190, slots: { vidro: S("Vidro", PALETA.vidro, "vidro"), perfil: S("Perfil", PALETA.branco), detalhe: S("Puxador", "#c9ccd0", "cromado") }, opcoes: { tipo: "frontal" } },
  { id: "box-canto", nome: "Box de vidro (canto)", categoria: "banheiro", forma: "box", largura: 90, profundidade: 90, altura: 190, slots: { vidro: S("Vidro", PALETA.vidro, "vidro"), perfil: S("Perfil", PALETA.branco), detalhe: S("Puxador", "#c9ccd0", "cromado") }, opcoes: { tipo: "canto" } },
  { id: "chuveiro", nome: "Chuveiro", categoria: "banheiro", forma: "chuveiro", largura: 12, profundidade: 22, altura: 20, elevacao: 195, slots: { cromado: S("Metal", "#c9ccd0", "cromado") } },
  { id: "vaso-sanitario", nome: "Vaso com caixa acoplada", categoria: "banheiro", forma: "vaso", largura: 38, profundidade: 62, altura: 78, slots: { louca: S("Louça", PALETA.louca, "louca") } },
  { id: "toalheiro", nome: "Toalheiro (barra)", categoria: "banheiro", forma: "toalheiro", largura: 50, profundidade: 8, altura: 6, elevacao: 120, slots: { cromado: S("Metal", "#c9ccd0", "cromado") } },
  { id: "fita-led", nome: "Fita de LED", categoria: "banheiro", forma: "caixa", largura: 80, profundidade: 2.5, altura: 0.6, elevacao: 119, slots: { principal: S("Luz", "#ffe2b0", "led") }, luz: { tipo: "fita", cor: "#ffd9a8", intensidade: 10, direcao: "baixo" } },

  // ------------------------------------------------------------------------------------ Decoração
  { id: "quadro", nome: "Quadro", categoria: "decoracao", forma: "quadro", largura: 46, profundidade: 3, altura: 62, elevacao: 124, slots: { moldura: S("Moldura", "#1c1c1c"), arte: S("Arte", "#b9a583") } },
  { id: "remo", nome: "Remo decorativo", categoria: "decoracao", forma: "remo", largura: 19, profundidade: 2, altura: 95, elevacao: 100, slots: { remo: S("Remo", "#ffffff") } },
  { id: "planta-vaso", nome: "Planta em vaso", categoria: "decoracao", forma: "planta", largura: 45, profundidade: 45, altura: 110, slots: { vaso: S("Vaso", "#d8d2c8", "louca"), folha: S("Folhagem", "#4f7a4a", "fosco") } },
  { id: "planta-pequena", nome: "Planta pequena", categoria: "decoracao", forma: "planta", largura: 20, profundidade: 20, altura: 35, slots: { vaso: S("Vaso", "#f1efeb", "louca"), folha: S("Folhagem", "#4f7a4a", "fosco") } },
  { id: "luminaria-piso", nome: "Luminária de piso", categoria: "decoracao", forma: "luminaria", largura: 26, profundidade: 26, altura: 150, slots: { metal: S("Estrutura", "#161616", "metal"), detalhe: S("Detalhe", "#c9a06a", "metal") }, opcoes: { tipo: "piso" }, luz: { tipo: "ponto", cor: "#ffd2a1", intensidade: 2, alcance: 420, em: [0.3, 0.86, 0.22] } },
  { id: "pendente", nome: "Luminária pendente", categoria: "decoracao", forma: "luminaria", largura: 35, profundidade: 35, altura: 70, elevacao: 190, slots: { metal: S("Fio", "#161616", "metal"), detalhe: S("Cúpula", "#161616", "metal") }, opcoes: { tipo: "pendente" }, luz: { tipo: "ponto", cor: "#ffd9ae", intensidade: 3, alcance: 480, em: [0, 0.1, 0] } },
  { id: "abajur", nome: "Abajur", categoria: "decoracao", forma: "luminaria", largura: 22, profundidade: 22, altura: 40, elevacao: 55, slots: { tecido: S("Cúpula", "#efe9dc", "tecido"), detalhe: S("Base", "#c9a06a", "metal") }, opcoes: { tipo: "abajur" }, luz: { tipo: "ponto", cor: "#ffd6a6", intensidade: 1.2, alcance: 300, em: [0, 0.75, 0] } },
  { id: "plafon", nome: "Plafon de teto", categoria: "decoracao", forma: "cilindro", largura: 30, profundidade: 30, altura: 3, elevacao: 257, slots: { principal: S("Luz", "#fff3dd", "led") }, luz: { tipo: "ponto", cor: "#ffe3bf", intensidade: FORCA_PLAFON, alcance: 700, em: [0, -12, 0] } },
  { id: "fita-led-teto", nome: "Fita de LED no teto", categoria: "decoracao", forma: "caixa", largura: 200, profundidade: 3, altura: 0.6, elevacao: 259.4, slots: { principal: S("Luz", "#fff0d6", "led") }, luz: { tipo: "fita", cor: "#ffe6c4", intensidade: 17, direcao: "baixo" } },
  { id: "vaso-decorativo", nome: "Vaso decorativo", categoria: "decoracao", forma: "cilindro", largura: 14, profundidade: 14, altura: 28, slots: { principal: S("Vaso", "#2f5d3a", "louca") }, opcoes: { afunila: 0.7 } },
  { id: "banqueta-redonda", nome: "Banqueta redonda", categoria: "decoracao", forma: "banqueta", largura: 36, profundidade: 36, altura: 45, slots: { madeira: S("Estrutura", "#1b1b1b", "metal"), assento: S("Assento", "#c39a6b", "madeira") }, opcoes: { redonda: true } },
];

const POR_ID = new Map(CATALOGO.map((i) => [i.id, i]));

export function itemCatalogo(id: string): ItemCatalogo | undefined {
  return POR_ID.get(id);
}

/** Cor e acabamento efetivos de cada parte do móvel (catálogo + cores trocadas pelo usuário). */
export function slotsDoMovel(m: Pick<Movel, "catalogoId" | "cores" | "acabamentos">): Record<string, SlotCor> {
  const item = itemCatalogo(m.catalogoId);
  const base = item?.slots ?? {};
  if (!m.cores && !m.acabamentos) return base;
  const out: Record<string, SlotCor> = { ...base };
  const padrao = (slot: string): SlotCor => out[slot] ?? { rotulo: slot, cor: "#bdbdbd", acabamento: "liso" };
  for (const [slot, cor] of Object.entries(m.cores ?? {})) out[slot] = { ...padrao(slot), cor };
  for (const [slot, acabamento] of Object.entries(m.acabamentos ?? {})) out[slot] = { ...padrao(slot), acabamento: acabamento as Acabamento };
  return out;
}

export function opcoesDoMovel(m: Pick<Movel, "catalogoId" | "opcoes">): Opcoes {
  return { ...(itemCatalogo(m.catalogoId)?.opcoes ?? {}), ...(m.opcoes ?? {}) };
}

let contador = 0;
export function novoId(prefixo = "m"): string {
  contador += 1;
  return `${prefixo}-${Date.now().toString(36)}-${contador.toString(36)}`;
}

/** Cria um móvel a partir do catálogo, na posição dada. */
export function criarMovel(catalogoId: string, x: number, y: number, extra: Partial<Movel> = {}): Movel {
  const item = itemCatalogo(catalogoId);
  if (!item) throw new Error(`Item de catálogo inexistente: ${catalogoId}`);
  return {
    id: novoId(),
    catalogoId,
    nome: item.nome,
    x,
    y,
    elevacao: item.elevacao ?? 0,
    rotacao: 0,
    largura: item.largura,
    profundidade: item.profundidade,
    altura: item.altura,
    ...extra,
  };
}
