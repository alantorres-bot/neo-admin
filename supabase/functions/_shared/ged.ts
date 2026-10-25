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

// Objetos planos; a ordem das chaves não conta (o estado lido do banco vem em outra ordem).
const canonico = (o: object) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const iguais = <T extends object>(a: T, b: T) => canonico(a) === canonico(b);

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
    // A API sempre devolve a lista, mesmo vazia: sem ela, é resposta inválida, não "nenhuma mudança".
    if (!Array.isArray(pagina.changes)) throw new ErroDrive("Resposta do Drive sem a lista de mudanças.");
    const mudancas = pagina.changes;
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
  opcoes: {
    profundidadeMax: number;
    maxItens: number;
    driveId?: string;
    /** Teto de requisições: cada pasta aberta é ao menos um files.list. */
    maxPastasAbertas?: number;
    /** Pastas lidas ao mesmo tempo (padrão 1). A ordem do resultado não muda. */
    paralelas?: number;
    /** Prazo total: ao vencer, para e marca `truncada` (a Edge Function tem tempo máximo de execução). */
    prazo?: { limiteMs: number; agora: () => number };
  },
): Promise<ArvoreLida> {
  const arvore: ArvoreLida = { pastas: [], arquivos: [], truncada: false };
  const fila: { id: string; profundidade: number }[] = [{ id: raizId, profundidade: 0 }];
  const inicio = opcoes.prazo?.agora() ?? 0;
  let itens = 0;
  let abertas = 0;
  while (fila.length > 0) {
    if (opcoes.prazo && opcoes.prazo.agora() - inicio >= opcoes.prazo.limiteMs) return { ...arvore, truncada: true };
    const restantes = opcoes.maxPastasAbertas === undefined ? Infinity : opcoes.maxPastasAbertas - abertas;
    if (restantes <= 0) return { ...arvore, truncada: true };
    const lote = fila.splice(0, Math.min(opcoes.paralelas ?? 1, restantes));
    abertas += lote.length;
    const listas = await Promise.all(lote.map((p) => listarPasta(cliente, p.id, opcoes.driveId)));
    for (const [i, atual] of lote.entries()) {
      for (const a of listas[i]) {
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
  opcoes: { maxItens: number; paralelas?: number; prazo?: { limiteMs: number; agora: () => number } },
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
    paralelas: opcoes.paralelas,
    prazo: opcoes.prazo,
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

/**
 * Lote para `ged_gravar_indice` (0806): o banco resolve os `uuid` pelo `drive_id`, numa transação só (pastas antes dos
 * documentos). Mesmo resultado dos três passos acima, sem idas e voltas.
 */
export function loteParaGravar(resultados: readonly ResultadoMudanca[]) {
  // raiz_id e pasta_id vazios: o banco ignora e usa os da rodada e o da pasta pelo drive_id.
  const pastas = resultados.flatMap((r) => (r.acao === "gravar_pasta" ? [linhaPasta(r.pasta, { raizId: "" })] : []));
  const documentos = resultados.flatMap((r) =>
    r.acao === "gravar_documento"
      ? [{ ...linhaDocumento(r.documento, { raizId: "", pastaId: "" }), pasta_drive_id: r.documento.pastaDriveId, nova_revisao: r.novaRevisao }]
      : [],
  );
  return { pastas, documentos };
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
    // Sem a lista, é resposta inválida, não pasta vazia (senão a reconciliação veria tudo como sumido).
    if (!Array.isArray(pagina.files)) throw new ErroDrive("Resposta do Drive sem a lista de arquivos.");
    arquivos.push(...pagina.files);
    pageToken = pagina.nextPageToken;
  } while (pageToken);
  return arquivos;
}

// ───────────────────────── Conexão OAuth da conta dedicada (A0-conexão) ─────────────────────────
// Plano: docs/auditoria/PLANO_FASE_A0_GED_2026-10-24.md (versão consolidada). Migration: 0801_ged_conexao.sql.
// PKCE S256; state consumido no banco ANTES da troca do código; identidade e escopos conferidos; só códigos fixos na URL de
// volta. Os únicos POST do GED são ao OAuth do Google (token e revoke); a Drive API continua só GET. Nada aqui registra log.

export const ESCOPO_DRIVE_LEITURA = "https://www.googleapis.com/auth/drive.readonly";
const ESCOPOS_ACEITOS = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email", ESCOPO_DRIVE_LEITURA]);
const ESCOPOS_PEDIDOS = `openid email ${ESCOPO_DRIVE_LEITURA}`;
const DOMINIO_GED = "neoformas.com.br";
const EMISSORES_GOOGLE = new Set(["accounts.google.com", "https://accounts.google.com"]);
const URL_AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_REVOGAR = "https://oauth2.googleapis.com/revoke";
const STATE_GED = /^[0-9a-f]{64}$/;
export const DESTINO_GED = /^\/(?!\/)[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;
const TEMPO_LIMITE_MS = 10_000;

export type CodigoErroConexao =
  | "invalid_grant" | "escopo_divergente" | "conta_divergente" | "identidade_invalida" | "token_ausente" | "http" | "recusado";

/** Configuração obrigatória, sem fallback. Faltando ou inválido qualquer item: null (a função responde 500 genérico). */
export function configConexao(env: (k: string) => string | undefined) {
  const clientId = env("GED_DRIVE_CLIENT_ID")?.trim();
  const clientSecret = env("GED_DRIVE_CLIENT_SECRET")?.trim();
  const redirectUri = env("GED_DRIVE_REDIRECT_URI")?.trim();
  const neoAdminUrl = env("NEO_ADMIN_URL")?.trim();
  if (!clientId || !clientSecret || !redirectUri || !neoAdminUrl) return null;
  try {
    const r = new URL(redirectUri);
    const n = new URL(neoAdminUrl);
    if (r.protocol !== "https:" || !["https:", "http:"].includes(n.protocol)) return null;
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri, neoAdminUrl };
}
export type ConfigConexao = NonNullable<ReturnType<typeof configConexao>>;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Desafio PKCE S256 (RFC 7636): base64url(SHA-256(verifier)). */
export async function desafioPkce(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

/** URL de autorização. `login_hint` e `hd` só orientam a tela do Google; a prova de identidade é o id_token. */
export function urlAutorizacaoGoogle(cfg: ConfigConexao, state: string, desafio: string, conta: string): string {
  const u = new URL(URL_AUTORIZACAO);
  u.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: ESCOPOS_PEDIDOS,
    access_type: "offline", prompt: "consent", code_challenge: desafio, code_challenge_method: "S256",
    login_hint: conta, hd: DOMINIO_GED, state,
  }).toString();
  return u.toString();
}

/** Conjunto exato de escopos concedidos: tem de ter o drive.readonly e nada fora da lista. Devolve a lista ou null. */
export function escoposConcedidos(scope: string | undefined): string[] | null {
  const lista = (scope ?? "").split(" ").filter(Boolean);
  if (!lista.includes(ESCOPO_DRIVE_LEITURA) || lista.some((s) => !ESCOPOS_ACEITOS.has(s))) return null;
  return lista;
}

/**
 * Confere o id_token recebido DIRETO do endpoint de token (por TLS: a assinatura pode ser dispensada, OIDC Core 3.1.3.7, item 6).
 * Exige emissor do Google, audiência = cliente do GED, validade, e-mail verificado (ausente = recusa), domínio e a conta configurada.
 */
export function conferirIdToken(
  idToken: string | undefined,
  esperado: { clientId: string; conta: string; agoraSeg: number },
): { ok: true; email: string; sub: string } | { ok: false; codigo: "identidade_invalida" | "conta_divergente" } {
  let d: { iss?: unknown; aud?: unknown; exp?: unknown; email?: unknown; email_verified?: unknown; hd?: unknown; sub?: unknown };
  try {
    const parte = (idToken ?? "").split(".")[1];
    const b64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    d = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return { ok: false, codigo: "identidade_invalida" };
  }
  const valido =
    typeof d.iss === "string" && EMISSORES_GOOGLE.has(d.iss) &&
    d.aud === esperado.clientId &&
    typeof d.exp === "number" && d.exp > esperado.agoraSeg &&
    d.email_verified === true &&
    d.hd === DOMINIO_GED &&
    typeof d.email === "string" && typeof d.sub === "string" && d.sub.trim() !== "";
  if (!valido) return { ok: false, codigo: "identidade_invalida" };
  const email = (d.email as string).trim().toLowerCase();
  if (email !== esperado.conta.trim().toLowerCase()) return { ok: false, codigo: "conta_divergente" };
  return { ok: true, email, sub: d.sub as string };
}

/** Volta ao Neo Admin: destino relativo validado, origem conferida contra NEO_ADMIN_URL, só códigos fixos na query. */
export function urlRetornoGed(neoAdminUrl: string, destino: string, ged: "conectado" | "recusado" | "erro", codigo?: CodigoErroConexao): string | null {
  if (!DESTINO_GED.test(destino)) return null;
  const base = new URL(neoAdminUrl);
  const u = new URL(destino, base);
  if (u.origin !== base.origin) return null;
  u.searchParams.set("ged", ged);
  if (codigo) u.searchParams.set("codigo", codigo);
  return u.toString();
}

export type RespostaGed = { status: number; location?: string; corpo?: string };
type ResultadoRpc = { data: unknown; error: { message: string } | null };
type FetchGed = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;
export type DepsConexao = {
  env: (k: string) => string | undefined;
  rpc: (nome: string, args: Record<string, unknown>) => Promise<ResultadoRpc>;
  fetch: FetchGed;
  agoraSeg: () => number;
};

const texto = (status: number, corpo: string): RespostaGed => ({ status, corpo });
const ir = (location: string): RespostaGed => ({ status: 302, location });
const tempoLimite = () => (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TEMPO_LIMITE_MS) : undefined);

/** Fluxo da conexão (GET). Ida: `?state=`. Volta: `?code=&state=` ou `?error=&state=`. Nunca devolve code, token ou segredo. */
export async function tratarConexao(req: { method: string; url: string }, d: DepsConexao): Promise<RespostaGed> {
  if (req.method !== "GET") return texto(405, "Método não permitido.");
  const cfg = configConexao(d.env);
  if (!cfg) return texto(500, "A conexão do GED não está configurada.");
  const p = new URL(req.url).searchParams;
  const state = p.get("state") ?? "";
  if (!STATE_GED.test(state)) return texto(400, "Pedido inválido. Volte ao Neo Admin e comece a conexão de novo.");
  const expirou = texto(400, "A autorização expirou. Volte ao Neo Admin e comece a conexão de novo.");

  const code = p.get("code");
  const recusou = p.get("error") !== null;

  // Ida ao Google.
  if (!code && !recusou) {
    const { data } = await d.rpc("ged_validar_estado", { p_state: state });
    const e = data as { code_verifier: string; conta: string } | null;
    if (!e) return expirou;
    return ir(urlAutorizacaoGoogle(cfg, state, await desafioPkce(e.code_verifier), e.conta));
  }

  // Volta: consome o state ANTES de qualquer troca (replay da URL não troca de novo).
  const { data } = await d.rpc("ged_consumir_estado", { p_state: state });
  const e = data as { code_verifier: string; destino: string; conta: string } | null;
  if (!e) return expirou;
  const falhar = async (codigo: CodigoErroConexao) => {
    await d.rpc("ged_registrar_erro_conexao", { p_codigo: codigo, p_state: state });
    const volta = urlRetornoGed(cfg.neoAdminUrl, e.destino, codigo === "recusado" ? "recusado" : "erro", codigo);
    return volta ? ir(volta) : texto(500, "Não foi possível concluir a conexão.");
  };
  if (recusou || !code) return falhar("recusado");

  let tokens: { refresh_token?: string; id_token?: string; scope?: string };
  try {
    const resp = await d.fetch(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code", code_verifier: e.code_verifier,
      }).toString(),
      signal: tempoLimite(),
    });
    if (!resp.ok) return falhar("http");
    tokens = (await resp.json()) as typeof tokens;
  } catch {
    return falhar("http");
  }

  const escopos = escoposConcedidos(tokens.scope);
  if (!escopos) return falhar("escopo_divergente");
  const id = conferirIdToken(tokens.id_token, { clientId: cfg.clientId, conta: e.conta, agoraSeg: d.agoraSeg() });
  if (!id.ok) return falhar(id.codigo);
  if (!tokens.refresh_token) return falhar("token_ausente");

  const { data: destino, error } = await d.rpc("ged_concluir_conexao", {
    p_state: state, p_email: id.email, p_sub: id.sub, p_escopos: escopos, p_refresh_token: tokens.refresh_token,
  });
  if (error || typeof destino !== "string") {
    // A conclusão falha com códigos 'ged:<codigo>' (sem dado sensível); desconhecido vira o genérico 'http'.
    const m = /^ged:(\w+)/.exec(error?.message ?? "")?.[1];
    if (m === "estado_invalido") return expirou;
    const conhecidos: CodigoErroConexao[] = ["escopo_divergente", "token_ausente", "identidade_invalida", "conta_divergente"];
    return falhar(conhecidos.includes(m as CodigoErroConexao) ? (m as CodigoErroConexao) : "http");
  }
  const volta = urlRetornoGed(cfg.neoAdminUrl, destino, "conectado");
  return volta ? ir(volta) : texto(500, "Não foi possível concluir a conexão.");
}

