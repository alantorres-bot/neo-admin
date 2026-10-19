import { describe, expect, it } from "vitest";
import {
  composicaoDaGravada,
  composicaoPadrao,
  composicaoParaBanco,
  comporCaixa,
  lerComposicaoGravada,
  parseSaldo,
  rotuloConta,
  validarAdicional,
  type ContaCaixa,
} from "./caixa";

const HOJE = "2026-10-19";
const conta = (id: string, saldoCentavos: number | null, dataSaldo: string | null, entraNoCaixa = true): ContaCaixa => ({
  id, descricao: `Conta ${id}`, banco: "748", agencia: "0802", conta: `${id}-0`, entraNoCaixa, saldoCentavos, dataSaldo,
});

describe("saldo digitado", () => {
  it("aceita formatos pt-BR, en e negativo", () => {
    expect(parseSaldo("1.234,56")).toBe(123456);
    expect(parseSaldo("R$ 50.000")).toBe(5_000_000);
    expect(parseSaldo("1234.5")).toBe(123450);
    expect(parseSaldo("-2.000,10")).toBe(-200010);
    expect(parseSaldo("(15,00)")).toBe(-1500);
    expect(parseSaldo("0")).toBe(0);
  });
  it("recusa vazio e texto", () => {
    expect(parseSaldo("")).toBeNull();
    expect(parseSaldo("abc")).toBeNull();
    expect(parseSaldo("1,2,3")).toBeNull();
  });
});

describe("adicionais", () => {
  it("exige descrição e valor positivo", () => {
    expect(validarAdicional({ descricao: "Depósito cliente X", valorCentavos: 100 })).toBeNull();
    expect(validarAdicional({ descricao: "ab", valorCentavos: 100 })).toMatch(/Descreva/);
    expect(validarAdicional({ descricao: "Depósito", valorCentavos: 0 })).toMatch(/Valor inválido/);
    expect(validarAdicional({ descricao: "Depósito", valorCentavos: null })).toMatch(/Valor inválido/);
  });
});

describe("composição do caixa", () => {
  const contas = [conta("a", 1_000_00, HOJE), conta("b", -200_00, "2026-10-16"), conta("c", null, null), conta("d", 5_000_00, HOJE, false)];

  it("padrão: só as contas que entram no caixa", () => {
    expect(composicaoPadrao(contas)).toEqual({ contas: ["a", "b", "c"], adicionais: [] });
  });

  it("soma saldos (inclusive negativo) e adicionais; avisa saldo antigo e conta sem saldo", () => {
    const r = comporCaixa(contas, { contas: ["a", "b", "c"], adicionais: [{ descricao: "Depósito previsto", valorCentavos: 300_00 }] }, HOJE);
    expect(r.saldosCentavos).toBe(800_00);
    expect(r.adicionaisCentavos).toBe(300_00);
    expect(r.totalCentavos).toBe(1_100_00);
    expect(r.linhas.map((l) => l.contaId)).toEqual(["a", "b", "c"]);
    expect(r.avisos).toEqual(["Conta b: saldo de 16/10, não de hoje.", "Conta c: sem saldo registrado (conta como R$ 0,00)."]);
  });

  it("conta desmarcada fica de fora", () => {
    expect(comporCaixa(contas, { contas: ["d"], adicionais: [] }, HOJE)).toMatchObject({ totalCentavos: 5_000_00, avisos: [] });
    expect(comporCaixa(contas, { contas: [], adicionais: [] }, HOJE).totalCentavos).toBe(0);
  });

  it("rótulo da conta", () => {
    expect(rotuloConta(conta("a", 0, HOJE))).toBe("Conta a · ag. 0802 · c/c a-0");
    expect(rotuloConta({ descricao: "Caixa", agencia: "", conta: "" })).toBe("Caixa");
  });
});

describe("composição gravada", () => {
  const gravada = [
    { tipo: "saldo", conta_id: "a", descricao: "Conta a", data_saldo: HOJE, valor: 1000 },
    { tipo: "saldo", conta_id: "b", descricao: "Conta b", data_saldo: "2026-10-16", valor: "-200.00" },
    { tipo: "adicional", conta_id: null, descricao: "Depósito previsto", data_saldo: null, valor: 300.1 },
    { tipo: "outro", valor: 1 },
  ];
  it("lê as linhas em centavos", () => {
    expect(lerComposicaoGravada(gravada)).toEqual([
      { tipo: "saldo", descricao: "Conta a", dataSaldo: HOJE, valorCentavos: 100000 },
      { tipo: "saldo", descricao: "Conta b", dataSaldo: "2026-10-16", valorCentavos: -20000 },
      { tipo: "adicional", descricao: "Depósito previsto", dataSaldo: null, valorCentavos: 30010 },
    ]);
    expect(lerComposicaoGravada(null)).toEqual([]);
  });
  it("reabre no diálogo e volta para o banco em reais", () => {
    const c = composicaoDaGravada(gravada)!;
    expect(c).toEqual({ contas: ["a", "b"], adicionais: [{ descricao: "Depósito previsto", valorCentavos: 30010 }] });
    expect(composicaoParaBanco(c)).toEqual({ contas: ["a", "b"], adicionais: [{ descricao: "Depósito previsto", valor: 300.1 }] });
    expect(composicaoDaGravada([])).toBeNull();
  });
});
