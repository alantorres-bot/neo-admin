/**
 * Projeto executivo de marcenaria: reúne os módulos, gera a lista de peças, os resumos de materiais,
 * fitas e ferragens, os aparelhos e as pendências. Tudo sai do modelo 3D (criarProjetoBase).
 */
import { PALETA } from "../catalogo/catalogo";
import { criarProjetoBase } from "../modelo/projetoBase";
import type { Projeto } from "../modelo/tipos";
import { FOLGA_NICHO_LAVA, criarCozinha } from "./cozinha";
import { caixaDoMovel, criarQuadros, movelDoProjeto } from "./quadros";
import { criarSuite } from "./suite";
import type { Caixa3, Classe, LinhaPeca, Modulo, Padrao, Pendencia, Quadro, Solido } from "./tipos";

export const PADROES: Record<Padrao, { nome: string; cor: string; espec: string; onde: string }> = {
  branco: { nome: "Branco TX", cor: "#f4f4f1", espec: "MDF BP branco texturizado, 2 faces", onde: "Interior das caixas, prateleiras, gavetas e fundos" },
  verde: { nome: "Verde sálvia", cor: PALETA.verdeSalvia, espec: "MDF BP verde sálvia fosco, 2 faces", onde: "Frentes dos armários de baixo da cozinha, faixa entre os aéreos, rodapé" },
  offwhite: { nome: "Off-white", cor: PALETA.offWhite, espec: "MDF BP off-white fosco, 2 faces", onde: "Aéreo superior, armário e painel da torre da geladeira" },
  madeira: { nome: "Madeira clara", cor: PALETA.madeiraClara, espec: "MDF BP madeirado claro (tom natural/mel, com veio), 2 faces", onde: "Aéreo inferior e nicho do micro-ondas" },
  carvalho: { nome: "Carvalho claro", cor: PALETA.carvalhoClaro, espec: "MDF BP madeirado carvalho claro, 2 faces", onde: "Suíte: coluna, molduras, lateral aparente, armário-ponte, cabeceira, painel e criados" },
  cinza: { nome: "Cinza", cor: PALETA.cinzaPorta, espec: "MDF BP cinza médio fosco, 2 faces", onde: "Portas do guarda-roupa G4 e rodapés do guarda-roupa" },
};

export interface ItemFerragem {
  nome: string;
  unidade: "un" | "par" | "m" | "m²" | "cj";
  espec: string;
}

