// GED — Central de Documentos: regras puras usadas pela indexação (Edge Function) e pelo app
// (docs/modulos/administrativo-ged.md). Sem imports: o tsc do app não aceita import com ".ts" e o Deno exige a extensão.
// Nada aqui grava no banco nem escreve no Drive: o cliente HTTP só faz GET (5.1).

// ───────────────────────── Texto e documentos (cópias locais de lib/nucleo) ─────────────────────────

/** Minúsculas, sem acento e com espaços simples (mesma regra de `normalizar`, lib/nucleo/tabela.ts). */
export const normalizarTexto = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const somenteDigitos = (valor: string): string => valor.replace(/\D/g, "");

// Cópia de `validarCnpj` (lib/nucleo/documentos.ts).
function validarCnpj(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const resto = base.split("").reduce((acc, x, i) => acc + Number(x) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d === d.slice(0, 12) + d1 + d2;
}

// ───────────────────────── Pasta → cliente (5.4.2, 5.4.3) ─────────────────────────
// Só sugestão: nada é confirmado automaticamente, nem com nota 100.

/** Termos societários e de ramo retirados do nome (5.4.2; a lista é configurável). */
export const TERMOS_IGNORADOS_PADRAO = ["ltda", "sa", "me", "eireli", "construtora", "construcoes", "engenharia"];
// Conectivos retirados para que "X Engenharia e Construções" e "X" cheguem ao mesmo núcleo (detalhe técnico, 11.1).
const CONECTIVOS = ["e", "de", "da", "do", "das", "dos"];

/** Núcleo do nome: sem acento, minúsculo, sem sufixo de ano ("- 2026"), sem pontuação, sem termos societários. */
export function normalizarNomeCliente(nome: string, termos: readonly string[] = TERMOS_IGNORADOS_PADRAO): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*-\s*(19|20)\d{2}\s*$/, "")
    .replace(/\bs\s*\/\s*a\b|\bs\.a\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p !== "" && !termos.includes(p) && !CONECTIVOS.includes(p))
    .join(" ");
}

/** CNPJs válidos citados num texto (com ou sem máscara). */
export function cnpjsNoTexto(texto: string): string[] {
  const achados = texto.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? [];
  return [...new Set(achados.map(somenteDigitos).filter(validarCnpj))];
}

export type ClienteCadastro = { id: string; nome: string; documento: string | null };
export type Candidato = { clienteId: string; nota: number; motivo: string };
export type SugestaoCliente = { situacao: "sugerida" | "sem_sugestao"; candidatos: Candidato[] };

// shortcut: semelhança por palavras em comum (Jaccard) com corte fixo; trocar por um índice de similaridade do banco
// (pg_trgm, ponto 9) se a qualidade das sugestões não bastar.
const NOTA_MINIMA = 40;

function semelhanca(a: string, b: string): number {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  const comuns = [...x].filter((p) => y.has(p)).length;
  return comuns / (x.size + y.size - comuns);
}

/**
 * Sugere até 3 clientes para uma pasta (`contrapartes` do tipo cliente, ativas). CNPJ válido no nome da pasta ou de um arquivo
 * dela vale nota 100; nome igual depois da normalização, 90; semelhança de palavras, até 80.
 */
export function sugerirCliente(nomePasta: string, nomesArquivos: readonly string[], clientes: readonly ClienteCadastro[]): SugestaoCliente {
  const cnpjPasta = cnpjsNoTexto(nomePasta);
  const cnpjArquivos = nomesArquivos.flatMap(cnpjsNoTexto);
  const nucleo = normalizarNomeCliente(nomePasta);

  const candidatos = clientes
    .map((c): Candidato | null => {
      const doc = c.documento ? somenteDigitos(c.documento) : "";
      if (doc && cnpjPasta.includes(doc)) return { clienteId: c.id, nota: 100, motivo: "mesmo CNPJ no nome da pasta" };
      if (doc && cnpjArquivos.includes(doc)) return { clienteId: c.id, nota: 100, motivo: "mesmo CNPJ no nome do arquivo" };
      const outro = normalizarNomeCliente(c.nome);
      if (nucleo !== "" && outro === nucleo) return { clienteId: c.id, nota: 90, motivo: "nome igual após normalização" };
      const nota = Math.round(semelhanca(nucleo, outro) * 80);
      return nota >= NOTA_MINIMA ? { clienteId: c.id, nota, motivo: "nome parecido" } : null;
    })
    .filter((c): c is Candidato => c !== null)
    .sort((a, b) => b.nota - a.nota)
    .slice(0, 3);

  return { situacao: candidatos.length > 0 ? "sugerida" : "sem_sugestao", candidatos };
}

