// Recibos de pagamento avulsos da folha (fora da folha do escritório): cálculo padronizado das rubricas, divisão de período por
// mês e as linhas padrão de cada tipo de recibo. Regras em docs/modulos/rh-folha.md, capítulo "Recibos avulsos" (decisões do Alan
// de 15/10/2026). Cada linha é arredondada em centavos; o líquido é proventos − descontos.
import { fimDoMes, inicioDoMes, somarMeses } from "@/lib/modulos/rh/calendario";

export const FORMAS = ["dias", "horas", "mensal_proporcional", "pct_salario_dias", "pct_base_dias", "fracao_salario", "valor"] as const;
export type Forma = (typeof FORMAS)[number];
export const ROTULO_FORMA_RUBRICA: Record<Forma, string> = {
  dias: "Salário ÷ 30 × dias",
  horas: "Salário ÷ 220 × horas",
  mensal_proporcional: "Valor mensal (Parâmetros) ÷ 30 × dias",
  pct_salario_dias: "% da pessoa × salário ÷ 30 × dias",
  pct_base_dias: "% da pessoa × base (Parâmetros) ÷ 30 × dias",
  fracao_salario: "Salário × fração (ex.: 1/3, 5%)",
  valor: "Valor digitado",
};

export type ChaveParametro = "assiduidade_mensal" | "salario_minimo";
export type CampoPct = "insalubridade_pct" | "adicional_noturno_pct";
export type Rubrica = {
  codigo: string; descricao: string; natureza: "provento" | "desconto"; forma: Forma;
  parametro: ChaveParametro | null; pct_campo: CampoPct | null;
};
export type DadosPessoa = { salario: number; insalubridade_pct: number; adicional_noturno_pct: number };
export type Parametros = Record<ChaveParametro, number>;
export type Vigencia = { chave: ChaveParametro; valor: number; vigente_desde: string };

export type LinhaEntrada = { rubrica: Rubrica; referencia: number; valor?: number | null };
export type LinhaCalculada = { rubrica: string; descricao: string; natureza: "provento" | "desconto"; referencia: number; centavos: number };

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100);

/** Parâmetro vigente na competência (o de maior "vigente_desde" que não passa da competência). */
export function parametrosVigentes(vigencias: readonly Vigencia[], competencia: string): Parametros {
  const comp = inicioDoMes(competencia);
  const vigente = (chave: ChaveParametro) =>
    [...vigencias].filter((v) => v.chave === chave && v.vigente_desde <= comp).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0]?.valor ?? 0;
  return { assiduidade_mensal: vigente("assiduidade_mensal"), salario_minimo: vigente("salario_minimo") };
}

/** Descrição impressa: a insalubridade e o noturno levam o percentual da pessoa. */
export function descricaoDaLinha(r: Rubrica, p: DadosPessoa): string {
  if (r.pct_campo) return `${r.descricao} (${p[r.pct_campo]}%)`;
  return r.descricao;
}

/** Valor da linha em centavos, positivo (o sinal vem da natureza no total). */
export function valorDaLinha(l: LinhaEntrada, p: DadosPessoa, par: Parametros): number {
  const ref = l.referencia;
  const pct = l.rubrica.pct_campo ? p[l.rubrica.pct_campo] / 100 : 0;
  const base = l.rubrica.parametro ? par[l.rubrica.parametro] : 0;
  switch (l.rubrica.forma) {
    case "dias": return centavos((p.salario / 30) * ref);
    case "horas": return centavos((p.salario / 220) * ref);
    case "mensal_proporcional": return centavos((base / 30) * ref);
    case "pct_salario_dias": return centavos(((pct * p.salario) / 30) * ref);
    case "pct_base_dias": return centavos(((pct * base) / 30) * ref);
    case "fracao_salario": return centavos(p.salario * ref);
    case "valor": return centavos(Math.abs(l.valor ?? 0));
  }
}

export function calcularRecibo(linhas: readonly LinhaEntrada[], p: DadosPessoa, par: Parametros): { linhas: LinhaCalculada[]; proventos: number; descontos: number; liquido: number } {
  const calc = linhas.map((l): LinhaCalculada => ({
    rubrica: l.rubrica.codigo, descricao: descricaoDaLinha(l.rubrica, p), natureza: l.rubrica.natureza, referencia: l.referencia,
    centavos: valorDaLinha(l, p, par),
  }));
  const proventos = calc.filter((l) => l.natureza === "provento").reduce((s, l) => s + l.centavos, 0);
  const descontos = calc.filter((l) => l.natureza === "desconto").reduce((s, l) => s + l.centavos, 0);
  return { linhas: calc, proventos, descontos, liquido: proventos - descontos };
}

export type Trecho = { competencia: string; inicio: string; fim: string; dias: number };

/** Divide um período (dias corridos) pelos meses que ele toca. Ex.: 20/07–08/08 → julho 12 dias, agosto 8 dias. */
export function dividirPorMes(inicio: string, fim: string): Trecho[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) return [];
  const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
  const trechos: Trecho[] = [];
  for (let comp = inicioDoMes(inicio); comp <= fim; comp = somarMeses(comp, 1)) {
    const a = inicio > comp ? inicio : comp;
    const b = fim < fimDoMes(comp) ? fim : fimDoMes(comp);
    trechos.push({ competencia: comp, inicio: a, fim: b, dias: dias(a, b) });
  }
  return trechos;
}

export const TIPOS_RECIBO = ["recorrente", "compra_ferias", "inicio_antes_registro", "eventual"] as const;
export type TipoRecibo = (typeof TIPOS_RECIBO)[number];
export const ROTULO_TIPO_RECIBO: Record<TipoRecibo, string> = {
  recorrente: "Recorrente", compra_ferias: "Compra de férias", inicio_antes_registro: "Início antes do registro", eventual: "Eventual",
};

/**
 * Linhas padrão de um trecho de dias: a rubrica principal (salário – férias ou dias normais) + assiduidade + insalubridade e
 * adicional noturno de quem tem (percentual no cadastro). O operador ainda pode mudar antes de gravar.
 */
export function linhasDeDias(tipo: "compra_ferias" | "inicio_antes_registro", dias: number, p: DadosPessoa, catalogo: ReadonlyMap<string, Rubrica>): LinhaEntrada[] {
  const r = (codigo: string) => {
    const x = catalogo.get(codigo);
    if (!x) throw new Error(`Rubrica ${codigo} não cadastrada.`);
    return x;
  };
  const linhas: LinhaEntrada[] = [{ rubrica: r(tipo === "compra_ferias" ? "salario_ferias" : "dias_normais"), referencia: dias }, { rubrica: r("assiduidade"), referencia: dias }];
  if (p.insalubridade_pct > 0) linhas.push({ rubrica: r("insalubridade"), referencia: dias });
  if (p.adicional_noturno_pct > 0) linhas.push({ rubrica: r("adicional_noturno"), referencia: dias });
  return linhas;
}

const br = (iso: string) => iso.split("-").reverse().join("/");
export function mensagemDoPeriodo(tipo: TipoRecibo, inicio: string, fim: string, periodoTodo?: { inicio: string; fim: string }): string {
  if (tipo === "compra_ferias") {
    const todo = periodoTodo ?? { inicio, fim };
    return `Férias de ${br(todo.inicio)} a ${br(todo.fim)} — neste recibo, ${br(inicio)} a ${br(fim)}`;
  }
  if (tipo === "inicio_antes_registro") return `Trabalho de ${br(inicio)} a ${br(fim)}, antes do registro`;
  return "";
}
