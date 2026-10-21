// Desdobramento no Consistem da compra parcelada cuja NF foi lançada pelo valor CHEIO (regra 61; migrations 0165 e 0177).
// A conciliação acha o par (linha "k/N" × título de ≈ N × parcela); aqui se monta o que vai para o ERP:
//   - k = 1 (NF na janela desta fatura): o título original vira a parcela 1 (PUT lancamentoContasPagar/{id} com { valorDocumento,
//     codDocumento, complementoHistorico }) e as parcelas 2 a N são títulos novos;
//   - k > 1 (NF lançada pelo total em outro mês, fora da janela; as parcelas 1..k−1 já foram pagas sem título — decisão do Alan,
//     21/10/2026): o original fica com as parcelas já pagas (valor (k−1) × parcela, documento "<NF>/1-(k−1)", complemento
//     "… PARC 1-(k−1)/N", vencimento que já tem — baixa à mão) e as parcelas k a N são títulos novos, a k no vencimento desta fatura;
//   - os títulos novos são copiados do original (fornecedor, categoria, emissão, entrada, fluxo, contas), com o portador e o
//     histórico da fatura do cartão por cima, nos vencimentos das faturas seguintes.
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

/** Parcela da linha desta fatura (1 quando a NF está na janela). */
const kDo = (par: Pick<ADesdobrar, "parcelaInicial">) => Math.max(1, par.parcelaInicial ?? 1);

/** O que fica no título original: a parcela 1 (k = 1) ou as já pagas, 1..k−1 (k > 1). */
function original(par: ADesdobrar, documento: string): { valorCentavos: number; documento: string; rotulo: string | number } {
  const k = kDo(par);
  if (k === 1) return { valorCentavos: par.parcelaCentavos, documento: `${documento}/1`, rotulo: 1 };
  const rotulo = k === 2 ? 1 : `1-${k - 1}`;
  return { valorCentavos: (k - 1) * par.parcelaCentavos, documento: `${documento}/${rotulo}`, rotulo };
}

/** Primeira parcela criada como título novo: 2 (k = 1) ou a desta fatura (k > 1). */
const primeiraNova = (par: ADesdobrar) => (kDo(par) === 1 ? 2 : kDo(par));

/**
 * Vencimento da parcela j criada: a da fatura (k > 1, j = k) ou o vencimento nominal da competência (j − k) meses depois da desta
 * fatura (a parcela k é a desta fatura).
 */
const vencimentoDaParcela = (cartao: Cartao, competencia: string, par: ADesdobrar, j: number, vencimentoFatura?: string | null) =>
  j === kDo(par) && vencimentoFatura ? vencimentoFatura : cicloDaCompetencia(cartao, somarMeses(competencia, j - kDo(par))).vencimento;

/**
 * Prévia para a tela (sem ler o detalhe do título): o título original (parcela 1, ou as já pagas 1..k−1) e as parcelas criadas, com
 * vencimento, valor, documento e complemento. `parcela` = 0 marca o original quando ele fica com mais de uma parcela.
 */
export function previaDesdobramento(e: { par: ADesdobrar; cartao: Cartao; competencia: string | null; vencimentoFatura?: string | null }): ParcelaPrevia[] {
  const base = baseDocumento(e.par.titulo.numeroTitulo);
  const valores = valoresDasParcelas(e.par);
  const o = original(e.par, base);
  const primeiro: ParcelaPrevia = {
    parcela: typeof o.rotulo === "number" ? o.rotulo : 0, valorCentavos: o.valorCentavos, documento: o.documento, vencimento: e.par.titulo.vencimento,
    complemento: complementoCompra(e.cartao.nome, o.rotulo, e.par.parcelas, e.par.linha.descricao),
  };
  const novas: ParcelaPrevia[] = [];
  for (let j = primeiraNova(e.par); j <= e.par.parcelas; j++) {
    novas.push({
      parcela: j, valorCentavos: valores[j - 1], documento: `${base}/${j}`,
      vencimento: e.competencia ? vencimentoDaParcela(e.cartao, e.competencia, e.par, j, e.vencimentoFatura) : null,
      complemento: complementoCompra(e.cartao.nome, j, e.par.parcelas, e.par.linha.descricao),
    });
  }
  return [primeiro, ...novas];
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
export function montarDesdobramento(e: { par: ADesdobrar; detalhe: Record<string, unknown>; cartao: Cartao; competencia: string; marcas: MarcasCartao; vencimentoFatura?: string | null }): Desdobramento {
  const { par, detalhe: d } = e;
  const cod = par.titulo.codLancamento ?? par.titulo.numeroTitulo;
  const aMao = "desdobre à mão no Consistem";
  if (par.parcelas < 2 || par.parcelas > 48 || kDo(par) > par.parcelas) return { ok: false, erro: "Número de parcelas inválido." };
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
  for (let k = primeiraNova(par); k <= par.parcelas; k++) {
    const vencimento = vencimentoDaParcela(e.cartao, e.competencia, par, k, e.vencimentoFatura);
    const payload: NovoLancamentoContaPagar = {
      codFornecedor: campos.codFornecedor!, categoriaDoc: campos.categoriaDoc!, codDocumento: `${documento}/${k}`, codPortador: marcadas.codPortador,
      dataEmissao: emissao!, dataEntrada: entrada!, dataVencimento: vencimento, valorDocumento: valores[k - 1] / 100,
      codHistorico: marcadas.codHistorico, complementoHistorico: complementoCompra(e.cartao.nome, k, par.parcelas, par.linha.descricao),
      grupoContaFluxoCaixa: campos.grupoContaFluxoCaixa!, contaFluxoCaixa: campos.contaFluxoCaixa!,
      dadosContabilidade: { contaContabilDebito: campos.contaContabilDebito!, contaContabilCredito: campos.contaContabilCredito!, listaCentroCustoContab: [] },
    };
    parcelas.push({ parcela: k, parcelas: par.parcelas, vencimento, payload });
  }
  const o = original(par, documento);
  return {
    ok: true,
    alteracao: { valorDocumento: o.valorCentavos / 100, codDocumento: o.documento, complementoHistorico: complementoCompra(e.cartao.nome, o.rotulo, par.parcelas, par.linha.descricao) },
    parcelas,
  };
}
