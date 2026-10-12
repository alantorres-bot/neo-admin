// Leitor da fatura Unicred Visa (PDF protegido por senha; calibrado com a fatura de 08/2026).
// O PDF vem com as letras espaçadas ("1 2 / m a r", "R $", "1 9 0 , 0 0"): cada item é "desespaçado" antes de ler. Página de
// lançamentos: cabeçalho "DATA · DESCRIÇÃO · VALOR"; linha = data "12/mar" (x≈82) · fragmentos da descrição (x≈126…) com
// "Parc.5/5" colado · "R$" + valor à direita (x≥460), "-R$" no pagamento recebido. "TOTAL DE <nome>" não tem data e fica de fora.
// Total impresso: "TOTAL: R$ X" (página 2); vencimento: "VENCIMENTO: 19 AGO 2026".
import { paraCentavos } from "../texto";
import { dataComAno, desespacar, mesAbreviado, montarLinha, numerar, parcelaDe } from "./comum";
import type { ItemTexto, Leitor, LinhaLida, PaginaTexto } from "./tipos";

const DATA = /^(\d{1,2})\/([a-z]{3})$/i;
const PARCELA = /PARC\.?\s*(\d{1,2})\/(\d{1,2})/i;
const RAIO_LINHA = 4;

const normalizarPagina = (p: PaginaTexto): PaginaTexto => ({ ...p, itens: p.itens.map((i) => ({ ...i, texto: desespacar(i.texto) })) });

function valorAposRotulo(pagina: PaginaTexto, rotulo: RegExp): string | null {
  const rot = pagina.itens.find((i) => rotulo.test(i.texto));
  if (!rot) return null;
  return pagina.itens.filter((i) => Math.abs(i.y - rot.y) <= 3 && i.x > rot.x).sort((a, b) => a.x - b.x).map((i) => i.texto).join(" ");
}

export const lerUnicred: Leitor = (paginasBrutas, contexto) => {
  const paginas = paginasBrutas.map(normalizarPagina);
  const linhas: LinhaLida[] = [];
  const avisos: string[] = [];
  for (const pagina of paginas) {
    const cab = pagina.itens.find((i) => /^DESCRI[CÇ][AÃ]O$/i.test(i.texto));
    const cabValor = pagina.itens.find((i) => /^VALOR$/i.test(i.texto));
    if (!cab || !cabValor) continue;
    const xValor = cabValor.x - 30;
    const ancoras = pagina.itens.filter((i) => DATA.test(i.texto) && i.x < cab.x - 10).sort((a, b) => a.y - b.y);
    for (const ancora of ancoras) {
      const m = DATA.exec(ancora.texto)!;
      const mes = mesAbreviado(m[2]);
      const data = mes ? dataComAno(Number(m[1]), mes, contexto.vencimento) : null;
      const perto = pagina.itens.filter((i) => i !== ancora && Math.abs(i.y - ancora.y) <= RAIO_LINHA).sort((a, b) => a.x - b.x);
      const direita: ItemTexto[] = perto.filter((i) => i.x >= xValor);
      const valorTexto = direita.map((i) => i.texto).join(" ").replace(/\s+/g, "");
      const centavos = paraCentavos(valorTexto);
      if (centavos === null) {
        avisos.push(`Página ${pagina.numero}: linha "${ancora.texto}" sem valor; conferir no PDF.`);
        continue;
      }
      let descricao = perto.filter((i) => i.x < xValor).map((i) => i.texto).join(" ");
      let parcela: { num: number; total: number } | null = null;
      const p = PARCELA.exec(descricao);
      if (p) { parcela = parcelaDe(`${p[1]}/${p[2]}`); descricao = descricao.replace(PARCELA, "").replace(/\s+/g, " ").trim(); }
      const linha = montarLinha({ pagina: pagina.numero, data, descricao, valorTexto, parcela, textoOrigem: `${ancora.texto} | ${descricao} | ${valorTexto}` });
      if (linha) linhas.push(linha);
    }
  }
  if (linhas.length === 0) avisos.push('Nenhuma linha com "DATA · DESCRIÇÃO · VALOR": o arquivo não parece uma fatura Unicred.');

  let total: number | null = null;
  let vencimento: string | null = null;
  for (const pagina of paginas) {
    if (total === null) {
      const t = valorAposRotulo(pagina, /^TOTAL:$/i);
      if (t) total = paraCentavos(t.split("VENCIMENTO")[0].replace(/\s+/g, ""));
    }
    if (!vencimento) {
      const v = valorAposRotulo(pagina, /^VENCIMENTO:$/i);
      const m = v ? /^(\d{1,2})([A-Za-z]{3})(\d{4})/.exec(v.replace(/\s+/g, "")) : null;
      const mes = m ? mesAbreviado(m[2]) : null;
      if (m && mes) vencimento = `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return { leitor: "unicred", linhas: numerar(linhas), avisos, totalImpressoCentavos: total, vencimentoImpresso: vencimento };
};
