import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ItemTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { extrairPaginasDoPdf } from "../cartao/fatura-pdf";
import { decodificarLinhaDigitavel, escolherTitulo, lerBoletoPdf, vencimentoDoFator } from "./boleto-pdf";

// Linhas reais dos boletos da AKF (Bradesco); vencimento e valor conferidos com os títulos do Consistem.
const REAIS: [string, string, number][] = [
  ["23790.41706 92000.001377 10000.476704 2 16180001066420", "2026-11-02", 1_066_420],
  ["23790.41706 92000.001377 15000.476703 9 16260002209064", "2026-11-10", 2_209_064],
  ["23790.41706 92000.001377 14000.476706 1 16290000905466", "2026-11-13", 905_466],
  ["23790.41706 92000.001377 17000.476709 7 16290000100000", "2026-11-13", 100_000],
];

describe("linha digitável", () => {
  it.each(REAIS)("%s", (linha, vencimento, valor) => {
    const r = decodificarLinhaDigitavel(linha);
    expect(r).toEqual({ linha: linha.replace(/\D/g, ""), banco: "237", vencimento, valorCentavos: valor });
  });

  it("recusa tamanho errado e dígito verificador errado (erro de leitura)", () => {
    expect(decodificarLinhaDigitavel("23790.41706 92000.001377")).toBeNull();
    expect(decodificarLinhaDigitavel("23790.41707 92000.001377 10000.476704 2 16180001066420")).toBeNull();
  });

  it("fator de vencimento (FEBRABAN, base 22/02/2025)", () => {
    expect(vencimentoDoFator(1000)).toBe("2025-02-22");
    expect(vencimentoDoFator(1626)).toBe("2026-11-10");
    expect(vencimentoDoFator(0)).toBeNull();
  });
});

describe("lerBoletoPdf", () => {
  const item = (texto: string): ItemTexto => ({ x: 0, y: 0, w: 0, texto });
  it("boleto da AKF: linha, documento e beneficiário", () => {
    const r = lerBoletoPdf([{ numero: 1, largura: 595, altura: 842, itens: [
      item("RECIBO DO PAGADOR"), item(REAIS[1][0]), item("AKF SECURITIZADORA DE CREDITOS - CNPJ: 21.248.571/0001-10"), item("002345"), item("10/11/2026"),
    ] }]);
    expect(r.linha?.valorCentavos).toBe(2_209_064);
    expect(r.documento).toBe("002345");
    expect(r.beneficiarioAkf).toBe(true);
    expect(r.avisos).toEqual([]);
  });
  it("boleto escaneado (sem texto)", () => {
    const r = lerBoletoPdf([{ numero: 1, largura: 595, altura: 842, itens: [] }]);
    expect(r.linha).toBeNull();
    expect(r.avisos[0]).toMatch(/escaneado/);
  });
});

// Calibração opcional com os PDFs reais (fora do repositório): NEO_AMOSTRAS_BOLETOS=<pasta com 0023xx.pdf>.
const PASTA = process.env.NEO_AMOSTRAS_BOLETOS;
describe.skipIf(!PASTA)("calibração: boletos reais", () => {
  const arquivos = PASTA ? readdirSync(PASTA).filter((f) => /^\d{6}\.pdf$/i.test(f)) : [];
  it.each(arquivos)("%s", async (arquivo) => {
    const ext = await extrairPaginasDoPdf(readFileSync(join(PASTA!, arquivo)));
    expect(ext.ok).toBe(true);
    if (!ext.ok) return;
    const r = lerBoletoPdf(ext.paginas);
    expect(r.linha).not.toBeNull();
    expect(r.documento).toBe(arquivo.slice(0, 6));
    expect(r.avisos).toEqual([]);
  });
});

describe("escolherTitulo", () => {
  const t = (id: string, vencimento: string, valorCentavos: number, extra: Partial<{ cedido: boolean; temBoleto: boolean }> = {}) =>
    ({ id, documento: `4002345${id}`, vencimento, valorCentavos, cedido: true, temBoleto: false, ...extra });
  const boleto = (vencimento: string, valorCentavos: number, akf = true) => ({ linha: { linha: "", banco: "237", vencimento, valorCentavos }, beneficiarioAkf: akf });

  it("parcela única", () => {
    expect(escolherTitulo(boleto("2026-11-10", 100), [t("U", "2026-11-10", 100)])).toEqual({ tituloId: "U", avisos: [] });
  });
  it("várias parcelas: pela linha digitável; sem linha, a pessoa escolhe", () => {
    const parcelas = [t("A", "2026-11-10", 100), t("B", "2026-12-10", 100)];
    expect(escolherTitulo(boleto("2026-12-10", 100), parcelas).tituloId).toBe("B");
    expect(escolherTitulo(null, parcelas)).toEqual({ tituloId: null, avisos: ["A NF tem 2 parcelas: escolha a parcela deste boleto."] });
  });
  it("avisos: divergência, AKF em título não cedido, substituição, NF sem título", () => {
    const r = escolherTitulo(boleto("2026-11-11", 150), [t("U", "2026-11-10", 100, { cedido: false, temBoleto: true })]);
    expect(r.tituloId).toBe("U");
    expect(r.avisos).toEqual([
      "Vencimento do boleto 11/11/2026 × título 10/11/2026.",
      "Valor do boleto diferente do título (1,50 × 1,00).",
      "Boleto da AKF, mas o título não está marcado como cedido.",
      "O título já tem boleto: este passa a valer (o anterior fica guardado).",
    ]);
    expect(escolherTitulo(null, []).avisos[0]).toMatch(/Nenhuma parcela/);
    expect(escolherTitulo(boleto("2026-11-10", 100), [{ ...t("U", "2026-11-10", 100), aceitaBoletoFactoring: false }]).avisos)
      .toEqual(["Cliente NÃO aceita boleto de factoring: este boleto é da AKF."]);
  });
});