// ───────────────────────── Tipo documental (5.5) ─────────────────────────
// As regras vêm do catálogo `ged_regras_tipo`; nenhuma regra de nome é fixada no código [PENDENTE 6].

export type Finalidade = "elaboracao" | "dossie_cliente" | "tematica";
export type FuncaoPasta = "modelos" | "trabalho";
export type TipoSituacao = "sugerido" | "confirmado" | "sem_tipo";

export type RegraTipo = {
  tipo: string;
  expressao: string;
  /** Menor número = avaliada primeiro. */
  prioridade: number;
  finalidade?: Finalidade;
  funcaoPasta?: FuncaoPasta;
};
export type RegraPreparada = RegraTipo & { re: RegExp };

export type DocumentoClassificavel = {
  nome: string;
  finalidade: Finalidade;
  funcaoPasta?: FuncaoPasta | null;
  tipo: string | null;
  tipoSituacao: TipoSituacao;
};
export type Classificacao = { tipo: string | null; tipoSituacao: TipoSituacao; modeloSituacao?: "nao_avaliado" };

/**
 * "Documentação cadastral" que a raiz `elaboracao` não sugere. PROVISÓRIO: a especificação não lista os códigos.
 * shortcut: leitura do assistente (cartão CNPJ, contrato social, procuração); substituir pelo catálogo final [PENDENTE 6 (GED)].
 */
export const TIPOS_CADASTRAIS_PROVISORIOS: readonly string[] = ["cartao_cnpj", "contrato_social", "procuracao"];

/** Tipos que a raiz não deixa sugerir (5.5, cautela 4); continuam classificáveis à mão. */
export const TIPOS_NAO_SUGERIDOS: Record<Finalidade, readonly string[]> = {
  elaboracao: ["contrato_assinado", "nf_venda", "nf_remessa", "boleto", ...TIPOS_CADASTRAIS_PROVISORIOS],
  dossie_cliente: ["modelo_contrato"],
  tematica: [],
};

export class ErroRegraTipo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroRegraTipo";
  }
}

/** Compila as regras uma vez, na ordem de prioridade. Expressão inválida é erro de configuração. */
export function prepararRegras(regras: readonly RegraTipo[]): RegraPreparada[] {
  return [...regras]
    .sort((a, b) => a.prioridade - b.prioridade)
    .map((r) => {
      try {
        return { ...r, re: new RegExp(r.expressao) };
      } catch {
        throw new ErroRegraTipo(`Expressão inválida na regra do tipo "${r.tipo}".`);
      }
    });
}

/**
 * Sugere o tipo. Confirmado: devolve como está. Arquivo em pasta de modelos da elaboração: `modelo_contrato` não avaliado
 * (cautela 1). Senão, a primeira regra que casa com o nome normalizado, respeitando finalidade, função da pasta e os
 * limites da raiz; nenhuma casando: `sem_tipo`.
 */
