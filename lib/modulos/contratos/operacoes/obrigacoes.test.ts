import { describe, expect, it } from "vitest";
import { planejarObrigacoes, situacaoDependencias, validarModelo, type ItemModelo } from "./obrigacoes";

const CAMPOS = ["tem_projeto", "banco"];
const item = (id: string, tipo: string, extra: Partial<ItemModelo> = {}): ItemModelo => ({
  id, tipo, descricao: id, condicao: null, dependencias: [], travaFaturamento: false, ...extra,
});
const projeto = item("projeto", "aprovar_projeto", { condicao: { todas: [{ campo: "tem_projeto", op: "=", valor: true }] } });

describe("planejarObrigacoes", () => {
  it("sem itens (ex.: avulsa) não cria nada", () => {
    expect(planejarObrigacoes([], {}, CAMPOS, [])).toEqual({ acoes: [], informarCondicao: [] });
  });

  it("entrega futura com e sem a condição", () => {
    const itens = [item("assinar", "obter_assinaturas"), projeto];
    expect(planejarObrigacoes(itens, { tem_projeto: true }, CAMPOS, []).acoes.map((a) => a.acao)).toEqual(["criar", "criar"]);
    expect(planejarObrigacoes(itens, { tem_projeto: false }, CAMPOS, []).acoes.map((a) => a.acao)).toEqual(["criar", "nenhuma"]);
  });

  it("condição desconhecida pede informar_condicao e o item espera, sem repetir campo já pedido", () => {
    const p = planejarObrigacoes([projeto], {}, CAMPOS, []);
    expect(p.acoes).toEqual([{ acao: "aguardar_condicao", itemId: "projeto", campos: ["tem_projeto"] }]);
    expect(p.informarCondicao).toEqual(["tem_projeto"]);
    expect(planejarObrigacoes([projeto], {}, CAMPOS, [], ["tem_projeto"]).informarCondicao).toEqual([]);
  });

  it("condição muda de verdadeiro para falso: cancela a aberta com motivo", () => {
    const p = planejarObrigacoes([projeto], { tem_projeto: false }, CAMPOS, [{ itemId: "projeto", situacao: "aberta" }]);
    expect(p.acoes).toEqual([{ acao: "cancelar", itemId: "projeto", motivo: "deixou de se aplicar: projeto" }]);
  });

  it("concluída não é desfeita; bloqueada que deixa de valer fica sem regra (AF-16)", () => {
    expect(planejarObrigacoes([projeto], { tem_projeto: false }, CAMPOS, [{ itemId: "projeto", situacao: "concluida" }]).acoes[0].acao).toBe("manter");
    expect(planejarObrigacoes([projeto], { tem_projeto: false }, CAMPOS, [{ itemId: "projeto", situacao: "bloqueada" }]).acoes[0].acao).toBe("sem_regra");
  });

  it("item cancelado que volta a valer não é recriado: reativação sem regra aprovada", () => {
    const p = planejarObrigacoes([projeto], { tem_projeto: true }, CAMPOS, [{ itemId: "projeto", situacao: "cancelada" }]);
    expect(p.acoes[0].acao).toBe("sem_regra");
  });
});

describe("situacaoDependencias", () => {
  it("abre só quando todas se resolvem; dispensa conta como resolvida", () => {
    expect(situacaoDependencias(["concluida", "dispensada"])).toBe("resolvidas");
    expect(situacaoDependencias(["concluida", "aberta"])).toBe("pendentes");
    expect(situacaoDependencias([])).toBe("resolvidas");
  });
  it("dependência cancelada não tem regra aprovada", () => {
    expect(situacaoDependencias(["concluida", "cancelada"])).toBe("sem_regra");
  });
});

describe("validarModelo", () => {
  const ATIVOS = ["obter_assinaturas", "aguardar_autorizacao_bancaria", "aprovar_projeto"];
  const assinar = item("assinar", "obter_assinaturas");
  const autorizacao = item("autorizacao", "aguardar_autorizacao_bancaria", { travaFaturamento: true });

  it("financiamento completo passa", () => {
    expect(validarModelo("financiamento", [assinar, autorizacao], ATIVOS)).toEqual([]);
  });
  it("financiamento sem assinaturas sem condição é recusado", () => {
    const condicionado = { ...assinar, condicao: { todas: [{ campo: "banco", op: "informado" as const }] } };
    expect(validarModelo("financiamento", [condicionado, autorizacao], ATIVOS)).toHaveLength(1);
  });
  it("autorização sem trava ou condicionada é recusada", () => {
    expect(validarModelo("financiamento", [assinar, { ...autorizacao, travaFaturamento: false }], ATIVOS)).toHaveLength(1);
    const cond = { ...autorizacao, condicao: { todas: [{ campo: "banco", op: "informado" as const }] } };
    expect(validarModelo("financiamento", [assinar, cond], ATIVOS)).toHaveLength(1);
  });
  it("modalidade que exige contrato sem assinaturas é recusada; avulsa não exige", () => {
    expect(validarModelo("locacao", [], ATIVOS)).toHaveLength(1);
    expect(validarModelo("avulsa", [], ATIVOS)).toEqual([]);
  });
  it("ciclo e tipo inativo são recusados", () => {
    const a = item("a", "obter_assinaturas", { dependencias: ["b"] });
    const b = item("b", "aprovar_projeto", { dependencias: ["a"] });
    expect(validarModelo("entrega_futura", [a, b], ATIVOS)).toContain("Há ciclo nas dependências do modelo.");
    expect(validarModelo("entrega_futura", [assinar, item("x", "tipo_velho")], ATIVOS)).toHaveLength(1);
  });
});
