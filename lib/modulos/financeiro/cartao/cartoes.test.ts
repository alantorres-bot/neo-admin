import { describe, expect, it } from "vitest";
import {
  MAX_COMPLEMENTO, faturaDaCompra, identificarCartaoDoTitulo, lerComplemento, montarComplemento, normalizarNomeCartao, vencimentoDaFatura, vencimentoSeguinte,
  type CartaoInfo,
} from "./cartoes";

// Planilha Cartões (12/10/2026): fechamento / vencimento / tipo de título.
const c = (nome: string, banco: string, tipoPessoa: "PF" | "PJ", f: number, v: number, tipoTitulo: number): CartaoInfo => ({
  codigo: normalizarNomeCartao(nome), nome, banco, tipoPessoa, diaFechamento: f, diaVencimento: v, tipoTitulo,
});
export const CARTOES_TESTE: CartaoInfo[] = [
  c("INTER PF", "Inter", "PF", 20, 28, 8),
  c("INTER PJ", "Inter", "PJ", 3, 10, 8),
  c("ITAÚ PJ", "Itaú", "PJ", 10, 28, 10),
  c("NUBANK PF", "Nubank", "PF", 20, 27, 7),
  c("PICPAY PF", "PicPay", "PF", 15, 25, 75),
  c("SICREDI PF", "Sicredi", "PF", 26, 10, 9),
  c("SICREDI PJ", "Sicredi", "PJ", 10, 23, 9),
  c("UNICRED PF", "Unicred", "PF", 10, 20, 73),
];
const por = (codigo: string) => CARTOES_TESTE.find((x) => x.codigo === codigo)!;

describe("normalizarNomeCartao", () => {
  it('"Itaú pj" → "ITAU PJ"', () => {
    expect(normalizarNomeCartao("Itaú pj")).toBe("ITAU PJ");
    expect(normalizarNomeCartao("  nubank   PF ")).toBe("NUBANK PF");
  });
});

describe("faturaDaCompra / vencimentoDaFatura", () => {
  it("Inter PJ (fecha 3 / vence 10): compra até o dia 3 vai para a fatura do dia 10 do mesmo mês; depois, para a seguinte", () => {
    const inter = por("INTER PJ");
    expect(faturaDaCompra("2026-10-03", inter)).toEqual({ fechamento: "2026-10-03", vencimento: "2026-10-10" });
    expect(vencimentoDaFatura("2026-10-04", inter)).toBe("2026-11-10");
    expect(vencimentoDaFatura("2026-09-20", inter)).toBe("2026-10-10");
  });
  it("Sicredi PF (fecha 26 / vence 10): o vencimento cai no mês seguinte ao fechamento", () => {
    const s = por("SICREDI PF");
    expect(faturaDaCompra("2026-09-20", s)).toEqual({ fechamento: "2026-09-26", vencimento: "2026-10-10" });
    expect(vencimentoDaFatura("2026-09-27", s)).toBe("2026-11-10");
  });
  it("vira o ano e respeita meses curtos", () => {
    expect(vencimentoDaFatura("2026-12-27", por("SICREDI PF"))).toBe("2027-02-10");
    expect(faturaDaCompra("2027-02-27", { diaFechamento: 31, diaVencimento: 5 })).toEqual({ fechamento: "2027-02-28", vencimento: "2027-03-05" });
    expect(vencimentoSeguinte("2026-12-10", por("SICREDI PF"))).toBe("2027-01-10");
    expect(vencimentoSeguinte("2026-01-31", { diaVencimento: 31 })).toBe("2026-02-28");
  });
});

describe("lerComplemento (textos reais do Contas a Pagar)", () => {
  it('"CARTAO INTER - PNEUS PARA STRADA;" cita o Inter, sem PF/PJ → 2 candidatos', () => {
    const l = lerComplemento("CARTAO INTER - PNEUS PARA STRADA;", CARTOES_TESTE);
    expect(l.citaCartao).toBe(true);
    expect(l.candidatos.map((x) => x.codigo)).toEqual(["INTER PF", "INTER PJ"]);
  });
  it('"CARTAO SICRED - REFORMA GALPAO" (abreviado) e "NUBANCK" (erro de grafia) são reconhecidos', () => {
    expect(lerComplemento("CARTAO SICRED - REFORMA GALPAO;", CARTOES_TESTE).candidatos.map((x) => x.banco)).toEqual(["Sicredi", "Sicredi"]);
    expect(lerComplemento("CARTAO NUBANCK - VIAGENS", CARTOES_TESTE).candidatos.map((x) => x.codigo)).toEqual(["NUBANK PF"]);
  });
  it('acha as parcelas ("3 X", "10X", "3x") em qualquer posição', () => {
    expect(lerComplemento("CARTÃO SICREDI 3 X;- MATERIA PRIMA ALUMINIO", CARTOES_TESTE).parcelas).toBe(3);
    expect(lerComplemento("CARTAO INTER - MECADOR LIVRE 10X;COMPRA CELULAR", CARTOES_TESTE).parcelas).toBe(10);
    expect(lerComplemento("CARTÃO NUBANK PF 3x — HOSPEDAGEM CUIABÁ", CARTOES_TESTE).parcelas).toBe(3);
  });
  it("PF/PJ escrito no texto restringe os candidatos", () => {
    const l = lerComplemento("CARTÃO ITAÚ PJ 1x — IOF", CARTOES_TESTE);
    expect(l.candidatos.map((x) => x.codigo)).toEqual(["ITAU PJ"]);
    expect(l.tipoPessoa).toBe("PJ");
  });
  it('não confunde com "INTERNET", "CARTORIO"; só a palavra CARTÃO é "só marca"', () => {
    expect(lerComplemento("INTERNET - SETEMBRO/2026;", CARTOES_TESTE).citaCartao).toBe(false);
    expect(lerComplemento("CARTORIO INTER REGISTRO", CARTOES_TESTE).citaCartao).toBe(false);
    const l = lerComplemento("PAGO NO CARTAO DO DIRETOR", CARTOES_TESTE);
    expect(l.citaCartao).toBe(false);
    expect(l.soMarca).toBe(true);
  });
});

