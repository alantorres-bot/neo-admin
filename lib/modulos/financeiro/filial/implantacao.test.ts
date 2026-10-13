import { describe, expect, it } from "vitest";
import { CONFIG_IMPLANTACAO_PADRAO, lerConfigImplantacao, montarFichaImplantacao, type KitParaFicha } from "./implantacao";

const kit = (extra: Partial<KitParaFicha> = {}): KitParaFicha => ({
  nota: "002351", emissao: "2026-10-08", clienteNome: "QRTZ 39", clienteDocumento: "54.228.381/0001-90", clienteCodigoErp: "91",
  clienteConferido: true, parcelas: [{ vencimento: "2026-11-13", valorCentavos: 2_650_100 }], ...extra,
});
const campo = (f: ReturnType<typeof montarFichaImplantacao>, rotulo: string) => f.secoes.flatMap((s) => s.campos).find((c) => c.rotulo === rotulo);

describe("montarFichaImplantacao (CCFT040)", () => {
  it("segue a ordem da rotina e traz os campos do POP", () => {
    const f = montarFichaImplantacao(kit(), CONFIG_IMPLANTACAO_PADRAO);
    expect(f.secoes.map((s) => s.titulo)).toEqual([
      "Cabeçalho", "Aba Item", "PIS/COFINS", "Abas Outros e Placas", "Aba Totais",
      "Confirma → \"Altera vencimento/valor de duplicatas?\" Sim → Altera Valor Título",
    ]);
    expect(f.secoes[0].campos.map((c) => c.rotulo)).toEqual(["Data Emissão", "Nota Fiscal", "Tipo de Nota", "Cliente", "Representante", "Condição Venda"]);
    expect(f.alertas).toEqual([]);
  });

  it("valores como se digitam no Consistem", () => {
    const f = montarFichaImplantacao(kit(), CONFIG_IMPLANTACAO_PADRAO);
    expect(campo(f, "Data Emissão")).toMatchObject({ valor: "08/10/2026", copiar: "08/10/2026" });
    expect(campo(f, "Nota Fiscal")).toMatchObject({ valor: "2351", copiar: "2351" });
    expect(campo(f, "Cliente")).toMatchObject({ valor: "91 — QRTZ 39", copiar: "91", detalhe: "54.228.381/0001-90" });
    expect(campo(f, "Tipo de Nota")).toMatchObject({ valor: "12 — FAT LOCAÇÃO", fixo: true, copiar: null });
    expect(campo(f, "Classificação Fiscal")?.valor).toBe("11837 — OUTRAS");
    expect(campo(f, "Preço Unitário / Valor Item")).toMatchObject({ valor: "R$ 26.501,00", copiar: "26501,00" });
    expect(campo(f, "Vencimento e valor")).toMatchObject({ valor: "13/11/26 · R$ 26.501,00", copiar: "13/11/26", detalhe: "valor 26501,00" });
    expect(f.totalCentavos).toBe(2_650_100);
  });

  it("várias parcelas em ordem de vencimento; total = soma", () => {
    const f = montarFichaImplantacao(kit({ parcelas: [{ vencimento: "2026-12-13", valorCentavos: 500_00 }, { vencimento: "2026-11-13", valorCentavos: 400_00 }] }), CONFIG_IMPLANTACAO_PADRAO);
    expect(f.secoes.at(-1)!.campos.map((c) => c.rotulo + ": " + c.valor)).toEqual(["Parcela 1: 13/11/26 · R$ 400,00", "Parcela 2: 13/12/26 · R$ 500,00"]);
    expect(campo(f, "Valor Total (conferir)")?.copiar).toBe("900,00");
  });

  it("alertas: cliente não cadastrado, não conferido, sem CNPJ, sem emissão, sem parcelas", () => {
    expect(montarFichaImplantacao(kit({ clienteCodigoErp: null }), CONFIG_IMPLANTACAO_PADRAO).alertas)
      .toEqual(["Cliente não cadastrado no Consistem (54.228.381/0001-90): cadastrar antes de implantar."]);
    expect(montarFichaImplantacao(kit({ clienteCodigoErp: null, clienteConferido: false }), CONFIG_IMPLANTACAO_PADRAO).alertas[0])
      .toMatch(/ainda não conferido/);
    expect(montarFichaImplantacao(kit({ clienteCodigoErp: null, clienteConferido: false, clienteDocumento: null }), CONFIG_IMPLANTACAO_PADRAO).alertas[0])
      .toMatch(/Sem CNPJ/);
    const f = montarFichaImplantacao(kit({ emissao: null, parcelas: [] }), CONFIG_IMPLANTACAO_PADRAO);
    expect(f.alertas).toEqual(["Sem data de emissão: confira na nota.", "Sem vencimento e valor: confira na nota."]);
    expect(campo(f, "Cliente")?.copiar).toBe("91");
  });

  it("configuração: usa a do banco e completa o que faltar com o POP", () => {
    const c = lerConfigImplantacao({ classificacao_fiscal: "99999 — TESTE", tipo_nota: " " });
    expect(c.classificacao_fiscal).toBe("99999 — TESTE");
    expect(c.tipo_nota).toBe("12 — FAT LOCAÇÃO");
    expect(lerConfigImplantacao(null)).toEqual(CONFIG_IMPLANTACAO_PADRAO);
  });
});
