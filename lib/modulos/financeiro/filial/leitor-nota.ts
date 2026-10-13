// Leitor da nota fatura do Syslock (Filial Contagem). O PDF vira itens de texto POSICIONADOS (extrairPaginasDoPdf, o mesmo
// do cartão) e este leitor sabe onde ficam as coisas no layout do Syslock (calibrado com as notas 002317–002354):
//  - Quadro FATURA/DUPLICATAS (rodapé): uma linha por parcela com [número] [valor] [vencimento] — ex.: "002351 26.501,00 13/11/2026".
//    É a fonte do vencimento e do valor. Mais de uma parcela = mais de um trio (na mesma linha ou em linhas seguintes).
//  - Nº da nota: 6 dígitos no canto superior direito.
//  - Cliente: razão social no quadro do destinatário (abaixo do cabeçalho, à esquerda).
//  - Descrição: "OBRA: …", "VENCIMENTO: dd/mm/aaaa" e "NO PERÍODO DE dd/mm A dd/mm/aaaa" (às vezes "NOS PERÍODOS DE:" com
//    várias linhas "- dd/mm A dd/mm/aaaa").
// Se o quadro de duplicatas não aparecer, usa "VENCIMENTO:" da descrição + o maior valor da nota (o total), com aviso.
// Regra pura: não abre arquivo nem acessa banco.
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { documentoFormatado } from "@/supabase/functions/_shared/consistem-receber";

export type NotaLida = {
  nota: string | null;
  /** Data de emissão ('AAAA-MM-DD'): a data no topo, à direita (a mesma que vai na CCFT040). */
  emissao: string | null;
  cliente: string | null;
  /** CNPJ/CPF do destinatário, formatado e válido (o da própria Neo fica de fora). */
  clienteDocumento: string | null;
  obra: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  parcelas: { vencimento: string; valorCentavos: number }[];
  totalCentavos: number | null;
  avisos: string[];
};