export const FERRAGENS: Record<string, ItemFerragem> = {
  "dob-reta": { nome: "Dobradiça de caneco 35 mm, reta, com amortecimento", unidade: "un", espec: "Porta sobreposta à lateral; aço niquelado; regulagem em 3 eixos" },
  "dob-super": { nome: "Dobradiça de caneco 35 mm, supercurva, com amortecimento", unidade: "un", espec: "Porta embutida entre molduras (G4)" },
  "dob-toque": { nome: "Dobradiça de caneco 35 mm, reta, sem amortecedor", unidade: "un", espec: "Para portas com fecho toque (o amortecedor impede a abertura por toque)" },
  "fecho-toque": { nome: "Fecho toque (pulsador)", unidade: "un", espec: "Abertura por pressão, para portas sem puxador" },
  "cor-500": { nome: "Corrediça telescópica 500 mm, extração total, com amortecimento", unidade: "par", espec: "Carga ≥ 35 kg (gavetões: ≥ 45 kg)" },
  "cor-450": { nome: "Corrediça telescópica 450 mm, extração total, com amortecimento", unidade: "par", espec: "Gavetas internas do guarda-roupa; carga ≥ 35 kg" },
  "cor-500-toque": { nome: "Corrediça telescópica 500 mm com abertura por toque", unidade: "par", espec: "Gaveta sem puxador sob a lava-louças" },
  "cor-300-toque": { nome: "Corrediça telescópica 300 mm com abertura por toque", unidade: "par", espec: "Gaveta dos criados" },
  cava: { nome: "Perfil puxador cava em alumínio, acabamento escuro fosco", unidade: "m", espec: "Embutido no topo de cada frente; 24 mm aparentes (como no 3D); com ponteiras" },
  "pux-barra": { nome: "Puxador barra reta 300 mm, alumínio ou inox escovado", unidade: "un", espec: "Vertical; centro a 1.120 mm do piso; eixo a 40 mm da borda de abertura" },
  "pe-100": { nome: "Pé regulável para rodapé de 100 mm, com clipe", unidade: "un", espec: "Plástico de engenharia; regulagem de ±15 mm" },
  "pe-80": { nome: "Pé regulável para rodapé de 80 mm, com clipe", unidade: "un", espec: "Ou base em quadro de MDF nivelada — a critério do marceneiro" },
  "sup-prat": { nome: "Suporte de prateleira (pino metálico 5 mm)", unidade: "un", espec: "4 por prateleira regulável; furação a cada 32 mm" },
  varao: { nome: "Tubo cabideiro oblongo 30 × 15 mm em alumínio", unidade: "m", espec: "Cortado na largura do vão" },
  "sup-varao": { nome: "Suporte lateral para tubo cabideiro", unidade: "un", espec: "Zamac ou aço, parafusado na lateral" },
  "sup-varao-central": { nome: "Suporte central para tubo cabideiro", unidade: "un", espec: "Preso à prateleira de cima; para vãos acima de 1.000 mm" },
  tensor: { nome: "Tensor (esticador) de porta embutido", unidade: "un", espec: "1 por porta acima de 2.000 mm, contra empeno" },
  "fix-aereo": { nome: "Suporte de fixação de armário aéreo, regulável", unidade: "par", espec: "Com trilho ou bucha adequada à alvenaria; carga conforme fabricante" },
  "fix-painel": { nome: "Fixação de painel (cantoneiras, parafusos e cola PU)", unidade: "cj", espec: "Fixação oculta em piso, teto e parede" },
  "sup-criado": { nome: "Suporte oculto para móvel suspenso", unidade: "par", espec: "Preso à alvenaria, atravessando a cabeceira" },
  "led-perfil": { nome: "Perfil de alumínio de embutir com difusor + fita de LED 2700–3000 K", unidade: "m", espec: "Sob o aéreo de madeira, junto ao frontão" },
  "led-fonte": { nome: "Fonte (driver) para a fita de LED", unidade: "un", espec: "Dimensionada pelo comprimento da fita; alojada na faixa verde" },
  espelho: { nome: "Espelho prata 3 mm, bordas lapidadas", unidade: "m²", espec: "Colado em toda a face da porta; película de segurança no verso" },
  "protetor-pia": { nome: "Proteção da base contra umidade (manta de alumínio ou bandeja)", unidade: "un", espec: "Nos módulos da pia e do tanque" },
  "org-talheres": { nome: "Organizador de talheres para gaveta", unidade: "un", espec: "Opcional" },
};

export interface Lote {
  cod: string;
  grupo: string;
  nome: string;
  opcional?: boolean;
}

export const LOTES: Lote[] = [
  { cod: "A1", grupo: "A — Cozinha", nome: "Armários de baixo da parede A (M1 a M5) e rodapé" },
  { cod: "A2", grupo: "A — Cozinha", nome: "Torre da geladeira (painel lateral + armário superior)" },
  { cod: "A3", grupo: "A — Cozinha", nome: "Aéreos (off-white, faixa verde, madeira clara e nicho do micro-ondas)" },
  { cod: "A4", grupo: "A — Cozinha", nome: "Área de serviço (módulo do tanque)" },
  { cod: "B1", grupo: "B — Guarda-roupa da suíte", nome: "Guarda-roupa de portas de espelho + coluna" },
  { cod: "B2", grupo: "B — Guarda-roupa da suíte", nome: "Guarda-roupa de portas cinza + canto" },
  { cod: "C1", grupo: "C — Complementos da suíte (opcional)", nome: "Armário-ponte sobre a cama", opcional: true },
  { cod: "C2", grupo: "C — Complementos da suíte (opcional)", nome: "Painel lateral da ponte", opcional: true },
  { cod: "C3", grupo: "C — Complementos da suíte (opcional)", nome: "Cabeceira em painel", opcional: true },
  { cod: "C4", grupo: "C — Complementos da suíte (opcional)", nome: "Criados suspensos (2)", opcional: true },
];

/** Classes que são chapa cortada (entram na lista de peças). */
export const CLASSES_DE_CORTE: Classe[] = ["lateral", "base", "tampo", "travessa", "divisoria", "prateleira", "fundo", "porta", "frente-gaveta", "frente-fixa", "gaveta", "rodape", "painel", "arremate"];
/** Classes com fita de 1 mm (bordas aparentes); as demais usam 0,45 mm. */
const CLASSES_APARENTES: Classe[] = ["porta", "frente-gaveta", "frente-fixa", "rodape", "painel", "arremate"];

