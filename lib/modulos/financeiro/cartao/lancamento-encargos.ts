// Títulos de ENCARGOS da fatura do cartão para o Consistem (PUT financeiro/v10/lancamentoContasPagar, corpo
// novoLancamentoContaPagar). Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 31 a 36.
//
// UM TÍTULO POR LINHA "Encargo financeiro" que ficou a lançar (sem justificativa e ainda não lançada), contra o banco emissor
// (fornecedor da configuração do cartão) — decisão do Alan em 21/10/2026: o título único com a soma do mês dificultava a
// conferência. Emissão e entrada = fechamento da fatura; vencimento = o da fatura; documento = DDMMAA do fechamento + "-" + número
// da linha na fatura; complemento = "CARTÃO <NOME> 1x — <DESCRIÇÃO>" (até 70 caracteres). Os códigos (histórico, portador,
// categoria, contas) vêm de crt_cartoes.lancamento_encargos: nada é inventado aqui.
import type { ItemALancar, ResultadoConciliacao } from "./conciliacao";
import { montarComplemento } from "./cartoes";
import { normalizar } from "./texto";

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

/**
 * Documento = dia, mês e ano do fechamento (DDMMAA). Só DDMM repete todo ano contra o mesmo fornecedor e o Consistem recusa:
 * "Documento (1910) do fornecedor (360) já possui o lançamento 10029" (encargos do Nubank PF, 20/10/2026).
 */
export const documentoDoFechamento = (fechamento: string) => `${fechamento.slice(8, 10)}${fechamento.slice(5, 7)}${fechamento.slice(2, 4)}`;

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

export type TituloEncargo = { item: ItemALancar; complemento: string; payload: NovoLancamentoContaPagar };
export type TitulosEncargos =
  | { ok: true; titulos: TituloEncargo[]; valorCentavos: number }
  | { ok: false; erro: string; linhas: ItemALancar[]; valorCentavos: number };

const dataIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Monta um título por linha de encargo. Recusa (com motivo) quando falta configuração, data ou valor positivo. */
export function montarTitulosEncargos(e: {
  nomeCartao: string;
  config: ConfigEncargos | null;
  linhas: readonly ItemALancar[];
  fechamento: string | null;
  vencimento: string;
}): TitulosEncargos {
  const linhas = [...e.linhas];
  const valorCentavos = linhas.reduce((s, a) => s + a.linha.valorCentavos, 0);
  if (linhas.length === 0) return { ok: false, erro: "Nenhum encargo pendente nesta fatura.", linhas, valorCentavos };
  const negativa = linhas.find((a) => a.linha.valorCentavos <= 0);
  if (negativa) return { ok: false, erro: `A linha "${negativa.linha.descricao}" não tem valor positivo: resolva com Decidir.`, linhas, valorCentavos };
  if (!e.config) return { ok: false, erro: "O cartão não tem os códigos do Consistem para encargos (aba Cartões).", linhas, valorCentavos };
  if (!e.fechamento || !dataIso(e.fechamento) || !dataIso(e.vencimento)) return { ok: false, erro: "Fatura sem mês do cartão (fechamento) ou sem vencimento.", linhas, valorCentavos };
  const c = e.config, fechamento = e.fechamento;
  const titulos = linhas.map((item): TituloEncargo => {
    const complemento = montarComplemento({ nome: e.nomeCartao }, 1, normalizar(item.linha.descricao));
    return {
      item, complemento,
      payload: {
        codFornecedor: c.codFornecedor, categoriaDoc: c.categoriaDoc, codDocumento: `${documentoDoFechamento(fechamento)}-${item.linha.ordem}`, codPortador: c.codPortador,
        dataEmissao: fechamento, dataEntrada: fechamento, dataVencimento: e.vencimento, valorDocumento: item.linha.valorCentavos / 100,
        codHistorico: c.codHistorico, complementoHistorico: complemento, grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
        dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
      },
    };
  });
  return { ok: true, titulos, valorCentavos };
}
