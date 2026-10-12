// Leitor da fatura PicPay (calibrado com a fatura de 08/2026).
// As páginas de lançamentos têm DUAS colunas independentes (esquerda x < metade da página, direita x ≥ metade), cada uma com
// blocos "Data · Estabelecimento · Valor (R$)". A transação é "dd/mm  DESCRIÇÃO  1.234,56"; a parcela vem colada ao nome
// ("MONZA TINTAS PARC07/08"); a descrição pode quebrar em linhas acima/abaixo. "PAGAMENTO DE FATURA" é pagamento (fora).
// "Subtotal dos lançamentos" e "Total geral dos lançamentos" não têm data e ficam de fora; o total geral é o total impresso.
import { paraCentavos, paraIso } from "../texto";
import { dataDeTexto, ehValorReais, montarLinha, numerar, parcelaDe, valorAoLadoDoRotulo } from "./comum";
import type { ItemTexto, Leitor, LinhaLida } from "./tipos";

const RAIO_LINHA = 7;
const DATA = /^\d{2}\/\d{2}$/;
const PARCELA_COLADA = /\s*PARC\s?(\d{1,2})\/(\d{1,2})\s*$/i;

export const lerPicpay: Leitor = (paginas, contexto) => {
  const linhas: LinhaLida[] = [];
  const avisos: string[] = [];

  for (const pagina of paginas) {
    const meio = pagina.largura / 2;
    for (const lado of ["esquerda", "direita"] as const) {
      const itens = pagina.itens.filter((i) => (lado === "esquerda" ? i.x < meio : i.x >= meio));
      if (itens.length === 0) continue;
      const x0 = Math.min(...itens.map((i) => i.x));
      const ancoras = itens.filter((i) => DATA.test(i.texto.trim()) && i.x <= x0 + 12).sort((a, b) => a.y - b.y);
      for (const ancora of ancoras) {
        const perto = itens.filter((i) => i !== ancora && Math.abs(i.y - ancora.y) <= RAIO_LINHA);
        const valores = perto.filter((i) => ehValorReais(i.texto) && i.x > ancora.x + 100).sort((a, b) => a.x - b.x);
        const valorItem: ItemTexto | undefined = valores[valores.length - 1];
        const fragmentos = perto.filter((i) => i !== valorItem && !DATA.test(i.texto.trim()) && i.x > ancora.x + 20 && (!valorItem || i.x < valorItem.x - 5))
          .sort((a, b) => a.y - b.y || a.x - b.x);
        let descricao = fragmentos.map((f) => f.texto.trim()).join(" ");
        if (!valorItem) {
          avisos.push(`Página ${pagina.numero}: linha "${ancora.texto} ${descricao}" sem valor; conferir no PDF.`);
          continue;
        }
        let parcela: { num: number; total: number } | null = null;
        const m = PARCELA_COLADA.exec(descricao);
        if (m) {
          parcela = parcelaDe(`${m[1]}/${m[2]}`);
          descricao = descricao.replace(PARCELA_COLADA, "").trim();
        }
        const linha = montarLinha({
          pagina: pagina.numero, data: dataDeTexto(ancora.texto, contexto.vencimento), descricao, valorTexto: valorItem.texto, parcela,
          textoOrigem: `${ancora.texto} | ${fragmentos.map((f) => f.texto.trim()).join(" ")} | ${valorItem.texto}`,
        });
        if (linha) linhas.push(linha);
      }
    }
  }
  if (linhas.length === 0) avisos.push("Nenhuma transação encontrada: o arquivo não parece uma fatura PicPay.");

  const totalTexto = valorAoLadoDoRotulo(paginas, /^Total geral dos lan[cç]amentos$/i, ehValorReais) ?? valorAoLadoDoRotulo(paginas, /^Total da fatura$/i, ehValorReais);
  const vencTexto = valorAoLadoDoRotulo(paginas, /^Vencimento:?$/i, (t) => /^\d{2}\/\d{2}\/\d{4}/.test(t));
  return {
    leitor: "picpay", linhas: numerar(linhas), avisos,
    totalImpressoCentavos: totalTexto ? paraCentavos(totalTexto) : null,
    vencimentoImpresso: vencTexto ? paraIso(vencTexto.slice(0, 10)) : null,
  };
};
