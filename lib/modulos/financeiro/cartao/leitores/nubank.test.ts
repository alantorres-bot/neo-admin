import { describe, expect, it } from "vitest";
import { somaLinhas } from "./comum";
import { lerFatura } from "./index";
import type { ItemTexto, PaginaTexto } from "./tipos";

const it_ = (x: number, y: number, texto: string): ItemTexto => ({ x, y, w: 40, texto });

// Página "TRANSAÇÕES" do Nubank (posições da fatura PF de 10/2026): data 1,2 pt acima da descrição, 21 pt por linha.
function paginaNubank(numero: number, linhas: { data: string; cartao?: boolean; desc: string; valor: string; abaixo?: string[] }[], subtotal?: string): PaginaTexto {
  const itens: ItemTexto[] = [it_(327, 60.4, "FATURA 27 OUT 2026"), it_(130, 108.1, "DE 20 SET A 20 OUT"), it_(50, 109.7, "TRANSAÇÕES")];
  if (subtotal) itens.push(it_(119, 175.9, "Titular Exemplo"), it_(488.2, 175.9, subtotal));
  let y = 201.7;
  for (const l of linhas) {
    itens.push(it_(123, y, l.data));
    if (l.cartao) itens.push(it_(172, y + 1.2, "•••• 0000"));
    itens.push(it_(l.cartao ? 214 : 185, y + 1.2, l.desc), it_(535 - l.valor.length * 4, y + 1.2, l.valor));
    (l.abaixo ?? []).forEach((t, k) => itens.push(it_(214, y + 15.9 + k * 9, t)));
    y += l.abaixo ? 42 : 22;
  }
  return { numero, largura: 595, altura: 842, itens };
}
const capa: PaginaTexto = { numero: 1, largura: 595, altura: 842, itens: [it_(138, 318.7, "R$ 1.234,56"), it_(138, 404.4, "Data de vencimento: 27 OUT 2026")] };
// A página 2 traz outro "Total a pagar" (simulação de parcelamento): não pode ser lido como total da fatura.
const parcelamento: PaginaTexto = { numero: 2, largura: 595, altura: 842, itens: [it_(318.3, 427.1, "Total a pagar"), it_(395, 427.5, "R$ 16.211,03")] };
const resumo = (total: string): PaginaTexto => ({
  numero: 4, largura: 595, altura: 842,
  itens: [it_(50, 109.7, "RESUMO DA FATURA ATUAL"), it_(140, 139.2, "Fatura anterior"), it_(482.5, 139.2, "R$ 500,00"), it_(140, 241.9, "Total a pagar"), it_(453.7, 241.9, total)],
});

describe("leitor Nubank", () => {
  const paginas = [capa, parcelamento, resumo("R$ 1.234,56"), paginaNubank(5, [
    { data: "20 SET", desc: "NuViagens - NuPay - Parcela 5/8", valor: "R$ 166,84" },
    { data: "20 SET", cartao: true, desc: "Anthropic* Claude Sub", valor: "R$ 570,79", abaixo: ["BRL 550.00 = USD 106.93", "Conversão: BRL 5.33 = USD 1 = R$ 5,33"] },
    { data: "20 SET", desc: 'IOF de "Anthropic* Claude Sub"', valor: "R$ 19,98" },
    { data: "20 SET", desc: "IOF de volta de Anthropic* Claude Sub", valor: "−R$ 19,98" },
    { data: "30 SET", desc: "Transação de NuTag", valor: "R$ 10,00" },
  ], "R$ 747,63"), paginaNubank(7, [
    { data: "06 OUT", desc: "Pagamento em 06 OUT", valor: "−R$ 500,00" },
    { data: "28 SET", desc: "Crédito de atraso", valor: "−R$ 500,00" },
    { data: "28 SET", desc: "Saldo em atraso", valor: "R$ 500,00" },
    { data: "06 OUT", desc: "Multa de atraso", valor: "R$ 10,00" },
    { data: "06 OUT", desc: "IOF de atraso", valor: "R$ 1,93" },
    { data: "06 OUT", desc: "Juros de atraso", valor: "R$ 475,00" },
    { data: "06 OUT", desc: "Juros de dívida encerrada", valor: "R$ 486,93" },
    { data: "06 OUT", desc: "Encerramento de dívida", valor: "−R$ 486,93" },
  ])];
  const r = lerFatura("nubank", paginas, { vencimento: "2026-10-27" });

  it("lê data sem ano, final do cartão, parcela no fim, sinal −, e ignora as linhas de conversão e os subtotais", () => {
    expect(r.avisos).toEqual([]);
    expect(r.linhas.slice(0, 5).map((l) => [l.dataCompra, l.descricao, l.parcelaNum, l.parcelaTotal, l.valorCentavos, l.descartada])).toEqual([
      ["2026-09-20", "NuViagens - NuPay", 5, 8, 16_684, false], ["2026-09-20", "Anthropic* Claude Sub", null, null, 57_079, false],
      ["2026-09-20", 'IOF de "Anthropic* Claude Sub"', null, null, 1_998, false], ["2026-09-20", "IOF de volta de Anthropic* Claude Sub", null, null, -1_998, false],
      ["2026-09-30", "Transação de NuTag", null, null, 1_000, false],
    ]);
  });

  it("descarta o pagamento e os pares do atraso; multa, IOF e juros de atraso ficam; a soma fecha com o Total a pagar do resumo", () => {
    expect(r.linhas.slice(5).map((l) => [l.descricao, l.valorCentavos, l.descartada])).toEqual([
      ["Pagamento em 06 OUT", -50_000, true], ["Crédito de atraso", -50_000, true], ["Saldo em atraso", 50_000, true],
      ["Multa de atraso", 1_000, false], ["IOF de atraso", 193, false], ["Juros de atraso", 47_500, false],
      ["Juros de dívida encerrada", 48_693, true], ["Encerramento de dívida", -48_693, true],
    ]);
    expect(r.totalImpressoCentavos).toBe(123_456);
    expect(somaLinhas(r.linhas)).toBe(123_456);
    expect(r.vencimentoImpresso).toBe("2026-10-27");
  });

  it("par do atraso sem contrapartida fica na conta e gera aviso", () => {
    const so = lerFatura("nubank", [paginaNubank(7, [{ data: "06 OUT", desc: "Juros de dívida encerrada", valor: "R$ 486,93" }])], { vencimento: "2026-10-27" });
    expect(so.linhas[0].descartada).toBe(false);
    expect(so.avisos).toHaveLength(1);
  });
});
