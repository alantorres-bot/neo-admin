// Financeiro / Comissões: regras do fechamento mensal (puras e testadas). Especificação: docs/modulos/financeiro-comissoes.md.
// Valores em centavos inteiros; datas 'aaaa-mm-dd'. Nada aqui inventa percentual: vêm do cadastro de representantes.

export const MODULO_COMISSOES = "financeiro.comissoes";
export const ROTA_COMISSOES = "/financeiro/comissoes";

/** Baixas que NÃO geram comissão (regra 4): 7 Antecipação, 8 Devolução de cliente, 11 Perdas. */
export const BAIXAS_SEM_COMISSAO = ["7", "8", "11"];
export const TITULO_PENDENCIA_Z = "Título Z sem crédito de cliente";

export type Tipo = "venda" | "locacao";

export type Representante = {
  cod_representante: string; nome: string; perc_venda: number; perc_locacao: number;
  /** Códigos dos representantes cujas vendas geram comissão para este (o próprio incluído). */
  recebe_de: string[];
  ativo: boolean;
};

export type TituloPago = {
  cod_titulo: string; cod_cliente: string | null; cod_representante: string | null; nota_fiscal: string | null;
  valor_centavos: number; valor_pago_centavos: number | null; data_pagamento: string | null; data_vencimento: string | null;
  tipo_baixa: string | null; tipo_nota: string | null; comissao_consistem_centavos: number | null;
  /** Pedido de venda da NF do título (quando há). */
  cod_pedido?: string | null;
  /** Unidade do teto (regra 12): "P:<pedido>", ou "N:<nota>" quando a NF não tem pedido; sem NF, null. */
  teto_chave?: string | null;
};

export type Credito = { id: string; data: string; cod_cliente: string; nome_cliente: string | null; valor_centavos: number; cod_pedido?: string | null };

const doc = (c: string) => c.trim().toUpperCase();
/** Título Z: lançamento sem NF ("Z…"; na planilha às vezes "AZ…"). */
export const ehTituloZ = (codTitulo: string) => /^A?Z/.test(doc(codTitulo));
/** Filial Contagem: documento iniciado em 400 (regra 9) — fica fora por enquanto. */
export const ehFilial = (codTitulo: string) => /^A?400/.test(doc(codTitulo));

/** Venda ou Locação (regra 10): NF tipo 12 = locação; sem tipo, documento iniciado em 4 (fora da Filial) = locação. */
export function tipoDoTitulo(t: { cod_titulo: string; tipo_nota: string | null }): Tipo {
  if (t.tipo_nota !== null && t.tipo_nota.trim() !== "") return t.tipo_nota.trim() === "12" ? "locacao" : "venda";
  return /^A?4/.test(doc(t.cod_titulo)) && !ehFilial(t.cod_titulo) ? "locacao" : "venda";
}

/** Comissão em centavos: valor × percentual (percentual em %, ex.: 1.5), arredondada ao centavo. */
export const calcularComissao = (valorCentavos: number, percentual: number) => Math.round((valorCentavos * percentual) / 100);

/**
 * Cruza os títulos Z pagos com os créditos da CCCCI010 (regra 11): mesmo cliente, mesma data (baixa do Z = data do
 * crédito) e mesmo valor. Cada crédito casa com um Z no máximo.
 *   zComCredito   um recebimento, uma comissão (pelo Z)
 *   zSemCredito   alerta: o financeiro esqueceu de lançar o crédito
 *   creditosSemZ  adiantamento: gera comissão no mês em que entrou
 */
export function cruzarZComCreditos(titulos: TituloPago[], creditos: Credito[]) {
  const livres = [...creditos];
  const zComCredito: { titulo: TituloPago; credito: Credito }[] = [];
  const zSemCredito: TituloPago[] = [];
  for (const t of titulos.filter((x) => ehTituloZ(x.cod_titulo))) {
    const i = livres.findIndex((c) =>
      c.cod_cliente.trim() === (t.cod_cliente ?? "").trim() && c.data === t.data_pagamento && c.valor_centavos === t.valor_centavos);
    if (i >= 0) zComCredito.push({ titulo: t, credito: livres.splice(i, 1)[0] });
    else zSemCredito.push(t);
  }
  return { zComCredito, zSemCredito, creditosSemZ: livres };
}

