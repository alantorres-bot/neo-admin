// Títulos do RH (folha e VT) para o Consistem (PUT financeiro/v10/lancamentoContasPagar). Decisões de 22/10/2026 (migration 0521;
// docs/modulos/rh-folha.md, regra 10): um título por funcionário × tipo; histórico, fluxo e contas contábeis por TIPO; categoria
// única; portador pela conta que paga (empregador × forma). Nada é inventado aqui: tudo vem dos Parâmetros, e a reserva no banco
// confere de novo.
import type { NovoLancamentoContaPagar } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";

export const TIPOS_TITULO = ["vt", "salario", "ferias", "decimo_1", "decimo_2", "avulso"] as const;
export type TipoTitulo = (typeof TIPOS_TITULO)[number];
/** Também é o texto do complemento do título no Consistem. */
export const ROTULO_TIPO: Record<TipoTitulo, string> = {
  vt: "VALE TRANSPORTE", salario: "SALÁRIO", ferias: "FÉRIAS", decimo_1: "13º SALÁRIO 1ª PARCELA", decimo_2: "13º SALÁRIO 2ª PARCELA", avulso: "AVULSO",
};
const SIGLA: Record<TipoTitulo, string> = { vt: "VT", salario: "SA", ferias: "FE", decimo_1: "D1", decimo_2: "D2", avulso: "AV" };

/** Todos os códigos de um título. */
export const CAMPOS_LANCAMENTO = ["codHistorico", "codPortador", "categoriaDoc", "grupoContaFluxoCaixa", "contaFluxoCaixa", "contaContabilDebito", "contaContabilCredito"] as const;
export type CodigosLancamento = Record<(typeof CAMPOS_LANCAMENTO)[number], number>;
export const ROTULO_CAMPO_LANCAMENTO: Record<keyof CodigosLancamento, string> = {
  codHistorico: "Histórico", codPortador: "Portador", categoriaDoc: "Categoria do documento", grupoContaFluxoCaixa: "Grupo da conta de fluxo",
  contaFluxoCaixa: "Conta de fluxo", contaContabilDebito: "Conta contábil de débito", contaContabilCredito: "Conta contábil de crédito",
};
/** Os que dependem do tipo (o portador vem da tabela de portadores; a categoria é única). */
export const CAMPOS_TIPO = ["codHistorico", "grupoContaFluxoCaixa", "contaFluxoCaixa", "contaContabilDebito", "contaContabilCredito"] as const;
export type CodigosTipo = Record<(typeof CAMPOS_TIPO)[number], number>;

/** Forma de pagamento para o portador: FOPAG ou PIX (as formas antigas "pix_neo_…" contam como PIX). */
export type FormaPortador = "fopag" | "pix";
export const formaDoPortador = (forma: string): FormaPortador => (forma === "fopag" ? "fopag" : "pix");

export type Portador = { empregador: string; forma: FormaPortador; codPortador: number; conta: string | null };
export type ParametrosLancamento = { categoriaDoc: number | null; tipos: Partial<Record<TipoTitulo, CodigosTipo>>; portadores: Portador[] };

const inteiroPositivo = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
};
const chaveEmpregador = (e: string) => e.trim().toUpperCase();

/** Códigos de um tipo; null se faltar algum (inteiro positivo) ou se débito = crédito. */
export function lerCodigosTipo(json: unknown): CodigosTipo | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const cfg = {} as CodigosTipo;
  for (const k of CAMPOS_TIPO) {
    const v = inteiroPositivo(o[k]);
    if (v === undefined) return null;
    cfg[k] = v;
  }
  return cfg.contaContabilDebito === cfg.contaContabilCredito ? null : cfg;
}

