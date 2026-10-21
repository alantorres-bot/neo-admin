// Leitor do CSV de banco de horas do Control iD (calibrado com relatorio_20261021_1647.CSV): uma linha por pessoa e dia,
// separador ";", UTF-8 com BOM. Colunas: Id;Nome;CPF;PIS;Data;Banco Negativo;Banco Positivo;Saldo Banco;Total Compensado;
// A Compensar;Descontar Folha;Pagar Folha;Detalhes. Guarda só o necessário (o PIS fica de fora, LGPD): por pessoa, os dias com
// crédito ou débito e o último saldo do Control iD. Regra pura: recebe a matriz já lida (lerCsv).
import { minutos } from "@/lib/modulos/rh/ponto/modulo";

export type PessoaLida = {
  idControlId: string;
  nome: string;
  /** só dígitos (11) */
  cpf: string;
  movimentos: { data: string; positivoMin: number; negativoMin: number }[];
  /** último saldo do Control iD no período (null = pessoa sem banco) e a data dele */
  saldoControlIdMin: number | null;
  saldoEm: string | null;
};

export type BancoLido = { inicio: string | null; fim: string | null; linhas: number; pessoas: PessoaLida[]; avisos: string[] };

const COLUNAS = ["Id", "Nome", "CPF", "PIS", "Data", "Banco Negativo", "Banco Positivo", "Saldo Banco"];
const chave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function lerBancoHoras(matriz: readonly (readonly string[])[]): BancoLido {
  const avisos: string[] = [];
  const cab = (matriz[0] ?? []).map((c) => chave(c.replace(/^﻿/, "")));
  const col = Object.fromEntries(COLUNAS.map((c) => [c, cab.indexOf(chave(c))])) as Record<string, number>;
  const faltam = COLUNAS.filter((c) => col[c] < 0);
  if (faltam.length) return { inicio: null, fim: null, linhas: 0, pessoas: [], avisos: [`Não é o CSV de banco de horas do Control iD: faltam as colunas ${faltam.join(", ")}.`] };

  const porCpf = new Map<string, PessoaLida & { ultimoSaldo: { data: string; min: number | null; anterior: number | null } | null }>();
  let inicio: string | null = null;
  let fim: string | null = null;
  let linhas = 0;
  let saltos = 0;
  for (const [i, l] of matriz.slice(1).entries()) {
    if (l.every((c) => !c.trim())) continue;
    const cpf = (l[col.CPF] ?? "").replace(/\D/g, "");
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((l[col.Data] ?? "").trim());
    if (cpf.length !== 11 || !d) {
      avisos.push(`Linha ${i + 2} ignorada (CPF ou data inválidos).`);
      continue;
    }
    const data = `${d[3]}-${d[2]}-${d[1]}`;
    const neg = minutos(l[col["Banco Negativo"]]) ?? 0;
    const pos = minutos(l[col["Banco Positivo"]]) ?? 0;
    const saldoTxt = (l[col["Saldo Banco"]] ?? "").trim();
    const saldo = saldoTxt ? minutos(saldoTxt) : null;
    linhas++;
    if (!inicio || data < inicio) inicio = data;
    if (!fim || data > fim) fim = data;
    let p = porCpf.get(cpf);
    if (!p) {
      p = { idControlId: (l[col.Id] ?? "").trim(), nome: (l[col.Nome] ?? "").trim(), cpf, movimentos: [], saldoControlIdMin: null, saldoEm: null, ultimoSaldo: null };
      porCpf.set(cpf, p);
    }
    if (pos || neg) p.movimentos.push({ data, positivoMin: Math.abs(pos), negativoMin: Math.abs(neg) });
    // conferência: o saldo do Control iD = saldo anterior + positivo − negativo
    if (p.ultimoSaldo && p.ultimoSaldo.min !== null && saldo !== null && p.ultimoSaldo.min + Math.abs(pos) - Math.abs(neg) !== saldo) saltos++;
    if (!p.ultimoSaldo || data > p.ultimoSaldo.data) p.ultimoSaldo = { data, min: saldo, anterior: p.ultimoSaldo?.min ?? null };
  }
  if (saltos) avisos.push(`${saltos} dia(s) em que o saldo do Control iD não bate com saldo anterior + positivo − negativo (ajuste manual no Control iD?).`);
  if (linhas === 0) avisos.push("O CSV não tem linhas de banco de horas.");
  const pessoas = [...porCpf.values()].map(({ ultimoSaldo, ...p }) => ({ ...p, saldoControlIdMin: ultimoSaldo?.min ?? null, saldoEm: ultimoSaldo?.data ?? null }));
  return { inicio, fim, linhas, pessoas, avisos };
}
