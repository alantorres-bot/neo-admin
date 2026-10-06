import { describe, expect, it } from "vitest";
import {
  descreverAtraso,
  descreverSincronizacao,
  ehFaixa,
  emCentavos,
  formatarMoeda,
  formatarValor,
  grupoDaSituacao,
  resumirCarteira,
  resumirPorGrupo,
  type LinhaResumo,
  type ResumoSincronizacao,
} from "./carteira";

const l = (faixa: string, valor: number | string, extra: Partial<LinhaResumo> = {}): LinhaResumo => ({
  faixa, valor, valor_atualizado: valor, contraparte_id: "c1", ...extra,
});

describe("emCentavos", () => {
  it("aceita número e texto do PostgREST sem erro de ponto flutuante", () => {
    expect(emCentavos(54000)).toBe(5_400_000);
    expect(emCentavos("18396.63")).toBe(1_839_663);
    expect(emCentavos(0.1 + 0.2)).toBe(30);
    expect(emCentavos(null)).toBe(0);
    expect(emCentavos("lixo")).toBe(0);
  });
});

describe("formatarMoeda", () => {
  it("usa R$ 1.234,56", () => {
    expect(formatarMoeda(123_456)).toBe("R$ 1.234,56");
    expect(formatarMoeda(0)).toBe("R$ 0,00");
    expect(formatarMoeda(2_599_057_023)).toBe("R$ 25.990.570,23");
    expect(formatarValor("3330000")).toBe("R$ 3.330.000,00");
  });
});

describe("resumirCarteira", () => {
  it("soma em centavos, separa vencido de a vencer e conta clientes distintos", () => {
    const r = resumirCarteira([
      l("a_vencer", 100.1, { contraparte_id: "a" }),
      l("a_vencer", 200.2, { contraparte_id: "b" }),
      l("01_15", 50, { contraparte_id: "a", valor_atualizado: 51.5 }),
      l("60_mais", 1000, { contraparte_id: "c", valor_atualizado: 1300 }),
    ]);
    expect(r.quantidade).toBe(4);
    expect(r.clientes).toBe(3);
    expect(r.totalCentavos).toBe(135_030);
    expect(r.atualizadoCentavos).toBe(10_010 + 20_020 + 5_150 + 130_000);
    expect(r.aVencer).toEqual({ quantidade: 2, centavos: 30_030 });
    expect(r.vencido).toEqual({ quantidade: 2, centavos: 105_000 });
    expect(r.porFaixa.map((f) => f.faixa)).toEqual(["a_vencer", "01_15", "16_30", "31_60", "60_mais"]);
    expect(r.porFaixa.find((f) => f.faixa === "16_30")).toMatchObject({ quantidade: 0, centavos: 0, percentual: 0 });
  });

  it("ignora encerrados e faixas desconhecidas", () => {
    const r = resumirCarteira([l("encerrado", 999), l("xyz", 5), l("a_vencer", 10)]);
    expect(r.quantidade).toBe(1);
    expect(r.totalCentavos).toBe(1000);
  });

  it("carteira vazia não divide por zero", () => {
    const r = resumirCarteira([]);
    expect(r).toMatchObject({ quantidade: 0, clientes: 0, totalCentavos: 0 });
    expect(r.porFaixa.every((f) => f.percentual === 0)).toBe(true);
  });

  it("percentuais por faixa somam a participação de cada uma", () => {
    const r = resumirCarteira([l("a_vencer", 75), l("01_15", 25)]);
    expect(r.porFaixa[0].percentual).toBe(75);
    expect(r.porFaixa[1].percentual).toBe(25);
  });
});

describe("ehFaixa e descreverAtraso", () => {
  it("reconhece só faixas abertas", () => {
    expect(ehFaixa("31_60")).toBe(true);
    expect(ehFaixa("encerrado")).toBe(false);
  });
  it("descreve atraso em dias", () => {
    expect(descreverAtraso(0)).toBe("A vencer");
    expect(descreverAtraso(1)).toBe("1 dia");
    expect(descreverAtraso(45)).toBe("45 dias");
  });
});

