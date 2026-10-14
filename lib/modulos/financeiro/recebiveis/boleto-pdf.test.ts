import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ItemTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { extrairPaginasDoPdf } from "../cartao/fatura-pdf";
import { ALTURA_LINHA_OCR, itensDasLinhas, ocrDoPdf } from "./boleto-ocr";
import {
  cpfCnpjValido, conferir, decodificarLinhaDigitavel, escolherTitulo, lerBoleto, lerNumeroDocumento, letraDaParcela, procurarLinhaDigitavel,
  vencimentoDoFator, type TituloCandidato,
} from "./boleto-pdf";

// Linhas reais (AKF e Bradesco Net Empresa); vencimento e valor conferidos com os títulos do Consistem.
const REAIS: [string, string, number][] = [
  ["23790.41706 92000.001377 10000.476704 2 16180001066420", "2026-11-02", 1_066_420],
  ["23790.41706 92000.001377 15000.476703 9 16260002209064", "2026-11-10", 2_209_064],
  ["23790.41706 92000.001377 14000.476706 1 16290000905466", "2026-11-13", 905_466],
  ["23790.41706 92000.001377 17000.476709 7 16290000100000", "2026-11-13", 100_000],
  ["23790.41706 92000.001369 96000.476703 1 16210004000000", "2026-11-05", 4_000_000],
  ["23790.41706 92000.001377 20000.476703 5 16540013400000", "2026-12-08", 13_400_000],
  ["23795.42604 96267.000006 02002.622609 5 16050000834073", "2026-10-20", 834_073],
  ["23795.42604 96267.000006 04002.622605 9 16010000048926", "2026-10-16", 48_926],
];

describe("linha digitável", () => {
  it.each(REAIS)("%s", (linha, vencimento, valor) => {
    expect(decodificarLinhaDigitavel(linha)).toEqual({ linha: linha.replace(/\D/g, ""), banco: "237", vencimento, valorCentavos: valor });
  });

  it("recusa tamanho errado, DV de campo errado e DV geral errado (erro de leitura)", () => {
    expect(decodificarLinhaDigitavel("23790.41706 92000.001377")).toBeNull();
    expect(decodificarLinhaDigitavel("23790.41707 92000.001377 10000.476704 2 16180001066420")).toBeNull();
    expect(decodificarLinhaDigitavel("23790.41706 92000.001377 10000.476704 3 16180001066420")).toBeNull();
    expect(decodificarLinhaDigitavel("23790.41706 92000.001377 10000.476704 2 16180001066421")).toBeNull();
  });

  it("acha a linha no meio de um texto (linha do OCR)", () => {
    expect(procurarLinhaDigitavel(`& bradesco | 237-2 | ${REAIS[6][0]}`)?.valorCentavos).toBe(834_073);
    expect(procurarLinhaDigitavel("sem linha 12345")).toBeNull();
  });

  it("fator de vencimento (FEBRABAN, base 22/02/2025)", () => {
    expect(vencimentoDoFator(1000)).toBe("2025-02-22");
    expect(vencimentoDoFator(1626)).toBe("2026-11-10");
    expect(vencimentoDoFator(0)).toBeNull();
  });
});

describe("nº do documento, parcela e CNPJ", () => {
  it("NF da filial, NF/parcela da Matriz e série Z", () => {
    expect(lerNumeroDocumento("002316")).toEqual({ texto: "002316", nota: "2316", parcela: null });
    expect(lerNumeroDocumento("1237/8")).toEqual({ texto: "1237/8", nota: "1237", parcela: 8 });
    expect(lerNumeroDocumento("226/2026/4")).toEqual({ texto: "226/2026/4", nota: null, parcela: 4 });
    expect(lerNumeroDocumento("DM")).toBeNull();
    expect(letraDaParcela(1)).toBe("A");
    expect(letraDaParcela(8)).toBe("H");
  });
  it("CPF/CNPJ só com DV certo (o OCR erra dígito); aceita o zero a mais do Bradesco", () => {
    expect(cpfCnpjValido("53.703.108/0001-07")).toBe("53703108000107");
    expect(cpfCnpjValido("045.498.204/0001-32")).toBe("45498204000132");
    expect(cpfCnpjValido("045A98.204/0001-32")).toBeNull();
    expect(cpfCnpjValido("53.703.108/0001-08")).toBeNull();
    expect(cpfCnpjValido("055.539.266-02")).toBe("05553926602");
    expect(cpfCnpjValido("055.539.266-03")).toBeNull();
  });
});

