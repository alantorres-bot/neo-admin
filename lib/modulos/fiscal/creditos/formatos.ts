// Fiscal > Créditos tributários: formatos brasileiros (R$ 1.234,56, dd/mm/aaaa, MM/AAAA) e leitura de valores digitados.
// Valores circulam em CENTAVOS inteiros dentro da aplicação (sem erro de ponto flutuante) e vão ao banco como texto
// decimal "1234.56" (numeric(14,2)). Nada é arredondado em silêncio: mais de 2 casas é erro.

/** 123456 -> 'R$ 1.234,56' */
export function moeda(centavos: number): string {
  const negativo = centavos < 0;
  const [inteiro, frac] = (Math.abs(Math.round(centavos)) / 100).toFixed(2).split(".");
  return `${negativo ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/** Valor numeric do banco (string ou número, em reais) -> centavos inteiros. */
export function centavos(valor: string | number | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const texto = typeof valor === "number" ? valor.toFixed(2) : String(valor).trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(texto);
  if (!m) return Math.round(Number(texto) * 100);
  const c = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -c : c;
}

/** Valor do banco direto para 'R$ 1.234,56'. */
export const reais = (valor: string | number | null | undefined) => moeda(centavos(valor));

/** Centavos -> '1234.56' (para o banco). */
export function decimal(c: number): string {
  const negativo = c < 0;
  const abs = Math.abs(Math.trunc(c));
  return `${negativo ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type LeituraValor = { ok: true; centavos: number } | { ok: false; erro: string };

/**
 * Lê o valor digitado em padrão brasileiro: '1.234,56', '1234,56', '1234', 'R$ 12,5', '-10,00'. Também aceita número
 * decimal de planilha (1234.56). Mais de 2 casas decimais é recusado (não arredonda em silêncio).
 */
export function lerValor(entrada: string | number | null | undefined, opcoes: { permitirNegativo?: boolean; permitirZero?: boolean } = {}): LeituraValor {
  if (entrada === null || entrada === undefined || (typeof entrada === "string" && entrada.trim() === "")) return { ok: false, erro: "Informe o valor." };
  let texto: string;
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) return { ok: false, erro: "Valor inválido." };
    // número vindo de planilha: aceita imprecisão binária (0.1 + 0.2), mas não mais de 2 casas "de verdade"
    const c = Math.round(entrada * 100);
    if (Math.abs(entrada * 100 - c) > 1e-6) return { ok: false, erro: "O valor deve ter no máximo 2 casas decimais." };
    texto = decimal(c);
  } else {
    texto = entrada.replace(/R\$|\s/g, "");
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(texto) || /^-?\d+(,\d+)?$/.test(texto)) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else if (!/^-?\d+(\.\d+)?$/.test(texto)) {
      return { ok: false, erro: `Valor inválido: "${entrada}". Use o formato 1.234,56.` };
    }
  }
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) return { ok: false, erro: "Valor inválido." };
  if ((m[3] ?? "").length > 2) return { ok: false, erro: "O valor deve ter no máximo 2 casas decimais." };
  if (m[2].length > 12) return { ok: false, erro: "Valor acima do limite." };
  const c = (Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"))) * (m[1] ? -1 : 1);
  if (c < 0 && !opcoes.permitirNegativo) return { ok: false, erro: "O valor não pode ser negativo." };
  if (c === 0 && !opcoes.permitirZero) return { ok: false, erro: "O valor deve ser maior que zero." };
  return { ok: true, centavos: c };
}

/** Soma exata em centavos. */
export const somar = (valores: readonly number[]) => valores.reduce((s, v) => s + Math.round(v), 0);

/** 'aaaa-mm-dd' -> 'dd/mm/aaaa' */
export function data(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Data e hora (timestamptz) em Cuiabá: 'dd/mm/aaaa hh:mm'. */
export function dataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** 'dd/mm/aaaa' ou 'aaaa-mm-dd' -> 'aaaa-mm-dd' (null se inválida). */
export function lerData(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  const t = entrada.trim();
  let a: number, m: number, d: number;
  let r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (r) [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || a < 1990 || a > 2100) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Competência 'MM/AAAA', 'AAAA-MM' ou 'AAAA-MM-DD' -> 'AAAA-MM-01' (null se inválida). */
export function lerCompetencia(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  const t = entrada.trim();
  let r = /^(\d{1,2})\/(\d{4})$/.exec(t);
  let a: number, m: number;
  if (r) [m, a] = [Number(r[1]), Number(r[2])];
  else if ((r = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(t))) [a, m] = [Number(r[1]), Number(r[2])];
  else return null;
  if (m < 1 || m > 12 || a < 2000 || a > 2100) return null;
  return `${a}-${String(m).padStart(2, "0")}-01`;
}

/** 'AAAA-MM-01' -> 'MM/AAAA' */
export function competencia(iso: string | null | undefined): string {
  if (!iso) return "";
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Soma `n` meses a 'AAAA-MM-01'. */
export function somarMeses(comp: string, n: number): string {
  const a = Number(comp.slice(0, 4)), m = Number(comp.slice(5, 7)) - 1 + n;
  const ano = a + Math.floor(m / 12), mes = ((m % 12) + 12) % 12;
  return `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

/** As 12 competências do exercício. */
export const competenciasDoAno = (ano: number) => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);

/** CNPJ só dígitos -> 00.000.000/0000-00 */
export function cnpj(digitos: string | null | undefined): string {
  const d = (digitos ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}
