// Títulos de COMPRA da fatura do cartão para o Consistem (mesma operação dos encargos: PUT lancamentoContasPagar).
// Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 37 a 43.
//
// Sugestão: o estabelecimento do dicionário (crt_estabelecimentos.lancamento_erp) e os padrões do cartão
// (crt_cartoes.lancamento_compras); o operador confere e pode mudar tudo. Parcelada sem título (ex.: 2/5): um título por parcela
// restante, a primeira no vencimento desta fatura e as demais nos vencimentos nominais das competências seguintes.
import type { CartaoInfo } from "./cartoes";
import { cicloDaCompetencia } from "./ciclos";
import { doDicionario, type LinhaFatura } from "./conciliacao";
import type { NovoLancamentoContaPagar } from "./lancamento-encargos";
import { normalizar } from "./texto";

export const CAMPOS_COMPRA = [
  "codFornecedor", "codHistorico", "codPortador", "categoriaDoc", "grupoContaFluxoCaixa", "contaFluxoCaixa", "contaContabilDebito", "contaContabilCredito",
] as const;
export type CampoCompra = (typeof CAMPOS_COMPRA)[number];
export type CamposCompra = Partial<Record<CampoCompra, number>>;
export type OrigemCampo = "estabelecimento" | "cartao" | "fornecedor" | "escolher";

export const ROTULO_CAMPO_COMPRA: Record<CampoCompra, string> = {
  codFornecedor: "Fornecedor", codHistorico: "Histórico", codPortador: "Portador", categoriaDoc: "Categoria do documento",
  grupoContaFluxoCaixa: "Grupo da conta de fluxo", contaFluxoCaixa: "Conta de fluxo", contaContabilDebito: "Conta contábil de débito",
  contaContabilCredito: "Conta contábil de crédito",
};
/** Padrões do cartão para compras (crt_cartoes.lancamento_compras). */
export const CAMPOS_PADRAO_CARTAO = ["codPortador", "categoriaDoc", "codHistorico", "contaContabilCredito"] as const;

const MAX = 70;
const inteiro = (v: unknown) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Lê um jsonb de códigos (só os campos conhecidos, inteiros positivos). */
export function lerCampos(json: unknown): CamposCompra {
  const c: CamposCompra = {};
  if (!json || typeof json !== "object") return c;
  for (const k of CAMPOS_COMPRA) {
    const v = inteiro((json as Record<string, unknown>)[k]);
    if (v !== undefined) c[k] = v;
  }
  return c;
}

export type EstabelecimentoCodigos = { padrao: string; lancamentoErp: CamposCompra };

export type Sugestao = { padrao: string | null; campos: CamposCompra; origem: Record<CampoCompra, OrigemCampo> };

/** Sugestão para a linha: o estabelecimento (mais específico) por cima dos padrões do cartão; o resto fica para escolher. */
export function sugestaoDaLinha(descricao: string, estabelecimentos: readonly EstabelecimentoCodigos[], padroesCartao: CamposCompra): Sugestao {
  const e = doDicionario(descricao, estabelecimentos);
  const campos: CamposCompra = {};
  const origem = {} as Record<CampoCompra, OrigemCampo>;
  for (const k of CAMPOS_COMPRA) {
    const doEstab = e?.lancamentoErp[k];
    const doCartao = (CAMPOS_PADRAO_CARTAO as readonly string[]).includes(k) ? padroesCartao[k] : undefined;
    if (doEstab !== undefined) { campos[k] = doEstab; origem[k] = "estabelecimento"; }
    else if (doCartao !== undefined) { campos[k] = doCartao; origem[k] = "cartao"; }
    else origem[k] = "escolher";
  }
  return { padrao: e?.padrao ?? null, campos, origem };
}

/** Chave para "lembrar" quando o estabelecimento não está no dicionário: a primeira palavra útil da descrição. */
export function padraoSugerido(descricao: string): string {
  const palavras = normalizar(descricao).replace(/[^A-Z0-9 ]+/g, " ").split(" ").filter((p) => /[A-Z]/.test(p) && p.length >= 3);
  return (palavras[0] ?? normalizar(descricao).slice(0, 20)).slice(0, 60);
}

