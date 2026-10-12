import { describe, expect, it } from "vitest";
import { desespacar, somaLinhas } from "./comum";
import { lerFatura } from "./index";
import type { ItemTexto, PaginaTexto } from "./tipos";

const it_ = (x: number, y: number, texto: string): ItemTexto => ({ x, y, w: 40, texto });

// Página "Despesas da fatura" do Inter (posições da fatura PF de 08/2026). Um bloco por cartão, 20 pt por linha.
function paginaInter(numero: number, blocos: { cartao: string; linhas: { data: string; mov: string[]; valor: string }[]; total?: string }[]): PaginaTexto {
  const itens: ItemTexto[] = [it_(223.5, 25.5, "TITULAR"), it_(256.5, 34.5, "5126****0000"), it_(327.7, 34.5, "28/08/2026"), it_(387, 34.5, "R$"), it_(395.5, 34.5, "4.731,40"), it_(18, 81.7, "Despesas da fatura")];
  let y = 111;
  for (const b of blocos) {
    itens.push(it_(24, y, "CARTÃO"), it_(54.7, y, b.cartao)); y += 20;
    itens.push(it_(24, y, "Data"), it_(75, y, "Movimentação"), it_(282.4, y, "Beneficiário"), it_(404.2, y, "Valor")); y += 20;
    for (const l of b.linhas) {
      itens.push(it_(24, y, l.data));
      let x = 77.4;
      for (const m of l.mov) { itens.push(it_(x, y, m)); x += m.length * 5.5; }
      itens.push(it_(299.5, y, "-"), it_(420 - l.valor.length * 3, y, l.valor));
      y += 20;
    }
    if (b.total) { itens.push(it_(24, y, "Total CARTÃO"), it_(61.5, y, b.cartao), it_(390, y, "R$"), it_(399, y, b.total)); y += 30; }
  }
  return { numero, largura: 446, altura: 632, itens };
}
const resumoInter: PaginaTexto = {
  numero: 1, largura: 446, altura: 632,
  itens: [it_(52.5, 145.5, "Total da sua fatura"), it_(52.5, 168, "R$"), it_(81, 168, "4.731,40"), it_(329.2, 168, "Data de Vencimento"), it_(329.2, 181.5, "28/08/2026"),
    it_(346.7, 433.5, "FATURA ATUAL"), it_(30, 516, "Despesas do mês"), it_(381.7, 516, "R$"), it_(390.7, 516, "4.731,40"), it_(30, 570, "Fatura atual"), it_(381.7, 570, "R$"), it_(390.7, 570, "4.731,40")],
};

describe("leitor Inter", () => {
  const paginas = [resumoInter, paginaInter(3, [
    { cartao: "5126****0000", linhas: [
      { data: "09 de abr. 2026", mov: ["CP P", "ARC LOJA EXEMPLO", "(Parcela 05 de 10)"], valor: "R$ 80,59" },
      { data: "02 de jul. 2026", mov: ["MS SOLAR", "(Parcela 02 de 06)"], valor: "R$ 2.666,66" },
      { data: "30 de jul. 2026", mov: ["PGTO PIX"], valor: "+ R$ 5.232,07" },
      { data: "21 de ago. 2026", mov: ["MULTA POR ATRASO"], valor: "R$ 104,59" },
      { data: "22 de ago. 2026", mov: ["IOF"], valor: "R$ 20,72" },
    ], total: "2.872,56" },
    { cartao: "5126****1111", linhas: [{ data: "18 de ago. 2026", mov: ["RENTCARS", "(Parcela 01 de 03)"], valor: "R$ 423,73" }], total: "423,73" },
  ])];
  const r = lerFatura("inter", paginas, { vencimento: "2026-08-28" });
  it("lê os blocos por cartão, data por extenso, parcela entre parênteses e o pagamento (+) como crédito descartado", () => {
    expect(r.avisos).toEqual([]);
    expect(r.linhas.map((l) => [l.dataCompra, l.descricao, l.parcelaNum, l.parcelaTotal, l.valorCentavos, l.descartada])).toEqual([
      ["2026-04-09", "CP P ARC LOJA EXEMPLO", 5, 10, 8_059, false], ["2026-07-02", "MS SOLAR", 2, 6, 266_666, false], ["2026-07-30", "PGTO PIX", null, null, -523_207, true],
      ["2026-08-21", "MULTA POR ATRASO", null, null, 10_459, false], ["2026-08-22", "IOF", null, null, 2_072, false], ["2026-08-18", "RENTCARS", 1, 3, 42_373, false],
    ]);
    expect(somaLinhas(r.linhas)).toBe(8_059 + 266_666 + 10_459 + 2_072 + 42_373);
    expect(r.totalImpressoCentavos).toBe(473_140);
    expect(r.vencimentoImpresso).toBe("2026-08-28");
  });
});