export type LinhaProposta = {
  chave: string;                    // identifica o recebimento (não paga duas vezes): "T:<título>" ou "C:<data>:<cliente>:<valor>"
  origem: "titulo" | "credito";
  cod_representante: string;        // quem recebe
  cod_representante_venda: string;  // de quem é a venda (o próprio ou o subordinado)
  cod_titulo: string | null;
  cod_cliente: string | null;
  nome_cliente: string | null;
  nota_fiscal: string | null;
  data_pagamento: string | null;
  tipo_baixa: string | null;
  tipo: Tipo;
  valor_base_centavos: number;
  percentual: number;
  valor_comissao_centavos: number;
  comissao_consistem_centavos: number | null;
  observacao: string | null;
  cod_pedido: string | null;
  teto_chave: string | null;
  teto_valor_centavos: number | null;
  incluida: boolean;
  motivo: string | null;
};

export const chaveCredito = (c: Pick<Credito, "data" | "cod_cliente" | "valor_centavos">) => `C:${c.data}:${c.cod_cliente.trim()}:${c.valor_centavos}`;
export const chaveTitulo = (codTitulo: string) => `T:${doc(codTitulo)}`;
export const chavePedido = (codPedido: string) => `P:${codPedido.trim().replace(/^0+(?=\d)/, "")}`;

/**
 * Proposta do mês para cada representante ativo:
 *   - títulos pagos cuja venda é de um representante de quem ele recebe (regras 3 e 8), fora da Filial (regra 9),
 *     com baixa que gera comissão (regra 4);
 *   - créditos sem Z (adiantamentos, regra 5), pelo representante sugerido para o cliente;
 *   - o que já foi pago em fechamento anterior (mesma chave e representante) não entra de novo (regra 6).
 */
export function proporLinhas(
  representantes: Representante[],
  titulos: TituloPago[],
  adiantamentos: (Credito & { cod_representante_sugerido: string | null })[],
  jaPagas: Set<string>, // "<representante>|<chave>"
): LinhaProposta[] {
  const linhas: LinhaProposta[] = [];
  for (const r of representantes.filter((x) => x.ativo)) {
    const percentual = (tipo: Tipo) => (tipo === "locacao" ? r.perc_locacao : r.perc_venda);
    for (const t of titulos) {
      if (!t.cod_representante || !r.recebe_de.includes(t.cod_representante)) continue;
      if (ehFilial(t.cod_titulo) || BAIXAS_SEM_COMISSAO.includes(t.tipo_baixa ?? "")) continue;
      const chave = chaveTitulo(t.cod_titulo);
      if (jaPagas.has(`${r.cod_representante}|${chave}`)) continue;
      const tipo = tipoDoTitulo(t);
      linhas.push({
        chave, origem: "titulo", cod_representante: r.cod_representante, cod_representante_venda: t.cod_representante,
        cod_titulo: t.cod_titulo, cod_cliente: t.cod_cliente, nome_cliente: null, nota_fiscal: t.nota_fiscal, data_pagamento: t.data_pagamento,
        tipo_baixa: t.tipo_baixa, tipo, valor_base_centavos: t.valor_centavos, percentual: percentual(tipo),
        valor_comissao_centavos: calcularComissao(t.valor_centavos, percentual(tipo)),
        comissao_consistem_centavos: r.cod_representante === t.cod_representante ? t.comissao_consistem_centavos : null,
        observacao: ehTituloZ(t.cod_titulo) ? "Título Z (sem NF)" : null,
        cod_pedido: t.cod_pedido ?? null, teto_chave: t.teto_chave ?? null, teto_valor_centavos: null, incluida: true, motivo: null,
      });
    }
    for (const c of adiantamentos) {
      if (!c.cod_representante_sugerido || !r.recebe_de.includes(c.cod_representante_sugerido)) continue;
      const chave = chaveCredito(c);
      if (jaPagas.has(`${r.cod_representante}|${chave}`)) continue;
      linhas.push({
        chave, origem: "credito", cod_representante: r.cod_representante, cod_representante_venda: c.cod_representante_sugerido,
        cod_titulo: null, cod_cliente: c.cod_cliente, nome_cliente: c.nome_cliente, nota_fiscal: null, data_pagamento: c.data,
        tipo_baixa: null, tipo: "venda", valor_base_centavos: c.valor_centavos, percentual: r.perc_venda,
        valor_comissao_centavos: calcularComissao(c.valor_centavos, r.perc_venda), comissao_consistem_centavos: null,
        observacao: "Adiantamento do cliente (CCCCI010)",
        cod_pedido: c.cod_pedido ?? null, teto_chave: c.cod_pedido ? chavePedido(c.cod_pedido) : null, teto_valor_centavos: null, incluida: true, motivo: null,
      });
    }
  }
  return linhas;
}

/** Fechamento de um representante: total das linhas incluídas − antecipações já pagas = saldo a pagar. */
export function totalizar(linhas: { incluida: boolean; valor_comissao_centavos: number }[], antecipacoesCentavos: number[]) {
  const total = linhas.filter((l) => l.incluida).reduce((s, l) => s + l.valor_comissao_centavos, 0);
  const antecipado = antecipacoesCentavos.reduce((s, v) => s + v, 0);
  return { total, antecipado, saldo: total - antecipado };
}

