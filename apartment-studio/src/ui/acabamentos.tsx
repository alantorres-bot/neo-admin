/**
 * Paletas e nomes de acabamento usados nos painéis: tons prontos para móveis, paredes, pisos e portas
 * (sempre com a opção de escolher outra cor) e os nomes que aparecem para cada acabamento e revestimento.
 */
import type { Acabamento } from "../catalogo/formas";
import { PALETA } from "../catalogo/catalogo";
import type { MaterialPiso, Revestimento } from "../modelo/tipos";

export interface Tom {
  nome: string;
  cor: string;
}

export const TONS_PAREDE: Tom[] = [
  { nome: "Off-white (padrão)", cor: "#f3f0ea" },
  { nome: "Branco gelo", cor: "#f8f8f6" },
  { nome: "Areia", cor: "#e3d9c8" },
  { nome: "Cinza claro", cor: "#d6d6d2" },
  { nome: "Cinza médio", cor: "#a8a9a6" },
  { nome: "Verde sálvia", cor: PALETA.verdeSalvia },
  { nome: "Azul-marinho", cor: "#1c2444" },
  { nome: "Terracota", cor: "#b5654a" },
  { nome: "Grafite", cor: PALETA.grafite },
];

export const TONS_MOVEL: Tom[] = [
  { nome: "Off-white", cor: PALETA.offWhite },
  { nome: "Branco", cor: PALETA.branco },
  { nome: "Bege", cor: PALETA.bege },
  { nome: "Cinza", cor: PALETA.cinzaPorta },
  { nome: "Verde sálvia", cor: PALETA.verdeSalvia },
  { nome: "Azul-marinho", cor: "#1c2444" },
  { nome: "Madeira clara", cor: PALETA.madeiraClara },
  { nome: "Madeira mel", cor: PALETA.madeiraMel },
  { nome: "Nogueira", cor: PALETA.nogueira },
  { nome: "Grafite", cor: PALETA.grafite },
  { nome: "Preto", cor: PALETA.preto },
];

export const TONS_PISO: Record<MaterialPiso, Tom[]> = {
  porcelanato: [
    { nome: "Cinza claro (planta)", cor: "#c6c2bb" },
    { nome: "Bege claro", cor: "#d8cfc0" },
    { nome: "Branco", cor: "#e9e7e2" },
    { nome: "Cinza médio", cor: "#a9a7a2" },
    { nome: "Grafite", cor: "#6a6a69" },
  ],
  madeira: [
    { nome: "Carvalho claro", cor: "#d9c3a0" },
    { nome: "Mel", cor: "#c79f72" },
    { nome: "Nogueira", cor: "#8a6a4d" },
    { nome: "Cinza", cor: "#b0a79b" },
  ],
  cimento: [
    { nome: "Cimento claro", cor: "#c9c7c2" },
    { nome: "Cimento", cor: "#b4b2ae" },
    { nome: "Cimento escuro", cor: "#8b8a87" },
  ],
};

export const TONS_LUZ: Tom[] = [
  { nome: "Quente (2700 K)", cor: "#ffd9a8" },
  { nome: "Neutra (4000 K)", cor: "#fff1dc" },
  { nome: "Fria (6000 K)", cor: "#eaf2ff" },
];

export const TONS_PORTA: Tom[] = [
  { nome: "Branca (padrão)", cor: "#f2f0eb" },
  { nome: "Off-white", cor: PALETA.offWhite },
  { nome: "Madeira clara", cor: PALETA.madeiraClara },
  { nome: "Nogueira", cor: PALETA.nogueira },
  { nome: "Grafite", cor: PALETA.grafite },
  { nome: "Preta", cor: PALETA.preto },
];

/** Acabamentos que se pode escolher para uma parte de móvel (vidro, espelho e luz não entram: são da peça). */
export const NOME_ACABAMENTO: Partial<Record<Acabamento, string>> = {
  liso: "Liso acetinado",
  fosco: "Laca fosca",
  madeira: "Madeira",
  pedra: "Pedra polida",
  granito: "Granito",
  granilite: "Granilite",
  tecido: "Tecido",
  metal: "Metal pintado",
  inox: "Inox",
  cromado: "Cromado",
  louca: "Louça",
  "vidro-preto": "Vidro preto",
};

const NOME_ACABAMENTO_FIXO: Partial<Record<Acabamento, string>> = { palhinha: "Palhinha", led: "Luz de LED", vidro: "Vidro", espelho: "Espelho" };

/** Opções do seletor de acabamento, incluindo o atual quando ele é próprio da peça (palhinha, LED…). */
export function opcoesDeAcabamento(atual: Acabamento): [Acabamento, string][] {
  const lista = Object.entries(NOME_ACABAMENTO) as [Acabamento, string][];
  return NOME_ACABAMENTO[atual] ? lista : [[atual, NOME_ACABAMENTO_FIXO[atual] ?? atual], ...lista];
}

export const NOME_REVESTIMENTO: Record<Revestimento, string> = {
  pintura: "Pintura",
  azulejo: "Azulejo",
  cimento: "Cimento queimado",
  tijolinho: "Tijolinho",
};

/** Cor que cada revestimento ganha quando é escolhido sobre uma parede ainda na cor padrão. */
export const COR_DO_REVESTIMENTO: Record<Revestimento, string> = {
  pintura: "#f3f0ea",
  azulejo: "#f4f3ef",
  cimento: "#b9b7b2",
  tijolinho: "#b5654a",
};

export const NOME_PISO: Record<MaterialPiso, string> = {
  porcelanato: "Porcelanato",
  madeira: "Madeira (réguas)",
  cimento: "Cimento queimado",
};

const igual = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Fileira de tons prontos e, no fim, o seletor para qualquer outra cor. */
export function EscolhaDeCor({
  tons,
  valor,
  aoEscolher,
  id,
  rotulo,
}: {
  tons: Tom[];
  valor: string | undefined;
  aoEscolher: (cor: string) => void;
  /** id do seletor livre (para rótulos e testes). */
  id?: string;
  /** Nome do que está sendo colorido, para leitores de tela. */
  rotulo: string;
}) {
  const livre = !!valor && !tons.some((t) => igual(valor, t.cor));
  return (
    <div className="paleta" role="group" aria-label={`Cor: ${rotulo}`}>
      {tons.map((t) => (
        <button
          key={t.cor}
          type="button"
          className={`tom${igual(valor, t.cor) ? " ativo" : ""}`}
          style={{ background: t.cor }}
          title={t.nome}
          aria-label={t.nome}
          aria-pressed={igual(valor, t.cor)}
          onClick={() => aoEscolher(t.cor)}
        />
      ))}
      <label className={`tom tom-livre${livre ? " ativo" : ""}`} title="Outra cor" style={livre ? { background: valor } : undefined}>
        <input type="color" id={id} aria-label={`Outra cor: ${rotulo}`} value={valor && valor.length === 7 ? valor : "#cccccc"} onChange={(e) => aoEscolher(e.target.value)} />
      </label>
    </div>
  );
}
