import { describe, expect, it } from "vitest";
import { resumirAno, type FechamentoResumo, type LinhaResumo } from "./resumo";

const f = (id: string, competencia: string, o: Partial<FechamentoResumo> = {}): FechamentoResumo => ({ id, competencia, status: "fechado", historico: true, fechado_em: null, ...o });
const l = (fechamento_id: string, cod: string, origem: string, valor: number, incluida = true): LinhaResumo => ({ fechamento_id, cod_representante: cod, origem, incluida, valor_comissao: valor });

describe("resumo do ano (painel e extrato)", () => {
  it("comissão − antecipações por mês e representante; excluídas e outro ano ficam fora", () => {
    // Heitor de agosto e setembro/2026 como nas planilhas: 1.540 − 1.540 e 4.240 − 1.540.
    const r = resumirAno(
      [f("ago", "2026-08-01"), f("set", "2026-09-01", { status: "em_conferencia", historico: false }), f("dez25", "2025-12-01")],
      [
        l("ago", "7", "titulo", 1540), l("ago", "7", "antecipacao", 1540),
        l("set", "7", "titulo", 1540), l("set", "7", "titulo", 1360), l("set", "7", "credito", 1340), l("set", "7", "antecipacao", 1540),
        l("set", "7", "titulo", 1470, false), l("set", "3", "manual", 27450),
        l("dez25", "7", "titulo", 999),
      ],
      2026,
    );
    expect(r.meses.map((m) => m.fechamento.id)).toEqual(["set", "ago"]);
    expect(r.meses[0].porRepresentante["7"]).toEqual({ total: 424_000, antecipado: 154_000, saldo: 270_000 });
    expect(r.meses[1].porRepresentante["7"]).toEqual({ total: 154_000, antecipado: 154_000, saldo: 0 });
    expect(r.porRepresentante["7"]).toEqual({ total: 578_000, antecipado: 308_000, saldo: 270_000 });
    expect(r.total).toEqual({ total: 578_000 + 2_745_000, antecipado: 308_000, saldo: 270_000 + 2_745_000 });
  });
  it("mês sem linhas aparece zerado", () => {
    const r = resumirAno([f("out", "2026-10-01", { status: "em_conferencia", historico: false })], [], 2026);
    expect(r.meses[0].total).toEqual({ total: 0, antecipado: 0, saldo: 0 });
  });
});