// Página de lançamentos da Unicred Visa: letras espaçadas, 36 pt por linha.
function paginaUnicred(numero: number, linhas: { data: string; desc: string[]; valor: string }[], total?: string): PaginaTexto {
  const e = (t: string) => t.split("").join(" ");
  const itens: ItemTexto[] = [it_(101.2, 51, e("TITULAR")), it_(101.2, 60.8, e("REF.:")), it_(130.5, 60.8, e("ago/2026")), it_(82.5, 188.3, "D ATA"), it_(129, 188.3, e("DESCRIÇÃO")), it_(489, 188.3, "VA L O R")];
  let y = 223.5;
  for (const l of linhas) {
    itens.push(it_(82.5, y, e(l.data)));
    let x = 131.2;
    for (const d of l.desc) { itens.push(it_(x, y, e(d))); x += d.length * 7; }
    const neg = l.valor.startsWith("-");
    itens.push(it_(neg ? 464.2 : 481.5, y, neg ? "- R $" : "R $"), it_(neg ? 483 : 496.5, y, e(l.valor.replace("-", ""))));
    y += 36;
  }
  if (total) itens.push(it_(75, y + 30, e("TOTAL")), it_(111.7, y + 30, e("DE")), it_(128.2, y + 30, e("TITULAR")), it_(409.6, y + 30, "R $"), it_(426.1, y + 30, e(total)));
  return { numero, largura: 612, altura: 792, itens };
}
const resumoUnicred: PaginaTexto = {
  numero: 2, largura: 612, altura: 792,
  itens: [it_(101.2, 137.3, "T O T A L :"), it_(133.5, 137.3, "R $"), it_(147, 137.3, "9 . 8 7 8 , 2 3"), it_(233.2, 137.3, "V E N C I M E N T O :"), it_(293.2, 137.3, "1 9"), it_(306.7, 137.3, "A G O"), it_(326.2, 137.3, "2 0 2 6"),
    it_(396, 137.3, "P A G A M E N T O"), it_(448.5, 137.3, "M Í N I M O :"), it_(486, 137.3, "R $"), it_(499.5, 137.3, "1 . 4 8 1 , 7 3")],
};

describe("leitor Unicred", () => {
  it("desespaça as letras", () => {
    expect(desespacar("1 2 / m a r")).toBe("12/mar");
    expect(desespacar("R $")).toBe("R$");
    expect(desespacar("D ATA")).toBe("D ATA");
    expect(desespacar("Pagamento Recebido")).toBe("Pagamento Recebido");
  });
  const paginas = [resumoUnicred, paginaUnicred(3, [
    { data: "12/mar", desc: ["CASA", "DOS", "FILTROS", "Parc.5/5"], valor: "190,00" },
    { data: "13/jul", desc: ["Anuidade -", "parcela"], valor: "79,16" },
    { data: "20/jul", desc: ["Pagamento", "Recebido"], valor: "-2.534,16" },
    { data: "06/ago", desc: ["MP*LENI10"], valor: "2.320,80" },
  ], "2.589,96")];
  const r = lerFatura("unicred", paginas, { vencimento: "2026-08-19" });
  it("lê data, parcela colada, valor com R$ separado e o pagamento recebido; total e vencimento impressos", () => {
    expect(r.avisos).toEqual([]);
    expect(r.linhas.map((l) => [l.dataCompra, l.descricao, l.parcelaNum, l.parcelaTotal, l.valorCentavos, l.descartada])).toEqual([
      ["2026-03-12", "CASA DOS FILTROS", 5, 5, 19_000, false], ["2026-07-13", "Anuidade- parcela", null, null, 7_916, false],
      ["2026-07-20", "Pagamento Recebido", null, null, -253_416, true], ["2026-08-06", "MP*LENI10", null, null, 232_080, false],
    ]);
    expect(r.totalImpressoCentavos).toBe(987_823);
    expect(r.vencimentoImpresso).toBe("2026-08-19");
  });
});
