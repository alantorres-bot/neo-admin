import { describe, expect, it } from "vitest";
import { checklistFechamento, diasAte, etapaAtual, percentuais, rotuloEmpresa, saudacao, variacao, type SituacaoFechamento } from "./painel";

describe("Painel do RH", () => {
  it("saudação pela hora de Cuiabá", () => {
    expect([saudacao(6), saudacao(11), saudacao(12), saudacao(17), saudacao(18), saudacao(23)]).toEqual(["Bom dia", "Bom dia", "Boa tarde", "Boa tarde", "Boa noite", "Boa noite"]);
  });

  it("dias até o pagamento: 15/10 → 06/11 = 22 dias", () => {
    expect(diasAte("2026-10-15", "2026-11-06")).toBe(22);
    expect(diasAte("2026-10-15", "2026-10-07")).toBe(-8);
  });

  it("variação de setembro sobre agosto/2026: +9,3%", () => {
    expect(variacao(24542586, 22452159)).toBe(9.3);
    expect(variacao(100, 0)).toBeNull();
    expect(variacao(100, null)).toBeNull();
  });

  it("composição de setembro/2026 soma 100%", () => {
    const p = percentuais({ salarios: 21098853, decimo: 167276, avulso: 3276457 });
    expect(p).toEqual({ salarios: 85.9, decimo: 0.7, avulso: 13.4 });
    expect(percentuais({ salarios: 0, decimo: 0, avulso: 0 })).toEqual({ salarios: 0, decimo: 0, avulso: 0 });
  });

  it("empresa e etapa", () => {
    expect(rotuloEmpresa("NEO SERVIÇOS")).toBe("Neo Serviços");
    expect(etapaAtual("aberta")).toBe(0);
    expect(etapaAtual("paga")).toBe(3);
  });

  const base: SituacaoFechamento = { empresas: ["NEO SERVIÇOS", "OESTE"], empresasComLiquido: [], modelosAtivos: 5, recorrentesGerados: 0, decimoLancado: false, status: "aberta" };

  it("checklist de um mês recém-aberto (outubro/2026)", () => {
    expect(checklistFechamento(base).map((i) => [i.estado, i.status])).toEqual([
      ["feito", "Feito"], ["pendente", "Pendente"], ["pendente", "Pendente"], ["aguardando", "Aguardando escritório"], ["depois", "Depois"],
    ]);
    expect(checklistFechamento(base)[1].texto).toBe("Recibos recorrentes (0 de 5 gerados)");
    expect(checklistFechamento(base)[2].texto).toBe("Líquidos do escritório — Neo Serviços e Oeste");
  });

  it("checklist com uma empresa importada, recorrentes gerados e 13º", () => {
    const l = checklistFechamento({ ...base, empresasComLiquido: ["NEO SERVIÇOS"], recorrentesGerados: 5, decimoLancado: true });
    expect(l[1]).toMatchObject({ estado: "feito", texto: "Recibos recorrentes (5)" });
    expect(l[2]).toMatchObject({ estado: "pendente", status: "Falta Oeste" });
    expect(l[3]).toMatchObject({ estado: "feito", status: "Lançado" });
  });

  it("checklist de folha conferida: 13º ausente não é pendência; falta a aprovação", () => {
    const l = checklistFechamento({ ...base, empresasComLiquido: base.empresas, recorrentesGerados: 5, status: "conferida" });
    expect(l.map((i) => i.estado)).toEqual(["feito", "feito", "feito", "feito", "pendente"]);
    expect(l[4].status).toBe("Aguardando aprovação");
  });
});
