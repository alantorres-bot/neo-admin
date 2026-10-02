// Regras da Fila do dia (puras). Datas de prazo são 'aaaa-mm-dd' (coluna `date`), sem fuso.
import type { Criticidade } from "./tipos";

export const FUSO = "America/Cuiaba";

/** Data de hoje no fuso de Cuiabá, como 'aaaa-mm-dd'. */
export function hojeEmCuiaba(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Diferença em dias inteiros: positivo quando `a` é depois de `b`. */
export function diferencaDias(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function estaAtrasada(prazo: string | null, hoje: string): boolean {
  return prazo !== null && prazo < hoje;
}

/** 'aaaa-mm-dd' -> 'dd/mm/aaaa' */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function descreverPrazo(prazo: string | null, hoje: string): string {
  if (!prazo) return "Sem prazo";
  const dias = diferencaDias(prazo, hoje);
  if (dias < 0) return dias === -1 ? "Atrasada há 1 dia" : `Atrasada há ${-dias} dias`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias (${formatarData(prazo)})`;
}

const PESO_CRITICIDADE: Record<Criticidade, number> = { critica: 0, alta: 1, normal: 2 };

type ItemOrdenavel = { prazo: string | null; criticidade: Criticidade; criado_em: string };

/**
 * Atrasadas primeiro; depois por prazo (mais próximo antes, sem prazo por último),
 * desempatando por criticidade e, por fim, pela criação mais antiga.
 */
export function ordenarFila<T extends ItemOrdenavel>(itens: readonly T[], hoje: string): T[] {
  return [...itens].sort((x, y) => {
    const atrasoX = estaAtrasada(x.prazo, hoje) ? 0 : 1;
    const atrasoY = estaAtrasada(y.prazo, hoje) ? 0 : 1;
    if (atrasoX !== atrasoY) return atrasoX - atrasoY;
    if (x.prazo !== y.prazo) {
      if (x.prazo === null) return 1;
      if (y.prazo === null) return -1;
      return x.prazo < y.prazo ? -1 : 1;
    }
    const porCriticidade = PESO_CRITICIDADE[x.criticidade] - PESO_CRITICIDADE[y.criticidade];
    if (porCriticidade !== 0) return porCriticidade;
    return x.criado_em < y.criado_em ? -1 : x.criado_em > y.criado_em ? 1 : 0;
  });
}