export type DepsDesconexao = DepsConexao & {
  /** Perfil admin dono do JWT (rpc ged_perfil_admin_atual com o token do usuário), ou null. */
  perfilAdmin: (jwt: string) => Promise<string | null>;
  /** administrativo.ged.revogar_no_google (D-REV; padrão proposto: true). */
  revogarNoGoogle: () => Promise<boolean>;
};

/**
 * Desconexão (POST com o JWT do admin). Com D-REV ligada, revoga no Google ANTES e desconecta localmente SEMPRE: o estado local
 * nunca fica ambíguo; a falha remota fica registrada ('falhou') para o admin revogar manualmente.
 */
export async function tratarDesconexao(req: { method: string; jwt: string | null }, d: DepsDesconexao): Promise<RespostaGed> {
  if (req.method !== "POST") return texto(405, "Método não permitido.");
  if (!req.jwt) return texto(401, "Entre no Neo Admin.");
  const perfil = await d.perfilAdmin(req.jwt);
  if (!perfil) return texto(403, "Só o administrador geral desconecta o Drive do GED.");

  let revogacao: "ok" | "falhou" | "nao_tentada" = "nao_tentada";
  if (await d.revogarNoGoogle()) {
    const { data } = await d.rpc("ged_refresh_token", {});
    const token = (data as { refresh_token?: string } | null)?.refresh_token;
    if (token) {
      try {
        const resp = await d.fetch(URL_REVOGAR, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
          signal: tempoLimite(),
        });
        let jaRevogado = false;
        if (resp.status === 400) jaRevogado = ((await resp.json().catch(() => ({}))) as { error?: string }).error === "invalid_token";
        revogacao = resp.ok || jaRevogado ? "ok" : "falhou";
      } catch {
        revogacao = "falhou";
      }
    }
  }
  const { error } = await d.rpc("ged_desconectar", { p_perfil: perfil, p_revogacao: revogacao });
  if (error) return texto(500, "Não foi possível desconectar. Tente de novo.");
  return { status: 200, corpo: JSON.stringify({ desconectado: true, revogacao }) };
}

