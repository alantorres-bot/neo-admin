/**
 * Mobília do projeto-base: as coisas do Alan e a marcenaria pedida, posicionadas em cm reais sobre a
 * planta (docs/PREFERENCIAS.md). Coordenadas da planta: origem no canto externo superior esquerdo.
 *
 * Faces internas usadas como referência (cm):
 *   cozinha: parede esquerda x = 10; parede da janela y = 74; shaft x 10–32, y 74–139; divisória x = 160/167
 *   sala: divisória x = 167; parede da TV x = 407; parede da sacada y = 74; parede do fundo y = 526
 *   banheiro: x 414–654, y 406–526; shaft x 414–506, y 501–526
 *   suíte: x 662–913, y 10–402 · quarto 2: x 414–654, y 10–297 · varanda: y 7–67
 * Rotação: 0 = frente para baixo (+y); 90 = frente para a direita (+x); 180 = para cima; 270 = para a esquerda.
 */
import { criarMovel, PALETA } from "../catalogo/catalogo";
import type { Movel, Vista } from "./tipos";

const it = (id: string, catalogoId: string, nome: string, x: number, y: number, rotacao: number, extra: Partial<Movel> = {}): Movel =>
  criarMovel(catalogoId, x, y, { id, nome, rotacao, ...extra });

const dim = (largura: number, profundidade: number, altura: number) => ({ largura, profundidade, altura });

