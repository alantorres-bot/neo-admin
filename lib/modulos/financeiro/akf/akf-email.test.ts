import { describe, expect, it } from "vitest";
import { corpoSolicitacaoParaHtml, lerLinhaTitulo, lerLinhaTotal } from "../../../../supabase/functions/_shared/akf-email";
import { montarEmailSolicitacao, type ItemEmail } from "./solicitacao";

const itens: ItemEmail[] = [
  { documento: "2318", cliente: "CAPARAO HOUSE GARDEN", vencimento: "2026-10-15", valorSolicitadoCentavos: 5_000_000, valorRestanteCentavos: 5_000_000, parcial: false, semBoleto: true },
  { documento: "1335/2", cliente: "EFATA & FILHOS <LTDA>", vencimento: "2026-10-20", valorSolicitadoCentavos: 12_000_000, valorRestanteCentavos: 12_000_000, parcial: false, semBoleto: false },
];
const { corpo } = montarEmailSolicitacao({ itens, data: "2026-10-12", hora: 14, tratamento: "André/Kayza", observacaoSemBoleto: "Operar com 01 dia após o vencimento e não emitir boleto." });
const html = corpoSolicitacaoParaHtml(corpo);

describe("lerLinhaTitulo e lerLinhaTotal", () => {
  it("separa as colunas da linha do título e do total", () => {
    expect(lerLinhaTitulo("NF 1335/2 | EFATA CONSTRUTORA LTDA | Venc. 20/10/2026 | R$ 120.000,00")).toEqual({ documento: "1335/2", cliente: "EFATA CONSTRUTORA LTDA", vencimento: "20/10/2026", valor: "R$ 120.000,00" });
    expect(lerLinhaTitulo("OBS - NF 2318 - Operar com 01 dia")).toBeNull();
    expect(lerLinhaTotal("Total: R$ 170.000,00 (2 títulos)")).toEqual({ valor: "R$ 170.000,00", quantidade: "2 títulos" });
    expect(lerLinhaTotal("Total geral")).toBeNull();
  });
});

describe("corpoSolicitacaoParaHtml", () => {
  it("os títulos viram uma tabela com cabeçalho, uma linha por título e o total no rodapé", () => {
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain(">Documento</th>");
    expect(html).toContain(">Vencimento</th>");
    expect(html.match(/<tr/g)).toHaveLength(4); // cabeçalho + 2 títulos + total
    expect(html).toContain(">2318</td>");
    expect(html).toContain(">15/10/2026</td>");
    expect(html).toContain(">R$ 50.000,00</td>");
    expect(html).toContain("Total (2 títulos)</td>");
    expect(html).toContain(">R$ 170.000,00</td>");
    expect(html).not.toContain("NF 2318 |"); // a linha de texto não sobra
    expect(html).not.toContain("Total: R$");
  });
  it("o texto ao redor fica, com quebras de linha, e a OBS continua depois da tabela", () => {
    expect(html).toContain("André/Kayza,<br><br>Boa tarde!<br><br>Favor operar os títulos abaixo:");
    expect(html.indexOf("</table>")).toBeLessThan(html.indexOf("OBS - NF 2318 - Operar com 01 dia após o vencimento e não emitir boleto."));
    expect(html).toContain("<br><br>Atenciosamente,");
  });
  it("escapa tudo o que vem do texto", () => {
    expect(html).toContain("EFATA &amp; FILHOS &lt;LTDA&gt;");
    expect(html).not.toContain("<LTDA>");
    expect(corpoSolicitacaoParaHtml("<script>x</script>")).not.toContain("<script>");
  });
  it("corpo sem linhas de título não gera tabela", () => {
    expect(corpoSolicitacaoParaHtml("Oi,\n\nAtenciosamente,")).not.toContain("<table");
  });
});
