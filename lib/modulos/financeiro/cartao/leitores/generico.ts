// Leitor genérico (plano B para emissor ainda não calibrado e leitor dos CSV): cada linha visual que começa com uma data
// ("20/10", "20/10/2026", "2026-10-20") e termina com um valor em reais vira uma transação; o que fica entre os dois é a
// descrição. Linhas sem data ou sem valor são ignoradas. Confira sempre a integridade (soma das linhas = total informado).
import { ehValorReais, montarLinha, numerar, parcelaDe, agruparEmLinhas, dataDeTexto, valorAoLadoDoRotulo } from "./comum";
import { paraCentavos, paraIso } from "../texto";
import type { Leitor, LinhaLida } from "./tipos";

const DATA_NO_INICIO = /^(\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/[a-z]{3})\b/i;
/** Além do formato brasileiro, aceita "123.45" (CSV exportado em inglês, como o do Nubank). */
const ehValor = (t: string) => ehValorReais(t) || /^[-−]?\d+\.\d{2}$/.test(t.trim());

export const lerGenerico: Leitor = (paginas, contexto) => {
  const linhas: LinhaLida[] = [];
  for (const pagina of paginas) {
    for (const linha of agruparEmLinhas(pagina.itens)) {
      let textos = linha.itens.map((i) => i.texto.trim()).filter(Boolean);
      // Linha num item só ("20/10 FLEXFORM PARC 02/06 R$ 115,80"): separa a data no início e o valor no fim.
      if (textos.length === 1) {
        const m = /^(\S+)\s+(.*?)\s+([-−]?\s?(?:R\$\s?)?[-−]?\d[\d.]*,\d{2}|[-−]?\d+\.\d{2})$/.exec(textos[0]);
        if (!m) continue;
        textos = [m[1], ...m[2].split(/\s+/), m[3].replace(/\s+/g, " ")];
      }
      if (textos.length < 2) continue;
      const primeiro = textos[0];
      const m = DATA_NO_INICIO.exec(primeiro);
      if (!m) continue;
      const data = dataDeTexto(m[1], contexto.vencimento);
      if (!data) continue;
      // valor: último item que é valor em reais (aceita "R$ 1.234,56" e "-50,00")
      let idxValor = -1;
      for (let i = textos.length - 1; i >= 1; i--) if (ehValor(textos[i])) { idxValor = i; break; }
      if (idxValor < 0) continue;
      const restoDoPrimeiro = primeiro.slice(m[0].length).trim();
      const meio = [restoDoPrimeiro, ...textos.slice(1, idxValor)].filter(Boolean);
      // parcela: item "02/06" isolado ou "Parcela 3/8" dentro da descrição
      let parcela: { num: number; total: number } | null = null;
      const descricaoPartes: string[] = [];
      for (const t of meio) {
        if (/^\d{1,2}\/\d{1,2}$/.test(t) && parcelaDe(t)) { parcela = parcelaDe(t); continue; }
        descricaoPartes.push(t);
      }
      const descricao = descricaoPartes.join(" ");
      if (!parcela) {
        const p = /PARCELA\s*(\d{1,2})\s*\/\s*(\d{1,2})/i.exec(descricao);
        if (p) parcela = parcelaDe(`${p[1]}/${p[2]}`);
      }
      const l = montarLinha({ pagina: pagina.numero, data, descricao, valorTexto: textos[idxValor], parcela, textoOrigem: textos.join(" | ") });
      if (l) linhas.push(l);
    }
  }
  const totalTexto = valorAoLadoDoRotulo(paginas, /^Total (da|desta) fatura/i, ehValorReais);
  const vencTexto = valorAoLadoDoRotulo(paginas, /^Vencimento:?$/i, (t) => /^\d{2}\/\d{2}\/\d{4}/.test(t));
  return {
    leitor: "generico", linhas: numerar(linhas),
    avisos: linhas.length === 0 ? ["Nenhuma linha com data e valor foi reconhecida. Confira o arquivo ou escolha outro leitor no cadastro do cartão."] : [],
    totalImpressoCentavos: totalTexto ? paraCentavos(totalTexto) : null,
    vencimentoImpresso: vencTexto ? paraIso(vencTexto.slice(0, 10)) : null,
  };
};
