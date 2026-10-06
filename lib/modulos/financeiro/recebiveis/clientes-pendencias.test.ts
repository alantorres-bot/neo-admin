import { describe, expect, it } from "vitest";
import {
  criticidadeCadastro, descricaoPendenciaContato, planejarCadastro, tituloPendenciaCadastro, tituloPendenciaContato, type ClienteParaCadastro,
} from "../../../../supabase/functions/_shared/clientes";

const HOJE = "2026-10-06";
const c = (id: string, extra: Partial<ClienteParaCadastro> = {}): ClienteParaCadastro => ({
  id, nome: `Cliente ${id}`, documento: "12.345.678/0001-90", temContato: false,
  titulos: [{ documento: "1001", parcela: "1", vencimento: "2026-10-20", valorCentavos: 1_000_000 }], ...extra,
});

describe("planejarCadastro", () => {
  it("separa quem não tem contato e quem não tem documento; ignora quem não tem título no escopo", () => {
    const plano = planejarCadastro([
      c("a"),
      c("b", { temContato: true, documento: null }),
      c("c", { temContato: true }),
      c("d", { titulos: [] }),
    ]);
    expect(plano.semContato.map((x) => x.id)).toEqual(["a"]);
    expect(plano.semDocumento.map((x) => x.id)).toEqual(["b"]);
  });

  it("o mais urgente (menor vencimento) vem primeiro", () => {
    const plano = planejarCadastro([
      c("tarde", { titulos: [{ documento: "2", parcela: "1", vencimento: "2026-12-01", valorCentavos: 100 }] }),
      c("cedo", { titulos: [{ documento: "1", parcela: "1", vencimento: "2026-10-02", valorCentavos: 100 }] }),
    ]);
    expect(plano.semContato.map((x) => x.id)).toEqual(["cedo", "tarde"]);
  });
});

describe("textos e criticidade", () => {
  it("título único por cliente", () => {
    expect(tituloPendenciaContato("Alfa Ltda")).toBe("Cadastrar contato: Alfa Ltda");
    expect(tituloPendenciaCadastro("  ")).toBe("Conferir cadastro: cliente");
  });
  it("alta quando há título vencido ou vencendo em até 7 dias; normal quando todos estão longe", () => {
    expect(criticidadeCadastro(c("x", { titulos: [{ documento: "1", parcela: "1", vencimento: "2026-10-01", valorCentavos: 1 }] }), HOJE)).toBe("alta");
    expect(criticidadeCadastro(c("x", { titulos: [{ documento: "1", parcela: "1", vencimento: "2026-10-13", valorCentavos: 1 }] }), HOJE)).toBe("alta");
    expect(criticidadeCadastro(c("x", { titulos: [{ documento: "1", parcela: "1", vencimento: "2026-10-14", valorCentavos: 1 }] }), HOJE)).toBe("normal");
  });
  it("a descrição lista os títulos (até 5), o total e o que fazer", () => {
    const muitos = Array.from({ length: 7 }, (_, i) => ({ documento: `D${i}`, parcela: i === 0 ? "2" : "1", vencimento: `2026-10-${10 + i}`, valorCentavos: 100_000 }));
    const d = descricaoPendenciaContato(c("x", { titulos: muitos }));
    expect(d).toContain("7 títulos em aberto, total R$ 7.000,00");
    expect(d).toContain("• D0/2 — vence 10/10/2026 — R$ 1.000,00");
    expect(d).toContain("… e mais 2.");
    expect(d).toContain("a pendência se conclui sozinha");
  });
});
