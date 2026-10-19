// API Comercial v1.0 do Consistem (pedidos de venda, NF de saída, devoluções, expedição): leitura e sondagem.
// Lógica PURA (sem Deno, sem Supabase) para ser testada com o Vitest (lib/integracoes/consistem/consistem-comercial.test.ts)
// e usada pela Edge Function `com-pedidos-sincronizar` (módulo Comercial / Pedidos, docs/modulos/comercial-pedidos.md).
//
// Mesma autenticação de _shared/consistem-receber.ts. Diferenças da API Comercial:
//   - os serviços "Resumido/Resumida" paginam por CABEÇALHO (`page` a partir de 0, `size`) e devolvem array puro;
//   - a devolução lista em `notasDevolucao` e o MDF-e em `listaMDFe` (não em `data`);
//   - o `{id}` de notaFiscalSaida/{id} (e /titulo) não está documentado: a sondagem testa formatos.
// A sondagem devolve só contagens, formatos e nomes de campos: nada de nomes de clientes, valores ou documentos.
// Arquivo autocontido (sem imports), como os demais de _shared testados pelo Vitest. A leitura HTTP (buscarJson,
// buscarResumido, buscarTodasPaginas) fica em consistem-receber.ts.

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const preenchido = (v: unknown): boolean => texto(v) !== "";
const positivo = (v: unknown): boolean => Number(v) > 0;
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// Cópia de chaveNfe/numeroNota de consistem-receber.ts (há teste de paridade em consistem-comercial.test.ts).
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, "");
/** Chave de acesso da NF-e: 44 dígitos, senão vazio. */
export const chaveNfe = (v: unknown): string => {
  const d = soDigitos(v);
  return d.length === 44 ? d : "";
};
/** Número da nota sem zeros à esquerda e sem pontuação ("000123" -> "123"). */
export const numeroNota = (v: unknown): string => soDigitos(v).replace(/^0+/, "");

/** Contagem por valor de um campo (vazio vira "(vazio)"), do maior para o menor. */
export function contarPor(registros: Record<string, unknown>[], campo: string): { valor: string; total: number }[] {
  const mapa = new Map<string, number>();
  for (const r of registros) {
    const v = texto(r[campo]) || "(vazio)";
    mapa.set(v, (mapa.get(v) ?? 0) + 1);
  }
  return [...mapa.entries()].map(([valor, total]) => ({ valor, total })).sort((a, b) => b.total - a.total || a.valor.localeCompare(b.valor));
}

/** Nomes e tipos dos campos (sem valores). */
export function descreverCampos(registros: Record<string, unknown>[]): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const r of registros.slice(0, 50)) {
    for (const [k, v] of Object.entries(r ?? {})) {
      const tipo = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      if (!campos[k] || campos[k] === "null") campos[k] = tipo;
    }
  }
  return campos;
}

// ---------------------------------------------------------------- pedidos

/** Situação do pedido na API (string "0".."9"). */
export const SITUACAO_PEDIDO: Record<string, string> = {
  "0": "Digitado", "1": "Listado", "2": "Liberado", "3": "Selecionado parcial", "4": "Selecionado total",
  "5": "Faturado parcial", "6": "Faturado total", "7": "Transmitido", "8": "Bloqueado", "9": "Cancelado",
};

/** Retrato da carteira de pedidos (pedidoVendaResumido) em contagens. */
export function resumirPedidos(pedidos: Record<string, unknown>[], hoje: string) {
  const comSaldo = pedidos.filter((p) => positivo(p.vlrSaldo));
  return {
    total: pedidos.length,
    porSituacao: contarPor(pedidos, "situacao").map((s) => ({ ...s, nome: SITUACAO_PEDIDO[s.valor] ?? "?" })),
    comSaldo: comSaldo.length,
    // Previsão de faturamento já passou e ainda há saldo: candidato à pendência "Pedido com previsão vencida".
    previsaoVencidaComSaldo: comSaldo.filter((p) => preenchido(p.dataPrevFat) && texto(p.dataPrevFat).slice(0, 10) < hoje).length,
    semPrevisao: pedidos.filter((p) => !preenchido(p.dataPrevFat)).length,
    comNumeroUltimaNF: pedidos.filter((p) => preenchido(p.numeroUltimaNF)).length,
    comNomeCliente: pedidos.filter((p) => preenchido(p.nomeCliente)).length,
    comRepresentante: pedidos.filter((p) => preenchido(p.codRepresentante) && texto(p.codRepresentante) !== "0").length,
    comNomeRepresentante: pedidos.filter((p) => preenchido(p.nomeRepresentante)).length,
    comValorBloqueado: pedidos.filter((p) => positivo(p.vlrTotalBloqueado)).length,
    comValorCancelado: pedidos.filter((p) => positivo(p.vlrTotalCancelado)).length,
    porTipoNota: contarPor(pedidos, "codTipoNF").slice(0, 15),
    porCondicaoVenda: contarPor(pedidos, "codCondVenda").slice(0, 15),
    representantes: new Set(pedidos.map((p) => texto(p.codRepresentante)).filter(Boolean)).size,
    camposDisponiveis: Object.keys(descreverCampos(pedidos)).sort(),
  };
}