const r1 = (v: number) => Math.round(v * 10) / 10;

export function ehPecaDeCorte(sol: Solido): boolean {
  return CLASSES_DE_CORTE.includes(sol.classe) && !!sol.padrao;
}

export function nomeDoMaterial(padrao: Padrao, esp: number): string {
  return `MDF ${String(esp).replace(".", ",")} mm · ${PADROES[padrao].nome}`;
}

/** Lista de peças do módulo (peças iguais agrupadas) e o número de cada sólido nessa lista. */
export function listaDePecas(mod: Modulo): { linhas: LinhaPeca[]; numero: Map<Solido, number> } {
  const linhas: LinhaPeca[] = [];
  const chaves = new Map<string, number>();
  const numero = new Map<Solido, number>();
  const pecasUnicas = new Map<string, number>();
  for (const sol of mod.solidos) {
    if (!ehPecaDeCorte(sol)) continue;
    const ext = { s: r1(sol.s1 - sol.s0), d: r1(sol.d1 - sol.d0), z: r1(sol.z1 - sol.z0) };
    const eixos = (Object.keys(ext) as ("s" | "d" | "z")[]).sort((a, b) => ext[a] - ext[b]);
    const [eEsp, eLarg, eComp] = eixos;
    const chapas = sol.chapas ?? 1;
    const esp = r1(ext[eEsp] / chapas);
    let comp = ext[eComp];
    let larg = ext[eLarg];
    const fita = sol.fita ?? {};
    let fitaC = fita[eComp] ?? 0;
    let fitaL = fita[eLarg] ?? 0;
    let obs = sol.obs;
    if (sol.peca) {
      // vários sólidos formam uma peça recortada: conta uma vez, com a medida da chapa inteira
      const ja = pecasUnicas.get(sol.peca.chave);
      if (ja !== undefined) {
        numero.set(sol, ja);
        continue;
      }
      comp = sol.peca.comp;
      larg = sol.peca.larg;
      fitaC = (fita.z ?? 0) + (fita.s ?? 0) + (fita.d ?? 0);
      fitaL = 0;
      obs = sol.peca.obs;
    }
    const chave = [sol.nome, comp, larg, esp, sol.padrao, fitaC, fitaL, obs ?? ""].join("|");
    let idx = chaves.get(chave);
    if (idx === undefined) {
      idx = linhas.length;
      chaves.set(chave, idx);
      linhas.push({ modulo: mod.cod, n: idx + 1, nome: sol.nome, qtd: 0, comp, larg, esp, padrao: sol.padrao!, material: nomeDoMaterial(sol.padrao!, esp), fitaC, fitaL, fitaM: 0, areaM2: 0, obs });
    }
    const linha = linhas[idx];
    linha.qtd += chapas;
    linha.fitaM += (fitaC * comp + fitaL * larg) / 1000;
    linha.areaM2 += (chapas * comp * larg) / 1e6;
    numero.set(sol, idx + 1);
    if (sol.peca) pecasUnicas.set(sol.peca.chave, idx + 1);
  }
  for (const l of linhas) {
    l.fitaM = Math.round(l.fitaM * 100) / 100;
    l.areaM2 = Math.round(l.areaM2 * 1000) / 1000;
  }
  return { linhas, numero };
}

export interface Aparelho {
  nome: string;
  situacao: string;
  /** Medida adotada (L × A × P), mm — típica, modelo não informado. */
  medida: [number, number, number];
  /** Vão previsto na marcenaria (L × A × P), mm. */
  vao: [number, number, number];
  onde: string;
  pontos: string;
  atencao: string;
}

export interface Marcenaria {
  projeto: Projeto;
  quadros: Record<"coz-a" | "coz-b" | "sui-a" | "sui-b", Quadro>;
  modulos: Modulo[];
  contexto: Record<string, Solido[]>;
  peDireito: number;
  aparelhos: Aparelho[];
  pendencias: Pendencia[];
}

const dims = (c: Caixa3): [number, number, number] => [r1(c.s1 - c.s0), r1(c.z1 - c.z0), r1(c.d1 - c.d0)];

