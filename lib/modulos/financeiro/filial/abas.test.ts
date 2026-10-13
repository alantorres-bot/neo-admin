import { describe, expect, it } from "vitest";
import { ABA_INICIAL_FILIAL, abasFilial, explicacaoDaEtapa } from "./abas";

describe("abas do Faturamento Filial", () => {
  it("ordem do fluxo: remessa, implantação, boleto, envio ao cliente, enviadas", () => {
    expect(abasFilial().map((a) => a.rotulo)).toEqual(["Remessas", "A implantar", "Boletos a anexar", "A enviar ao cliente", "Enviadas"]);
    expect(ABA_INICIAL_FILIAL).toBe("/financeiro/filial/remessas");
  });
  it("a filial vê as etapas de Cuiabá pelo lado dela (mesmas rotas)", () => {
    const filial = abasFilial(true);
    expect(filial.map((a) => a.rotulo)).toEqual(["Remessas", "Em implantação", "Boletos a receber", "A enviar ao cliente", "Enviadas"]);
    expect(filial.map((a) => a.href)).toEqual(abasFilial().map((a) => a.href));
  });
  it("explicação da etapa conforme quem vê", () => {
    expect(explicacaoDaEtapa("implantada", true)).toMatch(/Cuiabá está anexando/);
    expect(explicacaoDaEtapa("implantada")).toMatch(/esperando o boleto/);
  });
});
