// Desdobramento no Consistem da compra parcelada cuja NF foi lançada pelo valor CHEIO (regra 61; migration 0165).
// A conciliação acha o par (linha "1/N" × título de ≈ N × parcela, `compraPeloTotal`); aqui se monta o que vai para o ERP:
//   - o título original vira a parcela 1: PUT lancamentoContasPagar/{id} com { valorDocumento, codDocumento, complementoHistorico };
//   - as parcelas 2 a N são títulos novos, copiados do original (fornecedor, categoria, emissão, entrada, fluxo, contas), com o
//     portador e o histórico da fatura do cartão por cima, nos vencimentos das faturas seguintes.
// A última parcela leva o arredondamento (total do título − (N−1) × parcela): a soma das parcelas é sempre o total da NF.
// Lógica PURA (testada com o Vitest); a Edge Function crt-desdobrar-no-consistem só envia o que foi montado e reservado.
import type { CartaoInfo } from "./cartoes";
import { cicloDaCompetencia } from "./ciclos";
import type { ADesdobrar } from "./conciliacao";
import { complementoCompra, somarMeses, type TituloCompra } from "./lancamento-compras";
import type { NovoLancamentoContaPagar } from "./lancamento-encargos";
import { comMarcasDaFatura, type MarcasCartao } from "./portador-fatura";

export type ParcelaPrevia = { parcela: number; vencimento: string | null; valorCentavos: number; documento: string; complemento: string };
/** O que o PUT grava no título original (parcela 1). */
export type AlteracaoDesdobramento = { valorDocumento: number; codDocumento: string; complementoHistorico: string };
export type Desdobramento = { ok: true; alteracao: AlteracaoDesdobramento; parcelas: TituloCompra[] } | { ok: false; erro: string };

type Cartao = Pick<CartaoInfo, "nome" | "diaFechamento" | "diaVencimento">;

/** Número do documento sem a parcela ("3615152/1" → "3615152"). */
export const baseDocumento = (doc: string) => doc.trim().replace(/\/\d+$/, "");

/** Valores das N parcelas (centavos): todas a da linha; a última fecha o total do título. */
export function valoresDasParcelas(par: Pick<ADesdobrar, "parcelas" | "parcelaCentavos" | "titulo">): number[] {
  const n = par.parcelas;
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? par.parcelaCentavos : par.titulo.valorCentavos - (n - 1) * par.parcelaCentavos));
}

/** Vencimento da parcela k (k ≥ 2): o vencimento nominal da competência k − 1 meses depois da desta fatura. */
const vencimentoDaParcela = (cartao: Cartao, competencia: string, k: number) => cicloDaCompetencia(cartao, somarMeses(competencia, k - 1)).vencimento;

/** Prévia para a tela (sem ler o detalhe do título): parcela, vencimento, valor, documento e complemento. */
export function previaDesdobramento(e: { par: ADesdobrar; cartao: Cartao; competencia: string | null }): ParcelaPrevia[] {
  const base = baseDocumento(e.par.titulo.numeroTitulo);
  return valoresDasParcelas(e.par).map((valorCentavos, i) => {
    const k = i + 1;
    return {
      parcela: k, valorCentavos, documento: `${base}/${k}`,
      vencimento: k === 1 ? e.par.titulo.vencimento : e.competencia ? vencimentoDaParcela(e.cartao, e.competencia, k) : null,
      complemento: complementoCompra(e.cartao.nome, k, e.par.parcelas, e.par.linha.descricao),
    };
  });
}

const inteiro = (v: unknown) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
};
const data = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const centavos = (v: unknown) => Math.round(Number(v) * 100);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Monta a alteração do título original e as parcelas 2 a N a partir do DETALHE do título lido do Consistem
 * (GET lancamentoContasPagar/{id}). Recusa, com o motivo, o que não dá para desdobrar com segurança pela API.
 */