const DINHEIRO = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const centavos = (t: string) => Math.round(Number(t.replace(/\./g, "").replace(",", ".")) * 100);
const iso = (t: string) => {
  const m = DATA.exec(t.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Agrupa os itens em linhas (mesmo y, com tolerância), da esquerda para a direita. */
function linhas(itens: readonly ItemTexto[]): ItemTexto[][] {
  const ordenados = [...itens].sort((a, b) => a.y - b.y || a.x - b.x);
  const saida: ItemTexto[][] = [];
  for (const i of ordenados) {
    const ultima = saida[saida.length - 1];
    if (ultima && Math.abs(ultima[0].y - i.y) <= 2.5) ultima.push(i);
    else saida.push([i]);
  }
  return saida.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Quadro de duplicatas: em cada linha, a sequência [número] [valor] [data] (pode repetir na mesma linha). */
function duplicatas(ls: ItemTexto[][]): { numero: string; vencimento: string; valorCentavos: number }[] {
  const saida: { numero: string; vencimento: string; valorCentavos: number }[] = [];
  for (const l of ls) {
    const t = l.map((i) => i.texto.trim());
    for (let k = 0; k + 2 < t.length; k++) {
      if (/^\d{3,9}(?:[/-]?[A-Z0-9]{1,3})?$/.test(t[k]) && DINHEIRO.test(t[k + 1]) && DATA.test(t[k + 2])) {
        saida.push({ numero: t[k], valorCentavos: centavos(t[k + 1]), vencimento: iso(t[k + 2])! });
        k += 2;
      }
    }
  }
  return saida;
}

/** "NO PERÍODO DE 12/09 A 11/10/2026", "NO PERÍODO FINAL DE 01 A 30/09/2026" e "- 13/08 A 11/09/2026" (vários): menor início e maior fim. */
export function lerPeriodo(texto: string): { inicio: string | null; fim: string | null } {
  const re = /(\d{2})(?:\/(\d{2}))?(?:\/(\d{4}))?\s+A\s+(\d{2})\/(\d{2})\/(\d{4})/g;
  const pares: { inicio: string; fim: string }[] = [];
  for (const m of texto.matchAll(re)) {
    const [, d1, m1, a1, d2, m2, a2] = m;
    const mesIni = m1 ?? m2;
    // início sem ano: mesmo ano do fim, ou o anterior se o mês do início vier depois do mês do fim (dez → jan)
    const anoIni = a1 ?? (Number(mesIni) > Number(m2) ? String(Number(a2) - 1) : a2);
    pares.push({ inicio: `${anoIni}-${mesIni}-${d1}`, fim: `${a2}-${m2}-${d2}` });
  }
  if (pares.length === 0) return { inicio: null, fim: null };
  return {
    inicio: pares.map((p) => p.inicio).sort()[0],
    fim: pares.map((p) => p.fim).sort().at(-1)!,
  };
}

export function lerNotaSyslock(paginas: readonly PaginaTexto[]): NotaLida {
  const avisos: string[] = [];
  const p1 = paginas[0];
  if (!p1) return { nota: null, emissao: null, cliente: null, clienteDocumento: null, obra: null, periodoInicio: null, periodoFim: null, parcelas: [], totalCentavos: null, avisos: ["O PDF não tem páginas."] };
  const todas = paginas.flatMap((p) => p.itens);
  const ls = linhas(todas);
  const textoLinha = (l: ItemTexto[]) => l.map((i) => i.texto).join(" ").replace(/\s+/g, " ").trim();

  // Nº da nota: 6 dígitos sozinhos no topo, à direita.
  const topo = p1.itens.filter((i) => i.y < p1.altura * 0.12 && i.x > p1.largura * 0.6 && /^\d{6}$/.test(i.texto.trim()));
  const nota = topo[0]?.texto.trim() ?? null;

  // Emissão: a primeira data no alto da página, à direita (abaixo do nº da nota).
  const datasTopo = p1.itens
    .filter((i) => i.y < p1.altura * 0.16 && i.x > p1.largura * 0.75 && DATA.test(i.texto.trim()))
    .sort((a, b) => a.y - b.y);
  const emissao = datasTopo[0] ? iso(datasTopo[0].texto) : null;

  // CNPJ/CPF do destinatário: no quadro do cliente (faixa logo abaixo do cabeçalho), à direita da razão social.
  const NEO = "17.209.767";
  const documentos = p1.itens
    .filter((i) => i.y > p1.altura * 0.15 && i.y < p1.altura * 0.26 && /^[\d./-]{14,18}$/.test(i.texto.trim()) && !i.texto.trim().startsWith(NEO))
    .map((i) => documentoFormatado(i.texto.trim()))
    .filter((d): d is string => !!d);
  const clienteDocumento = documentos[0] ?? null;

  // Descrição: as linhas de texto à esquerda entre o destinatário e o quadro de totais.
  const corrido = ls.map(textoLinha).join("\n");
  const obra = /OBRA:\s*(.+)/i.exec(corrido)?.[1]?.trim() ?? null;
  const vencimentoDescricao = iso(/VENCIMENTO:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(corrido)?.[1] ?? "");
  // Período: só a coluna da descrição (à esquerda dos valores), com as linhas emendadas — o texto quebra no meio ("12/09 A" / "11/10/2026.").
  const descricao = ls
    .map((l) => l.filter((i) => i.x < p1.largura * 0.6 && !DINHEIRO.test(i.texto.trim())).map((i) => i.texto).join(" "))
    .join(" ").replace(/\s+/g, " ");
  const trechoPeriodo = /PER[IÍ]ODOS?\b.{0,300}?(?=OBRA:|$)/i.exec(descricao)?.[0] ?? "";
  const periodo = lerPeriodo(trechoPeriodo);

  // Cliente: primeira linha "razão social" no quadro do destinatário (texto à esquerda, logo abaixo do cabeçalho com as datas).
  const linhaCliente = ls.find((l) => {
    const y = l[0].y;
    return y > p1.altura * 0.15 && y < p1.altura * 0.26 && l[0].x < p1.largura * 0.1 && /[A-Z]{3,}/.test(l[0].texto) && !/\d{2}\/\d{2}\/\d{4}/.test(l[0].texto);
  });
  const cliente = linhaCliente ? linhaCliente.filter((i) => i.x < p1.largura * 0.5).map((i) => i.texto).join(" ").trim() : null;

  const valores = todas.map((i) => i.texto.trim()).filter((t) => DINHEIRO.test(t)).map(centavos);
  const totalCentavos = valores.length ? Math.max(...valores) : null;

  let parcelas = duplicatas(ls)
    .filter((d) => !nota || d.numero.replace(/\D/g, "").startsWith(nota) || d.numero.replace(/\D/g, "").length <= 3)
    .map(({ vencimento, valorCentavos }) => ({ vencimento, valorCentavos }));
  if (parcelas.length === 0 && vencimentoDescricao && totalCentavos) {
    parcelas = [{ vencimento: vencimentoDescricao, valorCentavos: totalCentavos }];
    avisos.push("Quadro de duplicatas não encontrado: usei o VENCIMENTO da descrição e o total da nota. Confira.");
  }
  parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const soma = parcelas.reduce((s, p) => s + p.valorCentavos, 0);
  if (parcelas.length > 0 && totalCentavos && soma !== totalCentavos) {
    avisos.push("A soma das parcelas não bate com o total da nota. Confira.");
  }
  if (parcelas.length === 1 && vencimentoDescricao && parcelas[0].vencimento !== vencimentoDescricao) {
    avisos.push("O vencimento da duplicata é diferente do escrito na descrição. Confira.");
  }
  if (parcelas.length === 0) avisos.push("Não encontrei vencimento e valor na nota: informe à mão.");
  if (!nota) avisos.push("Não encontrei o número da nota no PDF.");

  if (!emissao) avisos.push("Não encontrei a data de emissão no PDF.");
  if (!clienteDocumento) avisos.push("Não encontrei o CNPJ/CPF do cliente no PDF.");

  return { nota, emissao, cliente, clienteDocumento, obra, periodoInicio: periodo.inicio, periodoFim: periodo.fim, parcelas, totalCentavos, avisos };
}
