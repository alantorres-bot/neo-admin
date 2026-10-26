import { describe, expect, it } from "vitest";
import { casarColaborador } from "./casar-colaborador";
import { acaoSugerida, horas, minutos, pendenciasDoFormulario } from "./modulo";

describe("horas e minutos", () => {
  it("ida e volta, com sinal", () => {
    expect(horas(130)).toBe("02:10");
    expect(horas(-848)).toBe("-14:08");
    expect(horas(null)).toBe("");
    expect(minutos("-14:08")).toBe(-848);
    expect(minutos("09:00")).toBe(540);
    expect(minutos("FALTA")).toBeNull();
  });
});

describe("acaoSugerida", () => {
  it("saída/atraso: banco quando o saldo cobre; parcial; sem saldo desconta", () => {
    expect(acaoSugerida("saida_atraso", 60, 86)).toMatch(/^Abater no banco/);
    expect(acaoSugerida("saida_atraso", 300, 60)).toMatch(/abater o saldo e descontar o restante/);
    expect(acaoSugerida("saida_atraso", 60, -848)).toMatch(/^Descontar/);
    expect(acaoSugerida("saida_atraso", 60, 0)).toMatch(/^Descontar/);
    expect(acaoSugerida("saida_atraso", 60, null)).toMatch(/se houver saldo/);
  });
  it("demais tipos", () => {
    expect(acaoSugerida("falta_injustificada", 540, 999)).toBe("Descontar");
    expect(acaoSugerida("esqueceu_bater", 300, null)).toMatch(/Incluir/);
    expect(acaoSugerida(null, 0, null)).toBe("");
  });
});

describe("pendenciasDoFormulario", () => {
  it("exige tipo, observação em todas e horário válido", () => {
    expect(pendenciasDoFormulario([
      { tipo: null, observacao: null, horario: null },
      { tipo: "outro", observacao: "  ", horario: null },
      { tipo: "esqueceu_bater", observacao: null, horario: "7:5" },
    ])).toEqual(["1 ocorrência(s) sem justificativa.", "2 ocorrência(s) sem observação: descreva o que aconteceu.", "1 horário(s) inválido(s) (use hh:mm)."]);
    expect(pendenciasDoFormulario([{ tipo: "esqueceu_bater", observacao: "esqueceu na saída", horario: "17:00" }, { tipo: "outro", observacao: "ok", horario: "" }])).toEqual([]);
  });
});

describe("casarColaborador", () => {
  const cadastro = [
    { id: "a", nome: "Fulano de Tal da Silva" }, { id: "b", nome: "Cauã Nascimento" }, { id: "c", nome: "JOSE SOUZA" }, { id: "d", nome: "JOSE PEREIRA SOUZA" },
  ];
  it("nome igual sem acento e caixa", () => {
    expect(casarColaborador("FULANO DE TAL DA SILVA", cadastro)).toBe("a");
    expect(casarColaborador("CAUA NASCIMENTO", cadastro)).toBe("b");
  });
  it("primeiro e último nome, só com um candidato", () => {
    expect(casarColaborador("CAUÃ DE NASCIMENTO", cadastro)).toBe("b");
    expect(casarColaborador("JOSE DA SOUZA", cadastro)).toBeNull();   // dois JOSE … SOUZA
    expect(casarColaborador("NINGUEM", cadastro)).toBeNull();
  });
});