export function criarMobilia(): Movel[] {
  const coz = { grupo: "cozinha", situacao: "sob-medida" as const };
  const carvalho = { cores: { principal: PALETA.carvalhoClaro }, acabamentos: { principal: "madeira" } };
  const suite = { grupo: "suite-marcenaria", situacao: "sob-medida" as const };

  return [
    // =================================================================== COZINHA — parede lateral (3,87 m)
    it("coz-gaveteiro", "gaveteiro-base", "Gaveteiro (canto do shaft)", 40, 180, 90, { ...coz, ...dim(82, 60, 87), opcoes: { gavetas: 3, rodape: 10 } }),
    it("coz-base-forno", "armario-base", "Módulo do forno", 40, 251, 90, { ...coz, ...dim(60, 60, 87), opcoes: { gavetas: 1, portas: 0, rodape: 10 } }),
    it("coz-forno", "forno", "Forno de embutir 60 cm", 42.5, 251, 90, { grupo: "cozinha", situacao: "comprar", obs: "Confirmar se já tem." }),
    it("coz-cooktop", "cooktop", "Cooktop 4 bocas", 40.5, 251, 90, { grupo: "cozinha", situacao: "comprar", obs: "Confirmar se já tem." }),
    it("coz-base-lavaloucas", "armario-base", "Módulo da lava-louças", 40, 311.5, 90, { ...coz, ...dim(61, 60, 87), opcoes: { gavetas: 1, portas: 0, rodape: 10 } }),
    it("coz-lavaloucas", "lava-loucas-compacta", "Lava-louças Electrolux 8 serviços", 45, 311.5, 90, { grupo: "cozinha", situacao: "tenho", obs: "Medidas típicas (55 × 52 × 59,5); conferir o modelo." }),
    it("coz-base-pia", "armario-base", "Armário da pia", 40, 377, 90, { ...coz, ...dim(70, 60, 87), opcoes: { portas: 2, rodape: 10 } }),
    it("coz-base-porta", "armario-base", "Armário de 1 porta", 40, 430, 90, { ...coz, ...dim(36, 60, 87), opcoes: { portas: 1, rodape: 10 } }),
    it("coz-bancada", "bancada", "Bancada de quartzo branco", 41, 293.5, 90, { ...coz, ...dim(309, 62, 3) }),
    it("coz-frontao", "frontao", "Frontão granilite", 10.5, 293.5, 90, { ...coz, ...dim(309, 1, 65) }),
    it("coz-cuba", "cuba-inox", "Cuba inox 50 × 40", 42, 377, 90, { ...coz, elevacao: 89.6 }),
    it("coz-aereo-superior", "armario-aereo", "Aéreo superior off-white (até o teto)", 28, 293.5, 90, { ...coz, ...dim(309, 36, 62), opcoes: { portas: 4 } }),
    it("coz-faixa-verde", "peca-marcenaria", "Faixa verde entre os aéreos", 24, 293.5, 90, { ...coz, ...dim(309, 28, 5), elevacao: 193, cores: { principal: PALETA.verdeSalvia } }),
    it("coz-aereo-madeira", "aereo-madeira", "Aéreo inferior em madeira clara", 26, 262, 90, { ...coz, ...dim(246, 32, 38), opcoes: { portas: 5 } }),
    it("coz-nicho-micro", "nicho", "Nicho do micro-ondas", 30, 416.5, 90, { ...coz, ...dim(63, 40, 38) }),
    it("coz-microondas", "microondas", "Micro-ondas Midea", 30.5, 416.5, 90, { grupo: "cozinha", situacao: "tenho", elevacao: 157, obs: "Medidas típicas (46 × 35 × 27); conferir o modelo." }),
    it("coz-depurador", "depurador", "Depurador slim", 28, 251, 90, { grupo: "cozinha", situacao: "comprar" }),
    it("coz-led", "fita-led", "Fita de LED sob o aéreo", 13.25, 262, 90, { ...coz, ...dim(246, 2.5, 0.6), elevacao: 154.3 }),
    // torre da geladeira
    it("coz-painel-geladeira", "peca-marcenaria", "Painel lateral da torre", 47.5, 449.5, 90, { ...coz, ...dim(3, 75, 260) }),
    it("coz-aereo-geladeira", "armario-aereo", "Armário sobre a geladeira", 46, 488.5, 90, { ...coz, ...dim(75, 72, 62), opcoes: { portas: 2 } }),
    it("coz-geladeira", "geladeira", "Geladeira LG (freezer embaixo)", 49.5, 488.5, 90, { grupo: "cozinha", situacao: "tenho", obs: "Medidas típicas (70 × 73 × 185); conferir o modelo." }),
    // =================================================================== COZINHA — pedra sob a janela
    it("coz-pedra-janela", "bancada", "Pedra sob a janela", 96, 106.5, 0, { ...coz, ...dim(128, 65, 3) }),
    it("coz-frontao-janela", "frontao", "Frontão sob a janela", 96, 74.5, 0, { ...coz, ...dim(128, 1, 20) }),
    it("coz-base-tanque", "armario-base", "Armário do tanque", 65, 107.5, 0, { ...coz, ...dim(66, 63, 87), opcoes: { portas: 2, rodape: 10 } }),
    it("coz-tanque", "cuba-inox", "Tanque (cuba 50 × 40)", 65, 104, 0, { ...coz, elevacao: 89.6, opcoes: { torneira: "lado" } }),
    it("coz-lava-e-seca", "lava-e-seca", "Lava e seca Midea grafite", 129.5, 108, 0, { grupo: "cozinha", situacao: "tenho", obs: "Conferir a profundidade (não pode passar de 62 cm)." }),
    it("coz-revest-shaft-a", "frontao", "Granilite na face do shaft", 32.5, 106.5, 90, { ...coz, ...dim(65, 1, 65) }),
    it("coz-revest-shaft-b", "frontao", "Granilite na ponta do shaft", 21, 139.5, 0, { ...coz, ...dim(22, 1, 65) }),

    // ============================================================================================ JANTAR
    it("jan-mesa", "mesa-jantar", "Mesa de jantar 1,20 × 0,80 (nova)", 226, 466, 90, { grupo: "jantar", situacao: "comprar", opcoes: { pes: "U", apoioParede: true }, obs: "Com 1,40 m a passagem até o sofá cairia para ≈70 cm." }),
    it("jan-cadeira-1", "cadeira-palhinha", "Cadeira de palhinha", 199, 498, 90, { grupo: "jantar", situacao: "tenho" }),
    it("jan-cadeira-2", "cadeira-palhinha", "Cadeira de palhinha", 199, 440, 90, { grupo: "jantar", situacao: "tenho" }),
    it("jan-cadeira-3", "cadeira-palhinha", "Cadeira de palhinha", 253, 498, 270, { grupo: "jantar", situacao: "tenho" }),
    it("jan-cadeira-4", "cadeira-palhinha", "Cadeira de palhinha", 253, 440, 270, { grupo: "jantar", situacao: "tenho" }),
    it("jan-remo-1", "remo", "Remo decorativo", 212, 525, 180, { grupo: "jantar", situacao: "tenho", elevacao: 105 }),
    it("jan-remo-2", "remo", "Remo decorativo", 240, 525, 180, { grupo: "jantar", situacao: "tenho", elevacao: 91 }),

    // ============================================================================================== SALA
    it("sala-sofa", "sofa-retratil", "Sofá bege retrátil 2,30 m", 217, 201, 90, { situacao: "tenho", obs: "Profundidade estimada (100 cm fechado). Aberto avança 50–70 cm." }),
    it("sala-quadro", "quadro", "Quadro", 168.5, 201, 90, { situacao: "tenho" }),
    it("sala-cortina", "cortina", "Cortina cinza", 277, 78, 0, { situacao: "tenho", ...dim(216, 8, 255), obs: "A atual cobre tudo; será cortada. Vai da divisória até a frente da prateleira (que encosta na parede da sacada)." }),
    it("sala-rack", "rack-ripado", "Rack nogueira com portas ripadas", 388, 200, 270, { situacao: "tenho" }),
    it("sala-tv", "tv-55", 'TV 55"', 405, 200, 270, { situacao: "tenho" }),
    it("sala-soundbar", "soundbar", "Soundbar", 386, 200, 270, { situacao: "tenho", elevacao: 50.2 }),
    it("sala-prateleira", "prateleira", "Prateleira de parede a parede", 396.5, 189, 270, { situacao: "tenho", ...dim(230, 21, 4), elevacao: 185, opcoes: { objetos: true }, obs: "Será cortada para 2,30 m." }),
    it("sala-ar", "ar-split", "Ar-condicionado (ponto da planta)", 396, 196, 270, { situacao: "sugestao", obs: "A planta indica um ponto de ar-condicionado nesta parede." }),
    it("sala-luminaria", "luminaria-piso", "Luminária de piso preta", 388, 96, 0, { situacao: "tenho" }),

    // ========================================================================================== BANHEIRO
    it("ban-box", "box-frontal", "Box de vidro", 505, 453.5, 90, { situacao: "comprar" }),
    it("ban-chuveiro", "chuveiro", "Chuveiro", 425, 454, 90, { situacao: "comprar" }),
    it("ban-vaso", "vaso-sanitario", "Vaso com caixa acoplada", 542, 495, 180, { situacao: "comprar" }),
    it("ban-gabinete", "gabinete", "Gabinete branco com tampo de granito", 614, 502.5, 180, { grupo: "banheiro-gabinete", situacao: "sob-medida" }),
    it("ban-cuba", "cuba-oval", "Cuba oval de embutir", 614, 500, 180, { grupo: "banheiro-gabinete", situacao: "comprar" }),
    it("ban-armario-espelho", "armario-espelho", "Armário de espelho", 614, 519.5, 180, { grupo: "banheiro-gabinete", situacao: "sob-medida" }),
    it("ban-led", "fita-led", "Fita de LED sob o espelho", 614, 520, 180, { grupo: "banheiro-gabinete", situacao: "sob-medida", ...dim(76, 2.5, 0.6), elevacao: 119.2 }),

    // ============================================================================================= SUÍTE
    it("sui-gr-coluna", "peca-marcenaria", "Coluna do guarda-roupa", 884.5, 252, 270, { ...suite, ...dim(10, 57, 260), ...carvalho }),
    it("sui-gr-espelho", "guarda-roupa-espelho", "Guarda-roupa: portas de espelho", 884.5, 301, 270, { ...suite, ...dim(88, 57, 260), opcoes: { portas: 2, espelho: true, puxador: "barra", rodape: 8 } }),
    it("sui-gr-canto", "peca-marcenaria", "Canto do guarda-roupa", 884.5, 373.5, 270, { ...suite, ...dim(57, 57, 260), ...carvalho }),
    it("sui-gr-cinza", "guarda-roupa", "Guarda-roupa: portas cinza", 802, 373.5, 180, { ...suite, ...dim(108, 57, 260), opcoes: { portas: 2, moldura: 5.5, puxador: "barra", rodape: 8 } }),
    it("sui-ponte", "armario-ponte", "Armário-ponte sobre a cama", 893, 130, 270, { ...suite }),
    it("sui-painel-janela", "peca-marcenaria", "Painel lateral da ponte", 892, 11.5, 270, { ...suite, ...dim(3, 42, 260), ...carvalho }),
    it("sui-cabeceira", "cabeceira", "Cabeceira em painel", 912, 130, 270, { ...suite, ...dim(234, 2, 158) }),
    it("sui-cama", "cama-casal", "Cama de casal 138 × 188", 817, 130, 270, { situacao: "sugestao", obs: "Confirmar o tamanho da cama." }),
    it("sui-criado-1", "criado-suspenso", "Criado suspenso", 893.5, 35, 270, { ...suite }),
    it("sui-criado-2", "criado-suspenso", "Criado suspenso", 893.5, 225, 270, { ...suite }),
    it("sui-ar", "ar-split", "Ar-condicionado (ponto da planta)", 673, 247, 90, { situacao: "sugestao", obs: "A planta indica um ponto de ar-condicionado nesta parede." }),

    // ========================================================================= QUARTO 2 (genérico da planta)
    it("q2-cama", "cama-solteiro", "Cama de solteiro", 458, 104, 0, { situacao: "sugestao" }),
    it("q2-guarda-roupa", "guarda-roupa", "Guarda-roupa", 625.5, 108, 270, {
      situacao: "sugestao",
      ...dim(192, 57, 240),
      opcoes: { portas: 4, puxador: "barra" },
      cores: { corpo: PALETA.branco, frente: PALETA.branco },
      acabamentos: { corpo: "liso" },
    }),
    it("q2-escrivaninha", "escrivaninha", "Escrivaninha", 497, 274.5, 180, { situacao: "sugestao", ...dim(140, 45, 75) }),
    it("q2-cadeira", "cadeira", "Cadeira", 520, 226, 0, { situacao: "sugestao" }),
    it("q2-ar", "ar-split", "Ar-condicionado (ponto da planta)", 524.5, 286, 180, { situacao: "sugestao", obs: "A planta indica um ponto de ar-condicionado nesta parede." }),

    // ============================================================================================ VARANDA
    it("var-banqueta-1", "banqueta-redonda", "Banqueta redonda", 229, 37, 0, { situacao: "sugestao" }),
    it("var-banqueta-2", "banqueta-redonda", "Banqueta redonda", 290, 37, 0, { situacao: "sugestao" }),
  ];
}

