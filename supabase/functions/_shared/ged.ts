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

// ───────────────────────── Pistas do arquivo de trabalho (5.4.8) ─────────────────────────

/**
 * Pistas para SUGERIR o vínculo de um arquivo da raiz `elaboracao` (5.4.8): o número de contrato no início do nome (`^\d+ - `)
 * e o nome curto do cliente no último trecho "… - <cliente>", sem extensão e sem marca de versão. Só sugestão: quem compara com
 * os contratos é `ctr_alvos_por_numero` (com a autorização de quem pergunta), e a confirmação é sempre humana.
 */
export function pistasArquivoTrabalho(nome: string): { numeroContrato: string | null; clienteCurto: string | null } {
  const numero = /^\s*(\d+)\s+-\s+/.exec(nome)?.[1] ?? null;
  const ponto = nome.lastIndexOf(".");
  const semExtensao = ponto > 0 ? nome.slice(0, ponto) : nome;
  const trechos = semExtensao.replace(MARCA_VERSAO, "").split(/\s+-\s+/);
  const ultimo = trechos.length >= 2 ? trechos[trechos.length - 1].trim() : "";
  return { numeroContrato: numero, clienteCurto: ultimo !== "" && !/^\d+$/.test(ultimo) ? ultimo : null };
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
  createdTime?: string;
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
  /** Para a busca por `ilike` (seção 8): minúsculo, sem acento. */
  nomeNormalizado: string;
  extensao: string;
  mime: string;
  driveRevisao: string | null;
  criadoNoDriveEm: string | null;
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
  // Sem `file` e sem `removed`: a conta técnica deixou de enxergar o item. Sem leitura não há o que indexar, então conta como
  // removido (nunca como inserção). Mudanças do próprio Drive compartilhado vêm sem `fileId` e não acham nada no índice.
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
    nomeNormalizado: normalizarTexto(f.name),
    extensao: separarVersao(f.name).extensao,
    mime: f.mimeType,
    driveRevisao: f.headRevisionId ?? null,
    criadoNoDriveEm: f.createdTime ?? null,
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

// ───────────────────────── Linhas para o banco (seção 8, modelo PROPOSTO) ─────────────────────────
// Só as colunas que a indexação grava. Tipo, cliente, versão e modelo são decisões de pessoas (funções de decisão, 5.10) e não
// entram aqui. Os `uuid` internos (raiz e pasta) vêm de quem grava. O modelo de dados ainda é [PROPOSTA]; se mudar, muda aqui.

export function linhaDocumento(d: DocumentoIndice, ids: { raizId: string; pastaId: string }) {
  return {
    origem: "drive",
    drive_id: d.driveId,
    raiz_id: ids.raizId,
    pasta_id: ids.pastaId,
    nome: d.nome,
    nome_normalizado: d.nomeNormalizado,
    mime: d.mime,
    extensao: d.extensao,
    tamanho_bytes: d.tamanhoBytes,
    md5: d.md5,
    drive_revisao: d.driveRevisao,
    criado_no_drive_em: d.criadoNoDriveEm,
    alterado_no_drive_em: d.alteradoNoDriveEm,
    web_link: d.webLink,
    atalho_para: d.atalhoPara,
    situacao: d.situacao,
  };
}

export function linhaPasta(p: PastaIndice, ids: { raizId: string }) {
  return { raiz_id: ids.raizId, drive_id: p.driveId, nome: p.nome, mae_drive_id: p.maeDriveId, profundidade: p.profundidade, situacao: p.situacao };
}

/** Linha de `ged_documento_revisoes` (só inserção), quando `aplicarMudanca` sinaliza `novaRevisao`. */
export function linhaRevisao(d: DocumentoIndice, documentoId: string) {
  if (d.driveRevisao === null) throw new Error("Documento sem revisão do Drive.");
  return { documento_id: documentoId, drive_revisao: d.driveRevisao, alterado_no_drive_em: d.alteradoNoDriveEm, tamanho_bytes: d.tamanhoBytes, md5: d.md5 };
}

/** Contagens da rodada para `ged_indexacoes.resumo` (seção 8): novos, alterados, removidos e ignorados. */
export function resumirRodada(resultados: readonly ResultadoMudanca[]) {
  const resumo = { novos: 0, alterados: 0, removidos: 0, ignorados: 0, pastas: 0 };
  for (const r of resultados) {
    if (r.acao === "gravar_pasta") resumo.pastas++;
    if (r.acao !== "gravar_documento") continue;
    const s = r.documento.situacao;
    if (s === "removido_no_drive" || s === "fora_do_escopo") resumo.removidos++;
    else if (s === "ignorado") resumo.ignorados++;
    else if (r.novo) resumo.novos++;
    else resumo.alterados++;
  }
  return resumo;
}

// ───────────────────────── Carga inicial, verificação e reconciliação (5.2.4.1, 5.3.1, 5.3.4) ─────────────────────────

export type ArvoreLida = {
  /** Pastas encontradas (sem a raiz), com a profundidade (filha direta da raiz = 1). */
  pastas: { arquivo: ArquivoDrive; profundidade: number }[];
  /** Arquivos (não pastas), com a profundidade da pasta-mãe. */
  arquivos: { arquivo: ArquivoDrive; profundidadeMae: number }[];
  /** Parou pelo limite de itens: a árvore está incompleta. */
  truncada: boolean;
};

/**
 * Percorre a raiz em largura, só com `files.list` (GET), até `profundidadeMax` (5.3.1). Pastas além do limite não são abertas.
 * Para em `maxItens` e marca `truncada`. Não grava nada: serve à carga inicial, à verificação e à reconciliação.
 */
export async function percorrerArvore(
  cliente: ClienteDrive,
  raizId: string,
  opcoes: { profundidadeMax: number; maxItens: number; driveId?: string },
): Promise<ArvoreLida> {
  const arvore: ArvoreLida = { pastas: [], arquivos: [], truncada: false };
  const fila: { id: string; profundidade: number }[] = [{ id: raizId, profundidade: 0 }];
  let itens = 0;
  while (fila.length > 0) {
    const atual = fila.shift() as { id: string; profundidade: number };
    for (const a of await listarPasta(cliente, atual.id, opcoes.driveId)) {
      if (itens >= opcoes.maxItens) return { ...arvore, truncada: true };
      itens++;
      if (a.mimeType === MIME_PASTA) {
        const profundidade = atual.profundidade + 1;
        if (profundidade > opcoes.profundidadeMax) continue;
        arvore.pastas.push({ arquivo: a, profundidade });
        fila.push({ id: a.id, profundidade });
      } else {
        arvore.arquivos.push({ arquivo: a, profundidadeMae: atual.profundidade });
      }
    }
  }
  return arvore;
}

/** A árvore lida como mudanças do Drive, pastas antes dos arquivos e em ordem de profundidade, prontas para `aplicarMudanca`. */
export function mudancasDaArvore(arvore: ArvoreLida): MudancaDrive[] {
  const pastas = [...arvore.pastas].sort((a, b) => a.profundidade - b.profundidade);
  return [...pastas.map((p) => p.arquivo), ...arvore.arquivos.map((a) => a.arquivo)].map((f) => ({ fileId: f.id, file: f }));
}

/**
 * Resumo da verificação da raiz (5.2.4.1): quantidades por nível, subpastas de 1º e 2º nível, extensões mais comuns e temporários.
 * Contém NOMES de pastas e arquivos: só pode ir ao admin geral, e a persistência segue a 5.2.4.4 [PENDENTE 13].
 */
export function resumirArvore(arvore: ArvoreLida, padroesIgnorar?: readonly string[]) {
  const niveis = new Map<number, { pastas: number; arquivos: number }>();
  const nivel = (n: number) => {
    let c = niveis.get(n);
    if (!c) niveis.set(n, (c = { pastas: 0, arquivos: 0 }));
    return c;
  };
  for (const p of arvore.pastas) nivel(p.profundidade).pastas++;
  for (const a of arvore.arquivos) nivel(a.profundidadeMae).arquivos++;

  const extensoes = new Map<string, number>();
  for (const { arquivo } of arvore.arquivos) {
    const ext = separarVersao(arquivo.name).extensao || "(sem extensão)";
    extensoes.set(ext, (extensoes.get(ext) ?? 0) + 1);
  }
  return {
    porNivel: [...niveis].sort((a, b) => a[0] - b[0]).map(([profundidade, c]) => ({ profundidade, ...c })),
    subpastasNivel1: arvore.pastas.filter((p) => p.profundidade === 1).map((p) => p.arquivo.name),
    subpastasNivel2: arvore.pastas.filter((p) => p.profundidade === 2).map((p) => p.arquivo.name),
    extensoes: [...extensoes].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([extensao, quantidade]) => ({ extensao, quantidade })),
    temporarios: arvore.arquivos.map((a) => a.arquivo.name).filter((n) => ehArquivoTemporario(n, padroesIgnorar)),
    truncada: arvore.truncada,
  };
}