/** Bloqueios do pedido completo (pedidoVenda/{id}): libFin, flgBloqCredito, flgBloqComercial. */
export function resumirBloqueios(pedidos: Record<string, unknown>[]) {
  const sim = (v: unknown) => v === true || v === 1 || texto(v) === "1" || /^(s|true)$/i.test(texto(v));
  return {
    amostra: pedidos.length,
    liberadoFinanceiro: pedidos.filter((p) => sim(p.libFin)).length,
    bloqueadoCredito: pedidos.filter((p) => sim(p.flgBloqCredito)).length,
    bloqueadoComercial: pedidos.filter((p) => sim(p.flgBloqComercial)).length,
    comPortador: pedidos.filter((p) => preenchido(p.codPortador)).length,
    comVencimentoEspecial: pedidos.filter((p) => lista(p.vencimentoEsp).length > 0).length,
    comValorAntecipado: pedidos.filter((p) => positivo(p.vlrAntecipado)).length,
    comPercComissao: pedidos.filter((p) => positivo(p.percComissRep)).length,
  };
}

// ---------------------------------------------------------------- notas fiscais

/** Retrato das NFs de saída (notaFiscalSaida) em contagens: pedido, representante, comissão, cobrança, retenções. */
export function resumirNotas(notas: Record<string, unknown>[]) {
  const itens = (n: Record<string, unknown>) => lista(n.itensNotaFiscalSaida);
  const pedidoNosItens = (n: Record<string, unknown>) =>
    itens(n).some((i) => lista(i.itemPedidoAgrupado).some((a) => preenchido(a.codPedido)));
  return {
    total: notas.length,
    porTipo: contarPor(notas, "codTipoDeNota").slice(0, 20),
    porSituacao: contarPor(notas, "situacao"),
    comChave: notas.filter((n) => chaveNfe(n.chaveAcesso) !== "").length,
    comPedidoNoCabecalho: notas.filter((n) => preenchido(n.codPedido)).length,
    comPedidoSoNosItens: notas.filter((n) => !preenchido(n.codPedido) && pedidoNosItens(n)).length,
    comRepresentante: notas.filter((n) => preenchido(n.codRepresentante) && texto(n.codRepresentante) !== "0").length,
    comComissaoRepresentante: notas.filter((n) => positivo(n.valorComissaoRepresentante) || positivo(n.percComissaoRepresentante)).length,
    comCondicaoVenda: notas.filter((n) => preenchido(n.codCondicaoVenda)).length,
    comPortador: notas.filter((n) => preenchido(n.codPortador)).length,
    comRetencao: notas.filter((n) => ["valorRetPIS", "valorRetCOFINS", "valorRetCSSL", "valorRetIR"].some((c) => positivo(n[c]))).length,
    comDataHoraSaida: notas.filter((n) => preenchido(n.dataHoraSaida)).length,
    comTransportadora: notas.filter((n) => preenchido(n.codTransportadora) && texto(n.codTransportadora) !== "0").length,
    comVolumes: notas.filter((n) => positivo(n.qtdVolumes)).length,
  };
}

/** NFs canceladas (situacao=3): quantas trazem motivo e protocolo de cancelamento. */
export function resumirCanceladas(canceladas: Record<string, unknown>[]) {
  return {
    total: canceladas.length,
    comMotivo: canceladas.filter((n) => ["obsCancNF1", "obsCancNF2", "obsCancNF3"].some((c) => preenchido(n[c]))).length,
    comProtocoloCancelamento: canceladas.filter((n) => preenchido(n.protCancelaNfe)).length,
    comDataHoraCancelamento: canceladas.filter((n) => preenchido(n.dataHoraCancelaNfe) || preenchido(n.dataGeracao1)).length,
  };
}

/** Chave "nota|cliente" usada para cruzar NF com título em aberto (o título traz `notaFiscal` e `codCliente`). */
export const chaveNotaCliente = (nota: unknown, cliente: unknown) => `${numeroNota(nota)}|${texto(cliente)}`;

