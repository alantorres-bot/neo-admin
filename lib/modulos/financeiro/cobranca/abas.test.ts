import { describe, expect, it } from "vitest";
import { FILAS, type Fila } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { ABAS_COBRANCA, abaInicialDaCobranca, contagemDasAbas } from "@/app/(plataforma)/financeiro/cobranca/abas";

const zeradas = Object.fromEntries(FILAS.map((f) => [f, 0])) as Record<Fila, number>;

describe("abas da Cobrança", () => {
  it("soma as filas de cada aba (A enviar junta boletos e dados de pagamento)", () => {
    const porAba = contagemDasAbas({ ...zeradas, anexar: 3, enviar: 2, dados: 1, cobrar: 4 });
    expect(porAba["/financeiro/cobranca/anexar"]).toBe(3);
    expect(porAba["/financeiro/cobranca/enviar"]).toBe(3);
    expect(porAba["/financeiro/cobranca/cobrar"]).toBe(4);
    expect(porAba["/financeiro/cobranca/confirmar"]).toBe(0);
    expect(porAba["/financeiro/cobranca/regra"]).toBe(0);
  });

  it("abre na primeira aba com itens, na ordem do trabalho", () => {
    expect(abaInicialDaCobranca({ ...zeradas, confirmar: 1, cobrar: 9 })).toBe("/financeiro/cobranca/confirmar");
    expect(abaInicialDaCobranca({ ...zeradas, dados: 2 })).toBe("/financeiro/cobranca/enviar");
    expect(abaInicialDaCobranca({ ...zeradas, baixa: 1 })).toBe("/financeiro/cobranca/baixas");
  });

  it("sem nada pendente, abre na primeira aba", () => {
    expect(abaInicialDaCobranca(zeradas)).toBe(ABAS_COBRANCA[0].href);
  });

  it("toda fila de trabalho (menos 'contato', que é cadastro em Recebíveis) pertence a uma aba", () => {
    const cobertas = new Set(ABAS_COBRANCA.flatMap((a) => a.filas));
    expect(FILAS.filter((f) => f !== "contato" && !cobertas.has(f))).toEqual([]);
  });
});