/**
 * Reconciliação (5.3.4): itens indexados que não apareceram na listagem completa. Não há regra que diga, só pela ausência, se o
 * item foi apagado ou movido; por isso cada ausente é consultado no Drive (`files.get`, GET) e vira uma mudança comum, que
 * `aplicarMudanca` trata como qualquer outra (404 = removido). A raiz (profundidade 0) não entra.
 */
export function ausentesNaListagem(arvore: ArvoreLida, indice: EstadoIndice): string[] {
  // Árvore truncada não serve: o que não foi lido pareceria sumido.
  if (arvore.truncada) throw new ErroDrive("Listagem incompleta (limite de itens): a reconciliação não pode marcar ausentes.");
  const vistos = new Set([...arvore.pastas.map((p) => p.arquivo.id), ...arvore.arquivos.map((a) => a.arquivo.id)]);
  const pastas = [...indice.pastas.values()].filter((p) => p.profundidade > 0 && p.situacao === "ativa").map((p) => p.driveId);
  const docs = [...indice.documentos.values()]
    .filter((d) => d.situacao === "vigente" || d.situacao === "ignorado")
    .map((d) => d.driveId);
  return [...pastas, ...docs].filter((id) => !vistos.has(id));
}

/** Consulta um item ausente e o devolve como mudança: 404 vira `removed`; senão, o arquivo como está hoje. */
export async function consultarAusente(cliente: ClienteDrive, driveId: string): Promise<MudancaDrive> {
  if (!/^[A-Za-z0-9_-]+$/.test(driveId)) throw new ErroDrive("ID de arquivo inválido.");
  try {
    const file = (await cliente.get(`files/${driveId}`, { fields: CAMPOS_ARQUIVO, supportsAllDrives: "true" })) as ArquivoDrive;
    return { fileId: driveId, file };
  } catch (e) {
    if (e instanceof ErroDrive && e.status === 404) return { fileId: driveId, removed: true };
    throw e;
  }
}

