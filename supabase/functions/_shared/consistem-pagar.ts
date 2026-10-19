// Contas a pagar do Consistem: normalização dos lançamentos da API e planejamento da sincronização.
// Lógica PURA (sem Deno, sem Supabase) para ser testada com o Vitest (lib/integracoes/consistem/consistem-pagar.test.ts)
// e usada pela Edge Function `cap-sincronizar-consistem`. O cliente HTTP é o mesmo de Recebíveis (consistem-receber.ts).
//
// O que a API entrega (testado ao vivo em 09/10/2026):
//   GET financeiro/v10/contasPagar            lista a VIDA INTEIRA (~27 mil); o filtro `situacao` é ignorado pelo servidor.
//                                             Em aberto = valorAtualizado > 0. Valores vêm como texto pt-BR ("2.525,44").
//   GET financeiro/v10/lancamentoContasPagar  (lista) devolve HTTP 500 no servidor; só o /{id} funciona (detalhe).
//   GET cadastrosgerais/v10/fornecedor        ?situacao=1 (ativos) e =0 (inativos).
// tipoLancamento: C = título a pagar · A = antecipação a fornecedor (dataVencimento vem "0") · B = baixa de antecipação
//                 · D = débito (crédito do fornecedor) · P = projeção (parcelamentos, INSS). Só C, A e D interessam.

// Sem imports: cópia enxuta de paraCentavos/paraDataIso de consistem-receber.ts (o tsc do app não aceita import com ".ts",
// e o Deno exige a extensão). Há teste de paridade em consistem-pagar.test.ts: se mudar lá, mude aqui.

export const ROTA_CONTAS_PAGAR = "financeiro/v10/contasPagar";
export const ROTA_DETALHE_LANCAMENTO = "financeiro/v10/lancamentoContasPagar";
export const ROTA_FORNECEDORES = "cadastrosgerais/v10/fornecedor";
/** Cadastro das contas bancárias da empresa (sem saldo: a API v1.0.15 não tem saldo nem conciliação). Lista em `dadosBancarios`. */
export const ROTA_DADOS_BANCARIOS = "financeiro/v10/dadosBancarios";

/** Quantos detalhes (um GET por lançamento) uma rodada lê, no máximo: só antecipações novas precisam dele. */
export const LIMITE_DETALHES_POR_RODADA = 150;

/**
 * Borderô: a tabela por trás da listagem (Cpg.MovimentoFornecedor) tem o campo `codBordero`, que a resposta não traz, mas o
 * filtro dinâmico aceita. `codBordero LIKE '%'` devolve só os lançamentos COM borderô (nulo fica fora). Antecipação com
 * borderô = paga (regra confirmada com o financeiro em 10/10/2026). Funciona junto com dataEmissaoIni/Fim.
 */
export const FILTRO_BORDERO = { campoFiltroDinamico: "codBordero", valorFiltroDinamico: "%" } as const;

