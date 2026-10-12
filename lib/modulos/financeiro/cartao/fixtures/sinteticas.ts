// Faturas SINTÉTICAS para os testes dos leitores: reproduzem as posições (x, y) dos layouts reais do Sicredi e do PicPay
// (medidas nas faturas de 08 e 10/2026), com estabelecimentos e valores inventados. As faturas reais ficam no Drive e não
// entram no repositório; o teste de calibração com elas é opcional (variável NEO_AMOSTRAS_CARTAO).
import type { ItemTexto, PaginaTexto } from "../leitores/tipos";

const it = (x: number, y: number, texto: string, w = 40): ItemTexto => ({ x, y, w, texto });

// ---------------------------------------------------------------- Sicredi
export type TransacaoSicredi = {
  dataHora: string; cidade?: string; compra?: "Online" | "Presencial"; descricao: string[]; parcela?: string; valor: string; dolar?: string; cotacao?: string;
};

/** Página de transações do Sicredi: cabeçalho e uma transação a cada 23 pt; descrição com até 3 fragmentos (acima, na linha, abaixo). */
export function paginaSicredi(numero: number, transacoes: TransacaoSicredi[], opcoes: { totalCartao?: string; vencimento?: string; totalFatura?: string } = {}): PaginaTexto {
  const itens: ItemTexto[] = [
    it(190.3, 27, "Titular Mascarado"), it(475.6, 27, "Vencimento"), it(519.9, 27, opcoes.vencimento ?? "10/10/2026"),
    it(190.3, 41.4, "Mastercard Black"), it(432.6, 41.4, "Total fatura de outubro"), it(516.9, 41.4, opcoes.totalFatura ?? "R$ 0,00"),
    it(42, 81, "Transações"), it(32, 115, "Cartão Titular Mascarado (final 0000)"),
    it(46.6, 142.6, "Data e hora"), it(112.8, 142.6, "Cidade"), it(170.7, 142.6, "Compra"), it(237.8, 142.6, "Descrição"), it(348.4, 142.6, "Parcela"),
    it(392.5, 142.6, "Valor em Dolar"), it(462.3, 142.6, "Cotação"), it(503.1, 142.6, "Valor em reais"),
    it(390.9, 151.2, "(Transações no exterior¹)"), it(461.9, 151.2, "do dólar"),
  ];
  let y = 178;
  for (const t of transacoes) {
    itens.push(it(44.4, y, t.dataHora));
    if (t.cidade) itens.push(it(110.6, y, t.cidade));
    if (t.compra) itens.push(it(t.compra === "Online" ? 173.3 : 166.9, y, t.compra));
    const ys = t.descricao.length === 1 ? [y] : t.descricao.length === 2 ? [y - 4.2, y + 4.2] : [y - 4.2, y, y + 4.2];
    t.descricao.forEach((d, i) => itens.push(it(237.1, ys[i], d)));
    if (t.parcela) itens.push(it(353.3, y, t.parcela));
    if (t.dolar) itens.push(it(403.7, y, t.dolar));
    if (t.cotacao) itens.push(it(468.1, y, t.cotacao));
    itens.push(it(516.3 - t.valor.length * 0.5, y, t.valor));
    y += 23;
  }
  if (opcoes.totalCartao) itens.push(it(404.4, y + 2, "Total cartão (final 0000)"), it(502.4, y + 2, opcoes.totalCartao));
  itens.push(it(32, 766, "Legenda:"), it(541.8, 835.3, `${numero} de 3`));
  return { numero, largura: 595, altura: 842, itens };
}

