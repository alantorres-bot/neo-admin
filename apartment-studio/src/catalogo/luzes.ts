/**
 * Luzes que os móveis emitem (plafon, pendente, abajur, luminária de piso, fitas de LED).
 * Funções puras: a cena (cena/Luzes.tsx) só desenha o que sai daqui.
 */
import { ambienteDoPonto } from "../modelo/geometria";
import type { Ambiente, Movel, Projeto } from "../modelo/tipos";
import { itemCatalogo, opcoesDoMovel } from "./catalogo";

export interface LuzMovel {
  tipo: "ponto" | "fita";
  /** Posição no referencial do móvel (cm): x ao longo da largura, y para cima, z para a frente. */
  p: [number, number, number];
  cor: string;
  intensidade: number;
  /** Ponto: alcance em cm. */
  alcance: number;
  /** Fita: comprimento × largura da faixa que emite (cm) e para onde ilumina. */
  tamanho: [number, number];
  direcao: "baixo" | "cima" | "frente";
}

/** Faixa mínima que emite numa fita (cm): fitas muito finas não iluminam nada na conta da cena. */
const LARGURA_MINIMA_FITA = 3;

export function luzesDoMovel(m: Pick<Movel, "catalogoId" | "largura" | "profundidade" | "altura" | "opcoes">): LuzMovel[] {
  const luz = itemCatalogo(m.catalogoId)?.luz;
  if (!luz) return [];
  const o = opcoesDoMovel(m);
  if (o.apagada === true) return [];
  const brilho = typeof o.brilho === "number" ? Math.max(0, o.brilho) : 1;
  const [fx, fy, fz] = luz.em ?? [0, 0, 0];
  const direcao = o.direcao === "cima" || o.direcao === "frente" || o.direcao === "baixo" ? o.direcao : (luz.direcao ?? "baixo");
  return [
    {
      tipo: luz.tipo,
      p: [fx * m.largura, fy * m.altura, fz * m.profundidade],
      cor: typeof o.corLuz === "string" ? o.corLuz : luz.cor,
      intensidade: luz.intensidade * brilho,
      alcance: luz.alcance ?? 500,
      tamanho: [m.largura, Math.max(m.profundidade, LARGURA_MINIMA_FITA)],
      direcao,
    },
  ];
}

/** O móvel é uma luz presa no teto (ou pendurada nele)? */
export function luzDeTeto(m: Movel, peDireito: number): boolean {
  return luzesDoMovel(m).length > 0 && m.elevacao + m.altura >= peDireito - 15;
}

/** O ambiente já tem luz de teto própria? Se não tiver, a cena acende um plafon no centro dele. */
export function ambienteTemLuzDeTeto(projeto: Pick<Projeto, "planta" | "moveis">, amb: Ambiente): boolean {
  const pe = projeto.planta.peDireito.valor;
  return projeto.moveis.some((m) => luzDeTeto(m, pe) && ambienteDoPonto(projeto.planta, m)?.id === amb.id);
}
