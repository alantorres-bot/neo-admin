// Várias linhas da fatura num único título do Consistem (agrupado). Regra 52 de docs/modulos/financeiro-cartao.md.
// Linhas à vista e positivas; título com a soma, vencimento da fatura, emissão no fechamento, documento DDMMAA do fechamento e
// complemento "CARTÃO <NOME> 1x — <RÓTULO> (<n> LANÇ.)"; documento DDMMAA do fechamento + "-" + o menor número de linha do grupo. Os códigos vêm das sugestões das linhas (iguais = preenchidos).
import type { LinhaFatura } from "./conciliacao";
import { CAMPOS_COMPRA, ROTULO_CAMPO_COMPRA, type CampoCompra, type CamposCompra, type Sugestao } from "./lancamento-compras";
import { documentoDoFechamento, type NovoLancamentoContaPagar } from "./lancamento-encargos";
import { normalizar } from "./texto";

const MAX = 70;
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

/** "CARTÃO SICREDI PJ 1x — TRANSPORTE POR APLICATIVO (14 LANÇ.)" (o rótulo é cortado; a contagem fica). */
export function complementoAgrupado(nomeCartao: string, rotulo: string, n: number): string {
  const base = `CARTÃO ${nomeCartao.toUpperCase()} 1x — `;
  const sufixo = ` (${n} LANÇ.)`;
  const r = normalizar(rotulo).slice(0, Math.max(0, MAX - base.length - sufixo.length)).trimEnd();
  return `${base}${r}${sufixo}`.slice(0, MAX);
}

export type TituloAgrupado =
  | { ok: true; valorCentavos: number; payload: NovoLancamentoContaPagar }
  | { ok: false; erro: string; valorCentavos: number };

export function montarTituloAgrupado(e: {
  linhas: readonly Pick<LinhaFatura, "ordem" | "valorCentavos" | "parcelaTotal">[];
  nomeCartao: string;
  campos: CamposCompra;
  fechamento: string | null;
  vencimento: string;
  rotulo: string;
}): TituloAgrupado {
  const valorCentavos = e.linhas.reduce((s, l) => s + l.valorCentavos, 0);
  if (e.linhas.length < 2) return { ok: false, erro: "Escolha pelo menos duas linhas para agrupar.", valorCentavos };
  if (e.linhas.some((l) => !aVista(l))) return { ok: false, erro: "Só linhas à vista e com valor positivo podem ser agrupadas.", valorCentavos };
  const faltando = CAMPOS_COMPRA.filter((k) => e.campos[k] === undefined);
  if (faltando.length) return { ok: false, erro: `Preencha: ${faltando.map((k) => ROTULO_CAMPO_COMPRA[k].toLowerCase()).join(", ")}.`, valorCentavos };
  if (!e.fechamento || !/^\d{4}-\d{2}-\d{2}$/.test(e.fechamento)) return { ok: false, erro: "Fatura sem mês do cartão (fechamento).", valorCentavos };
  if (!e.rotulo.trim()) return { ok: false, erro: "Informe o nome do grupo para o complemento.", valorCentavos };
  const c = e.campos as Record<CampoCompra, number>;
  const complemento = complementoAgrupado(e.nomeCartao, e.rotulo, e.linhas.length);
  return {
    ok: true, valorCentavos,
    payload: {
      codFornecedor: c.codFornecedor, categoriaDoc: c.categoriaDoc, codDocumento: `${documentoDoFechamento(e.fechamento)}-${Math.min(...e.linhas.map((l) => l.ordem))}`, codPortador: c.codPortador,
      dataEmissao: e.fechamento, dataEntrada: e.fechamento, dataVencimento: e.vencimento, valorDocumento: valorCentavos / 100,
      codHistorico: c.codHistorico, complementoHistorico: complemento, grupoContaFluxoCaixa: c.grupoContaFluxoCaixa, contaFluxoCaixa: c.contaFluxoCaixa,
      dadosContabilidade: { contaContabilDebito: c.contaContabilDebito, contaContabilCredito: c.contaContabilCredito, listaCentroCustoContab: [] },
    },
  };
}
