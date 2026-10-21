// "Lançar selecionadas" (regra 52 de docs/modulos/financeiro-cartao.md): várias linhas à vista da fatura escolhidas de uma vez,
// UM TÍTULO POR LINHA (cada uma com a sua descrição e o seu fornecedor). Até 21/10/2026 a seleção virava um título só com a soma
// (agrupado); o Alan trocou porque o agrupado dificultava a conferência. Aqui ficam os atalhos de seleção e os códigos comuns.
import type { LinhaFatura } from "./conciliacao";
import { CAMPOS_COMPRA, type CampoCompra, type CamposCompra, type Sugestao } from "./lancamento-compras";
export const aVista = (l: Pick<LinhaFatura, "parcelaTotal" | "valorCentavos">) => (l.parcelaTotal ?? 1) <= 1 && l.valorCentavos > 0;

export type ItemGrupo = { linha: LinhaFatura; sugestao: Sugestao; fornecedorNome: string | null; /** Categoria do dicionário (atalho por categoria). */ categoria?: string | null };
export type GrupoSugerido = { chave: string; rotulo: string; linhaIds: string[]; totalCentavos: number };

/**
 * Atalhos (a seleção na tabela é livre — qualquer linha, qualquer fornecedor): 1) linhas à vista com o mesmo fornecedor
 * sugerido (ou o mesmo estabelecimento); 2) das que sobraram, as da mesma categoria do dicionário. Só grupos com 2 ou mais.
 */
export function gruposSugeridos(itens: readonly ItemGrupo[]): GrupoSugerido[] {
  const somar = (m: Map<string, GrupoSugerido>, chave: string, rotulo: string, i: ItemGrupo) => {
    const g = m.get(chave) ?? { chave, rotulo, linhaIds: [], totalCentavos: 0 };
    g.linhaIds.push(i.linha.id);
    g.totalCentavos += i.linha.valorCentavos;
    m.set(chave, g);
  };
  const porFornecedor = new Map<string, GrupoSugerido>();
  for (const i of itens) {
    if (!aVista(i.linha)) continue;
    const cod = i.sugestao.campos.codFornecedor;
    const chave = cod ? `f:${cod}` : i.sugestao.padrao ? `e:${i.sugestao.padrao}` : null;
    if (chave) somar(porFornecedor, chave, (cod ? i.fornecedorNome : null) ?? i.sugestao.padrao ?? String(cod), i);
  }
  const fornecedores = [...porFornecedor.values()].filter((g) => g.linhaIds.length >= 2);
  const usadas = new Set(fornecedores.flatMap((g) => g.linhaIds));
  const porCategoria = new Map<string, GrupoSugerido>();
  for (const i of itens) {
    const cat = (i.categoria ?? "").trim();
    if (!aVista(i.linha) || usadas.has(i.linha.id) || !cat || cat.startsWith("[")) continue;
    somar(porCategoria, `c:${cat}`, cat, i);
  }
  const categorias = [...porCategoria.values()].filter((g) => g.linhaIds.length >= 2);
  return [...fornecedores, ...categorias].sort((a, b) => b.totalCentavos - a.totalCentavos);
}

/** Campos comuns às linhas: igual em todas → preenchido; diferente → o da primeira, com aviso. Fornecedor diferente → vazio. */
export function sugestaoDoGrupo(itens: readonly ItemGrupo[]): { campos: CamposCompra; divergentes: CampoCompra[] } {
  const campos: CamposCompra = {};
  const divergentes: CampoCompra[] = [];
  for (const k of CAMPOS_COMPRA) {
    const valores = itens.map((i) => i.sugestao.campos[k]);
    const primeiro = valores.find((v) => v !== undefined);
    const diverge = new Set(valores.filter((v) => v !== undefined)).size > 1;
    if (diverge) divergentes.push(k);
    if (primeiro !== undefined && !(diverge && k === "codFornecedor")) campos[k] = primeiro;
  }
  return { campos, divergentes };
}

/**
 * Códigos de uma linha em "Lançar selecionadas": os da sugestão da própria linha; o que o operador preencheu no diálogo só completa
 * o que faltar (cada título continua com o fornecedor e a conta da sua linha).
 */
export function camposDaSelecao(sugestao: CamposCompra, comuns: CamposCompra): CamposCompra {
  const campos: CamposCompra = { ...comuns };
  for (const k of CAMPOS_COMPRA) if (sugestao[k] !== undefined) campos[k] = sugestao[k];
  return campos;
}
