// Regras puras da tela Autorizar pagamento (Financeiro > Contas a pagar): o que está em aberto no espelho do Consistem
// (títulos e antecipações a fornecedor), filtros, ordem, corte das antecipações e totais por tipo. Sem imports: testado em
// pendentes.test.ts e usado pelas páginas do módulo.

export const MODULO_CONTAS_PAGAR = "financeiro.contas-pagar";
export const ROTA_CONTAS_PAGAR = "/financeiro/contas-pagar";
export const POR_PAGINA = 100;

export type TipoItem = "titulo" | "antecipacao";
export const ROTULO_TIPO: Record<TipoItem, string> = { titulo: "Título", antecipacao: "Antecipação" };

export type AutorizacaoAtiva = { id: string; numero: number; status: "rascunho" | "autorizada" };
export type Tratada = { id: string; motivo: string; em: string };

export type ItemPendente = {
  id: string;
  empresaId: string;
  tipo: TipoItem;
  codLancamento: string;
  codFornecedor: string;
  fornecedor: string;
  documentoFornecedor: string | null;
  numDocumento: string;
  emissao: string | null;
  /** Título: vencimento. Antecipação: nulo (a API manda "0"). */
  vencimento: string | null;
  /** Antecipação: data de pagamento programada/efetiva (do detalhe), quando já lida. */
  dataPagamento: string | null;
  valorDocumentoCentavos: number;
  /** Saldo: a pagar (título) ou ainda não abatido por NF (antecipação). */
  saldoCentavos: number;
  complemento: string;
  codBanco: string;
  categoria: string;
  /** Autorização ativa (rascunho ou autorizada) em que o lançamento já está, se houver. */
  autorizacao: AutorizacaoAtiva | null;
  /** Antecipação marcada como paga fora do Neo Admin. */
  tratada: Tratada | null;
};

/** Pendente de autorização = sem autorização ativa e não tratada. */
export const estaPendente = (i: Pick<ItemPendente, "autorizacao" | "tratada">): boolean => i.autorizacao === null && i.tratada === null;

export type FiltroTipo = "todos" | "titulos" | "antecipacoes";
export type FiltroSituacao = "todos" | "vencidos" | "a_vencer";
export type FiltroMostrar = "pendentes" | "todos";
export type FiltrosPendentes = {
  busca: string;
  tipo: FiltroTipo;
  situacao: FiltroSituacao;
  /** pendentes = só o que ainda não está em autorização nem foi tratado (padrão); todos = inclui esses também. */
  mostrar: FiltroMostrar;
  /** Vencimento (título) ou data de referência (antecipação) de/até, 'aaaa-mm-dd'. */
  vencDe: string | null;
  vencAte: string | null;
};

