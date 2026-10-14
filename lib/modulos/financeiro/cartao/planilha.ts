// Planilha de conciliação (XLSX, exceljs) com as seis abas da skill: Resumo, A Lançar, Divergências, Conciliados, Compensados
// e Conciliação. Mesmo visual (cabeçalho azul-marinho, Arial 10/11, bordas finas, painel congelado).
import type { Workbook, Worksheet } from "exceljs";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { ROTULO_DECISAO, type DecisaoItem, type ResultadoConciliacao } from "./conciliacao";
import { brl } from "./texto";

const NAVY = "FF1F3864";
const BORDA = { style: "thin" as const, color: { argb: "FF999999" } };
const BORDAS = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA };

function aba(wb: Workbook, titulo: string, cabecalhos: string[], linhas: (string | number)[][], larguras: number[]): Worksheet {
  const ws = wb.addWorksheet(titulo);
  const cab = ws.addRow(cabecalhos);
  cab.eachCell((c) => {
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDAS;
  });
  for (const l of linhas) {
    const r = ws.addRow(l);
    r.eachCell({ includeEmpty: true }, (c, i) => {
      c.font = { name: "Arial", size: 10 };
      c.alignment = { vertical: "top", wrapText: i === l.length };
      c.border = BORDAS;
    });
  }
  larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

/** Decisões do item em texto curto para a coluna "Decisão". */
function textoDecisoes(lista: (DecisaoItem | undefined)[]): string {
  return lista.filter((d): d is DecisaoItem => !!d)
    .map((d) => `${ROTULO_DECISAO[d.tipo]}: ${d.tipo === "classificar" ? [d.categoria, d.contaFluxo].filter(Boolean).join(" / ") : d.motivo ?? ""}${d.autor ? ` (${d.autor})` : ""}`)
    .join(" | ");
}

export function nomeDaPlanilha(r: Pick<ResultadoConciliacao, "cartao" | "vencimento">): string {
  return `Conciliacao Cartao ${r.cartao.codigo} - ${formatarData(r.vencimento).replace(/\//g, "-")}.xlsx`;
}

/** Monta o arquivo em memória. Só chamar no servidor (exceljs é carregado sob demanda). */
export async function gerarPlanilha(r: ResultadoConciliacao): Promise<Uint8Array> {
  const { Workbook: WorkbookImpl } = await import("exceljs");
  const wb = new WorkbookImpl();
  wb.creator = "Neo Admin";

  const resumo: [string, string | number][] = [
    ["CONCILIAÇÃO DE FATURA DE CARTÃO DE CRÉDITO", ""], ["", ""],
    ["Cartão", r.cartao.nome], ["Vencimento da fatura", formatarData(r.vencimento)], ["", ""],
    ["Total da fatura informado (R$)", brl(r.totalInformadoCentavos)],
    ["Soma das linhas lidas da fatura (R$)", brl(r.somaLinhasCentavos)],
    ["Integridade da leitura", r.integridadeOk ? "OK" : "DIVERGENTE — CONFERIR EXTRAÇÃO"],
    ["Total dos títulos no Contas a Pagar (R$)", brl(r.totalTitulosCentavos)],
    ["Diferença apurada (R$)", brl(r.diferencaCentavos)], ["", ""],
    ["Linhas de despesa na fatura", r.contagens.linhas],
    ["Pares compensados (IOF e estornos)", r.contagens.compensados],
    ["Títulos no Contas a Pagar", r.contagens.titulos],
    ["Itens conciliados", r.contagens.conciliados],
    ["Agrupamentos (várias linhas em um título)", r.contagens.agrupamentos],
    ["Itens a lançar", r.contagens.aLancar],
    ["Compras parceladas lançadas pelo total (a desdobrar)", (r.aDesdobrar ?? []).length],
    ["Itens pendentes (sem título e sem justificativa, ou a desdobrar)", r.pendentes ?? r.contagens.aLancar],
    ["Decisões registradas", (r.decisoes ?? []).length],
    ["Títulos sem correspondência", r.contagens.divergencias],
    ["Conciliados com cartão divergente", r.contagens.cartaoDivergente], ["", ""],
    ["DIFERENÇA NÃO JUSTIFICADA (R$)", brl(r.residuoCentavos)],
  ];
  const ws = wb.addWorksheet("Resumo");
  resumo.forEach(([k, v], i) => {
    const linha = ws.addRow([k, v]);
    const destaque = k.startsWith("DIFERENÇA NÃO") || k === "Integridade da leitura" || k === "Conciliados com cartão divergente";
    const ruim = destaque && !(v === "OK" || v === "0,00" || v === 0);
    linha.getCell(1).font = { name: "Arial", size: 11, bold: i === 0 || destaque, color: { argb: i === 0 ? NAVY : "FF000000" } };
    linha.getCell(2).font = { name: "Arial", size: 11, bold: destaque, color: { argb: ruim ? "FFC00000" : "FF000000" } };
  });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 36;

  aba(wb, "A Lançar",
    ["Data da compra", "Descrição na fatura", "Valor (R$)", "Natureza", "Categoria", "Conta de fluxo", "Parcelas", "Vencimento", "Complemento sugerido", "Decisão"],
    r.aLancar.map((a) => [formatarData(a.linha.dataCompra), a.linha.descricao, brl(a.linha.valorCentavos), a.natureza, a.categoria, a.contaFluxo, a.parcelas, formatarData(a.vencimento), a.complementoSugerido,
      textoDecisoes([a.justificativa, a.classificacao, ...(a.observacoes ?? [])])]),
    [14, 40, 14, 24, 24, 22, 10, 14, 52, 40]);

  if ((r.aDesdobrar ?? []).length) {
    aba(wb, "A Desdobrar",
      ["Data da compra", "Descrição na fatura", "Parcela (R$)", "Parcelas", "Nº do título", "Fornecedor", "Vencimento", "Valor do título (R$)", "Situação"],
      (r.aDesdobrar ?? []).map((p) => [formatarData(p.linha.dataCompra), p.linha.descricao, brl(p.parcelaCentavos), p.parcelas, p.titulo.numeroTitulo, p.titulo.fornecedor,
        formatarData(p.titulo.vencimento), brl(p.titulo.valorCentavos), "Compra parcelada lançada pelo total: desdobrar no Consistem"]),
      [14, 36, 14, 10, 14, 30, 14, 18, 52]);
  }

  aba(wb, "Divergências",
    ["Nº do título", "Fornecedor", "Vencimento", "Valor (R$)", "Complemento", "Causa provável", "Decisão"],
    r.divergencias.map((d) => [d.titulo.numeroTitulo, d.titulo.fornecedor, formatarData(d.titulo.vencimento), brl(d.titulo.valorCentavos), d.titulo.complemento, d.causa,
      textoDecisoes([d.justificativa, ...(d.observacoes ?? [])])]),
    [14, 30, 14, 14, 44, 46, 40]);

  aba(wb, "Conciliados",
    ["Data da compra", "Descrição na fatura", "Valor (R$)", "Nº do título", "Complemento do título", "Modo", "Aderência"],
    r.conciliados.map((c) => [
      formatarData(c.linhas[0].dataCompra),
      c.modo === "Agrupado" ? `${c.linhas[0].descricao} (${c.linhas.length} lançamentos)` : c.linhas[0].descricao,
      brl(c.linhas.reduce((s, l) => s + l.valorCentavos, 0)), c.titulo.numeroTitulo, c.titulo.complemento,
      c.modo === "Arredondamento" ? `Arredondamento (${brl(c.diferencaCentavos)})` : c.modo, c.aderencia,
    ]),
    [14, 44, 14, 14, 40, 26, 28]);

  aba(wb, "Compensados",
    ["Descrição (débito)", "Valor (R$)", "Descrição (crédito)", "Valor (R$)"],
    r.compensados.map((c) => [c.debito.descricao, brl(c.debito.valorCentavos), c.credito.descricao, brl(c.credito.valorCentavos)]),
    [46, 14, 46, 14]);

  aba(wb, "Conciliação", ["Descrição", "Valor (R$)"], r.quadro.map((q) => [q.rotulo, brl(q.centavos)]), [58, 20]);

  const descricaoDe = new Map([...r.aLancar.map((a) => a.linha), ...r.conciliados.flatMap((c) => c.linhas), ...r.compensados.flatMap((c) => [c.credito, c.debito, ...(c.outras ?? [])])]
    .map((l) => [l.id, `${l.descricao} (${brl(l.valorCentavos)})`]));
  aba(wb, "Decisões", ["Tipo", "Linhas da fatura", "Títulos (código do lançamento)", "Categoria / conta", "Motivo", "Por", "Quando"],
    (r.decisoes ?? []).map((d) => [ROTULO_DECISAO[d.tipo], d.linhas.map((id) => descricaoDe.get(id) ?? id).join("; "), d.titulos.join("; "),
      [d.categoria, d.contaFluxo].filter(Boolean).join(" / "), d.motivo ?? "", d.autor ?? "", d.em.slice(0, 16).replace("T", " ")]),
    [18, 44, 22, 28, 44, 18, 18]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