export function criarMarcenaria(projeto: Projeto = criarProjetoBase()): Marcenaria {
  const quadros = criarQuadros(projeto.planta);
  const coz = criarCozinha(projeto, quadros["coz-a"], quadros["coz-b"]);
  const sui = criarSuite(projeto, quadros["sui-a"], quadros["sui-b"]);
  const modulos = [...coz.modulos, ...sui.modulos];
  const pd = projeto.planta.peDireito.valor * 10;
  const mod = (cod: string) => modulos.find((x) => x.cod === cod)!;
  const cx = (id: string, q: "coz-a" | "coz-b") => caixaDoMovel(movelDoProjeto(projeto, id), quadros[q]);
  const sit = (id: string) => (movelDoProjeto(projeto, id).situacao === "tenho" ? "Já tem" : "A comprar");

  const gel = cx("coz-geladeira", "coz-a");
  const ag = mod("AG").caixa;
  const pg = mod("PG").caixa;
  const forno = cx("coz-forno", "coz-a");
  const cook = cx("coz-cooktop", "coz-a");
  const dep = cx("coz-depurador", "coz-a");
  const lv = cx("coz-lavaloucas", "coz-a");
  const mic = cx("coz-microondas", "coz-a");
  const nm = mod("NM").caixa;
  const les = cx("coz-lava-e-seca", "coz-b");
  const t1 = mod("T1").caixa;
  const qb = quadros["coz-b"];
  const m2 = mod("M2").caixa;
  const m3 = mod("M3").caixa;

  const aparelhos: Aparelho[] = [
    {
      nome: "Geladeira (freezer embaixo)",
      situacao: sit("coz-geladeira"),
      medida: dims(gel),
      vao: [quadros["coz-a"].comprimento - pg.s1, ag.z0, pg.d1 - pg.d0],
      onde: "Torre (PG + AG)",
      pontos: "Tomada acessível atrás ou acima do aparelho",
      atencao: "Folga lateral e abertura da porta junto à parede do fundo; ventilação pedida no manual.",
    },
    {
      nome: "Forno de embutir 60 cm",
      situacao: sit("coz-forno"),
      medida: dims(forno),
      vao: [m2.s1 - m2.s0 - 30, forno.z1 - forno.z0, 580],
      onde: "M2",
      pontos: "Tomada dedicada fora do nicho (potência conforme o modelo)",
      atencao: "Nicho, ventilação e posição da tomada conforme o manual; modelo não definido.",
    },
    {
      nome: "Cooktop 4 bocas",
      situacao: sit("coz-cooktop"),
      medida: dims(cook),
      vao: [0, 0, 0],
      onde: "Sobre o M2 (recorte na pedra)",
      pontos: "Gás (registro acessível) ou circuito elétrico dedicado — tipo não definido",
      atencao: "Recorte da pedra e distância ao forno conforme o manual.",
    },
    {
      nome: "Depurador slim 60 cm",
      situacao: sit("coz-depurador"),
      medida: dims(dep),
      vao: [0, dep.z0 - (cook.z0 - 0), 0],
      onde: "Sob o AM, sobre o cooktop",
      pontos: "Tomada dentro do aéreo de madeira",
      atencao: `Ficam ${dep.z0 - cook.z0} mm livres entre o cooktop e o depurador: os manuais costumam pedir de 650 a 750 mm (mais para gás). Conferir antes de fechar a altura do aéreo.`,
    },
    {
      nome: "Lava-louças compacta (8 serviços)",
      situacao: sit("coz-lavaloucas"),
      medida: dims(lv),
      vao: [m3.s1 - m3.s0 - 30, lv.z1 - lv.z0 + FOLGA_NICHO_LAVA, 574],
      onde: "M3 (alinhada com o forno)",
      pontos: "Água e esgoto pelo módulo da pia (M4); tomada no M4",
      atencao: `Folga de ${FOLGA_NICHO_LAVA} mm na altura com a medida típica; porta aberta avança ≈ 550 mm no corredor de 880 mm.`,
    },
    {
      nome: "Micro-ondas",
      situacao: sit("coz-microondas"),
      medida: dims(mic),
      vao: [nm.s1 - nm.s0 - 36, nm.z1 - nm.z0 - 36, nm.d1 - nm.d0 - 6],
      onde: "NM (nicho aberto)",
      pontos: "Tomada no fundo do nicho",
      atencao: "Ventilação lateral e superior conforme o manual.",
    },
    {
      nome: "Lava e seca (abertura frontal)",
      situacao: sit("coz-lava-e-seca"),
      medida: dims(les),
      vao: [qb.comprimento - t1.s1, 870, 650],
      onde: "Sob a pedra da janela, ao lado do T1",
      pontos: "Água, esgoto e tomada na parede (lateral ou da janela)",
      atencao: "Mangueiras atrás pedem 50–80 mm: a máquina pode ficar para fora da pedra. Sob a pedra sobram ≈ 20 mm.",
    },
  ];

  const pendencias: Pendencia[] = [
    { cod: "P-01", onde: "Geral", tipo: "medir", afetaPreco: true, texto: `Pé-direito: não consta na planta. Adotado ${pd} mm (estimado). Define a altura dos aéreos superiores (620), do painel da geladeira, do guarda-roupa (portas de 2.514), da coluna e do armário-ponte (1.020).` },
    { cod: "P-02", onde: "Geral", tipo: "medir", afetaPreco: false, texto: "Prumo, esquadro e nível de paredes, piso e teto: levantar na medição técnica. Prever réguas de ajuste (parede e teto) em todos os encontros." },
    { cod: "P-03", onde: "Geral", tipo: "medir", afetaPreco: false, texto: "Tomadas, interruptores, pontos de água, esgoto e gás existentes: não constam na planta. Levantar posição e altura de todos antes de recortar fundos, cabeceira e pedras." },
    { cod: "P-04", onde: "Cozinha", tipo: "medir", afetaPreco: true, texto: "Shaft do canto (220 × 650 mm, estimado): define o início do M1, o comprimento do T1 e da pedra sob a janela (1.280 mm)." },
    { cod: "P-05", onde: "Cozinha", tipo: "medir", afetaPreco: false, texto: "Janela da área de serviço: largura 650, peitoril 1.100 e posição estimados. Define o frontão de 200 mm e a posição da torneira do tanque." },
    { cod: "P-06", onde: "Cozinha", tipo: "aparelho", afetaPreco: true, texto: "Modelos dos aparelhos não informados (geladeira, lava-louças, micro-ondas, lava e seca) e forno/cooktop/depurador ainda não definidos: todos os nichos usam medidas típicas. Informar marca e modelo para fechar os vãos." },
    { cod: "P-07", onde: "Cozinha", tipo: "tecnico", afetaPreco: false, texto: "Altura livre entre cooktop e depurador: 600 mm no projeto. Conferir o manual dos dois aparelhos (costuma ser 650 a 750 mm); pode exigir subir o aéreo de madeira ou trocar o tipo de cooktop." },
    { cod: "P-08", onde: "Cozinha", tipo: "decidir", afetaPreco: true, texto: "Canto do L (M1 × T1): proposta de régua fixa de 40 mm + porta de 237 mm no módulo do tanque. Aprovar ou pedir alternativa ao marceneiro." },
    { cod: "P-09", onde: "Cozinha", tipo: "decidir", afetaPreco: true, texto: "Puxador cava: perfil de alumínio escuro embutido no topo de cada frente (proposto) ou cava usinada no MDF e pintada. Definir, pois muda o preço." },
    { cod: "P-10", onde: "Cozinha", tipo: "decidir", afetaPreco: true, texto: "Aéreo superior com 4 portas de 769,5 mm (desenho aprovado): largura acima do usual. Manter (3 dobradiças por porta) ou autorizar 6 portas de ≈ 512 mm." },
    { cod: "P-11", onde: "Cozinha", tipo: "decidir", afetaPreco: false, texto: "Cor do rodapé: no 3D aparece em verde mais fechado. Orçar no mesmo verde das frentes, salvo indicação em contrário." },
    { cod: "P-12", onde: "Cozinha", tipo: "tecnico", afetaPreco: false, texto: "Pedras (bancadas de quartzo, frontões de granilite e revestimento do shaft) são da marmoraria — fora deste orçamento. A marcenaria precisa estar instalada antes da medição das pedras." },
    { cod: "P-13", onde: "Suíte", tipo: "decidir", afetaPreco: true, texto: "Interior do guarda-roupa: é proposta do projeto, ainda não aprovada pelo cliente. Confirmar a divisão (cabideiro duplo no G2; gavetas, prateleiras, cabideiro longo e sapateira no G4) ou indicar o que mudar." },
    { cod: "P-14", onde: "Suíte", tipo: "tecnico", afetaPreco: false, texto: "Encontro das portas no canto do L: a porta direita do G2 abre contra a frente do G4. Limitar a 90° ou autorizar régua de 40 mm em carvalho no canto." },
    { cod: "P-15", onde: "Suíte", tipo: "medir", afetaPreco: false, texto: "Porta do quarto: largura e posição estimadas. Aberta, a folha fica a ≈ 26 mm da lateral do G4 — conferir com a maçaneta e o batente reais." },
    { cod: "P-16", onde: "Suíte", tipo: "decidir", afetaPreco: true, texto: "Puxador barra sobre as portas de espelho exige furar o espelho. Alternativa: perfil puxador na borda da porta. Definir." },
    { cod: "P-17", onde: "Suíte", tipo: "medir", afetaPreco: false, texto: "Janela da suíte (posição estimada): o painel lateral da ponte fica a ≈ 148 mm do vão. Conferir com a cortina." },
    { cod: "P-18", onde: "Suíte", tipo: "decidir", afetaPreco: false, texto: "Cama: adotada casal padrão 1.380 × 1.880 (sugestão). Os criados de 400 mm deixam 60 mm de cada lado; se a cama for maior, os criados e a cabeceira mudam." },
    { cod: "P-19", onde: "Geral", tipo: "decidir", afetaPreco: true, texto: "Padrões de MDF: definidos aqui por cor e descrição, sem marca. Cada marceneiro deve informar fabricante, linha e nome do padrão proposto e apresentar amostra." },
  ];

  return { projeto, quadros, modulos, contexto: { ...coz.contexto, ...sui.contexto }, peDireito: pd, aparelhos, pendencias };
}