/**
 * Quantas NFs (canceladas ou devolvidas) ainda têm título EM ABERTO no contas a receber da API. Esses são os casos
 * que o pós-venda precisa tratar (e que explicam a "Possível baixa" do Recebíveis).
 */
export function cruzarComTitulosAbertos(
  notas: { nota: string; cliente: string }[],
  titulosAbertos: Record<string, unknown>[],
) {
  const abertos = new Map<string, number>();
  for (const t of titulosAbertos) {
    const n = numeroNota(t.notaFiscal);
    if (n === "") continue;
    const k = chaveNotaCliente(n, t.codCliente);
    abertos.set(k, (abertos.get(k) ?? 0) + 1);
  }
  const comTitulo = notas.filter((n) => abertos.has(chaveNotaCliente(n.nota, n.cliente)));
  return {
    notas: notas.length,
    comTituloAberto: comTitulo.length,
    titulosAbertos: comTitulo.reduce((s, n) => s + (abertos.get(chaveNotaCliente(n.nota, n.cliente)) ?? 0), 0),
  };
}

// ---------------------------------------------------------------- títulos da NF (/titulo)

/**
 * Formatos a testar para o `{id}` de notaFiscalSaida/{id}/titulo (a documentação não diz qual é). A ordem é a
 * da mais provável para a menos provável; o primeiro que responder com títulos vence.
 */
export function candidatosIdNota(n: Record<string, unknown>): { formato: string; id: string }[] {
  const nota = texto(n.codNumNota);
  const serie = texto(n.serie);
  const data = texto(n.dataEmissao).slice(0, 10);
  const chave = chaveNfe(n.chaveAcesso);
  const saida: { formato: string; id: string }[] = [];
  if (chave) saida.push({ formato: "chaveAcesso", id: chave });
  if (nota) saida.push({ formato: "codNumNota", id: nota });
  if (nota && data) saida.push({ formato: "dataEmissao,codNumNota", id: `${data},${nota}` });
  if (nota && serie) saida.push({ formato: "serie,codNumNota", id: `${serie},${nota}` });
  if (nota && serie && data) saida.push({ formato: "dataEmissao,serie,codNumNota", id: `${data},${serie},${nota}` });
  return saida;
}

export type TentativaTitulo = { formato: string; status: "ok" | "vazio" | "erro"; titulos?: Record<string, unknown>[]; erro?: string };

/** Resultado das tentativas de /titulo: qual formato de id funciona e o que os títulos trazem. */
export function resumirTitulosDaNota(porNota: TentativaTitulo[][]) {
  const formatos = new Map<string, { ok: number; vazio: number; erro: number }>();
  const erros = new Set<string>();
  const titulos: Record<string, unknown>[] = [];
  const parcelasPorNota: number[] = [];
  for (const tentativas of porNota) {
    for (const t of tentativas) {
      const f = formatos.get(t.formato) ?? { ok: 0, vazio: 0, erro: 0 };
      f[t.status]++;
      formatos.set(t.formato, f);
      if (t.erro) erros.add(t.erro.slice(0, 160));
    }
    const vencedora = tentativas.find((t) => t.status === "ok");
    if (vencedora?.titulos) {
      titulos.push(...vencedora.titulos);
      parcelasPorNota.push(vencedora.titulos.length);
    }
  }
  const distribuicao = new Map<number, number>();
  for (const q of parcelasPorNota) distribuicao.set(q, (distribuicao.get(q) ?? 0) + 1);
  return {
    notasTestadas: porNota.length,
    notasComTitulos: parcelasPorNota.length,
    formatos: [...formatos.entries()].map(([formato, v]) => ({ formato, ...v })),
    parcelasPorNota: [...distribuicao.entries()].map(([parcelas, notas]) => ({ parcelas, notas })).sort((a, b) => a.parcelas - b.parcelas),
    titulos: {
      total: titulos.length,
      formatosCodTitulo: contarPor(titulos.map((t) => ({ f: formatoCodigo(t.codTitulo) })), "f").slice(0, 10),
      comVencimento: titulos.filter((t) => preenchido(t.dataVencimento)).length,
      comPagamento: titulos.filter((t) => preenchido(t.dataPagamento)).length,
      comComissaoFat: titulos.filter((t) => positivo(t.valorComissaoRepresentanteFat)).length,
      comComissaoLiq: titulos.filter((t) => positivo(t.valorComissaoRepresentanteLiq)).length,
      comPercComissao: titulos.filter((t) => positivo(t.percComissaoRepresentante)).length,
      camposDisponiveis: Object.keys(descreverCampos(titulos)).sort(),
    },
    erros: [...erros].slice(0, 5),
  };
}

