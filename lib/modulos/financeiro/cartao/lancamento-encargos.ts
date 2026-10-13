// Título de ENCARGOS da fatura do cartão para o Consistem (PUT financeiro/v10/lancamentoContasPagar, corpo
// novoLancamentoContaPagar). Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 31 a 36.
//
// Um título por mês com a SOMA das linhas "Encargo financeiro" que ficaram a lançar (sem justificativa e ainda não lançadas),
// contra o banco emissor (fornecedor da configuração do cartão). Emissão e entrada = fechamento da fatura; vencimento = o da
// fatura; documento = DDMM do fechamento; complemento = "CARTÃO <NOME> — ENCARGOS: IOF, JUROS..." (até 70 caracteres).
// Os códigos (histórico, portador, categoria, contas) vêm de crt_cartoes.lancamento_encargos: nada é inventado aqui.
import type { ItemALancar, ResultadoConciliacao } from "./conciliacao";
import { normalizar } from "./texto";

export const MAX_COMPLEMENTO_ERP = 70;
const CAMPOS_CONFIG = [
  "codFornecedor", "codHistorico", "codPortador", "categoriaDoc", "grupoContaFluxoCaixa", "contaFluxoCaixa", "contaContabilDebito", "contaContabilCredito",
] as const;
export type ConfigEncargos = Record<(typeof CAMPOS_CONFIG)[number], number>;

export const ROTULO_CAMPO_CONFIG: Record<keyof ConfigEncargos, string> = {
  codFornecedor: "Fornecedor (banco emissor)", codHistorico: "Histórico", codPortador: "Portador", categoriaDoc: "Categoria do documento",
  grupoContaFluxoCaixa: "Grupo da conta de fluxo", contaFluxoCaixa: "Conta de fluxo", contaContabilDebito: "Conta contábil de débito",
  contaContabilCredito: "Conta contábil de crédito",
};
export const CAMPOS_CONFIG_ENCARGOS = CAMPOS_CONFIG;

/** Lê a configuração gravada no cartão; nula se faltar algum código (inteiro positivo). */
export function lerConfigEncargos(json: unknown): ConfigEncargos | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const cfg = {} as ConfigEncargos;
  for (const k of CAMPOS_CONFIG) {
    const v = typeof o[k] === "string" ? Number(o[k]) : o[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
    cfg[k] = v;
  }
  return cfg;
}

/** Linhas "Encargo financeiro" a lançar: sem justificativa e fora de lançamento anterior. */
export function encargosALancar(resultado: Pick<ResultadoConciliacao, "aLancar">, linhasJaLancadas: ReadonlySet<string> = new Set()): ItemALancar[] {
  return resultado.aLancar.filter((a) => a.natureza === "Encargo financeiro" && !a.justificativa && !linhasJaLancadas.has(a.linha.id));
}

const TIPOS: [RegExp, string][] = [
  [/\bIOF\b/, "IOF"], [/JUROS|MORA|ROTATIVO/, "JUROS"], [/MULTA/, "MULTA"], [/ANUIDADE/, "ANUIDADE"], [/TARIFA/, "TARIFA"], [/SEGURO/, "SEGURO"],
  [/PARCELAMENTO DE FATURA/, "PARCELAMENTO"],
];

/** "CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS" (tipos na ordem de TIPOS; corta em 70). */
export function complementoEncargos(nomeCartao: string, descricoes: readonly string[]): string {
  const texto = descricoes.map((d) => normalizar(d)).join(" | ");
  const tipos = TIPOS.filter(([re]) => re.test(texto)).map(([, nome]) => nome);
  const base = `CARTÃO ${nomeCartao.toUpperCase()} — ENCARGOS`;
  const completo = tipos.length ? `${base}: ${tipos.join(", ")}` : base;
  return completo.length <= MAX_COMPLEMENTO_ERP ? completo : completo.slice(0, MAX_COMPLEMENTO_ERP).trimEnd();
}

/** Documento = dia e mês do fechamento (DDMM), como nos lançamentos manuais. */
export const documentoDoFechamento = (fechamento: string) => `${fechamento.slice(8, 10)}${fechamento.slice(5, 7)}`;

export type NovoLancamentoContaPagar = {
  codFornecedor: number;
  categoriaDoc: number;
  codDocumento: string;
  codPortador: number;
  dataEmissao: string;
  dataEntrada: string;
  dataVencimento: string;
  valorDocumento: number;
  codHistorico: number;
  complementoHistorico: string;
  grupoContaFluxoCaixa: number;
  contaFluxoCaixa: number;
  dadosContabilidade: { contaContabilDebito: number; contaContabilCredito: number; listaCentroCustoContab: never[] };
};

export type TituloEncargos =
  | { ok: true; linhas: ItemALancar[]; valorCentavos: number; complemento: string; payload: NovoLancamentoContaPagar }
  | { ok: false; erro: string; linhas: ItemALancar[]; valorCentavos: number };

const dataIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Monta o título de encargos do mês. Recusa (com motivo) quando falta configuração, data ou valor positivo. */
export function montarTituloEncargos(e: {
  nomeCartao: string;
  config: ConfigEncargos | null;
  linhas: readonly ItemALancar[];
  fechamento: string | null;
  vencimento: string;
}): TituloEncargos {
  const linhas = [...e.linhas];
  const valorCentavos = linhas.reduce((s, a) => s + a.linha.valorCentavos, 0);
  if (linhas.length === 0) return { ok: false, erro: "Nenhum encargo pendente nesta fatura.", linhas, valorCentavos };
  if (valorCentavos <= 0) return { ok: false, erro: "A soma dos encargos não é positiva: resolva os estornos com Decidir.", linhas, valorCentavos };
  if (!e.config) return { ok: false, erro: "O cartão não tem os códigos do Consistem para encargos (aba Cartões).", linhas, valorCentavos };
  if (!e.fechamento || !dataIso(e.fechamento) || !dataIso(e.vencimento)) return { ok: false, erro: "Fatura sem mês do cartão (fechamento) ou sem vencimento.", linhas, valorCentavos };
  const complemento = complementoEncargos(e.nomeCartao, linhas.map((a) => a.linha.descricao));
  const c = e.config;
  return {
    ok: true, linhas, valorCentavos, complemento,
    payload: {
      codFornecedor: c.codFornecedor, categoriaDoc: c.categoriaDoc, codDocumento: documentoDoFechamento(e.fechamento), codPortador: c.codPortador,
      dataEmissao: e.fechamento, dataEntrada: e.fechamento, dataVencimento: e.vencimento, valorDocumento: valorCentavos / 100,
      codHistorico: c.codHistorico, complementoHistorico: complemento, grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
      dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
    },
  };
}
