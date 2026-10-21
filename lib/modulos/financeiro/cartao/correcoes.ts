// Avisos e correções dos títulos conciliados da fatura (regras 68 a 71 de docs/modulos/financeiro-cartao.md; decisões do Alan,
// 21/10/2026, depois do Nubank PF e do PicPay PF 10/2026). Os avisos não bloqueiam o fechamento; as correções vão ao Consistem
// pela Edge Function crt-corrigir-no-consistem (operador, mês em conciliação), que confere o título antes e depois.
//   cartao       — o complemento cita OUTRO cartão (ex.: "CARTÃO SICREDI PJ 1x — TQS INFORMAT" pago no PicPay);
//   vencimento   — fora do vencimento da fatura e do dia nominal do cartão (ex.: 28/10 no Nubank, que vence 27): some do
//                  relatório do Consistem filtrado pelo dia do cartão;
//   fluxo_inativo — conta de fluxo de caixa inativa: o Consistem recusa QUALQUER alteração no título (inclusive a troca do banco);
//   complemento_longo — mais de 60 caracteres: ao alterar, o Consistem cortaria o texto (a troca do banco não altera o título).
import { cartaoDivergente, chaveTitulo, type ResultadoConciliacao, type TituloPagar } from "./conciliacao";
import { ehMarcaCartao, MAX_COMPLEMENTO, mesmoBanco, normalizarTexto, type CartaoInfo } from "./cartoes";

export type TipoAviso = "cartao" | "vencimento" | "fluxo_inativo" | "complemento_longo";
export type Aviso = { tipo: TipoAviso; texto: string };
export type ContaFluxo = { grupo: number; conta: number };

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
export const chaveConta = (c: ContaFluxo) => `${c.grupo}/${c.conta}`;

/** Avisos de um título conciliado. `fluxo` vem do detalhe do título (a listagem do Consistem não traz a conta de fluxo). */
export function avisosDoTitulo(t: TituloPagar, e: {
  cartao: CartaoInfo; cartoes: readonly CartaoInfo[]; vencimentoFatura: string; fluxo?: ContaFluxo | null; contasInativas: ReadonlySet<string>;
}): Aviso[] {
  const avisos: Aviso[] = [];
  if (cartaoDivergente({ complemento: t.complemento, vencimento: t.vencimento }, e.cartao, e.cartoes)) {
    avisos.push({ tipo: "cartao", texto: "O complemento cita outro cartão" });
  }
  if (!t.antecipacao && t.vencimento && t.vencimento !== e.vencimentoFatura && Number(t.vencimento.slice(8, 10)) !== e.cartao.diaVencimento) {
    avisos.push({ tipo: "vencimento", texto: `Vencimento ${dataBr(t.vencimento)}: a fatura vence ${dataBr(e.vencimentoFatura)} (dia ${e.cartao.diaVencimento} do cartão)` });
  }
  if (e.fluxo && e.contasInativas.has(chaveConta(e.fluxo))) {
    avisos.push({ tipo: "fluxo_inativo", texto: `Conta de fluxo ${chaveConta(e.fluxo)} inativa: o Consistem recusa alterar o título (troque a conta)` });
  }
  if (t.complemento.length > MAX_COMPLEMENTO) {
    avisos.push({ tipo: "complemento_longo", texto: `Complemento com ${t.complemento.length} caracteres: corrija no Consistem (máx. ${MAX_COMPLEMENTO}), senão a troca do banco não altera o título` });
  }
  return avisos;
}

/** Títulos dos conciliados (o principal e os demais dos casamentos à mão), sem repetir. */
export function titulosConciliados(r: Pick<ResultadoConciliacao, "conciliados">): TituloPagar[] {
  const vistos = new Map<string, TituloPagar>();
  for (const c of r.conciliados) for (const t of [c.titulo, ...(c.titulosExtras ?? [])]) vistos.set(chaveTitulo(t), t);
  return [...vistos.values()];
}