/** Formato de um código sem expor o valor: dígito vira 9, letra vira A (ex.: "12345A" -> "99999A"). */
export const formatoCodigo = (v: unknown): string => texto(v).replace(/[0-9]/g, "9").replace(/[A-Za-z]/g, "A") || "(vazio)";

// ---------------------------------------------------------------- devoluções e expedição

/** Devoluções (devolucaoNota): quantas apontam a NF original e por qual motivo. */
export function resumirDevolucoes(devolucoes: Record<string, unknown>[]) {
  return {
    total: devolucoes.length,
    comNotaDevolvida: devolucoes.filter((d) => lista(d.notasDevolvidas).some((n) => preenchido(n.codNotaDev))).length,
    comChave: devolucoes.filter((d) => chaveNfe(d.chaveNFeNFCe) !== "").length,
    porMotivo: contarPor(devolucoes, "motivoDevolucao").slice(0, 15),
    itens: devolucoes.reduce((s, d) => s + lista(d.itensDevolucao).length, 0),
  };
}

/** NFs originais apontadas pelas devoluções, como pares nota/CNPJ do cliente (a devolução não traz o código do cliente). */
export function notasDevolvidas(devolucoes: Record<string, unknown>[]): { nota: string; documento: string }[] {
  return devolucoes.flatMap((d) =>
    lista(d.notasDevolvidas).map((n) => ({ nota: numeroNota(n.codNotaDev), documento: texto(d.CNPJCPFCliente).replace(/\D/g, "") })),
  ).filter((n) => n.nota !== "");
}

export type Sonda = { servico: string; status: "ok" | "vazio" | "sem_acesso" | "erro"; registros?: number; detalhe?: string };

/** Classifica a resposta de um serviço sondado: responde? tem dados? o token tem o serviço liberado? */
export function classificarSonda(servico: string, resultado: { registros?: number; erro?: { mensagem: string; status?: number } }): Sonda {
  if (resultado.erro) {
    const semAcesso = resultado.erro.status === 401 || resultado.erro.status === 403;
    return {
      servico,
      status: semAcesso ? "sem_acesso" : "erro",
      detalhe: semAcesso ? "serviço não liberado no token (CSMEN050, aba Serviço)" : resultado.erro.mensagem.slice(0, 160),
    };
  }
  const registros = resultado.registros ?? 0;
  return { servico, status: registros > 0 ? "ok" : "vazio", registros };
}

/** Tamanho aproximado (em KB) de um arquivo que a API devolve em base64, sem guardar o arquivo. */
export function tamanhoBase64Kb(arquivo: unknown): number | null {
  const b = texto(arquivo).replace(/\s/g, "");
  if (b === "") return null;
  const padding = b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0;
  return Math.round(((b.length * 3) / 4 - padding) / 1024);
}

// ---------------------------------------------------------------- comissão: títulos pagos, extrato e adiantamentos

/**
 * Títulos pagos no período (financeiro/v10/titulosPagos): é a base "parcela PAGA no mês" da comissão (regra do Alan,
 * 19/10/2026). Mede o formato dos códigos (ex.: "AZ…" = antecipação, "A100…" = com NF vinculada) e quanto o valor
 * pago difere do valor do título (juros/desconto), sem expor valores.
 */
export function resumirTitulosPagos(titulos: Record<string, unknown>[]) {
  const centavos = (v: unknown) => Math.round(Number(v) * 100);
  const comAmbos = titulos.filter((t) => Number.isFinite(Number(t.vlrPago)) && Number.isFinite(Number(t.vlrTitulo)) && t.vlrPago !== null && t.vlrTitulo !== null);
  const prefixo = (t: Record<string, unknown>) => {
    const c = texto(t.codTitulo).toUpperCase();
    return c.startsWith("AZ") ? "AZ (antecipação)" : c.startsWith("A") ? "A (com NF vinculada)" : c.startsWith("Z") ? "Z (sem NF)" : /^\d/.test(c) ? "numérico" : c === "" ? "(vazio)" : "outro";
  };
  return {
    total: titulos.length,
    porPrefixo: contarPor(titulos.map((t) => ({ p: prefixo(t) })), "p"),
    formatosCodTitulo: contarPor(titulos.map((t) => ({ f: formatoCodigo(t.codTitulo) })), "f").slice(0, 10),
    comNotaFiscal: titulos.filter((t) => preenchido(t.notaFiscal)).length,
    pagoIgualTitulo: comAmbos.filter((t) => centavos(t.vlrPago) === centavos(t.vlrTitulo)).length,
    pagoMaiorQueTitulo: comAmbos.filter((t) => centavos(t.vlrPago) > centavos(t.vlrTitulo)).length,
    pagoMenorQueTitulo: comAmbos.filter((t) => centavos(t.vlrPago) < centavos(t.vlrTitulo)).length,
    pagoAntesDoVencimento: titulos.filter((t) => preenchido(t.dataPagamento) && preenchido(t.dataVencimento) && texto(t.dataPagamento).slice(0, 10) < texto(t.dataVencimento).slice(0, 10)).length,
    camposDisponiveis: Object.keys(descreverCampos(titulos)).sort(),
  };
}