/** Unidade do teto (regra 12): o pedido (ou a NF sem pedido), com o valor e os títulos que ele gerou. */
export type UnidadeTeto = { rotulo: string; valor_centavos: number; titulos: string[] };

/** O que já foi comissionado em fechamentos fechados (inclusive o histórico das planilhas). */
export type LinhaAnterior = { cod_representante: string; cod_titulo: string | null; teto_chave: string | null; valor_base_centavos: number };

/**
 * Regra 12: um pedido nunca rende comissão, ao mesmo representante, sobre mais que o seu valor. A base já comissionada
 * do pedido (linhas fechadas com a mesma unidade, ou de títulos que o pedido gerou) mais a deste mês, pela ordem de
 * pagamento, não passa do valor do pedido; a linha que passaria vem excluída com o motivo (o gestor pode incluir de
 * novo na conferência). Linha sem unidade (Z, adiantamento sem pedido) ou com unidade não lida fica de fora do teto.
 */
export function aplicarTeto(linhas: LinhaProposta[], unidades: Record<string, UnidadeTeto>, anteriores: LinhaAnterior[]): LinhaProposta[] {
  const usado = new Map<string, number>();
  const chaveUso = (rep: string, unidade: string) => `${rep}|${unidade}`;
  for (const [chave, u] of Object.entries(unidades)) {
    const titulos = new Set(u.titulos.map(doc));
    for (const a of anteriores) {
      if (a.teto_chave === chave || (a.cod_titulo && titulos.has(doc(a.cod_titulo)))) {
        usado.set(chaveUso(a.cod_representante, chave), (usado.get(chaveUso(a.cod_representante, chave)) ?? 0) + a.valor_base_centavos);
      }
    }
  }
  const ordem = linhas.map((l, i) => ({ l, i })).sort((a, b) => (a.l.data_pagamento ?? "").localeCompare(b.l.data_pagamento ?? "") || a.i - b.i);
  const saida = [...linhas];
  for (const { l, i } of ordem) {
    const u = l.teto_chave ? unidades[l.teto_chave] : undefined;
    if (!u || !l.teto_chave) continue;
    const k = chaveUso(l.cod_representante, l.teto_chave);
    const ja = usado.get(k) ?? 0;
    const linha = { ...l, teto_valor_centavos: u.valor_centavos };
    if (ja + l.valor_base_centavos > u.valor_centavos) {
      linha.incluida = false;
      linha.motivo = `Excede o ${u.rotulo}: já comissionado ${reais(ja)} de ${reais(u.valor_centavos)}`;
    } else {
      usado.set(k, ja + l.valor_base_centavos);
    }
    saida[i] = linha;
  }
  return saida;
}

