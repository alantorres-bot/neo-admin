// Contas a receber do Consistem: leitura da API REST e planejamento da sincronização.
// Lógica PURA (sem Deno, sem Supabase, sem imports) para ser testada com o Vitest do projeto
// (lib/integracoes/consistem/consistem-receber.test.ts) e usada pela Edge Function
// `rec-sincronizar-consistem`.
//
// Baseado na integração já em produção no gestor-akf (consistem_api.py) e no NEOControl:
//   base  https://erp.neoformas.com.br/api
//   auth  header `Authorization: <token do CSMEN050>` (SEM "Bearer") + header `empresa: <código>`
//   lista GET /financeiro/v10/contasReceber?tipoTitulo=0  (0 = em aberto)
//   nomes GET /cadastrosgerais/v10/cliente?situacao=1
//   paginação por `continuationToken`, retry em HTTP 429.
// Datas da API são ISO (YYYY-MM-DD). A API NÃO traz nome do cliente nem do portador.

export const BASE_URL_PADRAO = "https://erp.neoformas.com.br/api";
export const PAGINACAO = 200;
const MAX_PAGINAS = 1000;
const MAX_TENTATIVAS_429 = 4;

export class ConsistemErro extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
    this.name = "ConsistemErro";
  }
}

// ---------------------------------------------------------------- cliente HTTP

export type ConfigConsistem = { baseUrl: string; token: string; empresa: string };
export type Buscar = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tira espaços e quebras de linha do token (artefato comum de copiar de terminal ou e-mail) e confere o
 * formato JWT do CSMEN050 (três partes base64url). Devolve null se não parecer um token; NUNCA ecoa o valor.
 */