export function classificarTipo(doc: DocumentoClassificavel, regras: readonly RegraPreparada[]): Classificacao {
  if (doc.tipoSituacao === "confirmado") return { tipo: doc.tipo, tipoSituacao: "confirmado" };
  if (doc.finalidade === "elaboracao" && doc.funcaoPasta === "modelos") {
    return { tipo: "modelo_contrato", tipoSituacao: "sugerido", modeloSituacao: "nao_avaliado" };
  }
  const nome = normalizarTexto(doc.nome);
  const bloqueados = TIPOS_NAO_SUGERIDOS[doc.finalidade];
  const regra = regras.find(
    (r) =>
      !bloqueados.includes(r.tipo) &&
      (r.finalidade === undefined || r.finalidade === doc.finalidade) &&
      (r.funcaoPasta === undefined || r.funcaoPasta === doc.funcaoPasta) &&
      r.re.test(nome),
  );
  return regra ? { tipo: regra.tipo, tipoSituacao: "sugerido" } : { tipo: null, tipoSituacao: "sem_tipo" };
}

// ───────────────────────── Temporários e versões (5.2.7, 5.6.3, 5.6.4) ─────────────────────────

/** Padrões padrão de `administrativo.ged.ignorar_padroes`: começa com `~$` ou `~WRL`, ou termina em `.tmp`. */
export const IGNORAR_PADROES_PADRAO = ["^~\\$", "^~wrl", "\\.tmp$"];

/** Arquivo temporário ou de sistema: fica `ignorado` e não aparece na busca. */
export function ehArquivoTemporario(nome: string, padroes: readonly string[] = IGNORAR_PADROES_PADRAO): boolean {
  return padroes.some((p) => new RegExp(p, "i").test(nome.trim()));
}

const MARCA_VERSAO = /\s*(?:\bv\s*(\d+)|\brev\.?\s*(\d+)|\((\d+)\))\s*$/i;

/** Nome sem extensão e sem a marca de versão final (`V2`, `Rev03`, `(1)`), com a versão encontrada (0 = sem marca). */
export function separarVersao(nome: string): { base: string; extensao: string; versao: number } {
  const ponto = nome.lastIndexOf(".");
  const extensao = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : "";
  let base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const m = MARCA_VERSAO.exec(base);
  const versao = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
  if (m) base = base.slice(0, m.index);
  return { base: base.trim().toLowerCase(), extensao, versao };
}

export type ArquivoVersionavel = { id: string; nome: string; raizId: string; pastaId: string };
export type SugestaoSubstituicao = { substitutoId: string; substituidoId: string };

/**
 * Sugere substituições (nunca aplica) entre arquivos da mesma pasta — e, por consequência, da mesma raiz — com o mesmo
 * nome-base e a mesma extensão, que diferem só pela marca de versão. Raízes diferentes nunca são comparadas (5.6.4).
 */
export function sugerirSubstituicoes(arquivos: readonly ArquivoVersionavel[]): SugestaoSubstituicao[] {
  const grupos = new Map<string, { id: string; versao: number }[]>();
  for (const a of arquivos) {
    const { base, extensao, versao } = separarVersao(a.nome);
    const chave = JSON.stringify([a.raizId, a.pastaId, base, extensao]);
    grupos.set(chave, [...(grupos.get(chave) ?? []), { id: a.id, versao }]);
  }
  const sugestoes: SugestaoSubstituicao[] = [];
  for (const grupo of grupos.values()) {
    const ordenado = [...grupo].sort((a, b) => a.versao - b.versao);
    for (let i = 1; i < ordenado.length; i++) {
      // Mesma versão (ex.: duas cópias sem marca) não é sugestão: não dá para saber qual substitui qual.
      if (ordenado[i].versao !== ordenado[i - 1].versao) {
        sugestoes.push({ substitutoId: ordenado[i].id, substituidoId: ordenado[i - 1].id });
      }
    }
  }
  return sugestoes;
}

// ───────────────────────── Pastas-raiz (5.2.4, 5.3.0) ─────────────────────────

export type SituacaoRaiz = "em_verificacao" | "ativa" | "inativa";
/** Raiz como o cadastro a enxerga: o ID do Drive e os IDs de todas as pastas acima dela. */
export type RaizCaminho = { driveId: string; ancestrais: readonly string[] };