// ───────────────────────── Carga inicial integrada (5.3.1) ─────────────────────────

/**
 * Carga inicial de uma raiz: pega o `startPageToken` ANTES de listar (para não perder mudanças feitas durante a leitura), percorre
 * a árvore e aplica tudo pelo mesmo caminho do incremental (`aplicarMudanca`), sobre uma cópia do índice atual. Não grava nada.
 * - Listagem completa: devolve o token, que só então pode ser gravado (5.3.1 e 5.3.3).
 * - Listagem truncada pelo limite: devolve o que foi lido (só inserções e atualizações; a listagem não traz itens na lixeira, então
 *   nada é marcado como removido) e token nulo. A próxima rodada refaz a carga, que é idempotente.
 * - Falha no meio (Drive ou gravação): a exceção sobe e nada é devolvido.
 * Sugestões de vínculo (5.4.8) NÃO são calculadas aqui: são feitas na hora, com a permissão do usuário (5.11.5).
 */
export async function cargaInicial(
  cliente: ClienteDrive,
  raiz: { driveId: string; driveIdCompartilhado?: string },
  indice: EstadoIndice,
  opcoes: { maxItens: number },
): Promise<{ resultados: ResultadoMudanca[]; resumo: ReturnType<typeof resumirRodada>; completa: boolean; startPageToken: string | null }> {
  if (indice.pastas.get(raiz.driveId)?.profundidade !== 0) throw new ErroDrive("A raiz precisa estar no índice com profundidade 0.");
  const paramsToken: Record<string, string> = { supportsAllDrives: "true" };
  if (raiz.driveIdCompartilhado) paramsToken.driveId = raiz.driveIdCompartilhado;
  const { startPageToken } = (await cliente.get("changes/startPageToken", paramsToken)) as { startPageToken?: string };
  if (!startPageToken) throw new ErroDrive("Resposta do Drive sem startPageToken.");

  const arvore = await percorrerArvore(cliente, raiz.driveId, {
    profundidadeMax: indice.profundidadeMax,
    maxItens: opcoes.maxItens,
    driveId: raiz.driveIdCompartilhado,
  });
  const copia = { ...indice, pastas: new Map(indice.pastas), documentos: new Map(indice.documentos) };
  const resultados = aplicarPaginaNoIndice(mudancasDaArvore(arvore), copia);
  return { resultados, resumo: resumirRodada(resultados), completa: !arvore.truncada, startPageToken: arvore.truncada ? null : startPageToken };
}

