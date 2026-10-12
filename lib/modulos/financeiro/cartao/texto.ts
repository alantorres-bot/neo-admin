// Utilidades de texto e valor da conciliação de cartão (porta de `conciliar.py` da skill conciliacao-fatura-cartao).

/** Maiúsculas, sem acento, espaços colapsados. */
export function normalizar(texto: string | null | undefined): string {
  if (!texto) return "";
  return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Valor em texto → centavos inteiros. Aceita "1.234,56", "1234.56", "R$ -50,00", "-R$ 50,00", "(50,00)", "−50,00".
 * Devolve `null` quando não há número.
 */
export function paraCentavos(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  const s = valor.trim();
  if (!s) return null;
  const negativo = /^[-−]/.test(s) || /R\$\s*[-−]/.test(s) || (s.includes("(") && s.includes(")"));
  let n = s.replace(/[^\d,.]/g, "");
  if (!n || !/\d/.test(n)) return null;
  if (n.includes(",") && n.includes(".")) {
    n = n.lastIndexOf(",") > n.lastIndexOf(".") ? n.replace(/\./g, "").replace(",", ".") : n.replace(/,/g, "");
  } else if (n.includes(",")) {
    n = n.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, ""); // "1.234" = milhar
  }
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  const c = Math.round(num * 100);
  return negativo ? -c : c;
}

/** 123456 → "1.234,56"; -5000 → "-50,00" (sem "R$", como na planilha da skill). */
export function brl(centavos: number): string {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `${centavos < 0 ? "-" : ""}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/**
 * Semelhança entre dois textos (0 a 1), pelo algoritmo de Ratcliff/Obershelp — o mesmo do `SequenceMatcher.ratio()` do
 * Python, para manter os limiares calibrados na skill (0,45 casamento fraco; 0,60 compensação; 0,80 grafia do cartão).
 */
export function semelhanca(a: string, b: string): number {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  return (2 * blocosIguais(x, y)) / (x.length + y.length);
}

function blocosIguais(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  // maior substring comum
  let melhor = 0, ia = 0, ib = 0;
  const anterior = new Array<number>(b.length + 1).fill(0);
  const atual = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        atual[j] = anterior[j - 1] + 1;
        if (atual[j] > melhor) { melhor = atual[j]; ia = i - melhor; ib = j - melhor; }
      } else atual[j] = 0;
    }
    for (let j = 0; j <= b.length; j++) { anterior[j] = atual[j]; atual[j] = 0; }
  }
  if (melhor === 0) return 0;
  return melhor + blocosIguais(a.slice(0, ia), b.slice(0, ib)) + blocosIguais(a.slice(ia + melhor), b.slice(ib + melhor));
}

/** "dd/mm/aaaa" ou "aaaa-mm-dd" → "aaaa-mm-dd"; null se não for data. */
export function paraIso(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.trim().slice(0, 10);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(t);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Dias entre duas datas ISO (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

/** Soma dias a uma data ISO. */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + dias));
  return d.toISOString().slice(0, 10);
}
