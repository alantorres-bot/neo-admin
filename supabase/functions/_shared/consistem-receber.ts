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
};

export const ESTAGIOS_ENCERRADOS = ["pago", "renegociado", "cancelado"] as const;
const encerrado = (estagio: string) => (ESTAGIOS_ENCERRADOS as readonly string[]).includes(estagio);
export const chaveTitulo = (documento: string, parcela: string) => `${documento}\u0000${parcela}`;

export type Alteracao = { id: string; campos: { vencimento?: string; valor?: number; emissao?: string | null } };

export type Plano = {
  /** Existem na API e não no banco. */
  novos: TituloApi[];
  /** Existem nos dois, com data/valor diferentes (a API é a fonte da verdade desses campos). */
  alterados: Alteracao[];
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
    novos: [], alterados: [], inalterados: 0, possiveisBaixas: [], presentes: [], divergentes: [], duplicadosApi: [],
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
  }

  for (const t of titulosBanco) {
    if (encerrado(t.estagio) || t.origem !== "importacao") continue; // manual/acordo não vêm do Consistem
    if (!vistos.has(chaveTitulo(t.documento, t.parcela))) plano.possiveisBaixas.push(t);
  }
  return plano;
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