describe("lerBoleto", () => {
  const item = (x: number, y: number, texto: string): ItemTexto => ({ x, y, w: 0, texto });
  it("boleto da AKF da Matriz (posições reais do PDF)", () => {
    const r = lerBoleto([{ numero: 1, largura: 595, altura: 842, itens: [
      item(30, 322, "Número do documento"), item(199, 322, "CPF / CNPJ"), item(33, 333, "1237/8"), item(30, 343, "(-) Descontos / Abatimentos"),
      item(30, 364, "Pagador"), item(33, 375, "SOLLYS INCORPORADORA LTDA, CNPJ: 53.703.108/0001-07"),
      item(222, 282, REAIS[4][0]), item(33, 312, "AKF SECURITIZADORA DE CREDITOS - CNPJ: 21.248.571/0001-10"),
    ] }]);
    expect(r.linha?.vencimento).toBe("2026-11-05");
    expect(r.documento).toEqual({ texto: "1237/8", nota: "1237", parcela: 8 });
    expect(r.pagadorDocumento).toBe("53703108000107");
    expect(r.beneficiarioAkf).toBe(true);
    expect(r.avisos).toEqual([]);
  });
  it("sem rótulo: NF de 6 dígitos sozinha (layout antigo da AKF)", () => {
    const r = lerBoleto([{ numero: 1, largura: 595, altura: 842, itens: [item(0, 0, REAIS[1][0]), item(0, 50, "002345")] }]);
    expect(r.documento?.nota).toBe("2345");
  });
  it("sem texto", () => {
    const r = lerBoleto([{ numero: 1, largura: 595, altura: 842, itens: [] }]);
    expect(r.linha).toBeNull();
    expect(r.avisos[0]).toMatch(/sem texto/);
  });
  it("palavras do OCR viram expressões separadas por coluna", () => {
    const p = (x0: number, x1: number, text: string) => ({ text, bbox: { x0, x1, y0: 186, y1: 196 } }) as never;
    expect(itensDasLinhas([{ words: [p(14, 30, "Data"), p(33, 45, "do"), p(48, 70, "Doc."), p(122, 136, "Nº"), p(139, 151, "do"), p(154, 205, "documento")] }]).map((i) => i.texto))
      .toEqual(["Data do Doc.", "Nº do documento"]);
  });
});