const addDiasIso = (iso: string, dias: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const diasEntreIso = (a: string, b: string): number => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Agrupa datas (aaaa-mm-dd) em janelas contíguas para consultar a API por intervalo: datas a até `maxLacuna` dias uma da
 * outra ficam na mesma janela. Se o intervalo todo couber em `maxJanelaUnica` dias, devolve uma janela só.
 * A consulta de borderô custa ~1 s a cada 250 lançamentos, então janelas pequenas em volta das emissões que interessam
 * saem muito mais baratas que o ano inteiro.
 */
export function janelasDeDatas(datas: readonly string[], maxLacuna = 3, maxJanelaUnica = 45): { ini: string; fim: string }[] {
  const ordenadas = [...new Set(datas.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (ordenadas.length === 0) return [];
  if (diasEntreIso(ordenadas[ordenadas.length - 1], ordenadas[0]) <= maxJanelaUnica) return [{ ini: ordenadas[0], fim: ordenadas[ordenadas.length - 1] }];
  const janelas: { ini: string; fim: string }[] = [];
  let ini = ordenadas[0];
  let fim = ordenadas[0];
  for (const d of ordenadas.slice(1)) {
    if (diasEntreIso(d, fim) <= maxLacuna) {
      fim = d;
    } else {
      janelas.push({ ini, fim });
      ini = d;
      fim = d;
    }
  }
  janelas.push({ ini, fim });
  return janelas;
}

/** Só para manter a API coerente nos testes: a data seguinte (usada ao fechar janelas). */
export const diaSeguinte = (iso: string): string => addDiasIso(iso, 1);

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

// toFixed(6) tira o ruído binário (1.005 * 100 = 100.49999999999999) antes de arredondar ao centavo.
const emCentavos = (n: number) => Math.round(Number((n * 100).toFixed(6)));

/** Valor monetário em centavos (inteiro). Aceita número JSON ou string pt-BR ("1.234,56") ou en ("1234.56"). */
export function paraCentavos(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? emCentavos(v) : null;
  let s = texto(v).replace(/[R$\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? emCentavos(n) : null;
}

/** Datas da API vêm em ISO; aceita também a parte de data de um timestamp. "0" e vazio viram null. */
export function paraDataIso(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? `${m[1]}-${m[2]}-${m[3]}`
    : null;
}

export type TipoLancamento = "C" | "A" | "B" | "D" | "P";
export type TipoGravado = "C" | "A" | "D";
export type Classe = "titulo" | "antecipacao" | "credito" | "ignorar";

export type LancamentoPagarApi = {
  codLancamento: string;
  tipo: TipoLancamento;
  codFornecedor: string;
  numDocumento: string;
  categoriaDoc: string;
  codBanco: string;
  codHistorico: string;
  complemento: string;
  emissao: string | null;
  entrada: string | null;
  /** Nula na antecipação (a API manda "0"). */
  vencimento: string | null;
  valorDocumentoCentavos: number;
  valorOriginalCentavos: number | null;
  /** Saldo: a pagar (C) ou ainda não abatido por NF (A). */
  saldoCentavos: number;
  codOrigem: string;
};

export type ResultadoLancamento =
  | { ok: true; lancamento: LancamentoPagarApi }
  | { ok: false; motivo: string; codLancamento: string };

const TIPOS: readonly string[] = ["C", "A", "B", "D", "P"];

export function normalizarLancamentoPagar(r: Record<string, unknown>): ResultadoLancamento {
  const codLancamento = texto(r.codLancamento);
  if (codLancamento === "") return { ok: false, motivo: "lançamento sem código", codLancamento };
  const tipo = texto(r.tipoLancamento).toUpperCase();
  if (!TIPOS.includes(tipo)) return { ok: false, motivo: `tipo de lançamento desconhecido (${tipo || "vazio"})`, codLancamento };
  const valorDocumentoCentavos = paraCentavos(r.valorDocumento);
  if (valorDocumentoCentavos === null) return { ok: false, motivo: "valor do documento inválido", codLancamento };
  const saldoCentavos = paraCentavos(r.valorAtualizado);
  if (saldoCentavos === null) return { ok: false, motivo: "valor atualizado inválido", codLancamento };
  return {
    ok: true,
    lancamento: {
      codLancamento,
      tipo: tipo as TipoLancamento,
      codFornecedor: texto(r.codFornecedor),
      numDocumento: texto(r.numDocumento ?? r.codDocumento),
      categoriaDoc: texto(r.categoriaDoc),
      codBanco: texto(r.codBanco ?? r.codPortador),
      codHistorico: texto(r.codHistorico),
      complemento: texto(r.complementoHistorico).replace(/;\s*$/, ""),
      emissao: paraDataIso(r.dataEmissao),
      entrada: paraDataIso(r.dataEntrada),
      vencimento: paraDataIso(r.dataVencimento),
      valorDocumentoCentavos,
      valorOriginalCentavos: paraCentavos(r.valorOriginal ?? r.valorOriginalDocumento),
      saldoCentavos,
      codOrigem: texto(r.codOrigem),
    },
  };
}

export function classificarLancamento(l: Pick<LancamentoPagarApi, "tipo">): Classe {
  switch (l.tipo) {
    case "C": return "titulo";
    case "A": return "antecipacao";
    case "D": return "credito";
    default: return "ignorar";
  }
}

export const estaEmAberto = (l: Pick<LancamentoPagarApi, "saldoCentavos">): boolean => l.saldoCentavos > 0;

/** Campos do detalhe (GET lancamentoContasPagar/{id}) que a lista não traz. */
export type DetalheLancamento = {
  codPortador: string;
  codBarras: string;
  qrCodePix: string;
  dataPagamento: string | null;
  valorPagoCentavos: number | null;
};

export function normalizarDetalheLancamento(r: Record<string, unknown>): DetalheLancamento {
  return {
    codPortador: texto(r.codPortador),
    codBarras: texto(r.codBarras),
    qrCodePix: texto(r.qrCodePix),
    dataPagamento: paraDataIso(r.dataPagamento),
    valorPagoCentavos: paraCentavos(r.valorPago),
  };
}

export type FornecedorApi = { codFornecedor: string; nome: string; nomeFantasia: string; documentoBruto: string; ativo: boolean; codCategoria: number | null };

export function normalizarFornecedorApi(r: Record<string, unknown>): FornecedorApi | null {
  const codFornecedor = texto(r.codFornecedor);
  if (codFornecedor === "") return null;
  const nome = texto(r.nome) || texto(r.nomeFantasia) || texto(r.razaoSocial);
  const situacao = texto(r.situacao);
  return {
    codFornecedor,
    nome: nome || `Fornecedor ${codFornecedor} (Consistem)`,
    nomeFantasia: texto(r.nomeFantasia),
    documentoBruto: texto(r.cpfCnpj ?? r.cnpjCpf ?? r.cnpj ?? r.cpf),
    ativo: situacao === "" ? true : situacao === "1",
    codCategoria: /^\d{1,3}$/.test(texto(r.codCategoria)) ? Number(texto(r.codCategoria)) : null,
  };
}

// ---------------------------------------------------------------- contas bancárias

export type ContaBancariaApi = {
  codContaBancaria: string;
  codBanco: string;
  descricao: string;
  agencia: string;
  conta: string;
  contaContabil: string;
  /** 1 = conta corrente, 2 = outras (aplicação, vinculada...). */
  tipoConta: number | null;
  /** "Considera saldo no fluxo" no Consistem. */
  consideraSaldo: boolean;
  inativa: boolean;
};

/** Booleano da API: true/false, 1/0 ou "1"/"0"/"S"/"N". Vazio = null. */
function paraBooleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const t = texto(v).toUpperCase();
  if (t === "") return null;
  return t === "1" || t === "TRUE" || t === "S" || t === "SIM";
}

/** Uma linha de GET /dadosBancarios; null sem código da conta. `situacaoConta` = "Conta Inativa" (true = inativa). */
export function normalizarContaBancaria(r: Record<string, unknown>): ContaBancariaApi | null {
  const codContaBancaria = texto(r.codContaBancaria);
  if (codContaBancaria === "") return null;
  const tipo = texto(r.tipoConta);
  return {
    codContaBancaria,
    codBanco: texto(r.codBanco),
    descricao: texto(r.descContaBancaria) || `Conta ${codContaBancaria}`,
    agencia: texto(r.codAgencia),
    conta: texto(r.ctaCorrenteEditada) || texto(r.identficadorConta),
    contaContabil: texto(r.contaContabil),
    tipoConta: /^\d{1,2}$/.test(tipo) ? Number(tipo) : null,
    consideraSaldo: paraBooleano(r.consideraSaldo) ?? false,
    inativa: paraBooleano(r.situacaoConta) ?? false,
  };
}

/** Padrão local de "entra no caixa" para conta nova: conta corrente, ativa e que considera saldo no fluxo. */
export const entraNoCaixaPorPadrao = (c: Pick<ContaBancariaApi, "tipoConta" | "consideraSaldo" | "inativa">): boolean =>
  c.tipoConta === 1 && c.consideraSaldo && !c.inativa;

// ---------------------------------------------------------------- planejamento

/** O que está gravado em cap_lancamentos (só o necessário para comparar). */
export type LancamentoBanco = {
  id: string;
  codLancamento: string;
  tipo: TipoGravado;
  codFornecedor: string;
  numDocumento: string;
  complemento: string;
  vencimento: string | null;
  valorDocumentoCentavos: number;
  saldoCentavos: number;
  baixadoEm: string | null;
};

export type CamposAlterados = {
  cod_fornecedor?: string | null;
  num_documento?: string | null;
  complemento_historico?: string | null;
  data_vencimento?: string | null;
  valor_documento?: number;
  valor_atualizado?: number;
  /** Voltou a ter saldo depois de "baixado": reabre. */
  baixado_em?: null;
};

export type PlanoPagar = {
  /** Em aberto na API e ainda não gravados (C, A ou D). */
  novos: LancamentoPagarApi[];
  /** Gravados, ainda abertos na API, com algum campo diferente (ou reabertos). */
  alterados: { id: string; campos: CamposAlterados }[];
  /** Gravados e abertos no banco que sumiram da API ou voltaram com saldo zero. */
  baixados: string[];
  inalterados: number;
  /** Em aberto na API, mas de tipo que não interessa (B, P). */
  ignorados: number;
  /** Com saldo zero na API e sem registro no banco: nunca interessaram. */
  encerradosNaApi: number;
  duplicadosApi: string[];
  /** Quantos de cada tipo estão em aberto na API (C, A, D, B, P). */
  abertosPorTipo: Record<TipoLancamento, { quantidade: number; centavos: number }>;
};

const vazioPorTipo = (): PlanoPagar["abertosPorTipo"] => ({
  C: { quantidade: 0, centavos: 0 }, A: { quantidade: 0, centavos: 0 }, B: { quantidade: 0, centavos: 0 },
  D: { quantidade: 0, centavos: 0 }, P: { quantidade: 0, centavos: 0 },
});

export function planejarSincronizacaoPagar(api: readonly LancamentoPagarApi[], banco: readonly LancamentoBanco[]): PlanoPagar {
  const plano: PlanoPagar = { novos: [], alterados: [], baixados: [], inalterados: 0, ignorados: 0, encerradosNaApi: 0, duplicadosApi: [], abertosPorTipo: vazioPorTipo() };
  const porCodigo = new Map<string, LancamentoBanco>(banco.map((b) => [b.codLancamento, b]));
  const vistos = new Set<string>();
  const abertosNaApi = new Set<string>();

  for (const l of api) {
    if (vistos.has(l.codLancamento)) {
      plano.duplicadosApi.push(l.codLancamento);
      continue;
    }
    vistos.add(l.codLancamento);
    const aberto = estaEmAberto(l);
    if (aberto) {
      plano.abertosPorTipo[l.tipo].quantidade++;
      plano.abertosPorTipo[l.tipo].centavos += l.saldoCentavos;
    }
    if (classificarLancamento(l) === "ignorar") {
      if (aberto) plano.ignorados++;
      continue;
    }
    const b = porCodigo.get(l.codLancamento);
    if (!aberto) {
      if (!b) plano.encerradosNaApi++;
      // gravado e sem saldo na API: vira "baixado" abaixo (não entra em abertosNaApi)
      continue;
    }
    abertosNaApi.add(l.codLancamento);
    if (!b) {
      plano.novos.push(l);
      continue;
    }
    const campos: CamposAlterados = {};
    if (b.codFornecedor !== l.codFornecedor) campos.cod_fornecedor = l.codFornecedor || null;
    if (b.numDocumento !== l.numDocumento) campos.num_documento = l.numDocumento || null;
    if (b.complemento !== l.complemento) campos.complemento_historico = l.complemento || null;
    if (b.vencimento !== l.vencimento) campos.data_vencimento = l.vencimento;
    if (b.valorDocumentoCentavos !== l.valorDocumentoCentavos) campos.valor_documento = l.valorDocumentoCentavos / 100;
    if (b.saldoCentavos !== l.saldoCentavos) campos.valor_atualizado = l.saldoCentavos / 100;
    if (b.baixadoEm !== null) campos.baixado_em = null;
    if (Object.keys(campos).length > 0) plano.alterados.push({ id: b.id, campos });
    else plano.inalterados++;
  }

  for (const b of banco) {
    if (b.baixadoEm === null && !abertosNaApi.has(b.codLancamento)) plano.baixados.push(b.id);
  }
  return plano;
}