/** A nova raiz é a mesma, está dentro ou está acima de alguma raiz já cadastrada? Devolve o driveId em conflito ou null. */
export function raizSobreposta(nova: RaizCaminho, cadastradas: readonly RaizCaminho[]): string | null {
  const conflito = cadastradas.find(
    (r) => r.driveId === nova.driveId || nova.ancestrais.includes(r.driveId) || r.ancestrais.includes(nova.driveId),
  );
  return conflito?.driveId ?? null;
}

export const podeIndexar = (situacao: SituacaoRaiz): boolean => situacao === "ativa";

// ───────────────────────── Cliente HTTP da Drive API, só leitura (4.1, 5.1, 10) ─────────────────────────
// Método diferente de GET, ou endereço fora de www.googleapis.com/drive/v3, falha ANTES do fetch.
// O token só entra no cabeçalho e nunca aparece em mensagem de erro.

export const DRIVE_BASE = "https://www.googleapis.com/drive/v3/";
/** Campos de arquivo pedidos em `files.list` e `changes.list` (4.1). */
export const CAMPOS_ARQUIVO = "id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,webViewLink,headRevisionId,trashed,shortcutDetails";
// Mesmo desenho do retry de 429 do Consistem (_shared/consistem-receber.ts): 1 s, 2 s, 4 s.
const MAX_TENTATIVAS = 4;

export class ErroDrive extends Error {
  constructor(mensagem: string, readonly status: number | null = null) {
    super(mensagem);
    this.name = "ErroDrive";
  }
}

type Fetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<Response>;
type OpcoesCliente = { fazerFetch?: Fetch; esperar?: (ms: number) => Promise<void> };

const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const transitorio = (status: number) => status === 429 || status >= 500;

export function criarClienteDrive(obterToken: () => Promise<string>, opcoes: OpcoesCliente = {}) {
  const fazerFetch = opcoes.fazerFetch ?? fetch;
  const esperar = opcoes.esperar ?? esperarPadrao;

  async function requisitar(metodo: string, caminho: string, params: Record<string, string> = {}): Promise<unknown> {
    if (metodo.toUpperCase() !== "GET") throw new ErroDrive(`O GED só lê o Drive: o método ${metodo} foi recusado.`);
    const url = new URL(caminho, DRIVE_BASE);
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/drive/v3/")) {
      throw new ErroDrive("O GED só acessa a Drive API v3.");
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const token = await obterToken();
    const init = { method: "GET" as const, headers: { Authorization: `Bearer ${token}` } };
    let resposta = await fazerFetch(url.toString(), init);
    for (let tentativa = 1; transitorio(resposta.status) && tentativa < MAX_TENTATIVAS; tentativa++) {
      await esperar(2 ** (tentativa - 1) * 1000);
      resposta = await fazerFetch(url.toString(), init);
    }
    if (!resposta.ok) {
      let motivo = "";
      try {
        const corpo = (await resposta.json()) as { error?: { status?: string; message?: string } };
        motivo = corpo.error?.status ?? corpo.error?.message ?? "";
      } catch {
        // corpo sem JSON: fica só o status HTTP
      }
      const mensagem = `Drive respondeu ${resposta.status}${motivo ? ` (${motivo})` : ""}.`;
      throw new ErroDrive(token ? mensagem.split(token).join("***") : mensagem, resposta.status);
    }
    return resposta.json();
  }

  return { requisitar, get: (caminho: string, params?: Record<string, string>) => requisitar("GET", caminho, params) };
}

export type ClienteDrive = ReturnType<typeof criarClienteDrive>;

// ───────────────────────── Indexação: mudanças do Drive (5.3.2, 8.1) ─────────────────────────

export const MIME_PASTA = "application/vnd.google-apps.folder";

export type ArquivoDrive = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  headRevisionId?: string;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  webViewLink?: string;
  shortcutDetails?: { targetId?: string };
};
export type MudancaDrive = { fileId: string; removed?: boolean; file?: ArquivoDrive };

export type SituacaoDocumento = "vigente" | "substituido" | "removido_no_drive" | "fora_do_escopo" | "ignorado";
export type SituacaoPasta = "ativa" | "removida_no_drive" | "fora_do_escopo";