export function montarDesdobramento(e: { par: ADesdobrar; detalhe: Record<string, unknown>; cartao: Cartao; competencia: string; marcas: MarcasCartao }): Desdobramento {
  const { par, detalhe: d } = e;
  const cod = par.titulo.codLancamento ?? par.titulo.numeroTitulo;
  const aMao = "desdobre à mão no Consistem";
  if (par.parcelas < 2 || par.parcelas > 48) return { ok: false, erro: "Número de parcelas inválido." };
  if (d.tipoLancamento !== undefined && d.tipoLancamento !== "C") return { ok: false, erro: `O lançamento ${cod} não é um título (tipo ${String(d.tipoLancamento)}).` };
  if (centavos(d.valorDocumento) !== par.titulo.valorCentavos) {
    return { ok: false, erro: `O título ${cod} vale ${reais(centavos(d.valorDocumento))} no Consistem, e a conciliação viu ${reais(par.titulo.valorCentavos)}. Recarregue a página.` };
  }
  if (centavos(d.valorPago ?? 0) > 0 || data(d.dataPagamento)) return { ok: false, erro: `O título ${cod} já tem pagamento no Consistem: ${aMao}.` };
  if (par.titulo.emBordero) return { ok: false, erro: `O título ${cod} está num borderô: ${aMao}.` };
  const contab = (d.dadosContabilidade ?? {}) as Record<string, unknown>;
  if (Array.isArray(contab.listaCentroCustoContab) && contab.listaCentroCustoContab.length > 0) {
    return { ok: false, erro: `O título ${cod} tem rateio por centro de custo: ${aMao}.` };
  }
  const campos = {
    codFornecedor: inteiro(d.codFornecedor), categoriaDoc: inteiro(d.categoriaDoc), grupoContaFluxoCaixa: inteiro(d.grupoContaFluxoCaixa),
    contaFluxoCaixa: inteiro(d.contaFluxoCaixa), codPortador: inteiro(d.codPortador), codHistorico: inteiro(d.codHistorico),
    contaContabilDebito: inteiro(contab.contaContabilDebito), contaContabilCredito: inteiro(contab.contaContabilCredito),
  };
  const documento = typeof d.codDocumento === "string" || typeof d.codDocumento === "number" ? baseDocumento(String(d.codDocumento)) : "";
  const emissao = data(d.dataEmissao);
  const entrada = data(d.dataEntrada) ?? emissao;
  const faltando = [
    ...Object.entries(campos).filter(([, v]) => v === null).map(([k]) => k),
    ...(documento ? [] : ["codDocumento"]), ...(emissao ? [] : ["dataEmissao"]),
  ];
  if (faltando.length) return { ok: false, erro: `O título ${cod} está sem ${faltando.join(", ")} no Consistem: ${aMao}.` };
  const valores = valoresDasParcelas(par);
  if (valores[valores.length - 1] <= 0) return { ok: false, erro: "A última parcela ficaria sem valor." };
  const marcadas = comMarcasDaFatura({ codPortador: campos.codPortador!, codHistorico: campos.codHistorico! }, e.marcas);
  const parcelas: TituloCompra[] = [];
  for (let k = 2; k <= par.parcelas; k++) {
    const vencimento = vencimentoDaParcela(e.cartao, e.competencia, k);
    const payload: NovoLancamentoContaPagar = {
      codFornecedor: campos.codFornecedor!, categoriaDoc: campos.categoriaDoc!, codDocumento: `${documento}/${k}`, codPortador: marcadas.codPortador,
      dataEmissao: emissao!, dataEntrada: entrada!, dataVencimento: vencimento, valorDocumento: valores[k - 1] / 100,
      codHistorico: marcadas.codHistorico, complementoHistorico: complementoCompra(e.cartao.nome, k, par.parcelas, par.linha.descricao),
      grupoContaFluxoCaixa: campos.grupoContaFluxoCaixa!, contaFluxoCaixa: campos.contaFluxoCaixa!,
      dadosContabilidade: { contaContabilDebito: campos.contaContabilDebito!, contaContabilCredito: campos.contaContabilCredito!, listaCentroCustoContab: [] },
    };
    parcelas.push({ parcela: k, parcelas: par.parcelas, vencimento, payload });
  }
  return {
    ok: true,
    alteracao: { valorDocumento: valores[0] / 100, codDocumento: `${documento}/1`, complementoHistorico: complementoCompra(e.cartao.nome, 1, par.parcelas, par.linha.descricao) },
    parcelas,
  };
}
