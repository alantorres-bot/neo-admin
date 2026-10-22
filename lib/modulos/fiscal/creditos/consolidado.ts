// Fiscal > Créditos tributários: consolidado do exercício por grupo (tributo, ou estabelecimento + tributo), a partir das linhas
// mensais por crédito devolvidas por fis_apuracao. Usado na tela, no Excel e na impressão (mesma conta em todos).
import { consolidarExercicio, linhaDoBanco, somarLinhas, type Consolidado, type LinhaApuracao, type LinhaBanco } from "./apuracao";
import { competenciasDoAno } from "./formatos";

export type GrupoConsolidado = { chave: string; atual: Consolidado | null; anterior: Consolidado | null; /** saldo final de dezembro do ano anterior (calculado) */ transportadoDoAnterior: number };

/** Soma as linhas mensais de um conjunto de créditos e consolida o exercício `ano`. */
function consolidarAno(linhas: readonly LinhaBanco[], ano: number): Consolidado | null {
  const doAno = linhas.filter((l) => l.competencia.startsWith(String(ano)));
  if (doAno.length === 0) return null;
  const porMes = new Map<string, LinhaApuracao[]>();
  for (const b of doAno) {
    const l = linhaDoBanco(b);
    porMes.set(l.competencia, [...(porMes.get(l.competencia) ?? []), l]);
  }
  const meses = competenciasDoAno(ano).filter((m) => porMes.has(m)).map((m) => somarLinhas(porMes.get(m)!, m));
  // Créditos que só começam no meio do ano: o "inicial" do exercício fica com os que existiam no 1º mês; os demais entram
  // pela implantação/geração do mês em que nasceram — por isso a conta é mês a mês e não precisa de ajuste.
  return consolidarExercicio(meses);
}

export function consolidarPor(linhas: readonly LinhaBanco[], ano: number, chave: (l: LinhaBanco) => string): GrupoConsolidado[] {
  const grupos = new Map<string, LinhaBanco[]>();
  for (const l of linhas) grupos.set(chave(l), [...(grupos.get(chave(l)) ?? []), l]);
  return [...grupos.entries()].map(([k, ls]) => {
    const dezAnterior = ls.filter((l) => l.competencia.startsWith(`${ano - 1}-12`)).reduce((s, l) => s + linhaDoBanco(l).saldoFinal, 0);
    return { chave: k, atual: consolidarAno(ls, ano), anterior: consolidarAno(ls, ano - 1), transportadoDoAnterior: dezAnterior };
  }).filter((g) => g.atual || g.anterior).sort((a, b) => a.chave.localeCompare(b.chave));
}

/** Total geral (soma dos grupos). */
export function totalGeral(grupos: readonly GrupoConsolidado[], qual: "atual" | "anterior"): Consolidado | null {
  const cs = grupos.map((g) => g[qual]).filter((c): c is Consolidado => !!c);
  if (cs.length === 0) return null;
  const s = somarLinhas(cs);
  return {
    ...s, competencia: "", meses: Math.max(...cs.map((c) => c.meses)),
    saldoInicial: cs.reduce((x, c) => x + c.saldoInicial, 0), saldoFinal: cs.reduce((x, c) => x + c.saldoFinal, 0),
    implantadoNoAno: cs.reduce((x, c) => x + c.implantadoNoAno, 0),
  };
}