/** Extrato de comissões do Consistem (comissaosobrevendas/v10/extratoComissoes): tem dado? de quais representantes? */
export function resumirExtratoComissoes(respostas: Record<string, unknown>[]) {
  const extratos = respostas.flatMap((r) => (Array.isArray(r.extratosComissaoSobreVendas) ? lista(r.extratosComissaoSobreVendas) : [r]))
    .filter((e) => preenchido(e.codRepresentante) || lista(e.lancamentos).length > 0);
  const lancamentos = extratos.flatMap((e) => lista(e.lancamentos));
  return {
    extratos: extratos.length,
    representantes: new Set(extratos.map((e) => texto(e.codRepresentante)).filter(Boolean)).size,
    lancamentos: lancamentos.length,
    porTipo: contarPor(lancamentos, "tipoLancamento"),
    comTitulos: lancamentos.filter((l) => lista(l.titulosRefLancamento).length > 0).length,
    titulosReferenciados: lancamentos.reduce((s, l) => s + lista(l.titulosRefLancamento).length, 0),
    comValorComissaoNoTitulo: lancamentos.flatMap((l) => lista(l.titulosRefLancamento)).filter((t) => positivo(t.valorComissao)).length,
    descricoes: contarPor(lancamentos.map((l) => ({ d: texto(l.descricaoLancamento).slice(0, 40) })), "d").slice(0, 10),
  };
}

/** Pedidos com adiantamento do cliente (`vlrAntecipado` > 0 no pedido completo), por situação. */
export function resumirAdiantamentos(pedidos: Record<string, unknown>[]) {
  const comAdiantamento = pedidos.filter((p) => positivo(p.vlrAntecipado));
  return {
    pedidos: pedidos.length,
    comAdiantamento: comAdiantamento.length,
    porSituacao: contarPor(comAdiantamento, "situacao").map((s) => ({ ...s, nome: SITUACAO_PEDIDO[s.valor] ?? "?" })),
    adiantamentoIgualAoPedido: comAdiantamento.filter((p) => Math.round(Number(p.vlrAntecipado) * 100) === Math.round(Number(p.vlrTotalPedido) * 100)).length,
  };
}

// ---------------------------------------------------------------- sincronização da carteira (Fase 1)

/** Situações em que o pedido ainda pode faturar (não está faturado total nem cancelado). */
export const SITUACOES_ABERTAS = ["0", "1", "2", "3", "4", "5", "7", "8"];
export const TITULO_PENDENCIA_ATRASO = "Pedido com previsão vencida";
export const MODULO_PEDIDOS = "comercial.pedidos";
export const ROTA_PEDIDOS = "/comercial/pedidos";

