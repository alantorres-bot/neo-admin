import { describe, expect, it } from "vitest";
import { montarCaminhoAnexo, nomeSeguro } from "./anexos";

describe("nomeSeguro", () => {
  it("tira acentos e caracteres problemáticos, mantendo a extensão", () => {
    expect(nomeSeguro("Boleto Cliente Ação 03/2026.pdf")).toBe("Boleto_Cliente_Acao_03_2026.pdf");
    expect(nomeSeguro("../../etc/passwd")).toBe("etc_passwd");
    expect(nomeSeguro("  relatório (final).xlsx ")).toBe("relatorio_final.xlsx");
  });

  it("nunca devolve vazio e limita o tamanho", () => {
    expect(nomeSeguro("???")).toBe("arquivo");
    expect(nomeSeguro("...")).toBe("arquivo");
    expect(nomeSeguro("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
    expect(nomeSeguro("a".repeat(300) + ".pdf").endsWith(".pdf")).toBe(true);
  });
});

describe("montarCaminhoAnexo", () => {
  it("segue <modulo>/<tabela>/<id>/<uuid>-<nome>, com o módulo no 1º segmento (a RLS do Storage depende disso)", () => {
    const caminho = montarCaminhoAnexo(
      { modulo: "financeiro.recebiveis", referenciaTabela: "rec_titulos", referenciaId: "11111111-1111-1111-1111-111111111111" },
      "Boleto março.pdf",
      "aaaa",
    );
    expect(caminho).toBe("financeiro.recebiveis/rec_titulos/11111111-1111-1111-1111-111111111111/aaaa-Boleto_marco.pdf");
    expect(caminho.split("/")[0]).toBe("financeiro.recebiveis");
  });

  it("gera uuid diferente a cada envio, para não sobrescrever", () => {
    const dados = { modulo: "a.b", referenciaTabela: "t", referenciaId: "x" };
    expect(montarCaminhoAnexo(dados, "f.pdf")).not.toBe(montarCaminhoAnexo(dados, "f.pdf"));
  });
});
