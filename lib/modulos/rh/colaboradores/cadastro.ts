// Regras puras do cadastro de quem recebe vale-transporte (docs/modulos/rh-vale-transporte.md, seções 4 e 8).
import { formatarCpf, somenteDigitos, validarCpf } from "@/lib/nucleo/documentos";

/** Agência/conta como na planilha ("2764-2", "99149-X"): só dígitos, hífen opcional antes do dígito verificador (número ou X). */
const AGENCIA = /^\d{1,5}-?[0-9X]?$/;
const CONTA = /^\d{1,12}-?[0-9X]?$/;

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };

const limpar = (v: string | null | undefined) => (v ?? "").replace(/\s/g, "").toUpperCase();

export function normalizarAgencia(entrada: string | null | undefined): Resultado<string | null> {
  const v = limpar(entrada);
  if (v === "") return { ok: true, valor: null };
  return AGENCIA.test(v) ? { ok: true, valor: v } : { ok: false, erro: "Agência inválida (ex.: 2764-2)." };
}

export function normalizarConta(entrada: string | null | undefined): Resultado<string | null> {
  const v = limpar(entrada);
  if (v === "") return { ok: true, valor: null };
  return CONTA.test(v) ? { ok: true, valor: v } : { ok: false, erro: "Conta inválida (ex.: 99149-X)." };
}

/** CPF opcional; quando informado, dígitos verificadores conferidos e gravado com máscara. */
export function normalizarCpf(entrada: string | null | undefined): Resultado<string | null> {
  const d = somenteDigitos(entrada ?? "");
  if (d === "") return { ok: true, valor: null };
  return validarCpf(d) ? { ok: true, valor: formatarCpf(d) } : { ok: false, erro: "CPF inválido." };
}

/** Código de fornecedor do Consistem ("Nº" da planilha), sem zeros à esquerda. */
export function normalizarCodFornecedor(entrada: string | null | undefined): Resultado<string> {
  const v = (entrada ?? "").trim().replace(/^0+(?=\d)/, "");
  return /^\d{1,9}$/.test(v) && v !== "0" ? { ok: true, valor: v } : { ok: false, erro: "Informe o código de fornecedor do Consistem (número)." };
}

/** Valor em reais digitado ("4,95", "R$ 5,95", "8") para número com 2 casas; null se inválido ou não positivo. */
export function lerTarifa(entrada: string | null | undefined): number | null {
  const v = (entrada ?? "").replace(/R\$|\s/g, "");
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(v)) return null;
  const n = Math.round(Number(v.replace(",", ".")) * 100) / 100;
  return n > 0 ? n : null;
}

const normalizarNome = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export type FornecedorConsistem = { codFornecedor: string; nome: string; cpf: string | null; ativo: boolean };
export type CadastroComparavel = { cod_fornecedor: string; nome: string; cpf: string | null };
export type Divergencia = { campo: "nome" | "cpf" | "situacao"; aqui: string; consistem: string };

/**
 * Compara o cadastro do VT com o fornecedor do Consistem (fonte de nome e CPF). Nome compara sem acento/caixa/espaços;
 * CPF compara os dígitos. Fornecedor inativo no Consistem também é apontado.
 */
export function divergencias(c: CadastroComparavel, f: FornecedorConsistem): Divergencia[] {
  const lista: Divergencia[] = [];
  if (normalizarNome(c.nome) !== normalizarNome(f.nome)) lista.push({ campo: "nome", aqui: c.nome, consistem: f.nome });
  if (somenteDigitos(c.cpf ?? "") !== somenteDigitos(f.cpf ?? "")) lista.push({ campo: "cpf", aqui: c.cpf ?? "—", consistem: f.cpf ?? "—" });
  if (!f.ativo) lista.push({ campo: "situacao", aqui: "ativo", consistem: "inativo" });
  return lista;
}