/** Data 'aaaa-mm-dd' (aceita ISO com hora); vazio ou inválido vira null. */
export const dataIso = (v: unknown): string | null => {
  const d = texto(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== "0000-00-00" && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null;
};
/** Data e hora ISO (timestamptz); vazio ou inválido vira null. */
const dataHoraIso = (v: unknown): string | null => {
  const t = texto(v);
  return t !== "" && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null;
};
/** Valor em reais com 2 casas (número JSON ou texto "1234.56"); inválido vira `padrao`. */
const reais = <T extends number | null>(v: unknown, padrao: T): number | T => {
  if (v === null || v === undefined || texto(v) === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : padrao;
};
const numero = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ouNulo = (v: unknown): string | null => texto(v) || null;

export type PedidoNormalizado = {
  cod_pedido: string; situacao: string; cod_cliente: string | null; nome_cliente: string | null;
  cod_representante: string | null; nome_representante: string | null; cod_tipo_nf: string | null; desc_tipo_nf: string | null;
  cod_cond_venda: string | null; desc_cond_venda: string | null; data_emissao: string | null; data_digitacao: string | null;
  data_prev_fat: string | null; data_ultimo_fat: string | null; valor_total: number; valor_faturado: number; valor_saldo: number;
  valor_cancelado: number; valor_bloqueado: number;
};

/** Linha de pedidoVendaResumido -> linha de com_pedidos (sem o que só vem no detalhe). Sem código: null. */
export function normalizarPedidoResumido(r: Record<string, unknown>): PedidoNormalizado | null {
  const cod = texto(r.codPedido);
  if (cod === "") return null;
  return {
    cod_pedido: cod,
    situacao: texto(r.situacao) || "?",
    cod_cliente: ouNulo(r.codCliente),
    nome_cliente: ouNulo(r.nomeCliente),
    cod_representante: ouNulo(r.codRepresentante),
    nome_representante: ouNulo(r.nomeRepresentante),
    cod_tipo_nf: ouNulo(r.codTipoNF),
    desc_tipo_nf: ouNulo(r.descTipoNF),
    cod_cond_venda: ouNulo(r.codCondVenda),
    desc_cond_venda: ouNulo(r.descCondVenda),
    data_emissao: dataIso(r.dataEmissao),
    data_digitacao: dataIso(r.dataDigitacao),
    data_prev_fat: dataIso(r.dataPrevFat),
    data_ultimo_fat: dataIso(r.dataUltimoFat),
    valor_total: reais(r.vlrTotalPedido, 0),
    valor_faturado: reais(r.vlrTotalFaturado, 0),
    valor_saldo: reais(r.vlrSaldo, 0),
    valor_cancelado: reais(r.vlrTotalCancelado, 0),
    valor_bloqueado: reais(r.vlrTotalBloqueado, 0),
  };
}

export type PedidoCompletoNormalizado = Omit<PedidoNormalizado, "nome_cliente" | "nome_representante" | "desc_tipo_nf" | "desc_cond_venda" | "data_ultimo_fat">;

/**
 * Pedido completo (pedidoVenda/{id}) relido fora da janela do Resumido: só o que ele traz igual (situação, datas, valores).
 * O completo não traz nomes nem o total faturado; o faturado sai de total - saldo - cancelado.
 */
export function normalizarPedidoCompleto(r: Record<string, unknown>): PedidoCompletoNormalizado | null {
  const cod = texto(r.codPedido);
  if (cod === "") return null;
  const total = reais(r.vlrTotalPedido, 0);
  const saldo = reais(r.vlrSaldo, 0);
  const cancelado = reais(r.vlrTotalCancelado, 0);
  return {
    cod_pedido: cod, situacao: texto(r.situacao) || "?", cod_cliente: ouNulo(r.codCliente), cod_representante: ouNulo(r.codRepresentante),
    cod_tipo_nf: ouNulo(r.codTipoNF), cod_cond_venda: ouNulo(r.codCondVenda), data_emissao: dataIso(r.dataEmissao),
    data_digitacao: dataIso(r.dataDigitacao), data_prev_fat: dataIso(r.dataPrevFat), valor_total: total,
    valor_faturado: Math.max(0, Math.round((total - saldo - cancelado) * 100) / 100), valor_saldo: saldo, valor_cancelado: cancelado,
    valor_bloqueado: 0,
  };
}

/** O que, se mudar, obriga a reler o detalhe e as NFs do pedido. */
export const assinaturaPedido = (p: Pick<PedidoNormalizado, "situacao" | "valor_total" | "valor_faturado" | "valor_saldo" | "valor_cancelado" | "data_prev_fat">) =>
  [p.situacao, p.valor_total.toFixed(2), p.valor_faturado.toFixed(2), p.valor_saldo.toFixed(2), p.valor_cancelado.toFixed(2), p.data_prev_fat ?? ""].join("|");

/** O pedido já faturou alguma coisa (tem NF a buscar)? */
export const pedidoFaturou = (p: Pick<PedidoNormalizado, "situacao" | "valor_faturado">) =>
  p.valor_faturado > 0 || p.situacao === "5" || p.situacao === "6";

export type ItemNormalizado = { item: number; cod_produto: string | null; qtd_pedida: number; qtd_faturada: number; qtd_cancelada: number; preco_unitario: number | null };

/** Detalhe do pedido (pedidoVenda/{id}): itens e o que o Resumido não traz. Item sem número (ou repetido) recebe 10000 + posição. */
export function normalizarDetalhePedido(r: Record<string, unknown>) {
  const vistos = new Set<number>();
  const itens: ItemNormalizado[] = [];
  lista(r.itensPedido).forEach((i, posicao) => {
    let item = Math.round(numero(i.itemPedido));
    if (!(item > 0) || vistos.has(item)) item = 10_000 + posicao;
    vistos.add(item);
    itens.push({
      item, cod_produto: ouNulo(i.codProduto), qtd_pedida: numero(i.qtdPedida), qtd_faturada: numero(i.qtdFaturada),
      qtd_cancelada: numero(i.qtdCancelada), preco_unitario: i.precoUnit === null || i.precoUnit === undefined ? null : numero(i.precoUnit),
    });
  });
  return { valor_antecipado: reais(r.vlrAntecipado, null), cod_portador: ouNulo(r.codPortador), observacao: ouNulo(r.observacaoPedido), itens };
}

export type NotaNormalizada = {
  nota: string; serie: string; chave_acesso: string | null; situacao: string | null; cod_tipo_nota: string | null;
  data_emissao: string | null; data_hora_saida: string | null; valor_total: number | null; qtd_volumes: number | null;
};

/** NF de saída (notaFiscalSaidaPedido/{codPedido}) -> linha de com_notas. Sem número: null. */
export function normalizarNotaPedido(r: Record<string, unknown>): NotaNormalizada | null {
  const nota = numeroNota(r.codNumNota);
  if (nota === "") return null;
  return {
    nota, serie: texto(r.serie), chave_acesso: chaveNfe(r.chaveAcesso) || null, situacao: ouNulo(r.situacao),
    cod_tipo_nota: ouNulo(r.codTipoDeNota), data_emissao: dataIso(r.dataEmissao), data_hora_saida: dataHoraIso(r.dataHoraSaida),
    valor_total: reais(r.valorTotal, null), qtd_volumes: r.qtdVolumes === null || r.qtdVolumes === undefined ? null : numero(r.qtdVolumes),
  };
}

/** Título da NF (/titulo) -> linha de com_nota_parcelas. Sem código: null. */
export function normalizarParcela(r: Record<string, unknown>) {
  const cod = texto(r.codTitulo);
  if (cod === "") return null;
  return {
    cod_titulo: cod, data_emissao: dataIso(r.dataEmissao), data_vencimento: dataIso(r.dataVencimento), data_pagamento: dataIso(r.dataPagamento),
    valor: reais(r.valorTitulo, 0), valor_juros: reais(r.valorJuros, null), valor_desconto: reais(r.valorDesconto, null), cod_portador: ouNulo(r.codPortador),
  };
}

/** A API responde HTTP 400 "Títulos não encontrados para a nota fiscal N" quando a NF não gera duplicata (não é falha). */
export const ehNotaSemTitulos = (mensagem: string) => /t[íi]tulos n[ãa]o encontrados/i.test(mensagem);

/**
 * NFs cujas parcelas precisam ser lidas: com chave (o /titulo só aceita a chave), não canceladas, que geram título, e que
 * ainda não foram lidas ou têm parcela em aberto. As nunca lidas primeiro, depois as lidas há mais tempo.
 */
export function notasParaLerParcelas<T extends { chave_acesso: string | null; situacao: string | null; sem_titulos: boolean; parcelas_lidas_em: string | null; parcelas_abertas: number }>(
  notas: T[], limite: number,
): T[] {
  return notas
    .filter((n) => n.chave_acesso && n.situacao !== "3" && !n.sem_titulos && (n.parcelas_lidas_em === null || n.parcelas_abertas > 0))
    .sort((a, b) => (a.parcelas_lidas_em ?? "").localeCompare(b.parcelas_lidas_em ?? ""))
    .slice(0, limite);
}

/** O pedido está atrasado: tem saldo a faturar, não está cancelado nem faturado total e a previsão já passou. */
export const pedidoAtrasado = (p: { situacao: string; valor_saldo: number; data_prev_fat: string | null }, hoje: string) =>
  p.valor_saldo > 0 && p.situacao !== "9" && p.situacao !== "6" && p.data_prev_fat !== null && p.data_prev_fat < hoje;

const moeda = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type PedidoParaPendencia = {
  id: string; cod_pedido: string; situacao: string; valor_saldo: number; data_prev_fat: string | null;
  nome_cliente: string | null; contraparte_id: string | null;
};

/**
 * Pendência "Pedido com previsão vencida" na Fila do dia: abre para cada pedido atrasado que ainda não tem, atualiza a
 * descrição das abertas (saldo e previsão mudam) e conclui as dos pedidos que deixaram de estar atrasados.
 */
export function planejarPendenciasAtraso(
  pedidos: PedidoParaPendencia[],
  abertas: { id: string; referencia_id: string | null; descricao: string | null }[],
  hoje: string,
) {
  const descricao = (p: PedidoParaPendencia) =>
    `Pedido ${p.cod_pedido}${p.nome_cliente ? ` · ${p.nome_cliente}` : ""} · previsão ${dataBr(p.data_prev_fat!)} · saldo a faturar ${moeda(p.valor_saldo)}`;
  const atrasados = new Map(pedidos.filter((p) => pedidoAtrasado(p, hoje)).map((p) => [p.id, p]));
  const abertaPor = new Map(abertas.filter((a) => a.referencia_id).map((a) => [a.referencia_id!, a]));
  const abrir = [...atrasados.values()].filter((p) => !abertaPor.has(p.id)).map((p) => ({
    titulo: TITULO_PENDENCIA_ATRASO, descricao: descricao(p), prazo: hoje, contraparte_id: p.contraparte_id,
    referencia_tabela: "com_pedidos", referencia_id: p.id, link: `${ROTA_PEDIDOS}/${p.id}`,
  }));
  const atualizar = [...atrasados.values()].flatMap((p) => {
    const a = abertaPor.get(p.id);
    return a && a.descricao !== descricao(p) ? [{ id: a.id, descricao: descricao(p) }] : [];
  });
  const concluir = abertas.filter((a) => !a.referencia_id || !atrasados.has(a.referencia_id)).map((a) => a.id);
  return { abrir, atualizar, concluir };
}

// ---------------------------------------------------------------- MDF-e (Fase 2, expedição)

export const SITUACAO_MDFE: Record<string, string> = {
  "0": "Em digitação", "1": "Com pendência", "2": "Autorizado", "3": "Cancelado", "4": "Encerrado", "5": "Contingência",
};
/** Manifesto ainda em aberto (precisa ser encerrado): autorizado, com pendência ou em contingência. */
export const MDFE_EM_ABERTO = ["1", "2", "5"];
export const TITULO_PENDENCIA_MDFE = "MDF-e não encerrado";
export const CHAVE_DIAS_ALERTA_MDFE = "comercial.pedidos.mdfe_dias_alerta";

/** Linha de GET mdfe (`listaMDFe`) -> linha de com_mdfes. A API grafa o campo de situação como "situcao". */
export function normalizarMdfe(r: Record<string, unknown>) {
  const numero = texto(r.numeroMDFe).replace(/^0+(?=\d)/, "");
  if (numero === "") return null;
  return {
    numero, chave: (soDigitos(r.chaveMDFe).length === 44 ? soDigitos(r.chaveMDFe) : null), protocolo: ouNulo(r.numeroProtocolo),
    uf_final: ouNulo(r.ufFinal), placas: ouNulo(r.placaVeiculos), situacao: ouNulo(r.situcao ?? r.situacao),
    data_emissao: dataIso(r.dataEmissao), hora_emissao: ouNulo(r.horaEmissao), valor_carga: reais(r.valorTotalCarga, null),
  };
}

/** Prazo do alerta lido da configuração: inteiro de 1 a 365, senão null (alerta desligado). */
export function diasAlertaMdfe(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

/** Dias corridos desde a emissão (0 sem data). */
export const diasDesdeEmissao = (dataEmissao: string | null, hoje: string) =>
  dataEmissao ? Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dataEmissao}T00:00:00Z`)) / 86_400_000) : 0;

type MdfeParaPendencia = { id: string; numero: string; situacao: string | null; data_emissao: string | null; uf_final: string | null; placas: string | null };

/**
 * Pendência "MDF-e não encerrado": manifesto em aberto há `dias` ou mais desde a emissão. Com `dias` nulo (alerta
 * desligado) nada é aberto e as abertas são concluídas. Abre as que faltam, conclui as que deixaram de valer.
 */
export function planejarPendenciasMdfe(
  mdfes: MdfeParaPendencia[], abertas: { id: string; referencia_id: string | null }[], hoje: string, dias: number | null,
) {
  const vencidos = new Map(
    dias === null ? [] : mdfes
      .filter((m) => m.situacao !== null && MDFE_EM_ABERTO.includes(m.situacao) && m.data_emissao !== null && diasDesdeEmissao(m.data_emissao, hoje) >= dias)
      .map((m) => [m.id, m]),
  );
  const comAberta = new Set(abertas.map((a) => a.referencia_id).filter(Boolean));
  const abrir = [...vencidos.values()].filter((m) => !comAberta.has(m.id)).map((m) => ({
    titulo: TITULO_PENDENCIA_MDFE, prazo: hoje, referencia_tabela: "com_mdfes", referencia_id: m.id, link: `${ROTA_PEDIDOS}/mdfe`,
    descricao: `MDF-e ${m.numero} · ${SITUACAO_MDFE[m.situacao!] ?? m.situacao} · emitido em ${dataBr(m.data_emissao!)} (${diasDesdeEmissao(m.data_emissao, hoje)} dias)${m.uf_final ? ` · destino ${m.uf_final}` : ""}${m.placas ? ` · placa ${m.placas}` : ""}`,
  }));
  const concluir = abertas.filter((a) => !a.referencia_id || !vencidos.has(a.referencia_id)).map((a) => a.id);
  return { abrir, concluir };
}
