import { describe, expect, it } from "vitest";
import { lerBancoHoras } from "./leitor-csv";
import { creditosEmAberto, fimDoCiclo, inicioDoCiclo, situacao, vencimentoDoCredito } from "./modulo";

describe("ciclo de 26 a 25", () => {
  it("fim do ciclo", () => {
    expect(fimDoCiclo("2026-05-10")).toBe("2026-05-25");
    expect(fimDoCiclo("2026-05-25")).toBe("2026-05-25");
    expect(fimDoCiclo("2026-05-26")).toBe("2026-06-25");
    expect(fimDoCiclo("2026-12-30")).toBe("2027-01-25");
    expect(inicioDoCiclo("2026-05-25")).toBe("2026-04-26");
    expect(inicioDoCiclo("2027-01-25")).toBe("2026-12-26");
  });
  it("vencimento = fim do ciclo de origem + 6 meses (decisão de 21/10/2026: 10/05 → 25/11)", () => {
    expect(vencimentoDoCredito("2026-05-10", 6)).toBe("2026-11-25");
    expect(vencimentoDoCredito("2026-04-26", 6)).toBe("2026-11-25");
    expect(vencimentoDoCredito("2026-05-26", 6)).toBe("2026-12-25");
    expect(vencimentoDoCredito("2026-08-20", 6)).toBe("2027-02-25");
  });
});

describe("créditos em aberto (o mais antigo primeiro)", () => {
  const movs = [
    { data: "2026-04-10", positivoMin: 600, negativoMin: 0 },   // antes do início: ignorado
    { data: "2026-05-10", positivoMin: 120, negativoMin: 0 },
    { data: "2026-06-10", positivoMin: 60, negativoMin: 0 },
    { data: "2026-07-01", positivoMin: 0, negativoMin: 90 },    // consome os 120 de maio primeiro
  ];
  it("débito consome o crédito mais antigo; saldo ignora o que veio antes do início", () => {
    const r = creditosEmAberto(movs, 0, "2026-04-26", 6);
    expect(r.saldoMin).toBe(90);
    expect(r.creditos.map((c) => [c.data, c.restanteMin, c.vencimento])).toEqual([["2026-05-10", 30, "2026-11-25"], ["2026-06-10", 60, "2026-12-25"]]);
  });
  it("vencido, vencendo e pagamento na folha", () => {
    const r = creditosEmAberto(movs, 0, "2026-04-26", 6);
    expect(situacao(r.creditos, "2026-11-26", 30)).toEqual({ vencidoMin: 30, vencendoMin: 60, proximoVencimento: "2026-12-25" });
    expect(situacao(r.creditos, "2026-11-01", 30)).toEqual({ vencidoMin: 0, vencendoMin: 30, proximoVencimento: "2026-11-25" });
    const pago = creditosEmAberto(movs, 30, "2026-04-26", 6);   // pagos os 30 vencidos de maio
    expect(pago.saldoMin).toBe(60);
    expect(situacao(pago.creditos, "2026-11-26", 30).vencidoMin).toBe(0);
  });
  it("saldo negativo: nenhum crédito em aberto", () => {
    const r = creditosEmAberto([{ data: "2026-05-01", positivoMin: 30, negativoMin: 0 }, { data: "2026-05-02", positivoMin: 0, negativoMin: 100 }], 0, "2026-04-26", 6);
    expect(r.saldoMin).toBe(-70);
    expect(r.creditos[0].restanteMin).toBe(0);
  });
});

describe("lerBancoHoras", () => {
  const CAB = ["﻿Id", "Nome", "CPF", "PIS", "Data", "Banco Negativo", "Banco Positivo", "Saldo Banco", "Total Compensado", "A Compensar", "Descontar Folha", "Pagar Folha", "Detalhes"];
  const l = (id: string, nome: string, cpf: string, data: string, neg: string, pos: string, saldo: string) => [id, nome, cpf, "12345678901", data, neg, pos, saldo, "", neg || pos, "", "", ""];
  it("agrupa por CPF, guarda só os dias com movimento e o último saldo; período", () => {
    const r = lerBancoHoras([
      CAB,
      l("2", "FULANO", "11122233344", "22/09/2026", "", "", "00:39"),
      l("2", "FULANO", "11122233344", "07/10/2026", "", "00:12", "00:51"),
      l("4", "BELTRANO", "55566677788", "22/09/2026", "", "", "-14:08"),
      l("4", "BELTRANO", "55566677788", "23/09/2026", "05:01", "", "-19:09"),
      l("9", "SEM BANCO", "99988877766", "23/09/2026", "", "", ""),
      [],
    ]);
    expect(r.avisos).toEqual([]);
    expect([r.inicio, r.fim, r.linhas]).toEqual(["2026-09-22", "2026-10-07", 5]);
    expect(r.pessoas).toEqual([
      { idControlId: "2", nome: "FULANO", cpf: "11122233344", movimentos: [{ data: "2026-10-07", positivoMin: 12, negativoMin: 0 }], saldoControlIdMin: 51, saldoEm: "2026-10-07" },
      { idControlId: "4", nome: "BELTRANO", cpf: "55566677788", movimentos: [{ data: "2026-09-23", positivoMin: 0, negativoMin: 301 }], saldoControlIdMin: -1149, saldoEm: "2026-09-23" },
      { idControlId: "9", nome: "SEM BANCO", cpf: "99988877766", movimentos: [], saldoControlIdMin: null, saldoEm: "2026-09-23" },
    ]);
  });
  it("avisa saldo que não bate e recusa outro CSV", () => {
    expect(lerBancoHoras([CAB, l("2", "X", "11122233344", "01/10/2026", "", "", "01:00"), l("2", "X", "11122233344", "02/10/2026", "", "00:10", "02:00")]).avisos[0]).toMatch(/não bate/);
    expect(lerBancoHoras([["a", "b"], ["1", "2"]]).avisos[0]).toMatch(/faltam as colunas/);
  });
});

describe("departamentos do cadastro do Control iD", () => {
  it("lê só CPF e Departamento e casa com o setor pelo nome sem acento", async () => {
    const { lerDepartamentos, setoresPorDepartamento } = await import("./departamentos");
    const r = lerDepartamentos([
      ["﻿id_funcionario", "CPF", "PIS", "Nome", "Senha para Uso no REP", "Departamento"],
      ["1", "111.222.333-44", "x", "A", "1234", "FABRICA"],
      ["2", "55566677788", "x", "B", "", "ESCRITÓRIO"],
      ["3", "99988877766", "x", "C", "", ""],
    ]);
    expect(r).toEqual({ itens: [{ cpf: "11122233344", departamento: "FABRICA" }, { cpf: "55566677788", departamento: "ESCRITÓRIO" }], erro: null });
    expect(setoresPorDepartamento(r.itens, [{ id: "s1", nome: "Fábrica" }, { id: "s2", nome: "Escritorio" }])).toEqual({ casados: [{ cpf: "11122233344", setor: "s1" }, { cpf: "55566677788", setor: "s2" }], semSetor: [] });
    expect(setoresPorDepartamento(r.itens, [{ id: "s1", nome: "FABRICA" }]).semSetor).toEqual(["ESCRITÓRIO"]);
    expect(lerDepartamentos([["Nome"], ["x"]]).erro).toMatch(/faltam/);
  });
});