describe("descreverSincronizacao", () => {
  const base: ResumoSincronizacao = {
    empresa: "NEO FORMAS", titulosNaApi: 158, novos: 158, alterados: 0, inalterados: 0, possiveisBaixas: 0, divergentes: 0, recusados: 0, simulacao: false,
  };
  it("resultado limpo", () => {
    const t = descreverSincronizacao({ ...base, contrapartesNovas: 73 });
    expect(t[0]).toContain("Sincronização concluída");
    expect(t[1]).toBe("Novos: 158 · Alterados: 0 · Sem mudança: 0");
    expect(t[2]).toContain("Clientes criados: 73");
    expect(t).toHaveLength(3);
  });
  it("simulação deixa claro que nada foi gravado e usa o condicional", () => {
    const t = descreverSincronizacao({ ...base, simulacao: true, possiveisBaixas: 2 });
    expect(t[0]).toContain("nada foi gravado");
    expect(t.join(" ")).toContain("viraria pendência");
    expect(t.join(" ")).toContain("Nenhuma baixa é dada automaticamente");
  });
  it("singular e plural", () => {
    expect(descreverSincronizacao({ ...base, titulosNaApi: 1, recusados: 1 }).join(" ")).toContain("1 título em aberto");
    expect(descreverSincronizacao({ ...base, recusados: 2 }).join(" ")).toContain("2 registros recusados");
  });
  it("avisa divergências, repetidos e pendências canceladas", () => {
    const t = descreverSincronizacao({ ...base, divergentes: 3, duplicadosNaApi: 1, pendenciasCanceladas: 1 }).join(" ");
    expect(t).toContain("3 títulos encerrados aqui");
    expect(t).toContain("1 título repetido");
    expect(t).toContain("1 pendência de baixa cancelada");
  });
});

describe("grupoDaSituacao", () => {
  const g = (estagio: string, faixa: string, extra: { cedido?: boolean; contestado?: boolean } = {}) => grupoDaSituacao({ estagio, faixa, ...extra });
  it("a vencer: cada estágio no seu grupo", () => {
    expect(g("aguardando_boleto", "a_vencer")).toBe("aguardando_boleto");
    expect(g("boleto_enviado", "a_vencer")).toBe("boleto_enviado");
    expect(g("confirmado_cliente", "a_vencer")).toBe("confirmado");
    expect(g("importado", "a_vencer")).toBe("sem_acao");
  });
  it("passou do vencimento: vencido, qualquer que seja o estágio de envio ou confirmação", () => {
    for (const e of ["importado", "boleto_enviado", "confirmado_cliente", "vencido"]) expect(g(e, "01_15")).toBe("vencido");
    expect(g("vencido", "60_mais")).toBe("vencido");
  });
  it("aguardando boleto fica na própria aba mesmo vencido (a ação é anexar o boleto)", () => {
    expect(g("aguardando_boleto", "16_30")).toBe("aguardando_boleto");
  });
  it("promessa e especiais têm precedência", () => {
    expect(g("promessa", "01_15")).toBe("promessa");
    expect(g("vencido", "01_15", { contestado: true })).toBe("especial");
    expect(g("boleto_enviado", "a_vencer", { cedido: true })).toBe("especial");
    expect(g("em_renegociacao", "31_60")).toBe("especial");
    expect(g("juridico", "60_mais")).toBe("especial");
    expect(g("promessa", "01_15", { contestado: true })).toBe("especial");
  });
});

describe("resumirPorGrupo", () => {
  it("soma quantidade e valor por situação e ignora o que não é aberto", () => {
    const r = resumirPorGrupo([
      l("a_vencer", 1000, { estagio: "boleto_enviado" }),
      l("a_vencer", 500, { estagio: "boleto_enviado" }),
      l("01_15", 200, { estagio: "vencido" }),
      l("a_vencer", 50, { estagio: "importado", cedido: true }),
      l("encerrado", 99, { estagio: "pago" }),
      l("a_vencer", 7), // sem estágio: ignorado
    ]);
    const por = Object.fromEntries(r.map((x) => [x.grupo, [x.quantidade, x.centavos]]));
    expect(por.boleto_enviado).toEqual([2, 150_000]);
    expect(por.vencido).toEqual([1, 20_000]);
    expect(por.especial).toEqual([1, 5_000]);
    expect(por.confirmado).toEqual([0, 0]);
    expect(r.reduce((s, x) => s + x.quantidade, 0)).toBe(4);
  });
});