/**
 * Aplica uma página do `changes.list` sobre o índice em memória, na ordem recebida (uma mudança pode depender da anterior,
 * ex.: pasta criada e arquivo dentro dela). Devolve só o que muda, para a gravação; o `indice` passado é atualizado.
 * Usada no `aplicarPagina` de `percorrerMudancas`: se a gravação falhar, o token não avança e a página é reaplicada depois.
 */
export function aplicarPaginaNoIndice(
  mudancas: readonly MudancaDrive[],
  indice: { pastas: Map<string, PastaIndice>; documentos: Map<string, DocumentoIndice>; profundidadeMax: number; padroesIgnorar?: readonly string[] },
): ResultadoMudanca[] {
  const resultados: ResultadoMudanca[] = [];
  for (const m of mudancas) {
    const r = aplicarMudanca(m, indice);
    if (r.acao === "gravar_pasta") indice.pastas.set(r.pasta.driveId, r.pasta);
    if (r.acao === "gravar_documento") indice.documentos.set(r.documento.driveId, r.documento);
    if (r.acao !== "nenhuma") resultados.push(r);
  }
  return resultados;
}

// Gravação em três passos, porque os `uuid` só existem depois do insert: pastas → documentos (com o id da pasta) → revisões
// (com o id do documento). Sem o id correspondente, para em vez de gravar uma linha órfã. A mensagem não cita IDs (5.11.11).
const exigirId = (id: string | undefined, oQue: string): string => {
  if (!id) throw new Error(`Sem o id interno de ${oQue}: a gravação foi interrompida para não deixar linha órfã.`);
  return id;
};

export const pastasParaGravar = (resultados: readonly ResultadoMudanca[], raizId: string) =>
  resultados.flatMap((r) => (r.acao === "gravar_pasta" ? [linhaPasta(r.pasta, { raizId })] : []));

export const documentosParaGravar = (resultados: readonly ResultadoMudanca[], raizId: string, idDaPasta: (driveId: string) => string | undefined) =>
  resultados.flatMap((r) =>
    r.acao === "gravar_documento"
      ? [linhaDocumento(r.documento, { raizId, pastaId: exigirId(idDaPasta(r.documento.pastaDriveId), "uma pasta") })]
      : [],
  );

export const revisoesParaGravar = (resultados: readonly ResultadoMudanca[], idDoDocumento: (driveId: string) => string | undefined) =>
  resultados.flatMap((r) =>
    r.acao === "gravar_documento" && r.novaRevisao
      ? [linhaRevisao(r.documento, exigirId(idDoDocumento(r.documento.driveId), "um documento"))]
      : [],
  );

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
