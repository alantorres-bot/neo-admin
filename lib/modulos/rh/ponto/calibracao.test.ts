// Calibração do leitor de inconsistências com relatórios REAIS do Control iD (que NÃO entram no repositório: têm nome de
// funcionário). NEO_AMOSTRAS_PONTO aponta para uma pasta com os PDFs originais (relatorio_AAAAMMDD_HHMM.PDF, salvos direto do
// Control iD; o reimpresso pelo "Microsoft Print to PDF" não tem texto). Para cada um, exige período, ocorrências e nenhum aviso.
// Sem a variável, pula.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { lerInconsistencias } from "./leitor-inconsistencias";

const PASTA = process.env.NEO_AMOSTRAS_PONTO;

// Conferido à mão no PDF, por nome de arquivo. relatorio_20261021_1447: Fábrica, 26/09 a 12/10/2026, emitido em 21/10 (só o que
// ainda estava inconsistente): 5 pessoas, 7 dias; layout com 2 entradas e 2 saídas.
const ESPERADO: Record<string, { inicio: string; fim: string; pessoas: number; ocorrencias: number; conferir?: (r: ReturnType<typeof lerInconsistencias>) => void }> = {
  "relatorio_20261021_1447.PDF": {
    inicio: "2026-09-26", fim: "2026-10-12", pessoas: 5, ocorrencias: 7,
    conferir: (r) => {
      expect(r.ocorrencias[0]).toMatchObject({ data: "2026-10-01", falta: true, faltaAtrasoMin: 540, bancoSaldoMin: 130, matricula: null });
      expect(r.ocorrencias[1]).toMatchObject({ nome: "CASSIANO DA SILVA", matricula: "7", marcacoes: ["07:00", "11:01", "11:56", "15:00", "", ""], faltaAtrasoMin: 60, bancoSaldoMin: -848 });
      expect(r.ocorrencias[3]).toMatchObject({ data: "2026-09-29", marcacoes: ["06:59", "11:01", "", "", "", ""], faltaAtrasoMin: 300, bancoSaldoMin: null });
    },
  },
};

describe.skipIf(!PASTA)("calibração: relatórios reais do Control iD", () => {
  const arquivos = PASTA ? readdirSync(PASTA).filter((f) => /\.pdf$/i.test(f)) : [];
  it.each(arquivos)("%s", async (arquivo) => {
    const ext = await extrairPaginasDoPdf(readFileSync(join(PASTA!, arquivo)));
    expect(ext.ok, ext.ok ? "" : ext.erro).toBe(true);
    if (!ext.ok) return;
    const r = lerInconsistencias(ext.paginas);
    console.log(arquivo, JSON.stringify(r, null, 1));
    expect(r.avisos).toEqual([]);
    expect(r.inicio).not.toBeNull();
    expect(r.ocorrencias.length).toBeGreaterThan(0);
    const e = ESPERADO[arquivo];
    if (e) {
      expect([r.inicio, r.fim]).toEqual([e.inicio, e.fim]);
      expect(new Set(r.ocorrencias.map((o) => o.nome)).size).toBe(e.pessoas);
      expect(r.ocorrencias.length).toBe(e.ocorrencias);
      e.conferir?.(r);
    }
  });
});
