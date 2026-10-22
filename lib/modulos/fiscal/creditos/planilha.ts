// Fiscal > Créditos tributários: geração de planilhas (Excel) dos relatórios e do modelo de importação. Só no servidor.
// Todo relatório traz no topo: título, data/hora de emissão, quem emitiu, período e critérios (filtros) usados.

export type ColunaPlanilha = { titulo: string; tipo?: "texto" | "moeda" | "data" | "numero"; largura?: number };
export type Celula = string | number | null;

export type Relatorio = { titulo: string; emitidoPor: string; emitidoEm: string; criterios: string[]; colunas: ColunaPlanilha[]; linhas: Celula[][]; totais?: Celula[]; avisos?: string[] };

const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

/** 'aaaa-mm-dd' -> Date (UTC meio-dia: sem troca de dia por fuso). */
const comoData = (v: Celula) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00Z`) : v);

export async function gerarPlanilha(abas: Relatorio[]): Promise<Uint8Array> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "Fiscal Control (Neo Admin)";
  for (const r of abas) {
    const ws = wb.addWorksheet(r.titulo.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
    ws.addRow([`Fiscal Control — ${r.titulo}`]).font = { bold: true, size: 13 };
    ws.addRow([`Emitido em ${r.emitidoEm} por ${r.emitidoPor}`]);
    for (const c of r.criterios) ws.addRow([c]);
    for (const a of r.avisos ?? []) ws.addRow([a]).font = { italic: true, color: { argb: "FF9A3412" } };
    ws.addRow([]);
    const cab = ws.addRow(r.colunas.map((c) => c.titulo));
    cab.font = { bold: true };
    cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } }; c.border = { bottom: { style: "thin" } }; });
    const inicio = cab.number + 1;
    for (const l of r.linhas) ws.addRow(l.map((v, i) => (r.colunas[i]?.tipo === "data" ? comoData(v) : v)));
    if (r.totais) ws.addRow(r.totais).font = { bold: true };
    r.colunas.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.largura ?? (c.tipo === "moeda" ? 16 : c.tipo === "data" ? 12 : 22);
      if (c.tipo === "moeda") col.eachCell((cel, linha) => { if (linha >= inicio) cel.numFmt = MOEDA; });
      if (c.tipo === "data") col.eachCell((cel, linha) => { if (linha >= inicio) cel.numFmt = "dd/mm/yyyy"; });
    });
    ws.views = [{ state: "frozen", ySplit: cab.number }];
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Centavos -> reais (número) para a célula de moeda. */
export const emReais = (c: number) => Math.round(c) / 100;
