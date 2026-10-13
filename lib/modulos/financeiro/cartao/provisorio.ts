// Título PROVISÓRIO da fatura do cartão (criado no fechamento do mês). Regra 54 de docs/modulos/financeiro-cartao.md.
// Fornecedor = banco emissor (codFornecedor dos códigos de encargos do cartão); valor = total da fatura; vencimento = o da
// fatura; emissão e entrada = dia do lançamento; documento = vencimento DDMMAA; complemento "FATURA CARTÃO <NOME> MM/AAAA".
// Os demais códigos vêm de financeiro.cartao.provisorio (nada é inventado: sem eles, recusa).
import { CAMPOS_COMPRA, lerCampos, ROTULO_CAMPO_COMPRA } from "./lancamento-compras";
import type { NovoLancamentoContaPagar } from "./lancamento-encargos";
import { normalizar } from "./texto";

export type Provisorio = { ok: true; payload: NovoLancamentoContaPagar } | { ok: false; erro: string };

/** "231026" (dia, mês e ano com 2 dígitos do vencimento). */
export const documentoProvisorio = (vencimento: string) => `${vencimento.slice(8, 10)}${vencimento.slice(5, 7)}${vencimento.slice(2, 4)}`;

/** "FATURA CARTÃO SICREDI PJ 10/2026" (até 70). */
export const complementoProvisorio = (nomeCartao: string, competencia: string) =>
  `FATURA CARTÃO ${normalizar(nomeCartao)} ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`.slice(0, 70);

export function montarProvisorio(e: {
  nomeCartao: string;
  /** crt_cartoes.lancamento_encargos (o codFornecedor do banco emissor). */
  codigosCartao: unknown;
  /** configuracoes financeiro.cartao.provisorio. */
  config: unknown;
  totalCentavos: number;
  vencimento: string;
  /** Competência do mês (AAAA-MM-01). */
  competencia: string;
  /** Data do lançamento (AAAA-MM-DD, Cuiabá). */
  hoje: string;
}): Provisorio {
  const fornecedor = lerCampos(e.codigosCartao).codFornecedor;
  if (!fornecedor) return { ok: false, erro: "O cartão não tem o fornecedor do banco emissor (códigos de encargos do cartão, aba Cartões)." };
  const c = { ...lerCampos(e.config), codFornecedor: fornecedor };
  const faltando = CAMPOS_COMPRA.filter((k) => c[k] === undefined);
  if (faltando.length) {
    return { ok: false, erro: `Configure o provisório (financeiro.cartao.provisorio): falta ${faltando.map((k) => ROTULO_CAMPO_COMPRA[k].toLowerCase()).join(", ")}.` };
  }
  if (e.totalCentavos <= 0) return { ok: false, erro: "Fatura sem valor." };
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(e.vencimento) || !iso.test(e.hoje) || !iso.test(e.competencia)) return { ok: false, erro: "Datas da fatura inválidas." };
  const d = c as Required<typeof c>;
  return {
    ok: true,
    payload: {
      codFornecedor: d.codFornecedor, categoriaDoc: d.categoriaDoc, codDocumento: documentoProvisorio(e.vencimento), codPortador: d.codPortador,
      dataEmissao: e.hoje, dataEntrada: e.hoje, dataVencimento: e.vencimento, valorDocumento: e.totalCentavos / 100,
      codHistorico: d.codHistorico, complementoHistorico: complementoProvisorio(e.nomeCartao, e.competencia),
      grupoContaFluxoCaixa: d.grupoContaFluxoCaixa, contaFluxoCaixa: d.contaFluxoCaixa,
      dadosContabilidade: { contaContabilDebito: d.contaContabilDebito, contaContabilCredito: d.contaContabilCredito, listaCentroCustoContab: [] },
    },
  };
}