/** Avisos por título conciliado (chave do título → avisos); só os que têm aviso. */
export function avisosDosConciliados(r: Pick<ResultadoConciliacao, "conciliados">, e: {
  cartao: CartaoInfo; cartoes: readonly CartaoInfo[]; vencimentoFatura: string; fluxoPorTitulo: ReadonlyMap<string, ContaFluxo>; contasInativas: ReadonlySet<string>;
}): Record<string, Aviso[]> {
  const saida: Record<string, Aviso[]> = {};
  for (const t of titulosConciliados(r)) {
    const avisos = avisosDoTitulo(t, { ...e, fluxo: e.fluxoPorTitulo.get(chaveTitulo(t)) ?? null });
    if (avisos.length) saida[chaveTitulo(t)] = avisos;
  }
  return saida;
}

// ---------------------------------------------------------------- trocar o cartão no complemento

/**
 * Troca no complemento o trecho "CARTÃO <banco> [PF|PJ]" (com as mesmas tolerâncias da leitura: "CRATAO", "SICRED", "PIC PAY")
 * por "CARTÃO <NOME DO CARTÃO CERTO>", mantendo o resto do texto; corta em 60 caracteres.
 */
export function trocarCartaoNoComplemento(complemento: string, cartoes: readonly CartaoInfo[], nomeCerto: string): { ok: true; complemento: string } | { ok: false; erro: string } {
  const bancos = [...new Set(cartoes.map((c) => normalizarTexto(c.banco)))];
  const ehBanco = (w: string) => bancos.some((b) => mesmoBanco(w, b));
  const tokens = [...complemento.matchAll(/\S+/g)].map((m) => ({ texto: m[0], ini: m.index!, fim: m.index! + m[0].length, norm: normalizarTexto(m[0]) }));
  const i = tokens.findIndex((t) => t.norm.split(" ").some((w) => w && ehMarcaCartao(w)));
  if (i < 0) return { ok: false, erro: "O complemento não tem a palavra CARTÃO: corrija à mão no Consistem." };
  let fim = i;
  let achouBanco = false;
  for (let j = i + 1; j < tokens.length; j++) {
    const w = tokens[j].norm;
    const juntoComProximo = j + 1 < tokens.length ? w + tokens[j + 1].norm : "";
    if (w && ehBanco(w)) { achouBanco = true; fim = j; continue; }
    if (juntoComProximo && bancos.includes(juntoComProximo)) { achouBanco = true; fim = j + 1; j++; continue; }
    if (achouBanco && (w === "PF" || w === "PJ")) { fim = j; continue; }
    break;
  }
  if (!achouBanco) return { ok: false, erro: "Não achei o nome do cartão logo depois da palavra CARTÃO: corrija à mão no Consistem." };
  const ultimo = tokens[fim].texto;
  const sobra = ultimo.slice(ultimo.search(/[^A-Za-zÀ-ÿ0-9]*$/));   // pontuação colada no fim ("PJ," / "NUBANK-")
  const novo = `${complemento.slice(0, tokens[i].ini)}CARTÃO ${nomeCerto.toUpperCase()}${sobra}${complemento.slice(tokens[fim].fim)}`.replace(/\s+/g, " ").trim();
  return { ok: true, complemento: novo.length <= MAX_COMPLEMENTO ? novo : novo.slice(0, MAX_COMPLEMENTO).trimEnd() };
}

export type Alteracao = Record<string, string | number>;

/** "Trocar cartão": complemento com o cartão certo, vencimento da fatura e, se o cartão tiver, o banco e o histórico da fatura. */
export function alteracaoTrocarCartao(t: Pick<TituloPagar, "complemento">, e: {
  cartoes: readonly CartaoInfo[]; nomeCartao: string; vencimentoFatura: string; portadorFatura?: number | null; historicoFatura?: number | null;
}): { ok: true; alteracao: Alteracao } | { ok: false; erro: string } {
  const c = trocarCartaoNoComplemento(t.complemento, e.cartoes, e.nomeCartao);
  if (!c.ok) return c;
  return {
    ok: true,
    alteracao: {
      complementoHistorico: c.complemento, dataVencimento: e.vencimentoFatura,
      ...(e.portadorFatura ? { codPortador: e.portadorFatura } : {}), ...(e.historicoFatura ? { codHistorico: e.historicoFatura } : {}),
    },
  };
}

export const alteracaoVencimento = (vencimentoFatura: string): Alteracao => ({ dataVencimento: vencimentoFatura });
export const alteracaoContaFluxo = (c: ContaFluxo): Alteracao => ({ grupoContaFluxoCaixa: c.grupo, contaFluxoCaixa: c.conta });