describe("escolherTitulo", () => {
  const t = (id: string, documento: string, vencimento: string, valorCentavos: number, extra: Partial<TituloCandidato> = {}): TituloCandidato =>
    ({ id, documento, nota: /^[14]00/.test(documento) ? documento.slice(3, -1).replace(/^0+/, "") : null, vencimento, valorCentavos, cedido: true, temBoleto: false, ...extra });
  const boleto = (vencimento: string, valorCentavos: number, documento: string | null, extra: { akf?: boolean; cnpj?: string } = {}) =>
    ({ linha: { linha: "", banco: "237", vencimento, valorCentavos }, documento: lerNumeroDocumento(documento), pagadorDocumento: extra.cnpj ?? null, beneficiarioAkf: extra.akf ?? true });

  const sollys = [
    t("G", "1001237G", "2026-10-05", 4_000_000, { cedido: false }), t("H", "1001237H", "2026-11-05", 4_000_000),
    t("I", "1001237I", "2026-12-05", 4_000_000, { cedido: false }),
  ];
  it("Matriz: NF/parcela liga pela letra", () => {
    expect(escolherTitulo(boleto("2026-11-05", 4_000_000, "1237/8"), sollys)).toEqual({ tituloId: "H", avisos: [] });
  });
  it("Filial: parcela única; várias parcelas pela linha digitável", () => {
    expect(escolherTitulo(boleto("2026-10-14", 100_000, "002313"), [t("U", "4002313U", "2026-10-14", 100_000)]).tituloId).toBe("U");
    const parcelas = [t("A", "4002345A", "2026-11-10", 100), t("B", "4002345B", "2026-12-10", 100)];
    expect(escolherTitulo(boleto("2026-12-10", 100, "002345"), parcelas).tituloId).toBe("B");
    expect(escolherTitulo({ ...boleto("2026-12-10", 100, "002345"), linha: null }, parcelas).avisos).toEqual(["A NF 2345 tem 2 parcelas em aberto: escolha a deste boleto."]);
  });
  it("série Z (sem NF): por vencimento + valor, desempate pelo CPF/CNPJ do pagador", () => {
    const z = [t("D", "Z00027D", "2026-12-08", 13_400_000, { clienteDocumento: "14171608000193" }), t("X", "1009999D", "2026-12-08", 13_400_000, { clienteDocumento: "11111111000191" })];
    expect(escolherTitulo(boleto("2026-12-08", 13_400_000, "226/2026/4", { cnpj: "14171608000193" }), z).tituloId).toBe("D");
    expect(escolherTitulo(boleto("2026-12-08", 13_400_000, "226/2026/4"), z).tituloId).toBeNull();
  });
  it("sem nada: a pessoa escolhe", () => {
    expect(escolherTitulo(boleto("2026-12-08", 1, null), []).avisos[0]).toMatch(/informe a NF/);
  });
  it("conferência: divergências, NF/parcela, CNPJ, AKF × cedido, substituição", () => {
    expect(conferir(boleto("2026-11-11", 150, "1237/9", { cnpj: "53703108000107" }), t("H", "1001237H", "2026-11-05", 100, { cedido: false, temBoleto: true, clienteDocumento: "14171608000193" }))).toEqual([
      "Vencimento do boleto 11/11/2026 × título 05/11/2026.",
      "Valor do boleto diferente do título (1,50 × 1,00).",
      "O boleto é da parcela 9 (I), o título é 1001237H.",
      "O CPF/CNPJ do pagador do boleto não é o do cliente do título.",
      "Boleto da AKF, mas o título não está marcado como cedido.",
      "O título já tem boleto: este passa a valer (o anterior fica guardado).",
    ]);
    expect(conferir(boleto("2026-11-05", 100, "1237", { akf: false }), t("H", "1001237H", "2026-11-05", 100))).toEqual(["Título cedido à AKF, mas o boleto não é da AKF."]);
    expect(conferir(boleto("2026-11-05", 100, null), { ...t("U", "4002345U", "2026-11-05", 100), aceitaBoletoFactoring: false }))
      .toEqual(["Cliente NÃO aceita boleto de factoring: este boleto é da AKF; o boleto deve ser o próprio da Neo."]);
  });
  it("cliente que não paga à AKF: título cedido com boleto próprio (a Neo recebe e repassa) não gera aviso", () => {
    const cedidoSemFactoring = { ...t("U", "4002335U", "2026-10-20", 834_073), aceitaBoletoFactoring: false };
    expect(conferir(boleto("2026-10-20", 834_073, "2335", { akf: false }), cedidoSemFactoring)).toEqual([]);
  });
});

// Calibração com os PDFs reais (fora do repositório): NEO_AMOSTRAS_BOLETOS=<pasta>. Confere que todo boleto tem linha digitável
// válida e nº do documento; os PDF-imagem passam pelo OCR.
const PASTA = process.env.NEO_AMOSTRAS_BOLETOS;
describe.skipIf(!PASTA)("calibração: boletos reais", () => {
  const arquivos = PASTA ? readdirSync(PASTA).filter((f) => /\.pdf$/i.test(f)) : [];
  it.each(arquivos)("%s", async (arquivo) => {
    // Cada leitura com a sua cópia: o pdf.js desliga o buffer que recebe.
    const ext = await extrairPaginasDoPdf(readFileSync(join(PASTA!, arquivo)));
    const ocr = ext.ok ? null : await ocrDoPdf(readFileSync(join(PASTA!, arquivo)));
    const paginas = ext.ok ? ext.paginas : ocr?.ok ? ocr.paginas : [];
    const r = lerBoleto(paginas, ext.ok ? {} : { porOcr: true, alturaLinha: ALTURA_LINHA_OCR });
    console.log(arquivo, ocr && !ocr.ok ? ocr.erro : "", JSON.stringify({ ...r, linha: r.linha && { ...r.linha, linha: undefined } }));
    expect(r.linha).not.toBeNull();
    expect(r.documento).not.toBeNull();
    expect(r.avisos).toEqual([]);
  }, 60_000);
});