// ───────────────────────── Primeira leitura controlada: só metadados (0802) ─────────────────────────
// Lista metadados (nome, tipo, data, tamanho) do que a conta conectada já enxerga. Sem download, sem conteúdo, sem gravar
// índice, sem escrita no Drive (o cliente só faz GET). Limites fixos: até 3 páginas de 100 itens; 20 na amostra da tela.

export const LIMITE_METADADOS = { porPagina: 100, paginas: 3, amostra: 20 } as const;
const CAMPOS_METADADOS = "nextPageToken,files(name,mimeType,modifiedTime,size)";

export type ItemMetadados = { nome: string; tipo: string; modificado_em: string | null; tamanho: number | null };
export type ConsultaMetadados = { itens: number; limite_atingido: boolean; por_tipo: Record<string, number>; amostra: ItemMetadados[] };
/** `incompleta`: só a verificação de raiz (parou num limite); não libera a ativação (0805). */
export type ResultadoConsultaMetadados = "ok" | "incompleta" | "invalid_grant" | "sem_permissao_drive" | "http";

export async function consultarMetadados(cliente: ClienteDrive, limite = LIMITE_METADADOS): Promise<ConsultaMetadados> {
  const r: ConsultaMetadados = { itens: 0, limite_atingido: false, por_tipo: {}, amostra: [] };
  let pageToken: string | undefined;
  let paginas = 0;
  do {
    const params: Record<string, string> = {
      q: "trashed=false", fields: CAMPOS_METADADOS, pageSize: String(limite.porPagina), orderBy: "modifiedTime desc",
      corpora: "allDrives", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    };
    if (pageToken) params.pageToken = pageToken;
    const pagina = (await cliente.get("files", params)) as { files?: ArquivoDrive[]; nextPageToken?: string };
    if (!Array.isArray(pagina.files)) throw new ErroDrive("Resposta do Drive sem a lista de arquivos.");
    for (const f of pagina.files) {
      r.itens++;
      r.por_tipo[f.mimeType] = (r.por_tipo[f.mimeType] ?? 0) + 1;
      if (r.amostra.length < limite.amostra) {
        r.amostra.push({ nome: f.name, tipo: f.mimeType, modificado_em: f.modifiedTime ?? null, tamanho: f.size ? Number(f.size) : null });
      }
    }
    paginas++;
    pageToken = pagina.nextPageToken;
  } while (pageToken && paginas < limite.paginas);
  r.limite_atingido = !!pageToken;
  return r;
}