export interface ResumoMaterial {
  material: string;
  padrao: Padrao;
  esp: number;
  pecas: number;
  areaM2: number;
}

export function todasAsPecas(mc: Marcenaria): LinhaPeca[] {
  return mc.modulos.flatMap((mod) => listaDePecas(mod).linhas);
}

export function resumoDeMateriais(linhas: LinhaPeca[]): ResumoMaterial[] {
  const mapa = new Map<string, ResumoMaterial>();
  for (const l of linhas) {
    const r = mapa.get(l.material) ?? { material: l.material, padrao: l.padrao, esp: l.esp, pecas: 0, areaM2: 0 };
    r.pecas += l.qtd;
    r.areaM2 += l.areaM2;
    mapa.set(l.material, r);
  }
  return [...mapa.values()].map((r) => ({ ...r, areaM2: Math.round(r.areaM2 * 100) / 100 })).sort((a, b) => a.padrao.localeCompare(b.padrao) || b.esp - a.esp);
}

export interface ResumoFita {
  padrao: Padrao;
  tipo: string;
  metros: number;
}

export function resumoDeFitas(mc: Marcenaria): ResumoFita[] {
  const mapa = new Map<string, ResumoFita>();
  for (const mod of mc.modulos) {
    for (const sol of mod.solidos) {
      if (!ehPecaDeCorte(sol) || !sol.fita) continue;
      const metros = ((sol.fita.s ?? 0) * (sol.s1 - sol.s0) + (sol.fita.d ?? 0) * (sol.d1 - sol.d0) + (sol.fita.z ?? 0) * (sol.z1 - sol.z0)) / 1000;
      if (metros <= 0) continue;
      const tipo = CLASSES_APARENTES.includes(sol.classe) ? "PVC 1 mm" : "PVC 0,45 mm";
      const chave = `${sol.padrao}|${tipo}`;
      const r = mapa.get(chave) ?? { padrao: sol.padrao!, tipo, metros: 0 };
      r.metros += metros;
      mapa.set(chave, r);
    }
  }
  return [...mapa.values()].map((r) => ({ ...r, metros: Math.round(r.metros * 10) / 10 })).sort((a, b) => a.padrao.localeCompare(b.padrao) || a.tipo.localeCompare(b.tipo));
}

export interface ResumoFerragem {
  item: string;
  nome: string;
  unidade: string;
  espec: string;
  qtd: number;
  modulos: string;
}

export function resumoDeFerragens(modulos: Modulo[]): ResumoFerragem[] {
  const mapa = new Map<string, ResumoFerragem>();
  for (const mod of modulos) {
    for (const f of mod.ferragens) {
      const item = FERRAGENS[f.item];
      if (!item) throw new Error(`Ferragem sem cadastro: ${f.item}`);
      const r = mapa.get(f.item) ?? { item: f.item, nome: item.nome, unidade: item.unidade, espec: item.espec, qtd: 0, modulos: "" };
      r.qtd += f.qtd;
      r.modulos = r.modulos ? `${r.modulos}, ${mod.cod}` : mod.cod;
      mapa.set(f.item, r);
    }
  }
  return Object.keys(FERRAGENS)
    .filter((k) => mapa.has(k))
    .map((k) => {
      const r = mapa.get(k)!;
      return { ...r, qtd: Math.round(r.qtd * 100) / 100 };
    });
}
