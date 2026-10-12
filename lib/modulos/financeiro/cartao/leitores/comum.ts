// Peças compartilhadas pelos leitores: agrupar itens em linhas, reconhecer valores, parcelas e datas, descartar o que não é despesa.
import { normalizar, paraCentavos, paraIso } from "../texto";
import type { ItemTexto, LinhaLida, PaginaTexto } from "./tipos";

export type LinhaDeItens = { y: number; itens: ItemTexto[] };

/** Agrupa itens de uma página em linhas visuais (mesmo `y` ± tolerância), cada uma ordenada da esquerda para a direita. */
export function agruparEmLinhas(itens: readonly ItemTexto[], tolerancia = 2.5): LinhaDeItens[] {
  const ordenados = [...itens].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: LinhaDeItens[] = [];
  for (const item of ordenados) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima.y - item.y) <= tolerancia) ultima.itens.push(item);
    else linhas.push({ y: item.y, itens: [item] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}

/** Itens de uma página a até `raio` pontos (vertical) de `y`. */
export function itensPerto(pagina: PaginaTexto, y: number, raio: number): ItemTexto[] {
  return pagina.itens.filter((i) => Math.abs(i.y - y) <= raio).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** "R$ 1.234,56", "-R$ 50,00", "R$ -50,00", "1.234,56", "-8.890,72". */
export const VALOR_REAIS = /^[-−]?\s?(R\$)?\s?[-−]?\d{1,3}(\.\d{3})*,\d{2}$/;
export const ehValorReais = (texto: string) => VALOR_REAIS.test(texto.trim());

/** "01/03", "07/12", "PARC04/05" → { num, total }. */
export function parcelaDe(texto: string | null | undefined): { num: number; total: number } | null {
  if (!texto) return null;
  const m = /(?:^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/.exec(texto);
  if (!m) return null;
  const num = Number(m[1]), total = Number(m[2]);
  if (num < 1 || total < 1 || num > total || total > 48) return null;
  return { num, total };
}

export const MESES: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Data de compra sem ano ("27/set", "20/10") → ISO. O ano é o do vencimento; se a data ficaria DEPOIS do vencimento, é do ano
 * anterior (parcela de compra antiga: "30/out" numa fatura de agosto).
 */
export function dataComAno(dia: number, mes: number, vencimento: string): string | null {
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  let ano = Number(vencimento.slice(0, 4));
  let iso = `${ano}-${pad(mes)}-${pad(dia)}`;
  if (iso > vencimento) { ano -= 1; iso = `${ano}-${pad(mes)}-${pad(dia)}`; }
  return iso;
}

/** "27/set 21:02" | "27/set" | "20/10" | "20/10/2026" | "2026-10-20" → ISO (com o ano inferido quando falta). */
export function dataDeTexto(texto: string, vencimento: string): string | null {
  const t = texto.trim();
  const iso = paraIso(t.slice(0, 10));
  if (iso) return iso;
  let m = /^(\d{1,2})\/([a-z]{3})\b/i.exec(t);
  if (m) {
    const mes = MESES[m[2].toLowerCase()];
    return mes ? dataComAno(Number(m[1]), mes, vencimento) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})(?!\d|\/)/.exec(t);
  if (m) return dataComAno(Number(m[1]), Number(m[2]), vencimento);
  return null;
}

/** Linhas da fatura que NÃO são despesa do ciclo (lista da skill + "Pagamento NNN" do Sicredi). Devolve o motivo ou null. */
const IGNORAR = [
  "PAGAMENTO EM", "PAGAMENTO RECEBIDO", "PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO", "PGTO FATURA", "PAGAMENTOS E FINANCIAMENTOS",
  "SALDO RESTANTE", "SALDO ANTERIOR", "FATURA ANTERIOR", "TOTAL DA FATURA", "LIMITE DISPONIVEL", "TOTAL DE COMPRAS", "SALDO EM ABERTO",
  "PGTO PIX", "PAGAMENTO PIX",
];
export function motivoDescarte(descricao: string): string | null {
  const d = normalizar(descricao);
  if (!d) return "Linha sem descrição";
  if (IGNORAR.some((t) => d.includes(t))) return "Pagamento, saldo ou total: não é despesa do ciclo";
  if (/^PAGAMENTO\s+\d+$/.test(d)) return "Pagamento da fatura anterior";
  return null;
}

/**
 * Texto com espaçamento de letras ("R O D R I G O", "1 2 / m a r", "9 . 8 7 8 , 2 3"): junta as letras. Só age quando a maioria dos
 * "tokens" tem um caractere; texto normal fica como está. Palavras do mesmo item perdem o espaço entre si (limitação do PDF).
 */
export function desespacar(texto: string): string {
  const t = texto.trim();
  const tokens = t.split(" ");
  if (tokens.length < 2) return t;
  const curtos = tokens.filter((x) => x.length <= 1).length;
  if (curtos < tokens.length * 0.6) return t;
  return t.replace(/ /g, "");
}

/** Mês abreviado em português ("abr", "ago", "AGO") → 1..12. */
export const mesAbreviado = (texto: string) => MESES[texto.toLowerCase().slice(0, 3)] ?? null;

/** Monta a linha normalizada a partir das partes lidas. */
export function montarLinha(p: {
  pagina: number; data: string | null; descricao: string; valorTexto: string; parcela?: { num: number; total: number } | null; textoOrigem?: string;
}): LinhaLida | null {
  const valorCentavos = paraCentavos(p.valorTexto);
  if (valorCentavos === null) return null;
  const descricao = p.descricao.replace(/\s+/g, " ").trim();
  const motivo = motivoDescarte(descricao);
  return {
    ordem: 0, pagina: p.pagina, dataCompra: p.data, descricao, valorCentavos,
    parcelaNum: p.parcela?.num ?? null, parcelaTotal: p.parcela?.total ?? null,
    descartada: motivo !== null, motivoDescarte: motivo,
    textoOrigem: p.textoOrigem ?? `${p.data ?? ""} ${descricao} ${p.valorTexto}`.trim(),
  };
}

/** Numera as linhas na ordem lida. */
export function numerar(linhas: LinhaLida[]): LinhaLida[] {
  return linhas.map((l, i) => ({ ...l, ordem: i + 1 }));
}

/** Soma das linhas não descartadas (o que deve bater com o total da fatura). */
export const somaLinhas = (linhas: readonly LinhaLida[]) => linhas.filter((l) => !l.descartada).reduce((s, l) => s + l.valorCentavos, 0);

/** Procura em todas as páginas um rótulo seguido (na mesma linha visual) de um item que satisfaça `aceita`. */
export function valorAoLadoDoRotulo(paginas: readonly PaginaTexto[], rotulo: RegExp, aceita: (texto: string) => boolean, raio = 3): string | null {
  for (const p of paginas) {
    for (const item of p.itens) {
      if (!rotulo.test(item.texto)) continue;
      const vizinhos = p.itens.filter((o) => o !== item && Math.abs(o.y - item.y) <= raio && o.x > item.x).sort((a, b) => a.x - b.x);
      // o próprio item pode trazer o valor no fim do texto
      const dentro = item.texto.replace(rotulo, "").trim();
      if (dentro && aceita(dentro)) return dentro;
      for (const v of vizinhos) if (aceita(v.texto.trim())) return v.texto.trim();
    }
  }
  return null;
}
