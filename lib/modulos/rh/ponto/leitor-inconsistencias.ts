// Leitor do relatório "Inconsistências" do Control iD (um PDF por setor e quinzena). O PDF vira itens de texto POSICIONADOS
// (extrairPaginasDoPdf, o mesmo do cartão) e este leitor monta as colunas pelos TÍTULOS do cabeçalho (DIA, PREVISTO, ENT. 1,
// SAÍ. 1 … BANCO SALDO): cada valor cai na coluna cujo título começa à esquerda dele. Assim não depende de coordenadas fixas.
//  - Período: "DE 26/09/2026 ATÉ 11/10/2026" no topo.
//  - Pessoa: "<NOME> - NÚMERO DE MATRÍCULA: <n> - NOME DO CARGO: <cargo>".
//  - Dia: "30/09/26 - QUA" + previsto + marcações + totais. "TOTAIS" fecha a pessoa (ignorado).
// O PDF reimpresso pelo "Microsoft Print to PDF" não tem texto (as letras viram desenho): extrairPaginasDoPdf já recusa.
// Regra pura: não abre arquivo nem acessa banco.
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { minutos } from "./modulo";

export type OcorrenciaLida = {
  ordem: number;
  nome: string;
  matricula: string | null;
  cargo: string | null;
  /** 'AAAA-MM-DD' */
  data: string;
  diaSemana: string;
  previsto: string;
  /** ENT.1, SAÍ.1 … SAÍ.3 como vieram ("*11:57*" = marcação incluída/ajustada no Control iD; "FALTA"). Vazias ficam "". */
  marcacoes: string[];
  falta: boolean;
  faltaAtrasoMin: number;
  totalNormaisMin: number | null;
  extrasMin: number;
  bancoSaldoMin: number | null;
};

export type RelatorioLido = { inicio: string | null; fim: string | null; ocorrencias: OcorrenciaLida[]; avisos: string[] };

type Coluna = "dia" | "previsto" | "ent1" | "sai1" | "ent2" | "sai2" | "ent3" | "sai3" | "normais" | "noturno" | "diaFalta" | "faltaAtraso"
  | "abono" | "extra50" | "extraDiurna" | "extraNoturna" | "bancoTotal" | "bancoSaldo";

const TITULOS: Record<string, Coluna> = {
  DIA: "dia", PREVISTO: "previsto", ENT1: "ent1", SAI1: "sai1", ENT2: "ent2", SAI2: "sai2", ENT3: "ent3", SAI3: "sai3",
  TOTALNORMAIS: "normais", TOTALNOTURNO: "noturno", DIAFALTA: "diaFalta", FALTAEATRASO: "faltaAtraso", ABONO: "abono",
  "EXTRA50%D": "extra50", EXTRA50D: "extra50", EXTRA50: "extra50", EXTRADIURNA: "extraDiurna", EXTRANOTURNA: "extraNoturna",
  BANCOTOTAL: "bancoTotal", BANCOSALDO: "bancoSaldo",
};
const MARCACOES: Coluna[] = ["ent1", "sai1", "ent2", "sai2", "ent3", "sai3"];

