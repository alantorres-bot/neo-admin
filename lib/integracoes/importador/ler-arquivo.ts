// Leitura de CSV e XLSX no navegador (ou no Node, nos testes). Devolve matrizes de texto;
// quem interpreta datas e valores é o módulo que usa a importação.
import Papa from "papaparse";
import type { Matriz } from "./tabela";

export type Planilha = { nome: string; matriz: Matriz };

export const TAMANHO_MAXIMO_IMPORTACAO = 15 * 1024 * 1024; // 15 MB

export type OpcoesLeitura = {
  /** ';', ',', '\t' ou '|'. Sem valor, detecta sozinho. */
  delimitador?: string;
};

/** CSV do Consistem costuma vir em Windows-1252; tenta UTF-8 estrito e cai para Windows-1252. */
export function decodificarTexto(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function lerCsv(buffer: ArrayBuffer, opcoes: OpcoesLeitura = {}): Planilha[] {
  const texto = decodificarTexto(buffer);
  const r = Papa.parse<string[]>(texto, {
    skipEmptyLines: "greedy",
    delimiter: opcoes.delimitador ?? "",
    delimitersToGuess: [";", ",", "\t", "|"],
  });
  const matriz = r.data.map((linha) => linha.map((c) => String(c ?? "").trim()));
  return [{ nome: "CSV", matriz }];
}

type ValorCelula = unknown;

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Células do Excel viram texto: datas em dd/mm/aaaa (UTC, para não deslocar o dia), fórmulas pelo resultado. */
export function textoDaCelula(valor: ValorCelula): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) {
    const data = `${doisDigitos(valor.getUTCDate())}/${doisDigitos(valor.getUTCMonth() + 1)}/${valor.getUTCFullYear()}`;
    const temHora = valor.getUTCHours() !== 0 || valor.getUTCMinutes() !== 0;
    return temHora ? `${data} ${doisDigitos(valor.getUTCHours())}:${doisDigitos(valor.getUTCMinutes())}` : data;
  }
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    if (Array.isArray(o.richText)) return o.richText.map((p) => String((p as { text?: string }).text ?? "")).join("").trim();
    if ("result" in o) return textoDaCelula(o.result);
    if ("text" in o) return textoDaCelula(o.text);
    if ("error" in o) return "";
    return "";
  }
  return String(valor).trim();
}

export async function lerXlsx(buffer: ArrayBuffer): Promise<Planilha[]> {
  const { default: ExcelJS } = await import("exceljs"); // só carrega quando o usuário envia um XLSX
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(buffer);
  const planilhas: Planilha[] = [];
  livro.eachSheet((aba) => {
    const matriz: Matriz = [];
    aba.eachRow({ includeEmpty: true }, (linha) => {
      const celulas: string[] = [];
      for (let c = 1; c <= linha.cellCount; c++) celulas.push(textoDaCelula(linha.getCell(c).value));
      matriz.push(celulas);
    });
    if (matriz.some((l) => l.some((c) => c !== ""))) planilhas.push({ nome: aba.name, matriz });
  });
  return planilhas;
}

export type ResultadoLeitura = { ok: true; planilhas: Planilha[] } | { ok: false; erro: string };

export async function lerBuffer(buffer: ArrayBuffer, nomeArquivo: string, opcoes: OpcoesLeitura = {}): Promise<ResultadoLeitura> {
  if (buffer.byteLength > TAMANHO_MAXIMO_IMPORTACAO) return { ok: false, erro: "O arquivo passa do limite de 15 MB." };
  const nome = nomeArquivo.toLowerCase();
  try {
    let planilhas: Planilha[];
    if (nome.endsWith(".csv") || nome.endsWith(".txt")) planilhas = lerCsv(buffer, opcoes);
    else if (nome.endsWith(".xlsx")) planilhas = await lerXlsx(buffer);
    else if (nome.endsWith(".xls")) return { ok: false, erro: "Arquivo .xls antigo não é suportado. Abra no Excel e salve como .xlsx ou .csv." };
    else return { ok: false, erro: "Formato não suportado. Use .csv ou .xlsx." };
    if (planilhas.length === 0 || planilhas.every((p) => p.matriz.length === 0)) return { ok: false, erro: "O arquivo não tem dados." };
    return { ok: true, planilhas };
  } catch (e) {
    return { ok: false, erro: `Não foi possível ler o arquivo: ${e instanceof Error ? e.message : "formato inválido"}` };
  }
}

export async function lerArquivo(arquivo: File, opcoes: OpcoesLeitura = {}): Promise<ResultadoLeitura> {
  return lerBuffer(await arquivo.arrayBuffer(), arquivo.name, opcoes);
}