export const ehFiltroTipo = (v: string): v is FiltroTipo => v === "todos" || v === "titulos" || v === "antecipacoes";
export const ehFiltroSituacao = (v: string): v is FiltroSituacao => v === "todos" || v === "vencidos" || v === "a_vencer";
export const ehFiltroMostrar = (v: string): v is FiltroMostrar => v === "pendentes" || v === "todos";
export const ehDataIso = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Data que manda na ordem e nos filtros: vencimento do título; pagamento programado (ou emissão) da antecipação. */
export function dataReferencia(item: Pick<ItemPendente, "tipo" | "vencimento" | "dataPagamento" | "emissao">): string | null {
  return item.tipo === "titulo" ? item.vencimento : (item.dataPagamento ?? item.emissao);
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Dias de atraso do título (0 se a vencer ou sem data). Antecipação não "atrasa". */
export function diasAtraso(item: Pick<ItemPendente, "tipo" | "vencimento">, hoje: string): number {
  if (item.tipo !== "titulo" || !item.vencimento) return 0;
  return Math.max(0, diasEntre(hoje, item.vencimento));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texto único onde a busca procura: fornecedor, código, documento, CNPJ e histórico. */
export function textoBusca(item: Pick<ItemPendente, "fornecedor" | "codFornecedor" | "numDocumento" | "codLancamento" | "documentoFornecedor" | "complemento">): string {
  return semAcento([item.fornecedor, item.codFornecedor, item.numDocumento, item.codLancamento, item.documentoFornecedor ?? "", (item.documentoFornecedor ?? "").replace(/\D/g, ""), item.complemento].join(" "));
}

/**
 * Corte das antecipações: as com data de referência ANTERIOR ao corte são consideradas pagas fora do Neo Admin e saem da
 * lista (parâmetro financeiro.contas-pagar.antecipacoes_a_partir_de). Sem corte, todas entram. Títulos não são afetados.
 */
export function aplicarCorteAntecipacoes<T extends Pick<ItemPendente, "tipo" | "vencimento" | "dataPagamento" | "emissao">>(itens: readonly T[], corte: string | null): T[] {
  if (!corte) return [...itens];
  return itens.filter((i) => {
    if (i.tipo !== "antecipacao") return true;
    const ref = dataReferencia(i);
    return ref === null || ref >= corte;
  });
}

export function aplicarFiltrosPendentes(itens: readonly ItemPendente[], f: FiltrosPendentes, hoje: string): ItemPendente[] {
  const termos = semAcento(f.busca.trim()).split(/\s+/).filter(Boolean);
  return itens.filter((i) => {
    if (f.mostrar === "pendentes" && !estaPendente(i)) return false;
    if (f.tipo === "titulos" && i.tipo !== "titulo") return false;
    if (f.tipo === "antecipacoes" && i.tipo !== "antecipacao") return false;
    if (f.situacao === "vencidos" && !(i.tipo === "titulo" && i.vencimento !== null && i.vencimento < hoje)) return false;
    if (f.situacao === "a_vencer" && i.tipo === "titulo" && i.vencimento !== null && i.vencimento < hoje) return false;
    const ref = dataReferencia(i);
    if (f.vencDe && (ref === null || ref < f.vencDe)) return false;
    if (f.vencAte && (ref === null || ref > f.vencAte)) return false;
    if (termos.length > 0) {
      const alvo = textoBusca(i);
      if (!termos.every((t) => alvo.includes(t))) return false;
    }
    return true;
  });
}

/** Vencidos primeiro (mais antigo no topo), depois por data de referência, depois fornecedor; sem data por último. */
export function ordenarPendentes(itens: readonly ItemPendente[]): ItemPendente[] {
  return [...itens].sort((a, b) => {
    const ra = dataReferencia(a);
    const rb = dataReferencia(b);
    if (ra === null && rb !== null) return 1;
    if (rb === null && ra !== null) return -1;
    return (ra ?? "").localeCompare(rb ?? "") || a.fornecedor.localeCompare(b.fornecedor, "pt-BR") || a.codLancamento.localeCompare(b.codLancamento, undefined, { numeric: true });
  });
}

export type Totais = { quantidade: number; centavos: number };
export type TotaisPorTipo = { titulos: Totais; antecipacoes: Totais; geral: Totais; vencidos: Totais };

export function totalizar(itens: readonly ItemPendente[], hoje: string): TotaisPorTipo {
  const t: TotaisPorTipo = { titulos: { quantidade: 0, centavos: 0 }, antecipacoes: { quantidade: 0, centavos: 0 }, geral: { quantidade: 0, centavos: 0 }, vencidos: { quantidade: 0, centavos: 0 } };
  for (const i of itens) {
    const alvo = i.tipo === "titulo" ? t.titulos : t.antecipacoes;
    alvo.quantidade++;
    alvo.centavos += i.saldoCentavos;
    t.geral.quantidade++;
    t.geral.centavos += i.saldoCentavos;
    if (diasAtraso(i, hoje) > 0) {
      t.vencidos.quantidade++;
      t.vencidos.centavos += i.saldoCentavos;
    }
  }
  return t;
}

export function paginar<T>(itens: readonly T[], pagina: number, porPagina = POR_PAGINA): { pagina: number; totalPaginas: number; itens: T[] } {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const p = Math.min(Math.max(1, pagina), totalPaginas);
  return { pagina: p, totalPaginas, itens: itens.slice((p - 1) * porPagina, p * porPagina) };
}

/** Rótulo curto da situação de um item para a tabela. */
export function descreverSituacao(item: ItemPendente, hoje: string): string {
  if (item.tipo === "antecipacao") return item.dataPagamento ? `programada para ${formatarDataCurta(item.dataPagamento)}` : "sem data de pagamento";
  const dias = diasAtraso(item, hoje);
  if (dias > 0) return dias === 1 ? "vencido há 1 dia" : `vencido há ${dias} dias`;
  if (item.vencimento === hoje) return "vence hoje";
  if (item.vencimento) {
    const faltam = diasEntre(item.vencimento, hoje);
    return faltam === 1 ? "vence amanhã" : `vence em ${faltam} dias`;
  }
  return "sem vencimento";
}

const formatarDataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
