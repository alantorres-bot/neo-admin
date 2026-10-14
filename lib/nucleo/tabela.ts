/**
 * Classificação e filtro das grades (componente `Table` de `components/ui/table.tsx`).
 * Trabalha sobre o texto exibido em cada célula: datas dd/mm/aaaa, valores "R$ 1.234,56" e texto livre.
 */

export type TipoColuna = "data" | "numero" | "texto";
export type Direcao = "asc" | "desc";

/** Filtro de uma coluna: trecho de texto e/ou lista de valores marcados (null = todos). */
export type FiltroColuna = { texto: string; valores: string[] | null };

/** Minúsculas, sem acento e com espaços simples — para comparar e buscar. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Texto da célula como aparece no filtro de valores: espaços simples, sem bordas. */
export function textoExibido(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** dd/mm/aaaa (com hora opcional), mm/aaaa ou aaaa-mm-dd → número comparável; null se não for data. */
export function interpretarData(texto: string): number | null {
  const t = textoExibido(texto);
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const [, d, mes, a, h = "0", min = "0", s = "0"] = m;
    if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return Date.UTC(Number(a), Number(mes) - 1, Number(d), Number(h), Number(min), Number(s));
  }
  m = /^(\d{2})\/(\d{4})$/.exec(t);
  if (m) {
    if (Number(m[1]) < 1 || Number(m[1]) > 12) return null;
    return Date.UTC(Number(m[2]), Number(m[1]) - 1, 1);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

/** "R$ 1.234,56", "-12,5%", "1.234", "(1.234,56)" → número; null se não for número no formato brasileiro. */
export function interpretarNumero(texto: string): number | null {
  let t = textoExibido(texto).replace(/R\$/g, "").replace(/%$/, "").replace(/\s/g, "");
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (/^[-−]/.test(t)) { negativo = !negativo; t = t.slice(1); }
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return negativo ? -n : n;
}

/** A coluna é de datas ou números só quando todos os valores preenchidos são; senão, texto. */
export function detectarTipo(valores: string[]): TipoColuna {
  const preenchidos = valores.map(textoExibido).filter((v) => v !== "" && v !== "—" && v !== "-");
  if (preenchidos.length === 0) return "texto";
  if (preenchidos.every((v) => interpretarData(v) !== null)) return "data";
  if (preenchidos.every((v) => interpretarNumero(v) !== null)) return "numero";
  return "texto";
}

const colacao = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function chaveDe(valor: string, tipo: TipoColuna): number | string | null {
  const v = textoExibido(valor);
  if (v === "" || v === "—" || v === "-") return null;
  if (tipo === "data") return interpretarData(v);
  if (tipo === "numero") return interpretarNumero(v);
  return v;
}

/**
 * Índices das linhas na ordem pedida. Ordenação estável; células vazias ("", "—") ficam sempre no fim,
 * em qualquer direção.
 */
export function ordenarIndices(linhas: string[][], coluna: number, direcao: Direcao): number[] {
  const tipo = detectarTipo(linhas.map((l) => l[coluna] ?? ""));
  const chaves = linhas.map((l) => chaveDe(l[coluna] ?? "", tipo));
  const sinal = direcao === "asc" ? 1 : -1;
  return linhas
    .map((_, i) => i)
    .sort((a, b) => {
      const ka = chaves[a];
      const kb = chaves[b];
      if (ka === null || kb === null) return ka === kb ? a - b : ka === null ? 1 : -1;
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : colacao.compare(String(ka), String(kb));
      return c !== 0 ? sinal * c : a - b;
    });
}

export function filtroAtivo(f: FiltroColuna | undefined): boolean {
  return !!f && (f.texto.trim() !== "" || f.valores !== null);
}

/** A linha aparece se contém a busca geral (em qualquer coluna) e atende ao filtro de cada coluna. */
export function linhaPassa(celulas: string[], filtros: Record<number, FiltroColuna>, busca: string): boolean {
  const b = normalizar(busca);
  if (b && !celulas.some((c) => normalizar(c).includes(b))) return false;
  for (const [col, f] of Object.entries(filtros)) {
    const valor = celulas[Number(col)] ?? "";
    const t = normalizar(f.texto);
    if (t && !normalizar(valor).includes(t)) return false;
    if (f.valores !== null && !f.valores.includes(textoExibido(valor))) return false;
  }
  return true;
}

/** Valores distintos da coluna, na ordem natural do tipo, com a quantidade de linhas de cada um. */
export function valoresDistintos(linhas: string[][], coluna: number): { valor: string; quantidade: number }[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const v = textoExibido(l[coluna] ?? "");
    contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }
  const valores = [...contagem.keys()];
  return ordenarIndices(valores.map((v) => [v]), 0, "asc").map((i) => ({ valor: valores[i], quantidade: contagem.get(valores[i])! }));
}