const chave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s.]/g, "");
const texto = (l: readonly ItemTexto[]) => l.map((i) => i.texto).join(" ").replace(/\s+/g, " ").trim();
const DIA = /^(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*([A-ZÇÁÉÍÓÚÂÊÔÃÕ]{3})/i;
const PESSOA = /^(.+?)\s*-\s*N[ÚU]MERO DE MATR[ÍI]CULA:\s*(\S*)\s*-\s*NOME DO CARGO:\s*(.*)$/i;
const PERIODO = /DE\s+(\d{2})\/(\d{2})\/(\d{4})\s+AT[ÉE]\s+(\d{2})\/(\d{2})\/(\d{4})/i;

/** Agrupa os itens em linhas (mesmo y, com tolerância), da esquerda para a direita. */
function linhas(itens: readonly ItemTexto[]): ItemTexto[][] {
  const saida: ItemTexto[][] = [];
  for (const i of [...itens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const ultima = saida[saida.length - 1];
    if (ultima && Math.abs(ultima[0].y - i.y) <= 2.5) ultima.push(i);
    else saida.push([i]);
  }
  return saida.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Colunas pelo cabeçalho (títulos em uma ou duas linhas: "TOTAL"/"NORMAIS"). Devolve o início (x) de cada coluna. */
function colunasDoCabecalho(ls: ItemTexto[][]): { coluna: Coluna; x: number }[] | null {
  const k = ls.findIndex((l) => l.some((i) => chave(i.texto) === "PREVISTO"));
  if (k < 0) return null;
  const y0 = ls[k][0].y;
  // títulos de duas linhas: junta os itens da faixa do cabeçalho que se sobrepõem na horizontal (alinhados à esquerda ou
  // centralizados), de cima para baixo
  const faixa = ls.filter((l) => Math.abs(l[0].y - y0) <= 9).flat().sort((a, b) => a.x - b.x || a.y - b.y);
  const sobrepoe = (a: ItemTexto, b: ItemTexto) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
  const grupos: ItemTexto[][] = [];
  for (const i of faixa) {
    const g = grupos.find((gr) => gr.some((j) => Math.abs(j.y - i.y) > 2.5 && sobrepoe(i, j)));
    if (g) g.push(i);
    else grupos.push([i]);
  }
  const colunas: { coluna: Coluna; x: number }[] = [];
  for (const g of grupos) {
    const c = TITULOS[chave(g.sort((a, b) => a.y - b.y).map((i) => i.texto).join(""))];
    if (c && !colunas.some((x) => x.coluna === c)) colunas.push({ coluna: c, x: Math.min(...g.map((i) => i.x)) });
  }
  return colunas.some((c) => c.coluna === "dia") && colunas.some((c) => c.coluna === "faltaAtraso") ? colunas.sort((a, b) => a.x - b.x) : null;
}

/** Valores de uma linha de dia por coluna: cada item vai para a coluna mais à direita cujo título começa até 6 pt depois dele. */
function porColuna(l: readonly ItemTexto[], colunas: readonly { coluna: Coluna; x: number }[]): Partial<Record<Coluna, string>> {
  const r: Partial<Record<Coluna, string>> = {};
  for (const i of l) {
    const c = [...colunas].reverse().find((col) => col.x <= i.x + 6) ?? colunas[0];
    r[c.coluna] = r[c.coluna] ? `${r[c.coluna]} ${i.texto.trim()}` : i.texto.trim();
  }
  return r;
}

const min = (t: string | undefined) => minutos((t ?? "").replace(/\*/g, ""));

export function lerInconsistencias(paginas: readonly PaginaTexto[]): RelatorioLido {
  const avisos: string[] = [];
  const ocorrencias: OcorrenciaLida[] = [];
  let inicio: string | null = null;
  let fim: string | null = null;
  let pessoa: { nome: string; matricula: string | null; cargo: string | null } | null = null;
  let colunas: { coluna: Coluna; x: number }[] | null = null;

  for (const p of paginas) {
    const ls = linhas(p.itens);
    colunas = colunasDoCabecalho(ls) ?? colunas;   // o cabeçalho se repete a cada página; se faltar, vale o anterior
    for (const l of ls) {
      const t = texto(l);
      const per = PERIODO.exec(t);
      if (per && !inicio) {
        inicio = `${per[3]}-${per[2]}-${per[1]}`;
        fim = `${per[6]}-${per[5]}-${per[4]}`;
        continue;
      }
      const pe = PESSOA.exec(t);
      if (pe) {
        const mat = pe[2].trim();
        pessoa = { nome: pe[1].trim(), matricula: /^\d+$/.test(mat) && Number(mat) > 0 ? mat : null, cargo: pe[3].trim() || null };
        continue;
      }
      const d = DIA.exec(t);
      if (!d || !colunas) continue;
      if (!pessoa) {
        avisos.push(`Dia ${d[1]}/${d[2]} sem funcionário antes dele (página ${p.numero}).`);
        continue;
      }
      // a data e o dia da semana podem vir em itens separados ("30/09/26", "-", "QUA"): tira-os antes de distribuir
      const resto = l.filter((i) => i.x > (colunas!.find((c) => c.coluna === "previsto")?.x ?? 0) - 6);
      const v = porColuna(resto, colunas);
      const ano = d[3].length === 2 ? `20${d[3]}` : d[3];
      const marcacoes = MARCACOES.map((c) => v[c] ?? "");
      const falta = marcacoes.some((m) => /FALTA/i.test(m)) || (v.diaFalta ?? "").trim() === "1";
      ocorrencias.push({
        ordem: ocorrencias.length + 1,
        nome: pessoa.nome, matricula: pessoa.matricula, cargo: pessoa.cargo,
        data: `${ano}-${d[2]}-${d[1]}`, diaSemana: d[4].toUpperCase(),
        previsto: v.previsto ?? "",
        marcacoes: falta ? marcacoes.map((m) => (/FALTA/i.test(m) ? "" : m)) : marcacoes,
        falta,
        faltaAtrasoMin: min(v.faltaAtraso) ?? 0,
        totalNormaisMin: min(v.normais),
        extrasMin: (min(v.extra50) ?? 0) + (min(v.extraNoturna) ?? 0) + (v.extra50 ? 0 : min(v.extraDiurna) ?? 0),
        bancoSaldoMin: min(v.bancoSaldo),
      });
    }
  }
  if (!colunas) avisos.push("Não encontrei o cabeçalho do relatório (DIA, PREVISTO, ENT. 1…). É o relatório \"Inconsistências\" do Control iD?");
  if (!inicio) avisos.push("Não encontrei o período (\"DE dd/mm/aaaa ATÉ dd/mm/aaaa\").");
  if (colunas && ocorrencias.length === 0) avisos.push("Nenhuma ocorrência encontrada no relatório.");
  if (inicio && fim) {
    const fora = ocorrencias.filter((o) => o.data < inicio! || o.data > fim!).length;
    if (fora) avisos.push(`${fora} ocorrência(s) com data fora do período ${inicio} a ${fim}.`);
  }
  return { inicio, fim, ocorrencias, avisos };
}
