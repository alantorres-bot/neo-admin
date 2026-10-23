import { describe, expect, it } from "vitest";
import { EM_ANDAMENTO, ehStatus, ROTULO_STATUS, STATUS, tarefaAdiantamento } from "./intimacoes";

describe("etapas", () => {
  it("todas têm rótulo; concluída e descartada não estão em andamento", () => {
    for (const s of STATUS) expect(ROTULO_STATUS[s]).toBeTruthy();
    expect(EM_ANDAMENTO).not.toContain("concluida");
    expect(EM_ANDAMENTO).not.toContain("descartada");
    expect(ehStatus("adiantamento_pendente")).toBe(true);
    expect(ehStatus("adiantamento_lancado")).toBe(false);
    expect(ROTULO_STATUS.adiantamento_pendente).toMatch(/lançamento manual/);
  });
});

describe("tarefa do adiantamento manual", () => {
  const base = { cartorio: "CUIABÁ 04", valorCustas: 45.9, protocolo: "3090983", localizador: "bfdec11a-5ff7-4716-807a-13a6fd3ea893", numeroTitulo: "24827-2", credorNome: "MT CORTE E DOBRA LTDA", codLancamento: "5001" };

  it("usa o cadastro do cartório e o valor exato das custas", () => {
    const t = tarefaAdiantamento(base, { "CUIABÁ 04": { nome: "4º Ofício de Protesto de Títulos de Cuiabá/MT", codFornecedor: 1501 } });
    expect(t).toMatchObject({ fornecedorNome: "4º Ofício de Protesto de Títulos de Cuiabá/MT", codFornecedor: "1501", valorCustas: 45.9 });
    expect(t.referencia).toMatch(/^Custas de protesto — protocolo 3090983 · título 24827-2 · MT/);
    expect(tarefaAdiantamento({ ...base, protocolo: null }, {}).referencia).toMatch(/^Custas de protesto — localizador bfdec11a · título 24827-2/);
    expect(t.referencia.length).toBeLessThanOrEqual(60);
    expect(t.instrucao).toMatch(/tela do Consistem \(não pela API\)/);
  });

  it("sem cadastro: o nome da CENPROT e o código em aberto (nunca inventado)", () => {
    const t = tarefaAdiantamento({ ...base, protocolo: null }, { "CUIABÁ 04": { nome: "4º Ofício", codFornecedor: null } });
    expect(t.codFornecedor).toBeNull();
    expect(tarefaAdiantamento(base, {}).fornecedorNome).toBe("CUIABÁ 04");
  });
});
