// Leitor da fatura do Banco Inter (PDF protegido por senha; calibrado com a fatura PF de 08/2026).
// Páginas "Despesas da fatura", um bloco por cartão ("CARTÃO 5126****1227"), cabeçalho "Data · Movimentação · Beneficiário · Valor".
// Linha: "09 de abr. 2026" (x≈24) · fragmentos da movimentação (x≈77; "(Parcela 05 de 10)" no fim) · beneficiário ("-") ·
// valor "R$ 80,59" ou "+ R$ 5.232,07" (o "+" é crédito/pagamento: "PGTO PIX" é o pagamento da fatura). "Total CARTÃO …" e a página
// "Próxima fatura" não têm data e ficam de fora. Total impresso: "Fatura atual R$ X"; vencimento: "Data de Vencimento" + data abaixo.
import { paraCentavos, paraIso } from "../texto";
import { mesAbreviado, montarLinha, numerar, parcelaDe } from "./comum";
import type { Leitor, LinhaLida } from "./tipos";

const DATA_EXTENSO = /^(\d{1,2}) de ([a-z]{3})\.? (\d{4})$/i;
const VALOR = /^([+\-−]?)\s*R\$\s?([\d.]+,\d{2})$/;
const PARCELA = /\(\s*Parcela\s+(\d{1,2})\s+de\s+(\d{1,2})\s*\)/i;
const RAIO_LINHA = 6;

export const lerInter: Leitor = (paginas) => {
  const linhas: LinhaLida[] = [];
  const avisos: string[] = [];
  for (const pagina of paginas) {
    const cabecalho = pagina.itens.find((i) => /^Movimenta[cç][aã]o$/i.test(i.texto));
    if (!cabecalho) continue;
    const xMov = cabecalho.x;
    const xBenef = pagina.itens.find((i) => /^Benefici[aá]rio$/i.test(i.texto))?.x ?? xMov + 205;
    const ancoras = pagina.itens.filter((i) => DATA_EXTENSO.test(i.texto.trim()) && i.x < xMov - 20).sort((a, b) => a.y - b.y);
    for (const ancora of ancoras) {
      const m = DATA_EXTENSO.exec(ancora.texto.trim())!;
      const mes = mesAbreviado(m[2]);
      const data = mes ? `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
      const perto = pagina.itens.filter((i) => i !== ancora && Math.abs(i.y - ancora.y) <= RAIO_LINHA).sort((a, b) => a.y - b.y || a.x - b.x);
      const valorItem = perto.filter((i) => VALOR.test(i.texto.trim())).sort((a, b) => a.x - b.x).pop();
      if (!valorItem) {
        avisos.push(`Página ${pagina.numero}: linha "${ancora.texto}" sem valor; conferir no PDF.`);
        continue;
      }
      const fragmentos = perto.filter((i) => i !== valorItem && i.x >= xMov - 5 && i.x < valorItem.x - 5 && !(i.x >= xBenef - 5 && i.texto.trim() === "-"));
      let descricao = fragmentos.map((f) => f.texto.trim()).join(" ");
      let parcela: { num: number; total: number } | null = null;
      const p = PARCELA.exec(descricao);
      if (p) { parcela = parcelaDe(`${p[1]}/${p[2]}`); descricao = descricao.replace(PARCELA, "").replace(/\s+/g, " ").trim(); }
      const v = VALOR.exec(valorItem.texto.trim())!;
      const centavos = paraCentavos(v[2]);
      if (centavos === null) continue;
      const valor = v[1] === "+" ? -centavos : v[1] ? -centavos : centavos;
      const linha = montarLinha({ pagina: pagina.numero, data, descricao, valorTexto: String(valor / 100).replace(".", ","), parcela, textoOrigem: `${ancora.texto} | ${descricao} | ${valorItem.texto}` });
      if (linha) linhas.push({ ...linha, valorCentavos: valor });
    }
  }
  if (linhas.length === 0) avisos.push('Nenhuma linha com "Data · Movimentação · Valor": o arquivo não parece uma fatura do Inter.');

  // Total: "Fatura atual" + "R$" + "4.731,40" na mesma linha (itens separados).
  let total: number | null = null;
  let vencimento: string | null = null;
  for (const pagina of paginas) {
    for (const rot of pagina.itens.filter((i) => /^Fatura atual$/.test(i.texto.trim()))) {
      if (total !== null) break;
      const direita = pagina.itens.filter((i) => Math.abs(i.y - rot.y) <= 3 && i.x > rot.x).sort((a, b) => a.x - b.x).map((i) => i.texto.trim()).join(" ");
      total = paraCentavos(direita.replace(/^R\$\s*/, ""));
    }
    const dv = pagina.itens.find((i) => /^Data de Vencimento$/i.test(i.texto.trim()));
    if (dv && !vencimento) {
      const abaixo = pagina.itens.filter((i) => i.y > dv.y && i.y - dv.y <= 20 && Math.abs(i.x - dv.x) <= 6 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.texto.trim()))[0];
      if (abaixo) vencimento = paraIso(abaixo.texto.trim());
    }
  }
  return { leitor: "inter", linhas: numerar(linhas), avisos, totalImpressoCentavos: total, vencimentoImpresso: vencimento };
};
