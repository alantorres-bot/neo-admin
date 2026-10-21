import { describe, expect, it } from "vitest";
import { lerBancoHoras } from "./leitor-csv";
import { emAberto, fimDoCiclo, inicioDoCiclo, situacao, vencimentoDoCredito } from "./modulo";

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

describe("fila nos dois sentidos (o mais antigo primeiro)", () => {
  const ini = "2026-04-26";
  const mov = (data: string, pos: number, neg = 0) => ({ data, positivoMin: pos, negativoMin: neg });

  it("exemplos do plano: 3h a mais em 10/05 vence 25/11 (pagar); 2h a menos em 03/06 vence 25/12 (descontar)", () => {
    const r = emAberto([mov("2026-05-10", 180), mov("2026-06-03", 0, 120)], [], ini, 6);
    // a hora a menos de 03/06 abate a hora a mais de 10/05 (mais antiga): sobra 1h a folgar até 25/11
    expect(r.saldoMin).toBe(60);
    expect(r.itens).toEqual([{ data: "2026-05-10", sinal: 1, restanteMin: 60, vencimento: "2026-11-25" }]);
    const so = emAberto([mov("2026-06-03", 0, 120)], [], ini, 6);
    expect(so.itens).toEqual([{ data: "2026-06-03", sinal: -1, restanteMin: 120, vencimento: "2026-12-25" }]);
    expect(situacao(so.itens, "2026-12-26", 30)).toMatchObject({ pagarMin: 0, descontarMin: 120 });
    expect(situacao(r.itens, "2026-11-26", 30)).toMatchObject({ pagarMin: 60, descontarMin: 0 });
  });

  it("hora a mais abate primeiro o débito mais antigo; o que sobra vira crédito novo", () => {
    const r = emAberto([mov("2026-05-01", 0, 60), mov("2026-06-01", 0, 30), mov("2026-07-01", 120)], [], ini, 6);
    expect(r.saldoMin).toBe(30);
    expect(r.itens).toEqual([{ data: "2026-07-01", sinal: 1, restanteMin: 30, vencimento: "2027-01-25" }]);
  });

  it("ignora o que veio antes do início; vencendo no aviso por sinal", () => {
    const r = emAberto([mov("2026-04-10", 600), mov("2026-05-10", 120), mov("2026-06-10", 0, 45)], [], ini, 6);
    expect(r.saldoMin).toBe(75);
    expect(situacao(r.itens, "2026-11-01", 30)).toEqual({ pagarMin: 0, descontarMin: 0, folgarMin: 75, reporMin: 0, proximoVencimento: "2026-11-25" });
  });

  it("lançamento na folha entra no dia 25 da competência, na ordem certa", () => {
    // 2h a mais em maio vencem 25/11; pagas na folha de novembro; depois, 1h a menos em dezembro vira hora a repor
    const r = emAberto([mov("2026-05-10", 120), mov("2026-12-01", 0, 60)], [{ competencia: "2026-11-01", tipo: "pago", minutos: 120 }], ini, 6);
    expect(r.saldoMin).toBe(-60);
    expect(r.itens).toEqual([{ data: "2026-12-01", sinal: -1, restanteMin: 60, vencimento: "2027-06-25" }]);
    const d = emAberto([mov("2026-06-03", 0, 120)], [{ competencia: "2026-12-01", tipo: "descontado", minutos: 120 }], ini, 6);
    expect(d).toEqual({ saldoMin: 0, itens: [] });
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
