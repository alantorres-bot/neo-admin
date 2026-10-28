// Contratos/Operações — condição de aplicação dos itens do modelo (docs/modulos/contratos-operacoes.md, 5.4.2 e 5.4.4).
// Formato fechado: {"todas":[{"campo":"x","op":"=","valor":true}]} ou {"alguma":[...]}. Sem condição, o item vale sempre.
// Campo não informado dá "desconhecido" (nunca "falso"): o motor cria `informar_condicao` e o item espera.

export const OPERADORES = ["=", "≠", ">", "≥", "<", "≤", "informado", "nao_informado"] as const;
export type Operador = (typeof OPERADORES)[number];

export type Comparacao = { campo: string; op: Operador; valor?: string | number | boolean };
export type Condicao = { todas: Comparacao[] } | { alguma: Comparacao[] };
export type ValorCampo = string | number | boolean | null | undefined;

export type ResultadoCondicao = "verdadeiro" | "falso" | "desconhecido";
export type AvaliacaoCondicao = { resultado: ResultadoCondicao; camposDesconhecidos: string[] };

/** Erro de configuração do modelo (campo inexistente, operador inválido, comparação sem sentido). */
export class ErroConfiguracaoCondicao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroConfiguracaoCondicao";
  }
}

const naoInformado = (v: ValorCampo) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function compararUma(c: Comparacao, valores: Readonly<Record<string, ValorCampo>>): ResultadoCondicao {
  const atual = valores[c.campo];
  if (c.op === "informado") return naoInformado(atual) ? "falso" : "verdadeiro";
  if (c.op === "nao_informado") return naoInformado(atual) ? "verdadeiro" : "falso";
  if (c.valor === undefined) throw new ErroConfiguracaoCondicao(`A comparação do campo "${c.campo}" não tem valor.`);
  if (naoInformado(atual)) return "desconhecido";
  if (c.op === "=") return atual === c.valor ? "verdadeiro" : "falso";
  if (c.op === "≠") return atual !== c.valor ? "verdadeiro" : "falso";
  // Ordem só entre números ou entre textos (datas 'aaaa-mm-dd' comparam como texto).
  const mesmoTipo = (typeof atual === "number" && typeof c.valor === "number") || (typeof atual === "string" && typeof c.valor === "string");
  if (!mesmoTipo) throw new ErroConfiguracaoCondicao(`O operador "${c.op}" não se aplica ao campo "${c.campo}".`);
  const a = atual as number | string;
  const b = c.valor as number | string;
  const ok = c.op === ">" ? a > b : c.op === "≥" ? a >= b : c.op === "<" ? a < b : a <= b;
  return ok ? "verdadeiro" : "falso";
}

/**
 * Avalia a condição de aplicação de um item do modelo sobre os campos da operação (5.3).
 * `camposValidos` é a lista de campos que o modelo pode citar; citar outro é erro de configuração.
 * Combinação em três valores: em `todas`, um falso decide; em `alguma`, um verdadeiro decide; senão, o desconhecido prevalece.
 */
export function avaliarCondicao(
  condicao: Condicao | null | undefined,
  valores: Readonly<Record<string, ValorCampo>>,
  camposValidos: readonly string[],
): AvaliacaoCondicao {
  if (!condicao) return { resultado: "verdadeiro", camposDesconhecidos: [] };
  const todas = "todas" in condicao;
  const lista = todas ? condicao.todas : condicao.alguma;
  if (!Array.isArray(lista) || lista.length === 0) throw new ErroConfiguracaoCondicao("A condição não tem comparações.");

  const resultados = lista.map((c) => {
    if (!camposValidos.includes(c.campo)) throw new ErroConfiguracaoCondicao(`O campo "${c.campo}" não existe na operação.`);
    if (!(OPERADORES as readonly string[]).includes(c.op)) throw new ErroConfiguracaoCondicao(`Operador inválido: "${c.op}".`);
    return { campo: c.campo, r: compararUma(c, valores) };
  });

  const decisivo = todas ? "falso" : "verdadeiro";
  if (resultados.some((x) => x.r === decisivo)) return { resultado: decisivo, camposDesconhecidos: [] };
  const desconhecidos = [...new Set(resultados.filter((x) => x.r === "desconhecido").map((x) => x.campo))];
  if (desconhecidos.length > 0) return { resultado: "desconhecido", camposDesconhecidos: desconhecidos };
  return { resultado: todas ? "verdadeiro" : "falso", camposDesconhecidos: [] };
}