/** Pontos de vista internos, um ou mais por ambiente (cm; altura dos olhos ≈ 160). */
export function criarVistas(): Vista[] {
  const v = (id: string, nome: string, ambienteId: string, de: [number, number, number], para: [number, number, number]): Vista => ({
    id,
    nome,
    ambienteId,
    de: { x: de[0], y: de[1], altura: de[2] },
    para: { x: para[0], y: para[1], altura: para[2] },
  });
  return [
    v("v-entrada", "Entrada", "amb-jantar", [326, 506, 160], [285, 200, 105]),
    v("v-sala", "Sala", "amb-sala", [318, 372, 160], [300, 110, 100]),
    v("v-cozinha", "Cozinha", "amb-cozinha", [142, 478, 162], [78, 110, 100]),
    v("v-bancada", "Bancada", "amb-cozinha", [330, 390, 165], [24, 360, 120]),
    v("v-mesa", "Mesa", "amb-jantar", [345, 345, 170], [226, 500, 85]),
    v("v-banheiro", "Banheiro", "amb-banheiro", [598, 400, 165], [532, 500, 95]),
    v("v-suite", "Suíte", "amb-quarto1", [672, 336, 165], [850, 115, 95]),
    v("v-guarda-roupa", "Guarda-roupa", "amb-quarto1", [700, 48, 165], [850, 335, 105]),
    v("v-quarto2", "Quarto 2", "amb-quarto2", [585, 280, 160], [470, 80, 70]),
    v("v-varanda", "Varanda", "amb-varanda", [40, 37, 150], [380, 37, 100]),
  ];
}