const reais = (centavos: number) => `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Representante sugerido para o cliente de um adiantamento: o do título mais recente (por emissão) desse cliente que é
 * de um representante comissionado; senão o do mais recente de qualquer representante; sem títulos, null.
 */
export function representanteDoCliente(titulosDoCliente: { cod_representante: string | null; data_emissao: string | null }[], comissionados: string[]) {
  const ordenados = [...titulosDoCliente].filter((t) => t.cod_representante).sort((a, b) => (b.data_emissao ?? "").localeCompare(a.data_emissao ?? ""));
  return (ordenados.find((t) => comissionados.includes(t.cod_representante!)) ?? ordenados[0])?.cod_representante ?? null;
}

// ---------------------------------------------------------------- planilha da CCCCI010

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Data da planilha: dd/mm/aaaa, aaaa-mm-dd ou número de série do Excel. Inválida: null. */
export function dataDaPlanilha(v: unknown): string | null {
  let iso: string | null = null;
  if (typeof v === "number" && v > 20000 && v < 80000) iso = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  else if (v instanceof Date && !Number.isNaN(v.getTime())) iso = v.toISOString().slice(0, 10);
  else {
    const t = texto(v);
    const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    iso = br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
  }
  if (!iso) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === iso ? iso : null;
}

/** Valor da planilha em centavos: número, ou texto pt-BR ("1.234,56") ou en ("1234.56"). Inválido: null. */
export function valorDaPlanilha(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let t = texto(v).replace(/[R$\s]/g, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export type LinhaCreditoLida = { linha: number; data: string; cod_cliente: string; nome_cliente: string | null; valor_centavos: number; cod_pedido: string | null };

/**
 * Lê a "Consulta de Créditos Cadastrados" da CCCCI010 (Data, Cliente, Descrição, Crédito, Baixado, Saldo, Portador…) ou
 * uma planilha simples (Data, Código do cliente, Nome, Valor). Acha o cabeçalho pelos nomes; o valor é o do crédito
 * (coluna "Crédito" ou "Valor"), não o saldo. Ignora linhas vazias e a de total, e devolve os erros por linha.
 */
export function lerPlanilhaCreditos(linhas: unknown[][]): { creditos: LinhaCreditoLida[]; erros: string[] } {
  const norm = (v: unknown) => texto(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ehValor = (c: string) => c.includes("valor") || c === "credito";
  const iCab = linhas.findIndex((l) => l.some((c) => norm(c).startsWith("data")) && l.some((c) => ehValor(norm(c))));
  if (iCab < 0) return { creditos: [], erros: ["Não achei o cabeçalho (colunas Data, Cliente, Descrição e Crédito)."] };
  const cab = linhas[iCab].map(norm);
  const col = {
    data: cab.findIndex((c) => c.startsWith("data")),
    codigo: cab.findIndex((c) => (c.includes("cod") || c === "cliente") && !c.includes("nome")),
    nome: cab.findIndex((c) => c.includes("nome") || c.includes("razao") || c === "descricao"),
    valor: cab.findIndex((c) => c.includes("valor")) >= 0 ? cab.findIndex((c) => c.includes("valor")) : cab.findIndex((c) => c === "credito"),
    pedido: cab.findIndex((c) => c.includes("pedido")),
  };
  if (col.codigo < 0) return { creditos: [], erros: ["Não achei a coluna do código do cliente."] };
  const creditos: LinhaCreditoLida[] = [];
  const erros: string[] = [];
  linhas.slice(iCab + 1).forEach((l, i) => {
    const n = iCab + i + 2; // número da linha no Excel
    if (l.every((c) => texto(c) === "")) return;
    if (norm(l[col.data]).startsWith("total") || norm(l[col.codigo]).startsWith("total")) return;
    if (texto(l[col.data]) === "" && texto(l[col.codigo]) === "") return; // rodapé com os totais da consulta
    const data = dataDaPlanilha(l[col.data]);
    const cod = texto(l[col.codigo]).replace(/\.0$/, "");
    const valor = valorDaPlanilha(l[col.valor]);
    if (!data || cod === "" || valor === null) {
      erros.push(`Linha ${n}: ${!data ? "data inválida" : cod === "" ? "sem código do cliente" : "valor inválido"}.`);
      return;
    }
    const pedido = col.pedido >= 0 ? texto(l[col.pedido]).replace(/\.0$/, "") : "";
    creditos.push({
      linha: n, data, cod_cliente: cod, nome_cliente: col.nome >= 0 ? texto(l[col.nome]) || null : null, valor_centavos: valor,
      cod_pedido: /^\d+$/.test(pedido) && Number(pedido) > 0 ? pedido.replace(/^0+/, "") : null,
    });
  });
  return { creditos, erros };
}

/**
 * Proposta completa do mês: cruza os Z com os créditos, sugere o representante dos adiantamentos (créditos sem Z) e
 * propõe as linhas de cada representante. Devolve também o que marcar nos créditos e os Z sem crédito (alerta).
 */
export function montarProposta(
  representantes: Representante[],
  titulos: TituloPago[],
  creditos: Credito[],
  titulosPorCliente: Record<string, { cod_representante: string | null; data_emissao: string | null }[]>,
  jaPagas: Set<string>,
  unidades: Record<string, UnidadeTeto> = {},
  anteriores: LinhaAnterior[] = [],
) {
  const { zComCredito, zSemCredito, creditosSemZ } = cruzarZComCreditos(titulos, creditos);
  const comissionados = [...new Set(representantes.filter((r) => r.ativo).flatMap((r) => r.recebe_de))];
  const adiantamentos = creditosSemZ.map((c) => ({ ...c, cod_representante_sugerido: representanteDoCliente(titulosPorCliente[c.cod_cliente] ?? [], comissionados) }));
  return {
    linhas: aplicarTeto(proporLinhas(representantes, titulos, adiantamentos, jaPagas), unidades, anteriores),
    creditosMarcados: [
      ...zComCredito.map((x) => ({ id: x.credito.id, cod_titulo_z: x.titulo.cod_titulo, cod_representante_sugerido: x.titulo.cod_representante })),
      ...adiantamentos.map((c) => ({ id: c.id, cod_titulo_z: null, cod_representante_sugerido: c.cod_representante_sugerido })),
    ],
    zSemCredito: zSemCredito.filter((t) => !ehFilial(t.cod_titulo)).map((t) => ({
      cod_titulo: t.cod_titulo, cod_cliente: t.cod_cliente, cod_representante: t.cod_representante, data_pagamento: t.data_pagamento, valor_centavos: t.valor_centavos,
    })),
  };
}