export function limparToken(bruto: string): string | null {
  const t = bruto.trim().replace(/^bearer\s+/i, "").replace(/\s+/g, ""); // a API do Consistem NÃO usa "Bearer"
  return /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

/** GET paginado: acumula `data` de todas as páginas até acabar o `continuationToken`. */
export async function buscarTodasPaginas(
  buscar: Buscar,
  cfg: ConfigConsistem,
  rota: string,
  params: Record<string, string | number>,
  opcoes: { esperar?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, unknown>[]> {
  const token = limparToken(cfg.token);
  if (!token) throw new ConsistemErro("O segredo CONSISTEM_API_KEY não parece um token válido (esperado: token JWT do CSMEN050, sem espaços nem quebras de linha).");
  const aguardar = opcoes.esperar ?? esperar;
  const base = `${cfg.baseUrl.replace(/\/+$/, "")}/${rota.replace(/^\/+/, "")}`;
  const headers = { Authorization: token, empresa: cfg.empresa, Accept: "application/json" };
  const registros: Record<string, unknown>[] = [];
  const p: Record<string, string | number> = { ...params };
  // Falha de rede/cabeçalho: mensagem genérica (o erro original pode conter o valor dos cabeçalhos, ou seja, o token).
  const chamar: Buscar = async (u, init) => {
    try {
      return await buscar(u, init);
    } catch {
      throw new ConsistemErro("Falha de rede ao chamar a API do Consistem.");
    }
  };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = `${base}?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))}`;
    let resp = await chamar(url, { headers });
    for (let tentativa = 1; resp.status === 429 && tentativa < MAX_TENTATIVAS_429; tentativa++) {
      await aguardar(2 ** (tentativa - 1) * 1000);
      resp = await chamar(url, { headers });
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new ConsistemErro(
        `Acesso negado (HTTP ${resp.status}). O serviço pode não estar liberado no token (CSMEN050, aba Serviço).`,
        resp.status,
      );
    }
    const texto = await resp.text();
    if (!resp.ok) throw new ConsistemErro(`Consistem HTTP ${resp.status}: ${texto.slice(0, 200)}`, resp.status);

    const corpo: unknown = texto ? JSON.parse(texto) : {};
    if (Array.isArray(corpo)) {
      registros.push(...(corpo as Record<string, unknown>[]));
      return registros;
    }
    const obj = corpo as Record<string, unknown>;
    const dados = (obj.data ?? obj.Data ?? []) as Record<string, unknown>[];
    registros.push(...dados);
    const continuacao = (obj.continuationToken ?? obj.ContinuationToken) as string | null | undefined;
    if (!continuacao) return registros;
    p.continuationToken = continuacao;
  }
  throw new ConsistemErro("Paginação do Consistem não terminou (limite de páginas).");
}

// ---------------------------------------------------------------- normalização

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

/** Datas da API vêm em ISO; aceita também a parte de data de um timestamp. */
export function paraDataIso(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? `${m[1]}-${m[2]}-${m[3]}`
    : null;
}

export type TituloApi = {
  documento: string;
  parcela: string;
  codCliente: string;
  emissao: string | null;
  vencimento: string;
  valorCentavos: number;
  codPortador: string;
  /** Número da nota fiscal de origem (sem zeros à esquerda); vazio nos lançamentos que não vêm de NF. */
  nota: string;
  /** Chave de acesso da NF-e (44 dígitos) ou vazio. */
  chaveNfe: string;
  tipoCobranca: string;
};

export type ResultadoTitulo = { ok: true; titulo: TituloApi } | { ok: false; motivo: string; documento: string };

export function normalizarTituloApi(r: Record<string, unknown>): ResultadoTitulo {
  const documento = texto(r.codTitulo);
  if (documento === "") return { ok: false, motivo: "título sem código", documento };
  const codCliente = texto(r.codCliente);
  if (codCliente === "") return { ok: false, motivo: "título sem cliente", documento };
  const vencimento = paraDataIso(r.dataVenc);
  if (!vencimento) return { ok: false, motivo: "vencimento inválido", documento };
  const valorCentavos = paraCentavos(r.valorTitulo);
  if (valorCentavos === null || valorCentavos <= 0) return { ok: false, motivo: "valor inválido ou zerado", documento };
  return {
    ok: true,
    titulo: {
      documento,
      // A API de contas a receber identifica o título só por `codTitulo` (o sufixo letra/número já distingue a
      // parcela). Se algum dia vier um campo de parcela, passa a valer; senão fica '1'.
      parcela: texto(r.parcela ?? r.numeroParcela) || "1",
      codCliente,
      emissao: paraDataIso(r.dataEmissao),
      vencimento,
      valorCentavos,
      codPortador: texto(r.codPortador),
      nota: numeroNota(r.notaFiscal),
      chaveNfe: chaveNfe(r.chaveNfeNotaFiscal),
      tipoCobranca: texto(r.tipoCobranca),
    },
  };
}

export type ClienteApi = { codCliente: string; nome: string; documentoBruto: string };

export function normalizarClienteApi(r: Record<string, unknown>): ClienteApi | null {
  const codCliente = texto(r.codCliente);
  if (codCliente === "") return null;
  const nome = texto(r.nome) || texto(r.nomeFantasia);
  return { codCliente, nome, documentoBruto: texto(r.cpfCnpj) };
}

// ---------------------------------------------------------------- documento (CPF/CNPJ)
// Cópia enxuta de lib/nucleo/documentos.ts: a Edge Function não pode importar de fora de
// supabase/functions. Se mudar a regra lá, mude aqui (há teste de paridade em consistem-receber.test.ts).

const digitos = (v: string) => v.replace(/\D/g, "");

function dv(base: string, pesos: number[]): number {
  const resto = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF/CNPJ válido, formatado COM máscara (como o núcleo grava); null se vazio ou inválido. */
export function documentoFormatado(entrada: string): string | null {
  const d = digitos(entrada);
  if (/^(\d)\1+$/.test(d)) return null;
  if (d.length === 14) {
    const d1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = dv(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (d !== d.slice(0, 12) + d1 + d2) return null;
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) {
    const d1 = dv(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = dv(d.slice(0, 9) + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (d !== d.slice(0, 9) + d1 + d2) return null;
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return null;
}

// ---------------------------------------------------------------- planejamento

export type TituloBanco = {
  id: string;
  documento: string;
  parcela: string;
  emissao: string | null;
  vencimento: string;
  valorCentavos: number;
  estagio: string;
  origem: string;
  /** Dados de nota/cobrança já gravados (ausentes nos títulos anteriores à migration 0103). */
  notaFiscal?: string | null;
  chaveNfe?: string | null;
  codPortador?: string | null;
  tipoCobranca?: string | null;
};

export const ESTAGIOS_ENCERRADOS = ["pago", "renegociado", "cancelado"] as const;
const encerrado = (estagio: string) => (ESTAGIOS_ENCERRADOS as readonly string[]).includes(estagio);
export const chaveTitulo = (documento: string, parcela: string) => `${documento}\u0000${parcela}`;

export type Alteracao = { id: string; campos: { vencimento?: string; valor?: number; emissao?: string | null } };
/** Completa dados de nota e cobrança que o Consistem informa e o banco ainda não tinha (ou que mudaram, como o portador). */
export type Enriquecimento = { id: string; campos: { nota_fiscal?: string; chave_nfe?: string; cod_portador?: string; tipo_cobranca?: string } };

export type Plano = {
  /** Existem na API e não no banco. */
  novos: TituloApi[];
  /** Existem nos dois, com data/valor diferentes (a API é a fonte da verdade desses campos). */
  alterados: Alteracao[];
  enriquecidos: Enriquecimento[];
  inalterados: number;
  /** Abertos no banco (veio do Consistem) que a API não lista mais: provável pagamento. NUNCA baixa sozinho. */
  possiveisBaixas: TituloBanco[];
  /** Ids que a API lista e estão abertos no banco: encerram pendência de "possível baixa" antiga. */
  presentes: string[];
  /** A API diz "em aberto", mas o banco já encerrou (pago/renegociado/cancelado). Só informa. */
  divergentes: TituloBanco[];
  /** Chaves repetidas na resposta da API (mantida a primeira). */
  duplicadosApi: string[];
};

export function planejarSincronizacao(titulosApi: TituloApi[], titulosBanco: TituloBanco[]): Plano {
  const banco = new Map(titulosBanco.map((t) => [chaveTitulo(t.documento, t.parcela), t]));
  const vistos = new Set<string>();
  const plano: Plano = {
    novos: [], alterados: [], enriquecidos: [], inalterados: 0, possiveisBaixas: [], presentes: [], divergentes: [], duplicadosApi: [],
  };

  for (const t of titulosApi) {
    const chave = chaveTitulo(t.documento, t.parcela);
    if (vistos.has(chave)) {
      plano.duplicadosApi.push(`${t.documento}/${t.parcela}`);
      continue;
    }
    vistos.add(chave);

    const existente = banco.get(chave);
    if (!existente) {
      plano.novos.push(t);
      continue;
    }
    if (encerrado(existente.estagio)) {
      plano.divergentes.push(existente);
      continue;
    }
    plano.presentes.push(existente.id);
    const campos: Alteracao["campos"] = {};
    if (existente.vencimento !== t.vencimento) campos.vencimento = t.vencimento;
    if (existente.valorCentavos !== t.valorCentavos) campos.valor = t.valorCentavos / 100;
    if (t.emissao && existente.emissao !== t.emissao) campos.emissao = t.emissao;
    if (Object.keys(campos).length > 0) plano.alterados.push({ id: existente.id, campos });
    else plano.inalterados++;

    const extra: Enriquecimento["campos"] = {};
    if (t.nota && !existente.notaFiscal) extra.nota_fiscal = t.nota;
    if (t.chaveNfe && !existente.chaveNfe) extra.chave_nfe = t.chaveNfe;
    if (t.codPortador && t.codPortador !== (existente.codPortador ?? "")) extra.cod_portador = t.codPortador;
    if (t.tipoCobranca && t.tipoCobranca !== (existente.tipoCobranca ?? "")) extra.tipo_cobranca = t.tipoCobranca;
    if (Object.keys(extra).length > 0) plano.enriquecidos.push({ id: existente.id, campos: extra });
  }

  for (const t of titulosBanco) {
    if (encerrado(t.estagio) || t.origem !== "importacao") continue; // manual/acordo não vêm do Consistem
    if (!vistos.has(chaveTitulo(t.documento, t.parcela))) plano.possiveisBaixas.push(t);
  }
  return plano;
}

// ---------------------------------------------------------------- NF de saída e entrada na esteira (Etapa 1a)

export type NotaSaida = {
  nota: string;
  serie: string;
  chave: string;
  codCliente: string;
  valorCentavos: number | null;
  emissao: string | null;
  /** Todos os pedidos da NF: o do cabeçalho e os dos itens (faturamento agrupado). */
  pedidos: string[];
};

/** NF de saída da API. O pedido vem no cabeçalho (`codPedido`) ou nos itens (`itemPedidoAgrupado[].codPedido`). */
export function normalizarNotaSaida(r: Record<string, unknown>): NotaSaida | null {
  const nota = numeroNota(r.codNumNota);
  if (nota === "") return null;
  const pedidos = new Set<string>();
  const cabecalho = texto(r.codPedido);
  if (cabecalho) pedidos.add(cabecalho);
  const itens = Array.isArray(r.itensNotaFiscalSaida) ? (r.itensNotaFiscalSaida as Record<string, unknown>[]) : [];
  for (const item of itens) {
    const agrupados = Array.isArray(item?.itemPedidoAgrupado) ? (item.itemPedidoAgrupado as Record<string, unknown>[]) : [];
    for (const a of agrupados) {
      const p = texto(a?.codPedido);
      if (p) pedidos.add(p);
    }
  }
  return {
    nota,
    serie: texto(r.serie),
    chave: chaveNfe(r.chaveAcesso),
    codCliente: texto(r.codCliente),
    valorCentavos: paraCentavos(r.valorTotal),
    emissao: paraDataIso(r.dataEmissao),
    pedidos: [...pedidos].sort(),
  };
}

export type IndiceNotas = { porChave: Map<string, number>; porNotaCliente: Map<string, number[]> };

export function indexarNotas(notas: readonly NotaSaida[]): IndiceNotas {
  const porChave = new Map<string, number>();
  const porNotaCliente = new Map<string, number[]>();
  notas.forEach((n, i) => {
    if (n.chave) porChave.set(n.chave, i);
    const k = `${n.nota}\u0000${n.codCliente}`;
    porNotaCliente.set(k, [...(porNotaCliente.get(k) ?? []), i]);
  });
  return { porChave, porNotaCliente };
}

export type Vinculo =
  | { ok: true; indice: number; via: "chave" | "nota_cliente" }
  | { ok: false; motivo: "sem_nota" | "nao_encontrada" | "ambigua" };

/**
 * Liga o título à NF que o originou. Só os dois caminhos provados com dados reais (Etapa 0): chave da NF-e e
 * número da nota + cliente. Mais de uma NF candidata = ambígua (não liga, para nunca ligar errado).
 */
export function ligarTituloNota(t: Pick<TituloApi, "nota" | "chaveNfe" | "codCliente">, indice: IndiceNotas): Vinculo {
  if (t.chaveNfe) {
    const i = indice.porChave.get(t.chaveNfe);
    if (i !== undefined) return { ok: true, indice: i, via: "chave" };
  }
  if (!t.nota) return { ok: false, motivo: "sem_nota" };
  const candidatas = indice.porNotaCliente.get(`${t.nota}\u0000${t.codCliente}`) ?? [];
  if (candidatas.length === 1) return { ok: true, indice: candidatas[0], via: "nota_cliente" };
  return { ok: false, motivo: candidatas.length > 1 ? "ambigua" : "nao_encontrada" };
}

/** Tantos títulos novos de uma vez indicam carga em lote (banco vazio, reimportação), não faturamento do dia. */
export const LIMITE_ENTRADA_LOTE = 50;
/** O boleto precisa estar pronto antes do D-7 da régua (envio do boleto). */
export const DIAS_ANTES_VENCIMENTO_BOLETO = 8;
export const PREFIXO_BOLETO = "Anexar boleto";

export type DecisaoEntrada = { abrir: boolean; motivo?: "sem_inicio" | "antes_do_inicio" | "lote_grande" | "sem_novos" };

/** Decide se os títulos novos desta rodada entram na esteira (abrem pendência de boleto). `inicio` = data configurada. */
export function decidirEntrada(qtdNovos: number, hoje: string, inicio: string | null): DecisaoEntrada {
  if (qtdNovos === 0) return { abrir: false, motivo: "sem_novos" };
  if (!inicio) return { abrir: false, motivo: "sem_inicio" };
  if (hoje < inicio) return { abrir: false, motivo: "antes_do_inicio" };
  if (qtdNovos > LIMITE_ENTRADA_LOTE) return { abrir: false, motivo: "lote_grande" };
  return { abrir: true };
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Prazo para anexar o boleto: D-8 do vencimento mais próximo; se já passou, hoje. */
export function prazoBoleto(vencimento: string, hoje: string): string {
  const alvo = addDias(vencimento, -DIAS_ANTES_VENCIMENTO_BOLETO);
  return alvo > hoje ? alvo : hoje;
}

/** Quanto mais perto do vencimento, mais urgente: até 3 dias crítica, até 10 alta, depois normal. */
export function criticidadeBoleto(vencimento: string, hoje: string): "critica" | "alta" | "normal" {
  const dias = diasEntre(vencimento, hoje);
  if (dias <= 3) return "critica";
  if (dias <= 10) return "alta";
  return "normal";
}

// ---- Pendência "Anexar boleto": calculada a partir do que está no banco (títulos em `aguardando_boleto`), não do
// que chegou nesta rodada. Assim a função é idempotente e uma rodada que falhou no meio é consertada pela seguinte.

export type TituloEsteira = {
  id: string;
  documento: string;
  parcela: string;
  vencimento: string;
  valorCentavos: number;
  notaSaidaId: string | null;
  contraparteId: string;
  codCliente: string;
  nomeCliente: string;
};

export type NotaEsteira = { id: string; nota: string; pedidos: string[] };

export type GrupoBoleto = {
  /** Uma pendência por NF; título sem NF = uma pendência por título. */
  referenciaTabela: "rec_notas_saida" | "rec_titulos";
  referenciaId: string;
  nota: NotaEsteira | null;
  titulos: TituloEsteira[];
  contraparteId: string;
  codCliente: string;
  nomeCliente: string;
  vencimentoMaisProximo: string;
  valorCentavos: number;
};

/** Agrupa os títulos aguardando boleto: parcelas da mesma NF viram um grupo; sem NF, um grupo por título. */
export function agruparBoletosPendentes(titulos: readonly TituloEsteira[], notas: readonly NotaEsteira[]): GrupoBoleto[] {
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  const grupos = new Map<string, GrupoBoleto>();
  for (const t of titulos) {
    const nota = t.notaSaidaId ? (notaPorId.get(t.notaSaidaId) ?? null) : null;
    const referenciaTabela = nota ? "rec_notas_saida" : "rec_titulos";
    const referenciaId = nota ? nota.id : t.id;
    const g = grupos.get(referenciaId) ?? {
      referenciaTabela, referenciaId, nota, titulos: [], contraparteId: t.contraparteId, codCliente: t.codCliente,
      nomeCliente: t.nomeCliente, vencimentoMaisProximo: t.vencimento, valorCentavos: 0,
    } as GrupoBoleto;
    g.titulos.push(t);
    g.valorCentavos += t.valorCentavos;
    if (t.vencimento < g.vencimentoMaisProximo) g.vencimentoMaisProximo = t.vencimento;
    grupos.set(referenciaId, g);
  }
  return [...grupos.values()].sort((a, b) => a.vencimentoMaisProximo.localeCompare(b.vencimentoMaisProximo) || a.referenciaId.localeCompare(b.referenciaId));
}

/** Título da pendência. Começa sempre por PREFIXO_BOLETO (a função consulta as abertas por esse prefixo). */
export function tituloPendenciaBoleto(g: GrupoBoleto): string {
  const qtd = g.titulos.length;
  const quem = g.nomeCliente.trim() || `cliente ${g.codCliente}`;
  const primeiro = g.titulos[0];
  const origem = g.nota ? `NF ${g.nota.nota}` : primeiro.documento + (primeiro.parcela !== "1" ? `/${primeiro.parcela}` : "");
  return `${PREFIXO_BOLETO}${qtd > 1 ? "(s)" : ""}: ${origem} — ${quem}${qtd > 1 ? ` (${qtd} parcelas)` : ""}`;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const moedaBr = (centavos: number) => {
  const [inteiro, frac] = (centavos / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Descrição da pendência: o que anexar (documento, vencimento, valor) e os pedidos da NF. */
export function descricaoPendenciaBoleto(g: GrupoBoleto): string {
  const ordenados = [...g.titulos].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.documento.localeCompare(b.documento));
  const linhas = ordenados.slice(0, 12).map((t) => `• ${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""} — vence ${dataBr(t.vencimento)} — ${moedaBr(t.valorCentavos)}`);
  if (ordenados.length > 12) linhas.push(`… e mais ${ordenados.length - 12}`);
  const pedidos = g.nota && g.nota.pedidos.length > 0 ? `\nPedido${g.nota.pedidos.length > 1 ? "s" : ""}: ${g.nota.pedidos.join(", ")}.` : "";
  return `Anexe o boleto e envie ao cliente até o prazo da pendência (o envio da régua é 7 dias antes do vencimento).\n${linhas.join("\n")}${pedidos}`;
}

// ---------------------------------------------------------------- evidência de pagamento (títulos pagos do Consistem)
// A lista de abertos (`tipoTitulo=0`) não traz o que foi pago; a de pagos (`tipoTitulo=1`, hoje ~700 títulos, lida inteira
// em ~1 s) traz `dataPagamento`, `tipoBaixa`, `valorTitulo`, `valorJuros` e `valorDesconto`. É só EVIDÊNCIA para a pessoa
// conferir: o Neo Admin nunca dá a baixa sozinho.

export type EvidenciaPagamento = {
  /** aaaa-mm-dd */
  pagoEm: string;
  /** valor do título + juros − desconto, como o Consistem informa (conferir antes de confirmar). */
  valorCentavos: number;
  /** Código do tipo de baixa; o significado é do Consistem (o Neo Admin não interpreta). */
  tipoBaixa: string;
};

/** Registro de título PAGO da API. Sem data de pagamento válida (vazia, "0", "0001-01-01") não é evidência. */
export function evidenciaDePago(r: Record<string, unknown>): EvidenciaPagamento | null {
  const pagoEm = paraDataIso(r.dataPagamento);
  if (!pagoEm) return null;
  const titulo = paraCentavos(r.valorTitulo) ?? 0;
  const juros = paraCentavos(r.valorJuros) ?? 0;
  const desconto = paraCentavos(r.valorDesconto) ?? 0;
  const total = titulo + juros - desconto;
  return { pagoEm, valorCentavos: total > 0 ? total : titulo, tipoBaixa: texto(r.tipoBaixa) };
}

/** `codTitulo` -> evidência. Se o mesmo título aparece mais de uma vez (baixas parciais), vale a pagamento mais recente. */
export function indexarPagos(registros: readonly Record<string, unknown>[]): Map<string, EvidenciaPagamento> {
  const mapa = new Map<string, EvidenciaPagamento>();
  for (const r of registros) {
    const doc = texto(r.codTitulo);
    const ev = evidenciaDePago(r);
    if (!doc || !ev) continue;
    const atual = mapa.get(doc);
    if (!atual || ev.pagoEm > atual.pagoEm) mapa.set(doc, ev);
  }
  return mapa;
}

const dataBrasil = (iso: string) => iso.split("-").reverse().join("/");
const moedaBrasil = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Texto da pendência "Possível baixa", com a evidência do Consistem quando houver. */
export function descricaoPossivelBaixa(ev: EvidenciaPagamento | null, valorTituloCentavos: number): string {
  if (!ev) {
    return "O título saiu da lista de contas a receber em aberto do Consistem e NÃO consta na lista de pagos. Pode ter sido cancelado ou renegociado: confira no Consistem e resolva em Baixas a conferir (dar baixa com data e valor, ou cancelar).";
  }
  const dif = ev.valorCentavos === valorTituloCentavos ? "" : ` (o título é de ${moedaBrasil(valorTituloCentavos)}; a diferença é juros ou desconto, confira)`;
  return `O Consistem informa pagamento em ${dataBrasil(ev.pagoEm)}, no valor de ${moedaBrasil(ev.valorCentavos)}${dif}${ev.tipoBaixa ? `, tipo de baixa ${ev.tipoBaixa}` : ""}. Confirme em Baixas a conferir: nada é baixado sozinho.`;
}

// ---------------------------------------------------------------- vínculo NF de saída <-> título (Etapa 0)
// O título (contasReceber) não traz o pedido, mas traz a nota (notaFiscal, chaveNfeNotaFiscal). A NF de saída
// (comercial/v10/notaFiscalSaida) traz codPedido. A análise abaixo mede, com dados reais, quanto dessa ligação
// funciona, devolvendo SÓ agregados (contagens e "padrões" de formato), nunca nomes, valores ou documentos.

export const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, "");

/** Chave de acesso da NF-e: 44 dígitos, senão vazio. */
export const chaveNfe = (v: unknown): string => {
  const d = soDigitos(v);
  return d.length === 44 ? d : "";
};

/** Número da nota sem zeros à esquerda e sem pontuação ("000123" -> "123"). */
export const numeroNota = (v: unknown): string => soDigitos(v).replace(/^0+/, "");

/** Formato de um texto sem expor o conteúdo: letras viram A, dígitos viram 9 ("1182025-4" -> "9999999-9"). */
export function padraoDe(v: unknown): string {
  const t = texto(v);
  if (t === "") return "(vazio)";
  return t.replace(/[A-Za-zÀ-ÿ]/g, "A").replace(/\d/g, "9").slice(0, 24);
}

function contarPadroes(valores: unknown[], limite = 8): { padrao: string; qtd: number }[] {
  const m = new Map<string, number>();
  for (const v of valores) {
    const p = padraoDe(v);
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  return [...m.entries()].map(([padrao, qtd]) => ({ padrao, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, limite);
}

export type RelatorioVinculo = {
  janela: { desde: string; ate: string };
  notas: {
    total: number; comPedido: number; comChave: number; pedidosDistintos: number; camposDisponiveis: string[];
    /** NFs que ligam a pelo menos um título em aberto (com ou sem pedido). */
    ligadasATitulos: number;
    ligadasComPedido: number;
    /** Por tipo de nota (código do tipo, sem dados de cliente): quantas NFs, quantas com pedido, quantas ligadas a título. */
    porTipo: { tipo: string; total: number; comPedido: number; ligadas: number }[];
  };
  titulos: { total: number; comNotaFiscal: number; comChave: number; naJanela: number };
  casamento: {
    /** Títulos da janela cuja chave NF-e casa com uma NF. */
    porChave: number;
    /** Títulos da janela sem casamento por chave mas com nº da nota + cliente iguais. */
    porNotaECliente: number;
    /** Títulos da janela casados por nota+cliente que têm mais de uma NF candidata (ambíguo). */
    ambiguos: number;
    semCasamento: number;
    taxaNaJanela: number;
    /** NFs com pedido que ligam a pelo menos um título em aberto. */
    notasComTitulo: number;
  };
  relacoes: {
    /** codTitulo contém o número da nota. */
    codTituloContemNota: number;
    /** numeroDuplicatas contém o número da nota. */
    duplicatasContemNota: number;
    /** O valor do título é ≤ valor total da NF (parcelas de uma NF somam o total). */
    valorMenorOuIgualNota: number;
  };
  padroes: {
    notaFiscal: { padrao: string; qtd: number }[];
    numeroDuplicatas: { padrao: string; qtd: number }[];
    codTitulo: { padrao: string; qtd: number }[];
  };
};

export const addDias = (iso: string, dias: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

export function analisarVinculo(
  notasBrutas: Record<string, unknown>[],
  titulosBrutos: Record<string, unknown>[],
  hoje: string,
  diasJanela: number,
): RelatorioVinculo {
  const desde = addDias(hoje, -diasJanela);
  const notas = notasBrutas.map((n) => ({
    nota: numeroNota(n.codNumNota),
    chave: chaveNfe(n.chaveAcesso),
    pedido: texto(n.codPedido),
    cliente: texto(n.codCliente),
    valor: paraCentavos(n.valorTotal),
  }));
  const porChave = new Map<string, number>();
  const porNotaCliente = new Map<string, number[]>();
  notas.forEach((n, i) => {
    if (n.chave) porChave.set(n.chave, i);
    if (n.nota) {
      const k = `${n.nota}\u0000${n.cliente}`;
      porNotaCliente.set(k, [...(porNotaCliente.get(k) ?? []), i]);
    }
  });

  const rel: RelatorioVinculo = {
    janela: { desde, ate: hoje },
    notas: {
      total: notas.length,
      comPedido: notas.filter((n) => n.pedido !== "").length,
      comChave: notas.filter((n) => n.chave !== "").length,
      pedidosDistintos: new Set(notas.map((n) => n.pedido).filter(Boolean)).size,
      camposDisponiveis: [...new Set(notasBrutas.slice(0, 50).flatMap((n) => Object.keys(n)))].sort(),
      ligadasATitulos: 0,
      ligadasComPedido: 0,
      porTipo: [],
    },
    titulos: { total: titulosBrutos.length, comNotaFiscal: 0, comChave: 0, naJanela: 0 },
    casamento: { porChave: 0, porNotaECliente: 0, ambiguos: 0, semCasamento: 0, taxaNaJanela: 0, notasComTitulo: 0 },
    relacoes: { codTituloContemNota: 0, duplicatasContemNota: 0, valorMenorOuIgualNota: 0 },
    padroes: {
      notaFiscal: contarPadroes(titulosBrutos.map((t) => t.notaFiscal)),
      numeroDuplicatas: contarPadroes(titulosBrutos.map((t) => t.numeroDuplicatas)),
      codTitulo: contarPadroes(titulosBrutos.map((t) => t.codTitulo)),
    },
  };

  const notasLigadas = new Set<number>();
  for (const t of titulosBrutos) {
    const nota = numeroNota(t.notaFiscal);
    const chave = chaveNfe(t.chaveNfeNotaFiscal);
    if (nota) rel.titulos.comNotaFiscal++;
    if (chave) rel.titulos.comChave++;
    const emissao = paraDataIso(t.dataEmissao);
    const naJanela = emissao !== null && emissao >= desde;
    if (naJanela) rel.titulos.naJanela++;

    let achada: number | undefined = chave ? porChave.get(chave) : undefined;
    let tipo: "chave" | "nota" | null = achada !== undefined ? "chave" : null;
    let ambiguo = false;
    if (achada === undefined && nota) {
      const candidatas = porNotaCliente.get(`${nota}\u0000${texto(t.codCliente)}`) ?? [];
      if (candidatas.length >= 1) {
        achada = candidatas[0];
        tipo = "nota";
        ambiguo = candidatas.length > 1;
      }
    }
    if (achada !== undefined) {
      notasLigadas.add(achada);
      const n = notas[achada];
      const cents = paraCentavos(t.valorTitulo);
      if (cents !== null && n.valor !== null && cents <= n.valor) rel.relacoes.valorMenorOuIgualNota++;
      if (nota && soDigitos(t.codTitulo).includes(nota)) rel.relacoes.codTituloContemNota++;
      if (nota && soDigitos(t.numeroDuplicatas).includes(nota)) rel.relacoes.duplicatasContemNota++;
    }
    if (naJanela) {
      if (tipo === "chave") rel.casamento.porChave++;
      else if (tipo === "nota") {
        rel.casamento.porNotaECliente++;
        if (ambiguo) rel.casamento.ambiguos++;
      } else rel.casamento.semCasamento++;
    }
  }
  rel.casamento.notasComTitulo = [...notasLigadas].filter((i) => notas[i].pedido !== "").length;
  rel.notas.ligadasATitulos = notasLigadas.size;
  rel.notas.ligadasComPedido = rel.casamento.notasComTitulo;
  const tipos = new Map<string, { total: number; comPedido: number; ligadas: number }>();
  notasBrutas.forEach((n, i) => {
    const tipo = texto(n.codTipoDeNota) || "(sem tipo)";
    const t = tipos.get(tipo) ?? { total: 0, comPedido: 0, ligadas: 0 };
    t.total++;
    if (notas[i].pedido !== "") t.comPedido++;
    if (notasLigadas.has(i)) t.ligadas++;
    tipos.set(tipo, t);
  });
  rel.notas.porTipo = [...tipos.entries()].map(([tipo, v]) => ({ tipo, ...v })).sort((a, b) => b.total - a.total);
  rel.casamento.taxaNaJanela = rel.titulos.naJanela > 0
    ? Math.round(((rel.casamento.porChave + rel.casamento.porNotaECliente) / rel.titulos.naJanela) * 1000) / 10
    : 0;
  return rel;
}

/** GET de um único objeto (ex.: pedidoVenda/{cod}); mesma autenticação e retry de 429 da leitura paginada. */
export async function buscarObjeto(
  buscar: Buscar,
  cfg: ConfigConsistem,
  rota: string,
  opcoes: { esperar?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, unknown>> {
  const token = limparToken(cfg.token);
  if (!token) throw new ConsistemErro("O segredo CONSISTEM_API_KEY não parece um token válido (esperado: token JWT do CSMEN050, sem espaços nem quebras de linha).");
  const aguardar = opcoes.esperar ?? esperar;
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${rota.replace(/^\/+/, "")}`;
  const headers = { Authorization: token, empresa: cfg.empresa, Accept: "application/json" };
  const chamar = async () => {
    try {
      return await buscar(url, { headers });
    } catch {
      throw new ConsistemErro("Falha de rede ao chamar a API do Consistem.");
    }
  };
  let resp = await chamar();
  for (let tentativa = 1; resp.status === 429 && tentativa < MAX_TENTATIVAS_429; tentativa++) {
    await aguardar(2 ** (tentativa - 1) * 1000);
    resp = await chamar();
  }
  const corpo = await resp.text();
  if (resp.status === 401 || resp.status === 403) throw new ConsistemErro(`Acesso negado (HTTP ${resp.status}).`, resp.status);
  if (!resp.ok) throw new ConsistemErro(`Consistem HTTP ${resp.status}: ${corpo.slice(0, 200)}`, resp.status);
  const json: unknown = corpo ? JSON.parse(corpo) : {};
  return (Array.isArray(json) ? (json[0] ?? {}) : (json as Record<string, unknown>)) ?? {};
}
