import { describe, expect, it } from "vitest";
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { lerNotaSyslock, lerPeriodo } from "./leitor-nota";

// Página sintética no layout do Syslock (coordenadas como nas notas reais; dados fictícios).
const it_ = (x: number, y: number, texto: string): ItemTexto => ({ x, y, w: texto.length * 5, texto });
function pagina(extra: ItemTexto[] = [], duplicatas: ItemTexto[] = [it_(65, 660, "002999"), it_(197, 660, "12.345,67"), it_(247, 660, "13/11/2026")]): PaginaTexto[] {
  return [{
    numero: 1, largura: 595, altura: 842,
    itens: [
      it_(521, 54, "002999"),
      it_(383, 90, "17.209.767/0002-09"),
      it_(530, 102, "08/10/2026"),
      it_(17, 120, "LOCAÇÃO DE BENS MÓVEIS"),
      it_(533, 153, "08/10/2026"),
      it_(380, 156, "11.222.333/0001-81"),
      it_(17, 159, "CONSTRUTORA EXEMPLO LTDA"),
      it_(17, 183, "RUA TAL, 100"),
      it_(17, 261, "LOCAÇÃO DE EQUIPAMENTOS MÓVEIS SISTEMA NEO FORMAS, NO PERÍODO DE 12/09 A"),
      it_(472, 261, "12.345,67"), it_(545, 261, "12.345,67"),
      it_(17, 273, "11/10/2026."),
      it_(17, 306, "OBRA: EDIFÍCIO EXEMPLO"),
      it_(17, 339, "VENCIMENTO: 13/11/2026"),
      it_(545, 567, "12.345,67"),
      it_(563, 597, "0,00"),
      ...duplicatas,
      it_(505, 768, "002999"),
      ...extra,
    ],
  }];
}

describe("lerNotaSyslock", () => {
  it("lê nota, cliente, obra, período e a parcela do quadro de duplicatas", () => {
    expect(lerNotaSyslock(pagina())).toEqual({
      nota: "002999", emissao: "2026-10-08", cliente: "CONSTRUTORA EXEMPLO LTDA", clienteDocumento: "11.222.333/0001-81", obra: "EDIFÍCIO EXEMPLO",
      periodoInicio: "2026-09-12", periodoFim: "2026-10-11",
      parcelas: [{ vencimento: "2026-11-13", valorCentavos: 1_234_567 }], totalCentavos: 1_234_567, avisos: [],
    });
  });

  it("várias parcelas (na mesma linha e na seguinte), em ordem de vencimento", () => {
    const r = lerNotaSyslock(pagina([], [
      it_(65, 660, "002999/2"), it_(197, 660, "4.000,00"), it_(247, 660, "13/12/2026"),
      it_(300, 660, "002999/1"), it_(420, 660, "4.000,00"), it_(470, 660, "13/11/2026"),
      it_(65, 672, "002999/3"), it_(197, 672, "4.345,67"), it_(247, 672, "13/01/2027"),
    ]));
    expect(r.parcelas).toEqual([
      { vencimento: "2026-11-13", valorCentavos: 400_000 },
      { vencimento: "2026-12-13", valorCentavos: 400_000 },
      { vencimento: "2027-01-13", valorCentavos: 434_567 },
    ]);
    expect(r.avisos).toEqual([]);
  });

  it("sem quadro de duplicatas: usa o VENCIMENTO da descrição e o total, com aviso", () => {
    const r = lerNotaSyslock(pagina([], []));
    expect(r.parcelas).toEqual([{ vencimento: "2026-11-13", valorCentavos: 1_234_567 }]);
    expect(r.avisos[0]).toMatch(/Quadro de duplicatas não encontrado/);
  });

  it("soma das parcelas diferente do total gera aviso", () => {
    const r = lerNotaSyslock(pagina([], [it_(65, 660, "002999"), it_(197, 660, "10.000,00"), it_(247, 660, "13/11/2026")]));
    expect(r.avisos).toContain("A soma das parcelas não bate com o total da nota. Confira.");
  });

  it("PDF sem nada reconhecível", () => {
    const r = lerNotaSyslock([{ numero: 1, largura: 595, altura: 842, itens: [it_(17, 100, "OUTRO DOCUMENTO")] }]);
    expect(r.nota).toBeNull();
    expect(r.emissao).toBeNull();
    expect(r.clienteDocumento).toBeNull();
    expect(r.parcelas).toEqual([]);
    expect(r.avisos).toContain("Não encontrei vencimento e valor na nota: informe à mão.");
  });
});

describe("lerPeriodo", () => {
  it("formas que aparecem nas notas", () => {
    expect(lerPeriodo("NO PERÍODO DE 12/09 A 11/10/2026.")).toEqual({ inicio: "2026-09-12", fim: "2026-10-11" });
    expect(lerPeriodo("NO PERÍODO FINAL DE 01 A 30/09/2026.")).toEqual({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(lerPeriodo("NOS PERÍODOS DE: - 13/08 A 11/09/2026 - BARREIRAS - 17/08 A 15/09/2026 - MURO")).toEqual({ inicio: "2026-08-13", fim: "2026-09-15" });
    expect(lerPeriodo("NO PERÍODO DE 15/12 A 14/01/2027.")).toEqual({ inicio: "2026-12-15", fim: "2027-01-14" });
    expect(lerPeriodo("sem período")).toEqual({ inicio: null, fim: null });
  });
});

describe("CNPJ do cliente", () => {
  it("ignora o CNPJ da Neo e documento inválido", () => {
    const r = lerNotaSyslock(pagina([it_(380, 140, "17.209.767/0002-09")]).map((p) => ({ ...p, itens: p.itens.map((i) => (i.texto === "11.222.333/0001-81" ? { ...i, texto: "11.222.333/0001-00" } : i)) })));
    expect(r.clienteDocumento).toBeNull();
    expect(r.avisos).toContain("Não encontrei o CNPJ/CPF do cliente no PDF.");
  });
  it("aceita CPF", () => {
    const r = lerNotaSyslock(pagina().map((p) => ({ ...p, itens: p.itens.map((i) => (i.texto === "11.222.333/0001-81" ? { ...i, texto: "529.982.247-25" } : i)) })));
    expect(r.clienteDocumento).toBe("529.982.247-25");
  });
});
