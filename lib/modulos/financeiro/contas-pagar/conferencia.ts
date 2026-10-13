// Regras puras da conferência dos pagamentos com o banco (Fase 4e): depois de autorizada, quem libera no banco marca cada item
// (título, antecipação ou extra) como conferido ou divergente. Aqui: a linha comum da tela, a busca por valor ou nome e o resumo.
// Sem imports; testado em conferencia.test.ts. As regras de gravação (só autorizada, quem/quando) ficam no banco (migration 0160).

export type SituacaoConferencia = "conferido" | "divergente";
export const ehSituacaoConferencia = (v: string | null | undefined): v is SituacaoConferencia => v === "conferido" || v === "divergente";

export type OrigemConferencia = "item" | "extra";

/** Uma linha da tela de conferência (item do Consistem ou pagamento extra, já sem os removidos). */
export type LinhaConferencia = {
  origem: OrigemConferencia;
  id: string;
  tipo: "titulo" | "antecipacao" | "extra";
  /** Fornecedor (itens) ou favorecido (extras). */
  nome: string;
  /** Número do documento (itens) ou descrição (extras). */
  documento: string;
  /** Vencimento (título), pagamento programado (antecipação) ou nulo (extra). */
  data: string | null;
  historico: string;
  valorCentavos: number;
  situacao: SituacaoConferencia | null;
  valorBancoCentavos: number | null;
  observacao: string | null;
  conferidoPorNome: string | null;
  conferidoEm: string | null;
};

export const ROTULO_TIPO_CONFERENCIA: Record<LinhaConferencia["tipo"], string> = { titulo: "Título", antecipacao: "Antecipação", extra: "Extra" };

const semAcento = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type Busca = {
  /** Valor digitado, em centavos (ex.: "150" → 15000; "1.234,56" → 123456). */
  centavos: number | null;
  /** true quando digitou sem vírgula ("150"): casa pela parte inteira (150,00 e 150,90). */
  inteiro: boolean;
  /** Texto normalizado (sem acento, minúsculo) para procurar em nome, documento e histórico. */
  texto: string;
};

/**
 * Interpreta o que foi digitado na busca: "150", "150,00", "1.234,56", "R$ 150" viram valor; o resto vira texto. Um número
 * com ponto e sem vírgula ("1.234") é lido como milhar (padrão brasileiro), não decimal.
 */
export function interpretarBusca(entrada: string): Busca {
  const texto = semAcento(entrada);
  const limpo = entrada.replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(limpo)) return { centavos: null, inteiro: false, texto };
  const [inteiros, decimais] = limpo.replace(/\./g, "").split(",");
  const temVirgula = decimais !== undefined;
  const centavos = Number(inteiros) * 100 + (temVirgula ? Number((decimais + "00").slice(0, 2)) : 0);
  return { centavos, inteiro: !temVirgula, texto };
}

/** Filtra as linhas pela busca: valor (exato com vírgula; parte inteira sem vírgula) ou texto em nome/documento/histórico. */
export function filtrarConferencia(linhas: readonly LinhaConferencia[], busca: Busca): LinhaConferencia[] {
  if (busca.centavos === null && busca.texto === "") return [...linhas];
  return linhas.filter((l) => {
    if (busca.centavos !== null) {
      const valores = [l.valorCentavos, l.valorBancoCentavos].filter((v): v is number => v !== null);
      const casaValor = busca.inteiro
        ? valores.some((v) => Math.floor(v / 100) === busca.centavos! / 100)
        : valores.includes(busca.centavos);
      if (casaValor) return true;
    }
    return busca.texto !== "" && [l.nome, l.documento, l.historico].some((c) => semAcento(c).includes(busca.texto));
  });
}

export type FiltroConferencia = "todos" | "faltam" | "conferidos" | "divergentes";
export const ehFiltroConferencia = (v: string): v is FiltroConferencia => ["todos", "faltam", "conferidos", "divergentes"].includes(v);

export function filtrarPorSituacao(linhas: readonly LinhaConferencia[], filtro: FiltroConferencia): LinhaConferencia[] {
  switch (filtro) {
    case "todos": return [...linhas];
    case "faltam": return linhas.filter((l) => l.situacao === null);
    case "conferidos": return linhas.filter((l) => l.situacao === "conferido");
    case "divergentes": return linhas.filter((l) => l.situacao === "divergente");
  }
}

export type Contagem = { quantidade: number; centavos: number };
export type ResumoConferencia = {
  total: Contagem;
  conferidos: Contagem;
  divergentes: Contagem;
  faltam: Contagem;
  /** Soma de (valor do banco − valor autorizado) dos divergentes que têm valor do banco. */
  diferencaCentavos: number;
  /** Tudo marcado (conferido ou divergente). */
  concluida: boolean;
};

export function resumirConferencia(linhas: readonly LinhaConferencia[]): ResumoConferencia {
  const zero = (): Contagem => ({ quantidade: 0, centavos: 0 });
  const r = { total: zero(), conferidos: zero(), divergentes: zero(), faltam: zero(), diferencaCentavos: 0, concluida: false };
  const somar = (c: Contagem, v: number) => { c.quantidade++; c.centavos += v; };
  for (const l of linhas) {
    somar(r.total, l.valorCentavos);
    if (l.situacao === "conferido") somar(r.conferidos, l.valorCentavos);
    else if (l.situacao === "divergente") {
      somar(r.divergentes, l.valorCentavos);
      if (l.valorBancoCentavos !== null) r.diferencaCentavos += l.valorBancoCentavos - l.valorCentavos;
    } else somar(r.faltam, l.valorCentavos);
  }
  r.concluida = r.total.quantidade > 0 && r.faltam.quantidade === 0;
  return r;
}

/** Só autorização autorizada é conferida; operador ou gestor marca. */
export const podeConferir = (status: string, podeOperar: boolean): boolean => status === "autorizada" && podeOperar;
