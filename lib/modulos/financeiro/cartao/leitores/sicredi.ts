// Leitor da fatura Sicredi (PF e PJ, mesmo layout; calibrado com faturas de 08 e 10/2026).
// Página de transações: cabeçalho "Data e hora · Cidade · Compra · Descrição · Parcela · Valor em Dolar · Cotação · Valor em
// reais"; cada transação tem a data "27/set 21:02" na primeira coluna e o valor "R$ 1.234,56" na última. A descrição pode
// quebrar em 2 ou 3 linhas visuais (acima e abaixo da linha da data). "Pagamento NNN" é o pagamento da fatura anterior.
// Totais ("Total cartão (final …)") não têm data e ficam de fora. "Total fatura de <mês> R$ X" é o total impresso.
import { paraCentavos, paraIso } from "../texto";
import { dataDeTexto, ehValorReais, montarLinha, numerar, parcelaDe, valorAoLadoDoRotulo } from "./comum";
import type { ItemTexto, Leitor, LinhaLida, PaginaTexto } from "./tipos";

const RAIO_LINHA = 9;          // fragmentos da descrição ficam ~4 pt acima/abaixo da data; a transação seguinte fica a ~21 pt
const DATA_HORA = /^(\d{1,2})\/([a-z]{3})\s+\d{2}:\d{2}$/i;

type Colunas = { descricao: number; parcela: number; dolar: number; valor: number };

function colunasDaPagina(pagina: PaginaTexto): Colunas | null {
  const cab = pagina.itens.filter((i) => /^Data e hora$/i.test(i.texto));
  if (cab.length === 0) return null;
  const y = cab[0].y;
  const na = (re: RegExp) => pagina.itens.find((i) => Math.abs(i.y - y) <= 3 && re.test(i.texto));
  const descricao = na(/^Descri[cç][aã]o$/i), parcela = na(/^Parcela$/i), dolar = na(/^Valor em Dolar/i), valor = na(/^Valor em reais/i);
  if (!descricao || !parcela || !valor) return null;
  return { descricao: descricao.x, parcela: parcela.x, dolar: dolar?.x ?? valor.x - 110, valor: valor.x };
}

export const lerSicredi: Leitor = (paginas, contexto) => {
  const linhas: LinhaLida[] = [];
  const avisos: string[] = [];
  let paginasComTransacoes = 0;

  for (const pagina of paginas) {
    const col = colunasDaPagina(pagina);
    if (!col) continue;
    paginasComTransacoes++;
    const ancoras = pagina.itens.filter((i) => DATA_HORA.test(i.texto.trim()) && i.x < col.descricao - 60).sort((a, b) => a.y - b.y);
    for (const ancora of ancoras) {
      const perto = pagina.itens.filter((i) => i !== ancora && Math.abs(i.y - ancora.y) <= RAIO_LINHA);
      const fragmentos = perto.filter((i) => i.x >= col.descricao - 6 && i.x < col.parcela - 8).sort((a, b) => a.y - b.y || a.x - b.x);
      const parcelaItem = perto.find((i) => i.x >= col.parcela - 8 && i.x < col.dolar - 10 && parcelaDe(i.texto));
      const valores = perto.filter((i) => i.x >= col.valor - 20 && ehValorReais(i.texto)).sort((a, b) => a.x - b.x);
      const valorItem: ItemTexto | undefined = valores[valores.length - 1];
      const descricao = fragmentos.map((f) => f.texto.trim()).join(" ");
      if (!valorItem) {
        avisos.push(`Página ${pagina.numero}: linha "${ancora.texto} ${descricao}" sem valor em reais; conferir no PDF.`);
        continue;
      }
      const linha = montarLinha({
        pagina: pagina.numero, data: dataDeTexto(ancora.texto, contexto.vencimento), descricao, valorTexto: valorItem.texto,
        parcela: parcelaItem ? parcelaDe(parcelaItem.texto) : null, textoOrigem: `${ancora.texto} | ${descricao} | ${parcelaItem?.texto ?? ""} | ${valorItem.texto}`,
      });
      if (linha) linhas.push(linha);
    }
  }
  if (paginasComTransacoes === 0) avisos.push('Nenhuma página com o cabeçalho "Data e hora · Descrição · Valor em reais": o arquivo não parece uma fatura Sicredi.');

  const totalTexto = valorAoLadoDoRotulo(paginas, /^Total fatura de \w+/i, ehValorReais) ?? valorAoLadoDoRotulo(paginas, /^Total desta Fatura$/i, ehValorReais);
  const vencTexto = valorAoLadoDoRotulo(paginas, /^Vencimento$/i, (t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
  return {
    leitor: "sicredi", linhas: numerar(linhas), avisos,
    totalImpressoCentavos: totalTexto ? paraCentavos(totalTexto) : null,
    vencimentoImpresso: vencTexto ? paraIso(vencTexto) : null,
  };
};
