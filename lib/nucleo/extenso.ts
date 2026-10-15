// Valor em reais por extenso (recibos): 1.234,56 → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos".

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 20) { if (r) partes.push(UNIDADES[r]); }
  else { partes.push(DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : "")); }
  return partes.join(" e ");
}

function inteiro(n: number): string {
  if (n === 0) return "zero";
  const grupos: [number, string, string][] = [[1_000_000_000, "bilhão", "bilhões"], [1_000_000, "milhão", "milhões"], [1_000, "mil", "mil"]];
  const partes: string[] = [];
  let resto = n;
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base);
    if (q) partes.push(base === 1000 && q === 1 ? "mil" : `${ate999(q)} ${q === 1 ? sing : plur}`);
    resto %= base;
  }
  if (resto) partes.push(ate999(resto));
  if (partes.length === 1) return partes[0];
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (mil e cem, mil e vinte); senão, só espaço
  // (mil duzentos e trinta e quatro).
  const ultimo = partes.pop()!;
  const juntaE = resto > 0 && (resto < 100 || resto % 100 === 0);
  return `${partes.join(" ")}${juntaE || resto === 0 ? " e " : " "}${ultimo}`.replace(/ e $/, "");
}

/** Centavos inteiros → texto. */
export function reaisPorExtenso(centavos: number): string {
  const c = Math.abs(Math.round(centavos));
  const reais = Math.floor(c / 100), cent = c % 100;
  const partes: string[] = [];
  if (reais) partes.push(`${inteiro(reais)}${reais % 1_000_000 === 0 && reais >= 1_000_000 ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  if (cent) partes.push(`${inteiro(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}
