// Leitor da fatura Nubank (PDF sem senha; calibrado com a fatura PF de 10/2026).
// Páginas "TRANSAÇÕES": linha = data "20 SET" (x≈123, sem ano) · descrição (x≈185; compra com cartão vem com "•••• 4589" em
// x≈172 e a descrição em x≈214) com " - Parcela 5/8" no fim · valor "R$ 594,98" ou "−R$ 19,98" (sinal U+2212) à direita (x≥480).
// Compra internacional tem 1–2 linhas abaixo ("BRL 550.00 = USD 106.93", "Conversão: …") sem data nem valor: ficam de fora.
// "Rodrigo F Felicio R$ X" e "Pagamentos e Financiamentos -R$ X" são subtotais sem data. Fatura paga em atraso traz pares que se
// anulam e não são despesa do ciclo: "Saldo em atraso" × "Crédito de atraso" (o saldo anterior rolado) e "Juros de dívida
// encerrada" × "Encerramento de dívida" (a soma de multa + IOF + juros de atraso, que já vêm em linhas próprias).
// Total impresso: "Total a pagar" da página "RESUMO DA FATURA ATUAL" (a página 2 tem outro "Total a pagar", do parcelamento);
// vencimento: "Data de vencimento: 27 OUT 2026" (página 1) ou o cabeçalho "FATURA 27 OUT 2026".
import { normalizar, paraCentavos } from "../texto";
import { dataComAno, mesAbreviado, montarLinha, numerar, parcelaDe } from "./comum";
import type { Leitor, LinhaLida } from "./tipos";

const DATA = /^(\d{1,2}) ([A-Z]{3})$/i;
const VALOR = /^([-−]?)\s*R\$\s?([\d.]+,\d{2})$/;
const PARCELA = /\s*-\s*Parcela\s+(\d{1,2})\/(\d{1,2})\s*$/i;
const CARTAO_FINAL = /^•+\s*\d{4}$/;
const DATA_EXTENSO = /(\d{1,2}) ([A-Z]{3}) (\d{4})/i;
const RAIO_LINHA = 3;

/** Pares do atraso que se anulam: [positiva, negativa]. */
const PARES_ATRASO: [string, string][] = [["SALDO EM ATRASO", "CREDITO DE ATRASO"], ["JUROS DE DIVIDA ENCERRADA", "ENCERRAMENTO DE DIVIDA"]];

function descartarParesDoAtraso(linhas: LinhaLida[], avisos: string[]): LinhaLida[] {
  const saida = [...linhas];
  for (const [pos, neg] of PARES_ATRASO) {
    const positivas = saida.map((l, i) => ({ l, i })).filter(({ l }) => !l.descartada && normalizar(l.descricao) === pos);
    for (const { l, i } of positivas) {
      const j = saida.findIndex((n) => !n.descartada && normalizar(n.descricao) === neg && n.valorCentavos === -l.valorCentavos);
      if (j < 0) { avisos.push(`"${l.descricao}" sem a contrapartida "${neg}" de mesmo valor; conferir no PDF.`); continue; }
      const motivo = "Ajuste do atraso que se anula com a contrapartida: não é despesa do ciclo";
      saida[i] = { ...l, descartada: true, motivoDescarte: motivo };
      saida[j] = { ...saida[j], descartada: true, motivoDescarte: motivo };
    }
  }
  return saida;
}

export const lerNubank: Leitor = (paginas, contexto) => {
  let linhas: LinhaLida[] = [];
  const avisos: string[] = [];
  for (const pagina of paginas) {
    if (!pagina.itens.some((i) => /^TRANSA[CÇ][OÕ]ES$/i.test(i.texto.trim()))) continue;
    const ancoras = pagina.itens.filter((i) => DATA.test(i.texto.trim()) && i.x < 160).sort((a, b) => a.y - b.y);
    for (const ancora of ancoras) {
      const m = DATA.exec(ancora.texto.trim())!;
      const mes = mesAbreviado(m[2]);
      const data = mes ? dataComAno(Number(m[1]), mes, contexto.vencimento) : null;
      const perto = pagina.itens.filter((i) => i !== ancora && Math.abs(i.y - ancora.y) <= RAIO_LINHA).sort((a, b) => a.x - b.x);
      const valorItem = perto.filter((i) => VALOR.test(i.texto.trim())).pop();
      if (!valorItem) {
        avisos.push(`Página ${pagina.numero}: linha "${ancora.texto}" sem valor; conferir no PDF.`);
        continue;
      }
      let descricao = perto.filter((i) => i !== valorItem && i.x < valorItem.x && !CARTAO_FINAL.test(i.texto.trim())).map((i) => i.texto.trim()).join(" ");
      let parcela: { num: number; total: number } | null = null;
      const p = PARCELA.exec(descricao);
      if (p) { parcela = parcelaDe(`${p[1]}/${p[2]}`); descricao = descricao.replace(PARCELA, "").trim(); }
      const v = VALOR.exec(valorItem.texto.trim())!;
      const centavos = paraCentavos(v[2]);
      if (centavos === null) continue;
      const valor = v[1] ? -centavos : centavos;
      const linha = montarLinha({ pagina: pagina.numero, data, descricao, valorTexto: v[2], parcela, textoOrigem: `${ancora.texto} | ${descricao} | ${valorItem.texto}` });
      if (linha) linhas.push({ ...linha, valorCentavos: valor });
    }
  }
  if (linhas.length === 0) avisos.push('Nenhuma linha na seção "TRANSAÇÕES": o arquivo não parece uma fatura Nubank.');
  linhas = descartarParesDoAtraso(linhas, avisos);

  let total: number | null = null;
  let vencimento: string | null = null;
  for (const pagina of paginas) {
    if (total === null && pagina.itens.some((i) => /^RESUMO DA FATURA ATUAL$/i.test(i.texto.trim()))) {
      const rot = pagina.itens.find((i) => /^Total a pagar$/i.test(i.texto.trim()));
      const valor = rot && pagina.itens.filter((i) => Math.abs(i.y - rot.y) <= 3 && i.x > rot.x).map((i) => VALOR.exec(i.texto.trim())).find(Boolean);
      if (valor) total = paraCentavos(valor[2]);
    }
    if (!vencimento) {
      const item = pagina.itens.find((i) => /^Data de vencimento:/i.test(i.texto.trim())) ?? pagina.itens.find((i) => /^FATURA \d{1,2} [A-Z]{3} \d{4}$/i.test(i.texto.trim()));
      const m = item ? DATA_EXTENSO.exec(item.texto) : null;
      const mes = m ? mesAbreviado(m[2]) : null;
      if (m && mes) vencimento = `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return { leitor: "nubank", linhas: numerar(linhas), avisos, totalImpressoCentavos: total, vencimentoImpresso: vencimento };
};
