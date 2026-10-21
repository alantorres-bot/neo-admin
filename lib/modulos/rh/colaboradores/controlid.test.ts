import { describe, expect, it } from "vitest";
import { casarComCadastro, empregadorDe, lerCadastroControlId, nomeParecido, type ColaboradorParaCasar } from "./controlid";

const CAB = ["﻿id_funcionario", "CPF", "PIS", "Nome", "Matrícula", "Empresa", "Departamento", "Cargo", "Senha para Uso no REP", "Data de Admissão", "PIN", "Ativo"];
const linha = (id: string, cpf: string, nome: string, empresa: string, dep: string, cargo: string, adm: string, ativo = "1") => [id, cpf, "99999999999", nome, "0", empresa, dep, cargo, "1234", adm, "4321", ativo];
const NEO = "NEO FORMAS SERVICOS DE MANUTENCAO DE METAIS LTDA";

describe("lerCadastroControlId", () => {
  const r = lerCadastroControlId([
    CAB,
    linha("133", "7122548112", "Fulano de Tal", NEO, "FABRICA", "AUXILIAR DE PRODUÇÃO 1", "4/7/2025 12:00:00 AM"),
    linha("2", "83489533100", "BELTRANO", "OESTE FORMAS PARA CONCRETO LTDA", "", "", ""),
    linha("9", "11122233344", "INATIVO", NEO, "FABRICA", "", "", "0"),
    linha("10", "55566677788", "teste teletron", NEO, "", "", ""),
  ]);
  it("só ativos; CPF com o zero da frente; data m/d/aaaa; empresa; nada sensível", () => {
    expect(r.erro).toBeNull();
    expect(r.ignorados).toEqual(["teste teletron"]);
    expect(r.itens).toEqual([
      { rhid: "133", cpf: "07122548112", nome: "FULANO DE TAL", empregador: "NEO SERVIÇOS", departamento: "FABRICA", cargo: "AUXILIAR DE PRODUÇÃO 1", admissao: "2025-04-07" },
      { rhid: "2", cpf: "83489533100", nome: "BELTRANO", empregador: "OESTE", departamento: null, cargo: null, admissao: null },
    ]);
    expect(JSON.stringify(r.itens)).not.toMatch(/1234|4321|99999999999/);
  });
  it("recusa outro arquivo", () => expect(lerCadastroControlId([["Nome"], ["x"]]).erro).toMatch(/Não é o cadastro/));
  it("empresa", () => expect([empregadorDe(NEO), empregadorDe("OESTE FORMAS PARA CONCRETO LTDA")]).toEqual(["NEO SERVIÇOS", "OESTE"]));
});

describe("casarComCadastro", () => {
  const base = { cod_fornecedor: "1", empregador: "NEO SERVIÇOS", departamento: null, funcao: null, data_admissao: null, id_rhid: null };
  const cadastro: ColaboradorParaCasar[] = [
    { ...base, id: "a", nome: "FULANO DE TAL", cpf: "071.225.481-12" },
    { ...base, id: "j", nome: "JEAN VAUDREIL PIERRI", cpf: null, cod_fornecedor: "695", empregador: "OESTE" },
    { ...base, id: "k", nome: "JEAN KERVENSON", cpf: "111.222.333-96", id_rhid: "125" },
    { ...base, id: "r", nome: "RODRIGO GUILHERME RODRIGUES DA SILVA", cpf: null },
  ];
  const it_ = (rhid: string, cpf: string, nome: string, empregador = "NEO SERVIÇOS") => ({ rhid, cpf, nome, empregador, departamento: "FABRICA", cargo: "SOLDADOR", admissao: "2025-01-02" });
  const r = casarComCadastro([
    it_("133", "07122548112", "FULANO DE TAL"),
    it_("216", "12345678901", "JEAN VAUDREUIL PIERRE", "OESTE"),
    it_("125", "99999999999", "JEAN KERVENSON"),
    it_("219", "55566677788", "RODRIGO REGER DE ARRUDA"),
  ], cadastro);

  it("CPF: completa RHiD, departamento, cargo e admissão; não mexe no resto", () => {
    expect(r[0]).toMatchObject({ como: "cpf", completa: { id_rhid: "133", departamento: "FABRICA", funcao: "SOLDADOR", data_admissao: "2025-01-02" }, diferencas: [] });
  });
  it("nome parecido sem CPF liga ao cadastro existente (não duplica) e avisa a diferença de nome", () => {
    expect(r[1].como).toBe("parecido");
    expect(r[1].colaborador?.id).toBe("j");
    expect(r[1].completa.cpf).toBe("123.456.789-01");
    expect(r[1].diferencas.join()).toMatch(/nome/);
  });
  it("RHiD manda; CPF diferente vira só aviso", () => {
    expect(r[2]).toMatchObject({ como: "rhid" });
    expect(r[2].completa.cpf).toBeUndefined();
    expect(r[2].diferencas.join()).toMatch(/CPF/);
  });
  it("outro Rodrigo não casa: é novo", () => expect(r[3]).toMatchObject({ como: "novo", colaborador: null }));
  it("nomeParecido", () => {
    expect(nomeParecido("JEAN VAUDREUIL PIERRE", "JEAN VAUDREIL PIERRI")).toBe(true);
    expect(nomeParecido("JEAN KERVENSON", "JEAN VAUDREUIL PIERRE")).toBe(false);
  });
});
