// Calibração do leitor com CSVs reais do Control iD (fora do repositório: têm CPF). NEO_AMOSTRAS_BANCO_HORAS aponta para a
// pasta. Sem a variável, pula.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerCsv } from "@/lib/integracoes/importador/ler-arquivo";
import { lerBancoHoras } from "./leitor-csv";

const PASTA = process.env.NEO_AMOSTRAS_BANCO_HORAS;

// Conferido à mão no arquivo: relatorio_20261021_1647 (geral, 22/09 a 21/10/2026): 57 pessoas, 1.710 linhas.
const ESPERADO: Record<string, { inicio: string; fim: string; pessoas: number; linhas: number; saldos: Record<string, number | null> }> = {
  "relatorio_20261021_1647.CSV": { inicio: "2026-09-22", fim: "2026-10-21", pessoas: 57, linhas: 1710, saldos: { "CASSIANO DA SILVA": -848, "ARNALDO FRANCISCO DOURADO": 51, "GENIEL PEDRO DE LUCENA": 26 * 60 + 4, "HEBER DOS SANTOS SILVA": null } },
};

describe.skipIf(!PASTA)("calibração: CSV real do Control iD", () => {
  const arquivos = PASTA ? readdirSync(PASTA).filter((f) => /\.csv$/i.test(f)) : [];
  it.each(arquivos)("%s", (arquivo) => {
    const b = readFileSync(join(PASTA!, arquivo));
    const [p] = lerCsv(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { delimitador: ";" });
    const r = lerBancoHoras(p.matriz);
    expect(r.avisos).toEqual([]);
    const e = ESPERADO[arquivo];
    if (!e) return;
    expect([r.inicio, r.fim, r.pessoas.length, r.linhas]).toEqual([e.inicio, e.fim, e.pessoas, e.linhas]);
    for (const [nome, saldo] of Object.entries(e.saldos)) expect(r.pessoas.find((x) => x.nome === nome)?.saldoControlIdMin).toBe(saldo);
    // o saldo final de cada pessoa = primeiro saldo + movimentos (a conferência do leitor já cobre dia a dia)
    expect(r.pessoas.reduce((s, x) => s + x.movimentos.length, 0)).toBe(119 + 23);
  });
});
