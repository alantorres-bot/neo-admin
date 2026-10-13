import { describe, expect, it } from "vitest";
import { abaInicialDaFilial, ABAS_FILIAL } from "./abas";

describe("abas do Faturamento Filial", () => {
  it("abre na primeira etapa com pendência", () => {
    expect(abaInicialDaFilial({ recebida: 2, implantada: 5 })).toBe("/financeiro/filial/a-implantar");
    expect(abaInicialDaFilial({ recebida: 0, implantada: 5, pronta: 1 })).toBe("/financeiro/filial/boletos-a-anexar");
    expect(abaInicialDaFilial({ pronta: 1, enviada: 40 })).toBe("/financeiro/filial/a-enviar");
  });
  it("sem pendência, abre em 'A enviar ao cliente' (enviadas não contam como pendência)", () => {
    expect(abaInicialDaFilial({ enviada: 10 })).toBe("/financeiro/filial/a-enviar");
    expect(abaInicialDaFilial({})).toBe("/financeiro/filial/a-enviar");
  });
  it("ordem do trabalho", () => {
    expect(ABAS_FILIAL.map((a) => a.rotulo)).toEqual(["A implantar", "Boletos a anexar", "A enviar ao cliente", "Enviadas", "Remessas"]);
  });
});