export type DocumentoIndice = {
  driveId: string;
  pastaDriveId: string;
  nome: string;
  mime: string;
  driveRevisao: string | null;
  alteradoNoDriveEm: string | null;
  tamanhoBytes: number | null;
  md5: string | null;
  webLink: string | null;
  atalhoPara: string | null;
  situacao: SituacaoDocumento;
};
export type PastaIndice = { driveId: string; maeDriveId: string | null; nome: string; profundidade: number; situacao: SituacaoPasta };

export type EstadoIndice = {
  pastas: ReadonlyMap<string, PastaIndice>;
  documentos: ReadonlyMap<string, DocumentoIndice>;
  profundidadeMax: number;
  padroesIgnorar?: readonly string[];
};

export type ResultadoMudanca =
  | { acao: "nenhuma" }
  | { acao: "gravar_pasta"; pasta: PastaIndice }
  | { acao: "gravar_documento"; documento: DocumentoIndice; novo: boolean; novaRevisao: boolean };

const iguais = <T extends object>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/** Primeira pasta-mãe indexada e ativa, se houver. */
function maeIndexada(arquivo: ArquivoDrive, pastas: EstadoIndice["pastas"]): PastaIndice | null {
  for (const id of arquivo.parents ?? []) {
    const p = pastas.get(id);
    if (p && p.situacao === "ativa") return p;
  }
  return null;
}

function moverPasta(atual: PastaIndice | undefined, situacao: SituacaoPasta): ResultadoMudanca {
  if (!atual || atual.situacao === situacao) return { acao: "nenhuma" };
  return { acao: "gravar_pasta", pasta: { ...atual, situacao } };
}

// O sistema só move entre vigente, removido, fora do escopo e ignorado (8.1). `substituido` é decisão de uma pessoa:
// a indexação não mexe na situação dele (o que fazer com um substituído removido do Drive não está especificado).
function moverDocumento(atual: DocumentoIndice | undefined, situacao: SituacaoDocumento): ResultadoMudanca {
  if (!atual || atual.situacao === situacao || atual.situacao === "substituido") return { acao: "nenhuma" };
  return { acao: "gravar_documento", documento: { ...atual, situacao }, novo: false, novaRevisao: false };
}

/**
 * Decide o efeito de uma mudança do `changes.list` sobre o índice, sem gravar nada e sem nunca apagar (5.3.2):
 * - removido ou na lixeira: `removido_no_drive` (pasta: `removida_no_drive`);
 * - pasta-mãe fora do índice: `fora_do_escopo`;
 * - senão, insere ou atualiza; documento removido ou fora volta a `vigente` se reaparecer (8.1);
 * - pasta além de `profundidadeMax` não entra no índice.
 * Aplicar a mesma mudança duas vezes dá `nenhuma` na segunda. Quando uma pasta sai do escopo, o Drive não manda mudança
 * para os arquivos dentro dela: quem os acerta é a reconciliação completa (5.3.4).
 */
