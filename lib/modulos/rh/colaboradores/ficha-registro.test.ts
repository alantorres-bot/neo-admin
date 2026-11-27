import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import type { PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { dataDaFicha, lerFichaRegistro, matriculaDaFicha, reaisDaFicha } from "./ficha-registro";
import { FICHA_EXEMPLO } from "./ficha-registro.exemplo";

const sem = (textos: string[]): PaginaTexto => ({ ...FICHA_EXEMPLO, itens: FICHA_EXEMPLO.itens.filter((i) => !textos.includes(i.texto)) });
const trocar = (de: string, para: string): PaginaTexto => ({ ...FICHA_EXEMPLO, itens: FICHA_EXEMPLO.itens.map((i) => (i.texto === de ? { ...i, texto: para } : i)) });

describe("ficha de registro do escritório (27/11/2026)", () => {
  it("lê todos os campos pela posição (endereço em 2 linhas; Nº ≠ matrícula eSocial)", () => {
    const r = lerFichaRegistro([FICHA_EXEMPLO]);
    expect(r).toEqual({
      ok: true, avisos: ["A ficha traz Nº 206 e matrícula eSocial 207; usei 206. Confira no extrato do escritório."],
      dados: {
        nome: "FULANO DE TAL DA SILVA", cpf: "529.982.247-25", cnpj: "45513941000167", empregador: "NEO SERVIÇOS", matriculaEscritorio: "206",
        dataAdmissao: "2026-12-01", salario: 2345.67, funcao: "AUXILIAR DE PRODUÇÃO",
        dataNascimento: "1990-03-15", telefone: "65999990000", endereco: "Rua DAS FLORES, 100, BAIRRO JARDIM AMERICA, VARZEA GRANDE, MT, - CEP: 78110-000",
        pis: "12345678901", rg: "12345678", rgOrgao: "SSP/MT", rgEmissao: "2015-01-10", ctps: "654321", ctpsSerie: "0012", ctpsUf: "MT",
        nomePai: "PAI DE TESTE", nomeMae: "MAE DE TESTE",
      },
    });
  });

  it("campos vazios ficam null; avisa nome, CPF e admissão ausentes", () => {
    const r = lerFichaRegistro([sem(["FULANO DE TAL DA SILVA", "529.982.247-25", "01/12/2026", "12345678", "PAI DE TESTE", "65999990000"])]);
    if (!r.ok) throw new Error(r.erro);
    expect(r.dados).toMatchObject({ nome: null, cpf: null, dataAdmissao: null, rg: null, nomePai: null, telefone: null, nomeMae: "MAE DE TESTE" });
    expect(r.avisos.filter((a) => !a.startsWith("A ficha traz Nº"))).toEqual(["A ficha não trouxe o nome.", "A ficha não trouxe o CPF.", "A ficha não trouxe a data de admissão."]);
  });

  it("CPF inválido, CNPJ fora da folha e salário que não é por mês viram aviso", () => {
    const pagina: PaginaTexto = { ...FICHA_EXEMPLO, itens: trocar("529.982.247-25", "529.982.247-26").itens
      .map((i) => (i.texto === "45.513.941/0001-67" ? { ...i, texto: "11.111.111/0001-11" } : i.texto === "Mês" ? { ...i, texto: "Hora" } : i)) };
    const r = lerFichaRegistro([pagina]);
    if (!r.ok) throw new Error(r.erro);
    expect(r.dados).toMatchObject({ cpf: null, empregador: null, cnpj: "11111111000111" });
    expect(r.avisos.filter((a) => !a.startsWith("A ficha traz Nº"))).toEqual([
      "O CPF da ficha não confere (dígitos verificadores); digite o correto.",
      "O CNPJ do empregador (11111111000111) não é de uma empresa da folha; escolha a empregadora.",
      'O salário da ficha é por "Hora", não por mês; confira.',
    ]);
  });

  it("recusa o que não é a ficha", () => {
    expect(lerFichaRegistro([sem(["REGISTRO DE EMPREGADO"])])).toEqual({ ok: false, erro: "O arquivo não parece a Ficha Registro de Empregado do escritório." });
    expect(lerFichaRegistro([])).toMatchObject({ ok: false });
  });

  it("matrícula: Nº; eSocial só quando o Nº é 000001 (ficha reimpressa)", () => {
    const av: string[] = [];
    expect(matriculaDaFicha("000222", "222", av)).toBe("222");
    expect(av).toEqual([]);
    expect(matriculaDaFicha("000206", "207", av)).toBe("206");
    expect(matriculaDaFicha("000001", "153", av)).toBe("153");
    expect(av).toHaveLength(2);
    expect(matriculaDaFicha("", "88", [])).toBe("88");
    expect(matriculaDaFicha("", "", [])).toBeNull();
  });

  it("datas e valores", () => {
    expect(dataDaFicha("17/11/2026")).toBe("2026-11-17");
    expect(dataDaFicha("31/02/2026")).toBeNull();
    expect(dataDaFicha("")).toBeNull();
    expect(reaisDaFicha("R$ 2.145,87")).toBe(2145.87);
    expect(reaisDaFicha("R$ 850,00")).toBe(850);
    expect(reaisDaFicha(null)).toBeNull();
  });
});

// Calibração com a ficha REAL (não entra no repositório: dados pessoais). Sem o arquivo, pula. Só confere campos não sensíveis.
const FICHA_REAL = "G:/Drives compartilhados/Neo Formas Administrativo/ADMINISTRATIVO/01 - RH/02 - FUNCIONARIOS/01 - ATIVOS/Fabricio Heverton/42_3_FABRICIO -  Ficha Registro de Empregado.pdf";
describe.skipIf(!existsSync(FICHA_REAL))("calibração: ficha real do escritório", () => {
  it("lê admissão, salário, cargo, matrícula e empregador", async () => {
    const ext = await extrairPaginasDoPdf(readFileSync(FICHA_REAL));
    if (!ext.ok) throw new Error(ext.erro);
    const r = lerFichaRegistro(ext.paginas);
    if (!r.ok) throw new Error(r.erro);
    expect(r.avisos).toEqual([]);
    expect(r.dados).toMatchObject({ empregador: "NEO SERVIÇOS", matriculaEscritorio: "222", dataAdmissao: "2026-11-17", salario: 2145.87, funcao: "AUXILIAR DE LOGISTICA", rg: null, ctps: null, pis: null });
    expect(r.dados.cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(r.dados.endereco).toMatch(/CEP: \d{5}-\d{3}$/);
  });
});
