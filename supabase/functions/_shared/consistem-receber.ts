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
