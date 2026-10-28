// Contratos/Operações — número do contrato (docs/modulos/contratos-operacoes.md, 5.5.2; R4-P6 — Numeração).
// Aprovado: número informado à mão, único por empresa independentemente do tipo, com zeros à esquerda normalizados.
// Não há sugestão nem geração de número. Números compostos (ex.: 137/2026) ficam como digitados [PENDENTE 8].

export type NumeroNormalizado =
  | { ok: true; numero: string; normalizado: string; composto: boolean }
  | { ok: false; erro: string };

/**
 * Normaliza o número para comparação. Só dígitos: tira os zeros à esquerda ("0137" → "137").
 * Composto (qualquer outro caractere): fica como digitado, sem espaços nas bordas, e marcado `composto` —
 * a regra dos componentes e do ano é o PENDENTE 8 e não é inventada aqui.
 */
export function normalizarNumeroContrato(entrada: string | null | undefined): NumeroNormalizado {
  const numero = (entrada ?? "").trim();
  if (numero === "") return { ok: false, erro: "Informe o número do contrato." };
  if (/^\d+$/.test(numero)) return { ok: true, numero, normalizado: numero.replace(/^0+(?=\d)/, ""), composto: false };
  return { ok: true, numero, normalizado: numero, composto: true };
}

export type ContratoNumerado = { id?: string; empresaId: string; numero: string };

/**
 * Procura outro contrato da mesma empresa com o mesmo número normalizado, qualquer que seja o tipo.
 * Devolve a mensagem de recusa, ou null quando o número está livre. Nunca corrige o número sozinho.
 */
export function conferirNumeroUnico(novo: ContratoNumerado, existentes: readonly ContratoNumerado[]): string | null {
  const n = normalizarNumeroContrato(novo.numero);
  if (!n.ok) return n.erro;
  const repetido = existentes.find((c) => {
    if (c.empresaId !== novo.empresaId || (novo.id !== undefined && c.id === novo.id)) return false;
    const e = normalizarNumeroContrato(c.numero);
    return e.ok && e.normalizado === n.normalizado;
  });
  return repetido ? `Já existe o contrato ${repetido.numero} nesta empresa.` : null;
}