/** Troca o refresh token (Vault) por um access token. Confere que a autorização continua só com os escopos aceitos. */
async function acessoDrive(cfg: ConfigConexao, refreshToken: string, d: DepsConexao): Promise<{ ok: true; token: string } | { ok: false; codigo: "invalid_grant" | "http" }> {
  try {
    const resp = await d.fetch(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token",
      }).toString(),
      signal: tempoLimite(),
    });
    const corpo = (await resp.json().catch(() => ({}))) as { access_token?: unknown; scope?: string; error?: string };
    if (resp.status === 400 && corpo.error === "invalid_grant") return { ok: false, codigo: "invalid_grant" };
    if (!resp.ok || typeof corpo.access_token !== "string" || !escoposConcedidos(corpo.scope)) return { ok: false, codigo: "http" };
    return { ok: true, token: corpo.access_token };
  } catch {
    return { ok: false, codigo: "http" };
  }
}

export type DepsMetadados = DepsConexao & {
  perfilAdmin: (jwt: string) => Promise<string | null>;
  /** GET da Drive API (padrão: fetch global). */
  fetchDrive?: (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<Response>;
  esperar?: (ms: number) => Promise<void>;
  /** Relógio do prazo da verificação (padrão: Date.now). */
  agoraMs?: () => number;
  /** Log sem dado sensível: só resultado e contagem. */
  log?: (mensagem: string) => void;
};

const json = (status: number, corpo: unknown): RespostaGed => ({ status, corpo: JSON.stringify(corpo) });

type Leitura = { perfil: string; cliente: ClienteDrive };

/**
 * Preparação comum das leituras do Drive: admin geral conferido ANTES de qualquer chamada ao Google; acesso renovado com o
 * token do Vault (invalid_grant marca a conexão "com erro"). `auditar` grava o resultado sem nomes nem tokens.
 */
async function prepararLeitura(
  req: { method: string; jwt: string | null },
  d: DepsMetadados,
  auditar: (perfil: string, resultado: ResultadoConsultaMetadados, itens: number) => Promise<void>,
): Promise<Leitura | RespostaGed> {
  if (req.method !== "POST") return json(405, { erro: "metodo" });
  if (!req.jwt) return json(401, { erro: "sem_sessao" });
  const perfil = await d.perfilAdmin(req.jwt);
  if (!perfil) return json(403, { erro: "sem_permissao" });
  const c = await clienteDoVault(d);
  if ("erro" in c) {
    if (c.erro === "nao_configurada") return json(500, { erro: c.erro });
    if (c.erro === "desconectado") return json(409, { erro: c.erro });
    await auditar(perfil, c.erro, 0);
    return json(c.erro === "invalid_grant" ? 409 : 502, { erro: c.erro });
  }
  return { perfil, cliente: c.cliente };
}

/** Cliente do Drive com o token do Vault (renovado agora). invalid_grant marca a conexão "com erro" (a tela pede reconexão). */
async function clienteDoVault(d: DepsMetadados): Promise<{ cliente: ClienteDrive } | { erro: "nao_configurada" | "desconectado" | "invalid_grant" | "http" }> {
  const cfg = configConexao(d.env);
  if (!cfg) return { erro: "nao_configurada" };
  const { data } = await d.rpc("ged_refresh_token", {});
  const refreshToken = (data as { refresh_token?: string } | null)?.refresh_token;
  if (!refreshToken) return { erro: "desconectado" };
  const acesso = await acessoDrive(cfg, refreshToken, d);
  if (!acesso.ok) {
    if (acesso.codigo === "invalid_grant") await d.rpc("ged_registrar_erro_conexao", { p_codigo: "invalid_grant" });
    return { erro: acesso.codigo };
  }
  return { cliente: criarClienteDrive(async () => acesso.token, { fazerFetch: d.fetchDrive, esperar: d.esperar }) };
}

/** Erro do Drive durante a leitura: 403 (API desativada ou sem acesso) tem código próprio; o resto é genérico. */
const resultadoDoErro = (e: unknown): ResultadoConsultaMetadados => (e instanceof ErroDrive && e.status === 403 ? "sem_permissao_drive" : "http");

/** Consulta de metadados (POST com o JWT do admin geral). Cada consulta fica na auditoria (quem, quantos, resultado). */
export async function tratarConsultaMetadados(req: { method: string; jwt: string | null }, d: DepsMetadados): Promise<RespostaGed> {
  const auditar = async (perfil: string, resultado: ResultadoConsultaMetadados, itens: number) => {
    await d.rpc("ged_registrar_consulta_metadados", { p_perfil: perfil, p_itens: itens, p_resultado: resultado });
    d.log?.(`ged-metadados: resultado=${resultado} itens=${itens}`);
  };
  const l = await prepararLeitura(req, d, auditar);
  if ("status" in l) return l;
  try {
    const r = await consultarMetadados(l.cliente);
    await auditar(l.perfil, "ok", r.itens);
    return json(200, r);
  } catch (e) {
    const resultado = resultadoDoErro(e);
    await auditar(l.perfil, resultado, 0);
    return json(502, { erro: resultado });
  }
}

// ───────────────────────── Verificação das raízes candidatas (A0, 5.2.4) ─────────────────────────
// Só as candidatas da especificação (2.2), lidas no Drive compartilhado. O resultado tem nomes de pastas: vai SÓ ao admin geral,
// na resposta, e não é gravado (5.2.4.4: nada persistido; a auditoria guarda só a raiz, a contagem e o resultado).

export const DRIVE_COMPARTILHADO_GED = "0ADGzgMWcDLTWUk9PVA";
export const RAIZES_CANDIDATAS = {
  "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR": { rotulo: "Elaboração: 02 - COMERCIAL / 02 - CONTRATOS", finalidade: "elaboracao" },
  "1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56": { rotulo: "Elaboração (alternativa): 02 - CONTRATOS / Contratos", finalidade: "elaboracao" },
  "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak": { rotulo: "Dossiê: 02 - COMERCIAL / 01 - CLIENTES", finalidade: "dossie_cliente" },
} as const;
export type IdRaizCandidata = keyof typeof RAIZES_CANDIDATAS;
/**
 * Profundidade 4 = proposta da 5.3.1 (ponto 4 em aberto). Tetos fixos e prazo de 90 s, abaixo do tempo máximo da Edge Function:
 * ao atingir qualquer um, a leitura volta marcada como incompleta.
 */
export const LIMITE_VERIFICACAO = { profundidadeMax: 4, maxItens: 10000, maxPastasAbertas: 1000, paralelas: 5, prazoMs: 90_000 } as const;

export const ehRaizCandidata = (id: unknown): id is IdRaizCandidata => typeof id === "string" && Object.hasOwn(RAIZES_CANDIDATAS, id);

export async function tratarVerificacaoRaiz(
  req: { method: string; jwt: string | null; raiz: unknown },
  d: DepsMetadados,
): Promise<RespostaGed> {
  if (req.method === "POST" && !ehRaizCandidata(req.raiz)) return json(400, { erro: "raiz_invalida" }); // antes de tudo: nada de ID livre
  const raiz = req.raiz as IdRaizCandidata;
  const auditar = async (perfil: string, resultado: ResultadoConsultaMetadados, itens: number) => {
    await d.rpc("ged_registrar_verificacao_raiz", { p_perfil: perfil, p_raiz: raiz, p_itens: itens, p_resultado: resultado });
    d.log?.(`ged-verificacao: resultado=${resultado} itens=${itens}`);
  };
  const l = await prepararLeitura(req, d, auditar);
  if ("status" in l) return l;
  try {
    const { prazoMs, ...limites } = LIMITE_VERIFICACAO;
    const arvore = await percorrerArvore(l.cliente, raiz, {
      ...limites, driveId: DRIVE_COMPARTILHADO_GED, prazo: { limiteMs: prazoMs, agora: d.agoraMs ?? Date.now },
    });
    const itens = arvore.pastas.length + arvore.arquivos.length;
    const ids = new Set(arvore.pastas.map((p) => p.arquivo.id));
    // 5.2.4.1: outras raízes (aqui, as outras candidatas) dentro desta. "Acima dela" aparece na verificação da outra.
    const candidatasDentro = (Object.keys(RAIZES_CANDIDATAS) as IdRaizCandidata[]).filter((id) => id !== raiz && ids.has(id)).map((id) => RAIZES_CANDIDATAS[id].rotulo);
    await auditar(l.perfil, arvore.truncada ? "incompleta" : "ok", itens); // só a completa libera a ativação (0805)
    return json(200, { raiz: RAIZES_CANDIDATAS[raiz].rotulo, itens, candidatasDentro, limites: LIMITE_VERIFICACAO, ...resumirArvore(arvore) });
  } catch (e) {
    const resultado = resultadoDoErro(e);
    await auditar(l.perfil, resultado, 0);
    return json(502, { erro: resultado });
  }
}

// ───────────────────────── Cadastro das pastas-raiz (A1a, 5.2; migration 0804) ─────────────────────────
// Só as duas raízes confirmadas em 25/10/2026 (2.2). O nome vem do Drive (files.get), nunca do navegador; a pasta precisa estar
// no Drive compartilhado do GED, fora da lixeira. O banco confere de novo: admin geral, IDs, trava da elaboração e áreas.

export const RAIZES_CONFIRMADAS = ["1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR", "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak"] as const satisfies readonly IdRaizCandidata[];
export type IdRaizConfirmada = (typeof RAIZES_CONFIRMADAS)[number];
export const ehRaizConfirmada = (id: unknown): id is IdRaizConfirmada => RAIZES_CONFIRMADAS.includes(id as IdRaizConfirmada);

/** Códigos que a função devolve a quem cadastrou (os `ged:<codigo>` do banco e os da leitura do Drive). */
const CODIGOS_CADASTRO = ["sem_permissao", "raiz_invalida", "raiz_travada", "area_invalida", "raiz_existente"] as const;
const listaDeAreas = (v: unknown): v is string[] => Array.isArray(v) && v.every((a) => typeof a === "string");

export async function tratarCadastroRaiz(
  req: { method: string; jwt: string | null; raiz: unknown; area: unknown; areas_leitura: unknown; area_operacao: unknown },
  d: DepsMetadados,
): Promise<RespostaGed> {
  if (req.method === "POST" && !ehRaizConfirmada(req.raiz)) return json(400, { erro: "raiz_invalida" }); // antes de tudo
  if (req.method === "POST" && (typeof req.area !== "string" || typeof req.area_operacao !== "string" || !listaDeAreas(req.areas_leitura))) {
    return json(400, { erro: "area_invalida" });
  }
  const raiz = req.raiz as IdRaizConfirmada;
  const log = async (_perfil: string, resultado: string) => void d.log?.(`ged-cadastro: resultado=${resultado}`);
  const l = await prepararLeitura(req, d, log);
  if ("status" in l) return l;
  let pasta: ArquivoDrive & { driveId?: string };
  try {
    pasta = (await l.cliente.get(`files/${raiz}`, { fields: "id,name,mimeType,driveId,trashed", supportsAllDrives: "true" })) as typeof pasta;
  } catch (e) {
    const resultado = resultadoDoErro(e);
    await log(l.perfil, resultado);
    return json(502, { erro: resultado });
  }
  if (pasta?.id !== raiz || pasta.mimeType !== MIME_PASTA || pasta.trashed || pasta.driveId !== DRIVE_COMPARTILHADO_GED
      || typeof pasta.name !== "string" || pasta.name.trim() === "") {
    await log(l.perfil, "pasta_invalida");
    return json(422, { erro: "pasta_invalida" });
  }
  const { data, error } = await d.rpc("ged_cadastrar_raiz", {
    p_perfil: l.perfil, p_drive_id: raiz, p_nome: pasta.name, p_drive_compartilhado_id: pasta.driveId,
    p_area: req.area, p_areas_leitura: req.areas_leitura, p_area_operacao: req.area_operacao,
  });
  if (error) {
    const codigo = /ged:([a-z_]+)/.exec(error.message)?.[1];
    const conhecido = CODIGOS_CADASTRO.find((c) => c === codigo) ?? "banco";
    await log(l.perfil, conhecido);
    return json(conhecido === "sem_permissao" ? 403 : conhecido === "banco" ? 500 : 409, { erro: conhecido });
  }
  await log(l.perfil, "ok");
  return json(201, { id: data, nome: pasta.name });
}

// ───────────────────────── Indexação (5.3; gravação na 0806) ─────────────────────────
// Chamada só pelo agendamento do banco (x-sincronizacao-segredo = SINCRONIZACAO_SEGREDO, 5.3.7). "Atualizar índice agora" não
// existe ainda [PENDENTE 16]. Só metadados (CAMPOS_ARQUIVO): nada de conteúdo, nada de classificação. Cada raiz ativa tem a sua
// rodada (ged_iniciar_indexacao confere o interruptor administrativo.ged.indexar, a raiz ativa e a trava):
//  - sem ponto de continuação: carga inicial (árvore inteira) e, se completa, grava o startPageToken pego ANTES da leitura;
//  - com ponto de continuação: incremental pelo changes.list do Drive compartilhado, gravando página por página.
// Falha no meio: a rodada fecha com um código de erro e o token NÃO avança; o que já foi gravado é refeito sem duplicar.
// Resposta e log só com contagens e códigos (5.11.3, 5.11.11): nada de nome, id ou link.

/** max_itens_rodada proposto (5.3.6) e profundidade proposta (5.3.1); prazo abaixo do tempo máximo da Edge Function. */
// shortcut: reconciliação a cada 7 dias fixos (proposta da 5.3.4); virar o parâmetro administrativo.ged.reconciliar_dias quando a
// frequência for decidida (seção 14, item 4).
export const LIMITE_INDEXACAO = {
  profundidadeMax: 4, maxItens: 5000, paralelas: 5, prazoMs: 100_000, documentosPorLote: 500, reconciliarDias: 7,
} as const;

export type RaizIndexavel = {
  id: string; driveId: string; driveIdCompartilhado: string | null; pageToken: string | null; reconciliadaEm: string | null;
};
type TipoRodada = "inicial" | "incremental" | "reconciliacao";

/** Sem ponto de continuação: carga inicial. Com ele: reconciliação se a última (ou a carga) tiver mais de N dias; senão, incremental. */
export function tipoDaRodada(raiz: RaizIndexavel, agoraMs: number, indexadaEm?: string | null): TipoRodada {
  if (!raiz.pageToken) return "inicial";
  const desde = raiz.reconciliadaEm ?? indexadaEm ?? null;
  if (!desde) return "incremental";
  return agoraMs - Date.parse(desde) >= LIMITE_INDEXACAO.reconciliarDias * 86_400_000 ? "reconciliacao" : "incremental";
}
export type DepsIndexacao = DepsMetadados & { raizesAtivas: () => Promise<(RaizIndexavel & { indexadaEm?: string | null })[]> };
type ResumoRodada = ReturnType<typeof resumirRodada>;
type ResumoRaiz = { tipo: TipoRodada; resultado: string; completa: boolean } & Partial<ResumoRodada>;

const iguaisSeguro = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
const codigoDoErro = (e: unknown): string =>
  e instanceof ErroDrive
    ? e.status === 403 ? "sem_permissao_drive" : "drive"
    : /ged:([a-z_]+)/.exec(String((e as { message?: unknown })?.message))?.[1] ?? "falha";
/** Sem acesso ao Drive, as outras raízes também falhariam: a rodada para. */
const SEM_ACESSO = ["invalid_grant", "desconectado", "nao_configurada", "http"];

export async function tratarIndexacao(req: { method: string; segredo: string | null }, d: DepsIndexacao): Promise<RespostaGed> {
  if (req.method !== "POST") return json(405, { erro: "metodo" });
  const esperado = d.env("SINCRONIZACAO_SEGREDO") ?? "";
  if (esperado.length < 32 || !req.segredo || !iguaisSeguro(req.segredo, esperado)) return json(401, { erro: "nao_autorizado" });

  const resumo: ResumoRaiz[] = [];
  let cliente: ClienteDrive | null = null;
  for (const raiz of await d.raizesAtivas()) {
    const tipo = tipoDaRodada(raiz, (d.agoraMs ?? Date.now)(), raiz.indexadaEm);
    const aberta = await d.rpc("ged_iniciar_indexacao", { p_raiz: raiz.id, p_tipo: tipo, p_agendada: true, p_usuario: null });
    if (aberta.error) {
      const codigo = codigoDoErro(aberta.error);
      if (codigo === "raiz_inativa") continue;
      // Interruptor desligado ou outra rodada em andamento: para, sem tocar no Google.
      d.log?.(`ged-indexacao: resultado=${codigo}`);
      return json(200, { parada: codigo, raizes: resumo });
    }
    const rodada = aberta.data as string;
    const fechar = (r: Partial<ResumoRodada>, token: string | null, erro: string | null) =>
      d.rpc("ged_concluir_indexacao", { p_indexacao: rodada, p_resumo: r, p_page_token: token, p_erro: erro });
    try {
      if (!cliente) {
        const c = await clienteDoVault(d);
        if ("erro" in c) throw new Error(`ged:${c.erro}`);
        cliente = c.cliente;
      }
      const r = await indexarRaiz(cliente, raiz, tipo, rodada, d);
      const fechou = await fechar(r.resumo, r.token, null);
      if (fechou.error) throw new Error(fechou.error.message);
      resumo.push({ tipo, resultado: "ok", completa: r.completa, ...r.resumo });
      d.log?.(`ged-indexacao: tipo=${tipo} resultado=ok completa=${r.completa} novos=${r.resumo.novos} alterados=${r.resumo.alterados}`);
    } catch (e) {
      const codigo = codigoDoErro(e);
      await fechar({}, null, codigo); // o token não avança
      resumo.push({ tipo, resultado: codigo, completa: false });
      d.log?.(`ged-indexacao: tipo=${tipo} resultado=${codigo}`);
      if (SEM_ACESSO.includes(codigo)) break;
    }
  }
  return json(200, { raizes: resumo });
}

/** Estado do índice no banco (ged_estado_indice) → índice em memória, com a raiz na profundidade 0. */
async function indiceDaRaiz(raiz: RaizIndexavel, d: DepsIndexacao) {
  const { data, error } = await d.rpc("ged_estado_indice", { p_raiz: raiz.id });
  if (error) throw new Error(error.message);
  const e = data as { pastas: PastaIndice[]; documentos: DocumentoIndice[] };
  const pastas = new Map(e.pastas.map((p) => [p.driveId, p]));
  const raizNova = !pastas.has(raiz.driveId);
  if (raizNova) pastas.set(raiz.driveId, { driveId: raiz.driveId, maeDriveId: null, nome: "(raiz)", profundidade: 0, situacao: "ativa" });
  const indice = { pastas, documentos: new Map(e.documentos.map((x) => [x.driveId, x])), profundidadeMax: LIMITE_INDEXACAO.profundidadeMax };
  return { indice, raizNova };
}

/** Grava em lotes de documentos; as pastas vão no primeiro (o banco precisa delas para achar a pasta de cada documento). */
async function gravarLotes(rodada: string, resultados: readonly ResultadoMudanca[], d: DepsIndexacao, extraPastas: object[] = []) {
  const { pastas, documentos } = loteParaGravar(resultados);
  const n = LIMITE_INDEXACAO.documentosPorLote;
  for (let i = 0; i === 0 || i < documentos.length; i += n) {
    const { error } = await d.rpc("ged_gravar_indice", {
      p_indexacao: rodada, p_pastas: i === 0 ? [...extraPastas, ...pastas] : [], p_documentos: documentos.slice(i, i + n),
    });
    if (error) throw new Error(error.message);
  }
}

async function indexarRaiz(cliente: ClienteDrive, raiz: RaizIndexavel, tipo: TipoRodada, rodada: string, d: DepsIndexacao) {
  const { indice, raizNova } = await indiceDaRaiz(raiz, d);
  const driveId = raiz.driveIdCompartilhado ?? undefined;
  if (tipo === "reconciliacao") {
    // 5.3.4: listagem completa; o que mudou entra pelo caminho comum e cada ausente é consultado no Drive (404 = removido).
    // Listagem incompleta não marca ausentes (ausentesNaListagem lança): a rodada falha e o token fica onde estava.
    const arvore = await percorrerArvore(cliente, raiz.driveId, {
      profundidadeMax: LIMITE_INDEXACAO.profundidadeMax, maxItens: LIMITE_INDEXACAO.maxItens, driveId,
      paralelas: LIMITE_INDEXACAO.paralelas, prazo: { limiteMs: LIMITE_INDEXACAO.prazoMs, agora: d.agoraMs ?? Date.now },
    });
    if (arvore.truncada) throw new Error("ged:listagem_incompleta");
    const resultados = aplicarPaginaNoIndice(mudancasDaArvore(arvore), indice);
    const ausentes = ausentesNaListagem(arvore, indice);
    const consultados: MudancaDrive[] = [];
    for (const id of ausentes) consultados.push(await consultarAusente(cliente, id));
    resultados.push(...aplicarPaginaNoIndice(consultados, indice));
    await gravarLotes(rodada, resultados, d);
    // O ponto de continuação não muda; reenviá-lo faz o banco registrar reconciliada_em (0806).
    return { resumo: resumirRodada(resultados), token: raiz.pageToken, completa: true };
  }
  if (tipo === "inicial") {
    const r = await cargaInicial(cliente, { driveId: raiz.driveId, driveIdCompartilhado: driveId }, indice, {
      maxItens: LIMITE_INDEXACAO.maxItens, paralelas: LIMITE_INDEXACAO.paralelas,
      prazo: { limiteMs: LIMITE_INDEXACAO.prazoMs, agora: d.agoraMs ?? Date.now },
    });
    // A raiz entra no índice na profundidade 0; depois a indexação nunca a altera (aplicarMudanca).
    const raizLinha = raizNova ? [{ drive_id: raiz.driveId, nome: "(raiz)", mae_drive_id: null, profundidade: 0, situacao: "ativa" }] : [];
    await gravarLotes(rodada, r.resultados, d, raizLinha);
    return { resumo: r.resumo, token: r.startPageToken, completa: r.completa };
  }
  const todos: ResultadoMudanca[] = [];
  const r = await percorrerMudancas(cliente, raiz.pageToken as string, async (mudancas) => {
    const pagina = aplicarPaginaNoIndice(mudancas, indice);
    if (pagina.length) await gravarLotes(rodada, pagina, d);
    todos.push(...pagina);
  }, { maxItens: LIMITE_INDEXACAO.maxItens, driveId });
  return { resumo: resumirRodada(todos), token: r.proximoToken, completa: r.completa };
}
