// Arquivo de crédito do BB (FOPAG), igual à aba "EXPORTA BB" da planilha de hoje: uma aba, cabeçalho CPF | AGENCIA | CONTA |
// VALOR, texto sem formatação e valor numérico. CPF no formato "000000000-00". Regra 8 de docs/modulos/rh-vale-transporte.md:
// só FOPAG com valor > 0; item FOPAG sem CPF, agência ou conta recusa o arquivo (o mês não sai pela metade).
import { somenteDigitos } from "@/lib/nucleo/documentos";
import type { FormaPagamento } from "./modulo";

export type ItemBB = { cod_fornecedor: string; nome: string; cpf: string | null; agencia: string | null; conta: string | null; forma_pagamento: FormaPagamento; valor: number };
export type LinhaBB = [string, string, string, number];

export const cpfBB = (cpf: string) => somenteDigitos(cpf).padStart(11, "0").replace(/^(\d{9})(\d{2})$/, "$1-$2");

export function linhasBB(itens: readonly ItemBB[]): { ok: true; linhas: LinhaBB[]; total: number } | { ok: false; erro: string } {
  const fopag = itens.filter((i) => i.forma_pagamento === "fopag" && i.valor > 0);
  const incompletos = fopag.filter((i) => !i.cpf || !i.agencia || !i.conta);
  if (incompletos.length) return { ok: false, erro: `FOPAG sem CPF, agência ou conta: ${incompletos.map((i) => `${i.cod_fornecedor} ${i.nome}`).join(", ")}.` };
  if (!fopag.length) return { ok: false, erro: "Nenhum FOPAG com valor neste mês." };
  const linhas = [...fopag].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((i): LinhaBB => [cpfBB(i.cpf!), i.agencia!, i.conta!, Math.round(i.valor * 100) / 100]);
  return { ok: true, linhas, total: Math.round(linhas.reduce((s, l) => s + l[3] * 100, 0)) / 100 };
}

export const nomeArquivoBB = (competencia: string) => `VT ${competencia.slice(5, 7)}-${competencia.slice(0, 4)} - EXPORTA BB.xlsx`;

/** Monta o XLSX em memória. Só no servidor (exceljs sob demanda). */
export async function gerarArquivoBB(linhas: readonly LinhaBB[]): Promise<Uint8Array> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "Neo Admin";
  const ws = wb.addWorksheet("EXPORTA BB");
  ws.addRow(["CPF", "AGENCIA", "CONTA", "VALOR"]);
  for (const l of linhas) ws.addRow([...l]);
  [16, 10, 12, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