describe("identificarCartaoDoTitulo — desambigua PF/PJ pelo vencimento", () => {
  it("Inter vencendo dia 10 → INTER PJ; dia 28 → INTER PF; dia 15 → ambíguo", () => {
    const a = identificarCartaoDoTitulo({ complemento: "CARTAO INTER - PNEUS PARA STRADA;", vencimento: "2026-10-10" }, CARTOES_TESTE);
    expect(a).toMatchObject({ situacao: "cartao", por: "vencimento", vencimentoCoerente: true });
    expect(a.cartao?.codigo).toBe("INTER PJ");
    expect(identificarCartaoDoTitulo({ complemento: "CARTAO INTER COMPRA REDONDO LAM A;", vencimento: "2026-10-28" }, CARTOES_TESTE).cartao?.codigo).toBe("INTER PF");
    const d = identificarCartaoDoTitulo({ complemento: "CARTAO INTER - X", vencimento: "2026-10-15" }, CARTOES_TESTE);
    expect(d.situacao).toBe("ambiguo");
    expect(d.candidatos).toHaveLength(2);
  });
  it("Sicredi vencendo dia 10 → PF; dia 23 → PJ; traz as parcelas do texto", () => {
    const a = identificarCartaoDoTitulo({ complemento: "CARTÃO SICREDI 3 X;- MATERIA PRIMA ALUMINIO", vencimento: "2026-10-10" }, CARTOES_TESTE);
    expect(a.cartao?.codigo).toBe("SICREDI PF");
    expect(a.parcelas).toBe(3);
    expect(identificarCartaoDoTitulo({ complemento: "CARTAO SICRED - X", vencimento: "2026-10-23" }, CARTOES_TESTE).cartao?.codigo).toBe("SICREDI PJ");
  });
  it('banco com um só cartão identifica pelo texto; vencimento fora do dia vira "incoerente"; sem cartão', () => {
    const a = identificarCartaoDoTitulo({ complemento: "CARTAO ITAU - IOF", vencimento: "2026-10-15" }, CARTOES_TESTE);
    expect(a).toMatchObject({ situacao: "cartao", por: "texto", vencimentoCoerente: false });
    expect(identificarCartaoDoTitulo({ complemento: "LUVAS / MASCARAS;", vencimento: "2026-10-10" }, CARTOES_TESTE).situacao).toBe("sem_cartao");
  });
});

describe("montarComplemento (máscara do POP)", () => {
  it("CARTÃO <NOME> <Nx> — <DESCRIÇÃO>, em maiúsculas; corta em 70; ida e volta pelo leitor", () => {
    expect(montarComplemento(por("NUBANK PF"), 3, "Hospedagem Cuiabá")).toBe("CARTÃO NUBANK PF 3x — HOSPEDAGEM CUIABÁ");
    expect(montarComplemento(por("ITAU PJ"), 1, "IOF")).toBe("CARTÃO ITAÚ PJ 1x — IOF");
    const longo = montarComplemento(por("SICREDI PF"), 10, "serviço de monitoramento eletrônico das instalações da fábrica e do escritório");
    expect(longo.length).toBeLessThanOrEqual(MAX_COMPLEMENTO);
    expect(montarComplemento(por("INTER PJ"), 1, "  ")).toBe("CARTÃO INTER PJ 1x");
    const id = identificarCartaoDoTitulo({ complemento: montarComplemento(por("INTER PJ"), 2, "Mercado Livre"), vencimento: "2026-10-10" }, CARTOES_TESTE);
    expect(id.cartao?.codigo).toBe("INTER PJ");
    expect(id.parcelas).toBe(2);
  });
});