/** Página 1 do Sicredi (resumo): traz "Total fatura de <mês> R$ X" e "Vencimento 10/out" num item só. */
export function paginaResumoSicredi(totalFatura: string, mes = "outubro"): PaginaTexto {
  return {
    numero: 1, largura: 595, altura: 842,
    itens: [
      it(170.3, 27, "Titular Mascarado"), it(412.6, 27, "Limite total de crédito"), it(495.7, 27, "R$ 200.000,00"),
      it(170.3, 70.8, `Total fatura de ${mes}`), it(257.8, 70.8, totalFatura), it(373.9, 70.8, "Total de parcelas em próximas faturas R$ 111.141,68"),
      it(87.7, 166.7, "Vencimento 10/out"), it(37, 424.8, "Total da fatura anterior"), it(229.1, 424.8, "91.374,55"),
      it(37, 438.4, "Pagamentos | Créditos"), it(224.7, 438.4, "-91.424,55"), it(37, 601.6, "Total desta Fatura"), it(227.5, 601.6, totalFatura.replace("R$ ", "")),
      it(540.7, 834.1, "1 de 3"),
    ],
  };
}

// ---------------------------------------------------------------- PicPay
export type TransacaoPicpay = { data: string; descricao: string[]; valor: string };
export type ColunaPicpay = { titulo?: string; transacoes: TransacaoPicpay[]; subtotal?: string };

/** Página de lançamentos do PicPay: duas colunas independentes (esquerda x≈23, direita x≈301), 20 pt por transação. */
export function paginaPicpay(numero: number, esquerda: ColunaPicpay[], direita: ColunaPicpay[], opcoes: { totalGeral?: string } = {}): PaginaTexto {
  const itens: ItemTexto[] = [
    it(497.3, 25.7, "Titular,"), it(326.1, 36.2, "ENDERECO MASCARADO"),
    it(377.1, 46.8, "Vencimento:"), it(429.2, 46.8, "25/08/2026 |"), it(476.7, 46.8, "Fechamento:"), it(530.4, 46.8, "19/08/2026"),
    it(464, 57.4, "PicPay Mastercard® BLACK"),
  ];
  const coluna = (blocos: ColunaPicpay[], x0: number, xDesc: number, xValor: number, yInicial: number) => {
    let y = yInicial;
    for (const b of blocos) {
      itens.push(it(x0, y, b.titulo ?? "Transações Nacionais")); y += 25;
      itens.push(it(x0, y, "Data"), it(xDesc, y, "Estabelecimento"), it(xValor - 60, y, "Valor (R$)")); y += 20;
      for (const t of b.transacoes) {
        itens.push(it(x0, y, t.data));
        const ys = t.descricao.length === 1 ? [y] : t.descricao.length === 2 ? [y - 5, y + 5] : [y - 5, y, y + 5];
        t.descricao.forEach((d, i) => itens.push(it(xDesc, ys[i], d)));
        itens.push(it(xValor - t.valor.length * 4.5, y, t.valor));
        y += 20;
      }
      if (b.subtotal) { itens.push(it(x0 + 6.8, y + 10, "Subtotal dos lançamentos"), it(xValor - b.subtotal.length * 4.5, y + 10, b.subtotal)); y += 35; }
    }
    return y;
  };
  const fim = coluna(esquerda, 23.5, 63.5, 285, 111);
  coluna(direita, 301.4, 341.4, 560, 126);
  if (opcoes.totalGeral) itens.push(it(23.5, fim + 40, "Total geral dos lançamentos"), it(248.5, fim + 40, opcoes.totalGeral));
  itens.push(it(530.9, 816, `Página ${numero}/6`));
  return { numero, largura: 595, altura: 842, itens };
}

/** Página 1 do PicPay (resumo): "Total da fatura R$ X". */
export function paginaResumoPicpay(total: string): PaginaTexto {
  return {
    numero: 1, largura: 595, altura: 842,
    itens: [
      it(377.1, 52.8, "Vencimento:"), it(429.2, 52.8, "25/08/2026 |"), it(476.7, 52.8, "Fechamento:"), it(530.4, 52.8, "19/08/2026"),
      it(81.5, 156.2, "Total da sua fatura"), it(68.1, 175.5, total), it(25, 234.6, "Fatura anterior"), it(247.7, 234.6, "8.890,72"),
      it(25, 248.5, "Pagamento recebido"), it(244.3, 248.5, "-8.890,72"), it(25, 290.6, "Total da fatura"), it(229.2, 290.6, total),
      it(532.5, 822, "Página 1/6"),
    ],
  };
}