/** Lê configuracoes 'rh.lancamento'; o que estiver incompleto fica de fora (e o botão recusa). */
export function lerParametrosLancamento(json: unknown): ParametrosLancamento {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const tiposBrutos = (o.tipos && typeof o.tipos === "object" ? o.tipos : {}) as Record<string, unknown>;
  const tipos: ParametrosLancamento["tipos"] = {};
  for (const t of TIPOS_TITULO) {
    const c = lerCodigosTipo(tiposBrutos[t]);
    if (c) tipos[t] = c;
  }
  const portadores: Portador[] = [];
  for (const p of Array.isArray(o.portadores) ? o.portadores : []) {
    const r = (p ?? {}) as Record<string, unknown>;
    const cod = inteiroPositivo(r.codPortador);
    if (typeof r.empregador === "string" && r.empregador.trim() && (r.forma === "fopag" || r.forma === "pix") && cod)
      portadores.push({ empregador: chaveEmpregador(r.empregador), forma: r.forma, codPortador: cod, conta: typeof r.conta === "string" && r.conta.trim() ? r.conta.trim() : null });
  }
  return { categoriaDoc: inteiroPositivo(o.categoriaDoc) ?? null, tipos, portadores };
}

export const portadorDe = (p: ParametrosLancamento, empregador: string, forma: string): Portador | undefined =>
  p.portadores.find((x) => x.empregador === chaveEmpregador(empregador) && x.forma === formaDoPortador(forma));

/** Conta que paga (rótulo dos Parâmetros), para agrupar a lista de PIX. */
export const contaPagadora = (p: ParametrosLancamento, empregador: string, forma: string): string | null => portadorDe(p, empregador, forma)?.conta ?? null;

/** Códigos completos do título (mesma regra de rh_codigos_titulo no banco); null se faltar tipo, categoria ou portador. */
export function codigosDoTitulo(p: ParametrosLancamento, tipo: TipoTitulo, empregador: string, forma: string): CodigosLancamento | null {
  const t = p.tipos[tipo];
  const port = portadorDe(p, empregador, forma);
  return t && p.categoriaDoc && port ? { ...t, categoriaDoc: p.categoriaDoc, codPortador: port.codPortador } : null;
}

/** "SALÁRIO - 10/2026" (competência do mês). */
export const complemento = (tipo: TipoTitulo, competencia: string) => `${ROTULO_TIPO[tipo]} - ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
/** Sigla + MMAA, ex.: "SA1026" (o VT continua "VT1126"). */
export const documento = (tipo: TipoTitulo, competencia: string) => `${SIGLA[tipo]}${competencia.slice(5, 7)}${competencia.slice(2, 4)}`;

/** Fornecedor = Nº do funcionário; vencimento = dia do pagamento; emissão/entrada = dia do lançamento. */
export function montarTitulo(e: { tipo: TipoTitulo; codFornecedor: string; valor: number; competencia: string; dataPagamento: string; hoje: string; codigos: CodigosLancamento }): NovoLancamentoContaPagar {
  const c = e.codigos;
  return {
    codFornecedor: Number(e.codFornecedor), categoriaDoc: c.categoriaDoc, codDocumento: documento(e.tipo, e.competencia), codPortador: c.codPortador,
    dataEmissao: e.hoje, dataEntrada: e.hoje, dataVencimento: e.dataPagamento, valorDocumento: Math.round(e.valor * 100) / 100,
    codHistorico: c.codHistorico, complementoHistorico: complemento(e.tipo, e.competencia),
    grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
    dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
  };
}

/** Códigos lidos do detalhe de um título já lançado no Consistem (modelo); o que não vier fica de fora para o gestor digitar. */
export function codigosDoModelo(detalhe: Record<string, unknown>): Partial<CodigosLancamento> {
  const contab = (detalhe.dadosContabilidade && typeof detalhe.dadosContabilidade === "object" ? detalhe.dadosContabilidade : {}) as Record<string, unknown>;
  const achado: Partial<CodigosLancamento> = {
    codHistorico: inteiroPositivo(detalhe.codHistorico),
    codPortador: inteiroPositivo(detalhe.codPortador ?? detalhe.codBanco),
    categoriaDoc: inteiroPositivo(detalhe.categoriaDoc),
    grupoContaFluxoCaixa: inteiroPositivo(detalhe.grupoContaFluxoCaixa),
    contaFluxoCaixa: inteiroPositivo(detalhe.contaFluxoCaixa),
    contaContabilDebito: inteiroPositivo(contab.contaContabilDebito ?? detalhe.contaContabilDebito),
    contaContabilCredito: inteiroPositivo(contab.contaContabilCredito ?? detalhe.contaContabilCredito),
  };
  return Object.fromEntries(Object.entries(achado).filter(([, v]) => v !== undefined)) as Partial<CodigosLancamento>;
}
