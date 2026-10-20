// Planilha do fechamento de comissões, no formato das planilhas "Comissões <Nome> - 2026.xlsx": uma aba por representante,
// percentuais no cabeçalho, linhas incluídas, TOTAL DO MÊS, ANTECIPADO e SALDO A PAGAR. Só no servidor (exceljs sob demanda).

export type LinhaPlanilha = {
  documento: string; cliente: string; data_pagamento: string | null; valor_base: number; tipo: "venda" | "locacao"; percentual: number;
  comissao: number; origem: string;
};
export type AbaPlanilha = {
  nome: string; perc_venda: number; perc_locacao: number; linhas: LinhaPlanilha[]; antecipacoes: { descricao: string; data: string | null; valor: number }[];
};

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
/** "Comissões Fernando Grassmann - 09-2026.xlsx" (um representante) ou "Comissões 09-2026.xlsx" (todos). */
export const nomePlanilhaComissoes = (competencia: string, representante?: string) =>
  `Comissões ${representante ? `${representante} - ` : ""}${competencia.slice(5, 7)}-${competencia.slice(0, 4)}.xlsx`;

export async function gerarPlanilhaComissoes(rotuloMes: string, abas: AbaPlanilha[]): Promise<Uint8Array> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const moeda = '"R$" #,##0.00';
  for (const aba of abas) {
    const ws = wb.addWorksheet(aba.nome.slice(0, 31));
    ws.columns = [{ width: 14 }, { width: 44 }, { width: 14 }, { width: 16 }, { width: 10 }, { width: 8 }, { width: 14 }, { width: 26 }];
    ws.addRow([`Comissões - ${aba.nome}`]).font = { bold: true, size: 13 };
    ws.addRow([`Mês de referência: ${rotuloMes}`, "", "", "Percentuais", "Venda", aba.perc_venda / 100, "Locação", aba.perc_locacao / 100]);
    ws.getRow(2).getCell(6).numFmt = "0.0%";
    ws.getRow(2).getCell(8).numFmt = "0.0%";
    ws.addRow([]);
    const cab = ws.addRow(["Nº docto", "Sacado", "Dt. pagamento", "Vl. total", "Tipo", "%", "Comissão", "Origem"]);
    cab.font = { bold: true };
    for (const l of aba.linhas) {
      const r = ws.addRow([l.documento, l.cliente, dataBr(l.data_pagamento), l.valor_base, l.tipo === "locacao" ? "Locação" : "Venda", l.percentual / 100, l.comissao, l.origem]);
      r.getCell(4).numFmt = moeda;
      r.getCell(6).numFmt = "0.0%";
      r.getCell(7).numFmt = moeda;
    }
    ws.addRow([]);
    const total = aba.linhas.reduce((s, l) => s + Math.round(l.comissao * 100), 0) / 100;
    const linhaTotal = ws.addRow(["", "TOTAL DO MÊS", "", "", "", "", total]);
    linhaTotal.font = { bold: true };
    linhaTotal.getCell(7).numFmt = moeda;
    for (const a of aba.antecipacoes) {
      const r = ws.addRow(["", `${a.descricao}${a.data ? ` - ${dataBr(a.data)}` : ""}`, "", "", "", "", -a.valor]);
      r.getCell(7).numFmt = moeda;
    }
    const saldo = ws.addRow(["", "SALDO A PAGAR", "", "", "", "", Math.round((total - aba.antecipacoes.reduce((s, a) => s + a.valor, 0)) * 100) / 100]);
    saldo.font = { bold: true };
    saldo.getCell(7).numFmt = moeda;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
