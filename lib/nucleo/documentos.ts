// CNPJ/CPF (algoritmo oficial de dígitos verificadores) e WhatsApp. Sempre gravamos o documento
// COM máscara, para que o índice único de `documento` trate '12345678000190' e '12.345.678/0001-90'
// como o mesmo cadastro.

export const somenteDigitos = (valor: string): string => valor.replace(/\D/g, "");

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function validarCnpj(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const d1 = digitoVerificador(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d === d.slice(0, 12) + d1 + d2;
}

export function validarCpf(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const d1 = digitoVerificador(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(d.slice(0, 9) + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d === d.slice(0, 9) + d1 + d2;
}

export function formatarCnpj(valor: string): string {
  const d = somenteDigitos(valor);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function formatarCpf(valor: string): string {
  const d = somenteDigitos(valor);
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export type ResultadoDocumento = { ok: true; valor: string | null } | { ok: false; erro: string };

/** Vazio é permitido (documento é opcional). 11 dígitos = CPF, 14 = CNPJ. */
export function normalizarDocumento(entrada: string | null | undefined): ResultadoDocumento {
  const d = somenteDigitos(entrada ?? "");
  if (d === "") return { ok: true, valor: null };
  if (d.length === 14) return validarCnpj(d) ? { ok: true, valor: formatarCnpj(d) } : { ok: false, erro: "CNPJ inválido." };
  if (d.length === 11) return validarCpf(d) ? { ok: true, valor: formatarCpf(d) } : { ok: false, erro: "CPF inválido." };
  return { ok: false, erro: "Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos)." };
}

export function normalizarCnpj(entrada: string | null | undefined): ResultadoDocumento {
  const d = somenteDigitos(entrada ?? "");
  if (d === "") return { ok: true, valor: null };
  return validarCnpj(d) ? { ok: true, valor: formatarCnpj(d) } : { ok: false, erro: "CNPJ inválido." };
}

/**
 * Celular/telefone brasileiro para o formato '+5565999999999'. Aceita com ou sem +55,
 * com DDD obrigatório. Retorna null quando não parece um número brasileiro válido.
 */
export function normalizarWhatsapp(entrada: string | null | undefined): string | null {
  let d = somenteDigitos(entrada ?? "");
  if (d.startsWith("0055")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!/^55[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(d)) return null;
  return "+" + d;
}

export function formatarWhatsapp(valor: string | null | undefined): string {
  const d = somenteDigitos(valor ?? "");
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (valor ?? "");
}