export function aplicarMudanca(m: MudancaDrive, indice: EstadoIndice): ResultadoMudanca {
  const pasta = indice.pastas.get(m.fileId);
  // A raiz (profundidade 0) é governada pelo cadastro (`ged_pastas_raiz`, 5.2.3), não pela indexação.
  if (pasta?.profundidade === 0) return { acao: "nenhuma" };
  const doc = indice.documentos.get(m.fileId);
  const removido = m.removed === true || m.file?.trashed === true || !m.file;

  if (removido) return pasta ? moverPasta(pasta, "removida_no_drive") : moverDocumento(doc, "removido_no_drive");

  const f = m.file as ArquivoDrive;
  const mae = maeIndexada(f, indice.pastas);

  if (f.mimeType === MIME_PASTA) {
    if (!mae || mae.profundidade + 1 > indice.profundidadeMax) return moverPasta(pasta, "fora_do_escopo");
    const nova: PastaIndice = { driveId: f.id, maeDriveId: mae.driveId, nome: f.name, profundidade: mae.profundidade + 1, situacao: "ativa" };
    return pasta && iguais(pasta, nova) ? { acao: "nenhuma" } : { acao: "gravar_pasta", pasta: nova };
  }

  if (!mae) return moverDocumento(doc, "fora_do_escopo");
  const situacao: SituacaoDocumento =
    doc?.situacao === "substituido" ? "substituido" : ehArquivoTemporario(f.name, indice.padroesIgnorar) ? "ignorado" : "vigente";
  const novo: DocumentoIndice = {
    driveId: f.id,
    pastaDriveId: mae.driveId,
    nome: f.name,
    mime: f.mimeType,
    driveRevisao: f.headRevisionId ?? null,
    alteradoNoDriveEm: f.modifiedTime ?? null,
    tamanhoBytes: f.size !== undefined ? Number(f.size) : null,
    md5: f.md5Checksum ?? null,
    webLink: f.webViewLink ?? null,
    atalhoPara: f.shortcutDetails?.targetId ?? null,
    situacao,
  };
  if (doc && iguais(doc, novo)) return { acao: "nenhuma" };
  return {
    acao: "gravar_documento",
    documento: novo,
    novo: !doc,
    novaRevisao: novo.driveRevisao !== null && novo.driveRevisao !== (doc?.driveRevisao ?? null),
  };
}

// ───────────────────────── Indexação: rodada paginada (5.3.1–5.3.3, 5.3.6) ─────────────────────────

type PaginaMudancas = { changes?: MudancaDrive[]; nextPageToken?: string; newStartPageToken?: string };

/**
 * Percorre o `changes.list` a partir do token salvo e entrega cada página a `aplicarPagina`, que grava.
 * Devolve o token a gravar SÓ quando todas as páginas lidas foram aplicadas; se algo falhar no meio, lança e o token
 * não avança (a próxima rodada reprocessa, de forma idempotente).
 * - `completa`: chegou ao `newStartPageToken`;
 * - limite de itens atingido: devolve o `nextPageToken` da página seguinte, e o resto fica para a próxima rodada.
 */
export async function percorrerMudancas(
  cliente: ClienteDrive,
  pageToken: string,
  aplicarPagina: (mudancas: MudancaDrive[]) => Promise<void>,
  opcoes: { maxItens: number; driveId?: string },
): Promise<{ proximoToken: string; completa: boolean; itens: number }> {
  let token = pageToken;
  let itens = 0;
  for (;;) {
    const params: Record<string, string> = {
      pageToken: token,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${CAMPOS_ARQUIVO}))`,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      pageSize: "1000",
    };
    if (opcoes.driveId) Object.assign(params, { driveId: opcoes.driveId });
    const pagina = (await cliente.get("changes", params)) as PaginaMudancas;
    const mudancas = pagina.changes ?? [];
    await aplicarPagina(mudancas);
    itens += mudancas.length;

    if (pagina.newStartPageToken) return { proximoToken: pagina.newStartPageToken, completa: true, itens };
    if (!pagina.nextPageToken) throw new ErroDrive("Resposta do Drive sem token de continuação.");
    token = pagina.nextPageToken;
    if (itens >= opcoes.maxItens) return { proximoToken: token, completa: false, itens };
  }
}

/** Lista todo o conteúdo de uma pasta (`files.list`), página por página (carga inicial e reconciliação, 5.3.1). */
export async function listarPasta(cliente: ClienteDrive, pastaId: string, driveId?: string): Promise<ArquivoDrive[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(pastaId)) throw new ErroDrive("ID de pasta inválido.");
  const arquivos: ArquivoDrive[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = {
      q: `'${pastaId}' in parents and trashed=false`,
      fields: `nextPageToken,files(${CAMPOS_ARQUIVO})`,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };
    if (driveId) Object.assign(params, { corpora: "drive", driveId });
    if (pageToken) params.pageToken = pageToken;
    const pagina = (await cliente.get("files", params)) as { files?: ArquivoDrive[]; nextPageToken?: string };
    arquivos.push(...(pagina.files ?? []));
    pageToken = pagina.nextPageToken;
  } while (pageToken);
  return arquivos;
}
