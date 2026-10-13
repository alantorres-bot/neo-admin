// Calibração do leitor da nota do Syslock com PDFs reais (que NÃO entram no repositório).
// NEO_AMOSTRAS_FILIAL aponta para uma pasta com notas "NF 0xxxx - CLIENTE.pdf". Para cada uma, exige: nº da nota igual ao do
// nome do arquivo, ao menos uma parcela, soma das parcelas = total da nota, cliente e obra encontrados. Sem a variável, pula.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairPaginasDoPdf } from "../cartao/fatura-pdf";
import { lerNomeArquivo } from "./arquivos";
import { lerNotaSyslock } from "./leitor-nota";

const PASTA = process.env.NEO_AMOSTRAS_FILIAL;

// Conferido no Consistem (títulos já implantados): emissão e CNPJ do cliente.
const CONSISTEM: Record<string, { emissao: string; documento: string }> = {
  "002317": { emissao: "2026-09-14", documento: "65.238.495/0001-37" },
  "002350": { emissao: "2026-10-08", documento: "36.882.425/0001-19" },
  "002351": { emissao: "2026-10-08", documento: "54.228.381/0001-90" },
  "002353": { emissao: "2026-10-08", documento: "45.498.204/0001-32" },
};

describe.skipIf(!PASTA)("calibração: notas reais do Syslock", () => {
  const arquivos = PASTA ? readdirSync(PASTA).filter((f) => /\.pdf$/i.test(f)) : [];
  it.each(arquivos)("%s", async (arquivo) => {
    const ext = await extrairPaginasDoPdf(readFileSync(join(PASTA!, arquivo)));
    expect(ext.ok).toBe(true);
    if (!ext.ok) return;
    const r = lerNotaSyslock(ext.paginas);
    console.log(arquivo, JSON.stringify({ ...r, avisos: r.avisos.length ? r.avisos : undefined }));
    expect(r.nota).toBe(lerNomeArquivo(arquivo).nota);
    expect(r.parcelas.length).toBeGreaterThan(0);
    expect(r.parcelas.reduce((s, p) => s + p.valorCentavos, 0)).toBe(r.totalCentavos);
    expect(r.cliente).toBeTruthy();
    expect(r.obra).toBeTruthy();
    expect(r.emissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.clienteDocumento).toBeTruthy();
    const c = r.nota ? CONSISTEM[r.nota] : undefined;
    if (c) {
      expect(r.emissao).toBe(c.emissao);
      expect(r.clienteDocumento).toBe(c.documento);
    }
    expect(r.avisos).toEqual([]);
  });
});