/** "CARTÃO SICREDI PF 5x — NUVIAGENS PARC 2/5" (até 70; a descrição é cortada, a parcela fica). */
export function complementoCompra(nomeCartao: string, parcela: number, parcelas: number, descricao: string): string {
  const base = `CARTÃO ${nomeCartao.toUpperCase()} ${parcelas}x — `;
  const sufixo = parcelas > 1 ? ` PARC ${parcela}/${parcelas}` : "";
  const desc = normalizar(descricao).slice(0, Math.max(0, MAX - base.length - sufixo.length)).trimEnd();
  return `${base}${desc}${sufixo}`.slice(0, MAX);
}

/** Competência (AAAA-MM-01) somada de n meses. */
export function somarMeses(competencia: string, n: number): string {
  const total = Number(competencia.slice(0, 4)) * 12 + Number(competencia.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export type TituloCompra = { parcela: number; parcelas: number; vencimento: string; payload: NovoLancamentoContaPagar };
export type ResultadoCompra = { ok: true; titulos: TituloCompra[] } | { ok: false; erro: string };

/** Monta os títulos da compra: um por parcela restante, da parcela da linha até a última. */
export function montarTitulosCompra(e: {
  linha: Pick<LinhaFatura, "ordem" | "dataCompra" | "descricao" | "valorCentavos" | "parcelaNum" | "parcelaTotal">;
  cartao: Pick<CartaoInfo, "nome" | "diaFechamento" | "diaVencimento">;
  campos: CamposCompra;
  vencimentoFatura: string;
  /** Competência do mês da fatura (AAAA-MM-01). */
  competencia: string;
}): ResultadoCompra {
  const { linha, campos } = e;
  if (linha.valorCentavos <= 0) return { ok: false, erro: "Estorno ou crédito não vira título: abata do título da compra." };
  const faltando = CAMPOS_COMPRA.filter((k) => campos[k] === undefined);
  if (faltando.length) return { ok: false, erro: `Preencha: ${faltando.map((k) => ROTULO_CAMPO_COMPRA[k].toLowerCase()).join(", ")}.` };
  if (!linha.dataCompra || !/^\d{4}-\d{2}-\d{2}$/.test(linha.dataCompra)) return { ok: false, erro: "A linha não tem a data da compra." };
  const primeira = linha.parcelaNum ?? 1;
  const total = linha.parcelaTotal ?? 1;
  if (primeira < 1 || primeira > total) return { ok: false, erro: "Parcela inválida na linha da fatura." };
  const ddmmaa = `${linha.dataCompra.slice(8, 10)}${linha.dataCompra.slice(5, 7)}${linha.dataCompra.slice(2, 4)}`;   // com o ano: DDMM repete todo ano
  const c = campos as Record<CampoCompra, number>;
  const titulos: TituloCompra[] = [];
  for (let k = primeira, i = 0; k <= total; k++, i++) {
    const vencimento = i === 0 ? e.vencimentoFatura : cicloDaCompetencia(e.cartao, somarMeses(e.competencia, i)).vencimento;
    const complemento = complementoCompra(e.cartao.nome, k, total, linha.descricao);
    titulos.push({
      parcela: k, parcelas: total, vencimento,
      payload: {
        codFornecedor: c.codFornecedor, categoriaDoc: c.categoriaDoc, codDocumento: total > 1 ? `${ddmmaa}-${linha.ordem}/${k}` : `${ddmmaa}-${linha.ordem}`, codPortador: c.codPortador,
        dataEmissao: linha.dataCompra, dataEntrada: linha.dataCompra, dataVencimento: vencimento, valorDocumento: linha.valorCentavos / 100,
        codHistorico: c.codHistorico, complementoHistorico: complemento, grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
        dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
      },
    });
  }
  return { ok: true, titulos };
}

/**
 * Contas contábeis invertidas ou iguais: o débito é a despesa e o crédito é a conta de fornecedores (a de crédito padrão do
 * cartão). Recusa débito igual ao crédito e débito igual à conta de crédito padrão (caso do 1º uso real, 13/10/2026).
 */
export function conferirContas(campos: CamposCompra, creditoPadrao: number | null | undefined): string | null {
  const d = campos.contaContabilDebito;
  const c = campos.contaContabilCredito;
  if (d !== undefined && c !== undefined && d === c) return "A conta contábil de débito não pode ser igual à de crédito.";
  if (d !== undefined && creditoPadrao && d === creditoPadrao) {
    return `A conta de débito ${d} é a conta de fornecedores (crédito padrão do cartão): use a conta da despesa no débito e ${creditoPadrao} no crédito.`;
  }
  return null;
}
