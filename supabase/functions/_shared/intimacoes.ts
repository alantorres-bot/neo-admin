// Intimações de cartório (módulo financeiro.intimacoes, docs/modulos/financeiro-intimacoes-cartorio.md): classifica os e-mails,
// extrai os dados, monta as chaves de duplicidade, sugere o título do Contas a Pagar e altera SÓ o vencimento no Consistem.
// Lógica pura (sem Deno) testada com o Vitest (lib/modulos/financeiro/intimacoes/*.test.ts) e usada pelas Edge Functions
// fin-intimacoes-ler-gmail e fin-intimacoes-consistem.
//
// NUNCA cria lançamento no Consistem: o adiantamento ao cartório é lançado À MÃO na tela do Consistem. A inclusão pela API
// (PUT contasPagar, tipo A) cria um registro sem data de pagamento e com valor pago zero, que o CCFFB720 não reconhece (teste de
// 23/10/2026, lançamento 34214, excluído). Este módulo não inclui nada no Consistem de propósito (há teste que confere).
//
// Sem imports (o tsc do app não aceita import com ".ts" e o Deno exige a extensão): a alteração do vencimento recebe a leitura,
// o envio e as conferências do Consistem já prontos (PortaConsistem), ligados em fin-intimacoes-consistem às rotinas de
// consistem-receber.ts / consistem-inclusao.ts — as mesmas das correções do Cartão (0176).

export class IntimacaoErro extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
    this.name = "IntimacaoErro";
  }
}

/** Valor em centavos: aceita "14249.64" (CENPROT), "14.249,64" e número. */
export function centavosDe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(Number((v * 100).toFixed(6))) : null;
  let s = String(v ?? "").replace(/[R$\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(6))) : null;
}

// ---------------------------------------------------------------- e-mails

export const REMETENTE_CARTORIO = "protesto.intimacao@4oficio.com";
export const REMETENTE_CENPROT = "aviso@pesquisaprotesto.com.br";
/** Como a CENPROT chama o 4º Ofício de Protesto de Títulos de Cuiabá (coluna "Comarca / Cartório"). */
export const CARTORIO_4OFICIO = "CUIABÁ 04";
/** Busca no Gmail. A mesma intimação chega em cópias (admcuiaba@, alantorres@…) e reenvios: a chave é que deduplica. */
export const CONSULTA_GMAIL = `from:(${REMETENTE_CARTORIO} OR ${REMETENTE_CENPROT}) newer_than:30d`;

export type TipoEmail = "cartorio" | "cenprot";

const enderecoDe = (remetente: string) => (/<([^>]+)>/.exec(remetente)?.[1] ?? remetente).trim().toLowerCase();

/** Intimação do 4º Ofício ou aviso "Avise-me" da CENPROT; o resto (ex.: "LIMPE SEU NOME", nomelimpo@) fica de fora. */
export function classificarEmail(remetente: string, assunto: string): TipoEmail | null {
  const de = enderecoDe(remetente);
  if (de === REMETENTE_CARTORIO && /INTIMA[ÇC][ÃA]O\s+DE\s+PROTESTO/i.test(assunto)) return "cartorio";
  if (de === REMETENTE_CENPROT && /avise-me/i.test(assunto)) return "cenprot";
  return null;
}

export type IntimacaoLida = {
  /**
   * Chave de duplicidade: `protocolo:<cartório>:<protocolo>` — a MESMA para o portal do 4º Ofício e para a CENPROT, então o
   * mesmo protesto das duas fontes vira uma intimação só. `localizador:<uuid>` só quando o portal não pôde ser lido.
   */
  chave: string;
  origem: TipoEmail;
  cartorio: string;
  localizador: string | null;
  link: string | null;
  protocolo: string | null;
  dataProtocolo: string | null;
  credorDocumento: string | null;
  credorNome: string | null;
  devedorDocumento: string | null;
  especie: string | null;
  numeroTitulo: string | null;
  valorTitulo: number | null;
  vencimentoTitulo: string | null;
  /** Do portal do cartório: data limite para pagamento. */
  dataLimite: string | null;
  /** Do portal: total a pagar no cartório (título + custas). */
  valorTotalCartorio: number | null;
  /** CALCULADO: total no cartório − saldo do título (o portal não mostra a composição). */
  valorCustas: number | null;
};

const VAZIA: Omit<IntimacaoLida, "chave" | "origem" | "cartorio"> = {
  localizador: null, link: null, protocolo: null, dataProtocolo: null, credorDocumento: null, credorNome: null,
  devedorDocumento: null, especie: null, numeroTitulo: null, valorTitulo: null, vencimentoTitulo: null,
  dataLimite: null, valorTotalCartorio: null, valorCustas: null,
};

export const chaveProtocolo = (cartorio: string, protocolo: string) => `protocolo:${cartorio.trim().toUpperCase()}:${protocolo.trim()}`;

const ENTIDADES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Texto de um trecho de HTML: <br> vira quebra de linha, tags somem, entidades comuns são trocadas. */
export function textoDoHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? " ")
    .split("\n").map((l) => l.replace(/[ \t\r]+/g, " ").trim()).filter(Boolean).join("\n");
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * E-mail do 4º Ofício: o corpo NÃO traz título, valor, custas nem prazo; só o código localizador e o link do portal do
 * cartório. Os dados vêm do portal (lerPortal4Oficio). Esta intimação "só localizador" é o que sobra se o portal falhar.
 */
export function lerIntimacaoCartorio(corpo: string): IntimacaoLida | null {
  const localizador = new RegExp(`C[óo]digo\\s+localizador\\s*-\\s*(${UUID})`, "i").exec(corpo)?.[1]?.toLowerCase();
  if (!localizador) return null;
  const link = new RegExp(`https://app\\.protestocuiaba\\.com\\.br/#/directMail/items/${localizador}/payments`, "i").exec(corpo)?.[0] ?? null;
  return { ...VAZIA, chave: `localizador:${localizador}`, origem: "cartorio", cartorio: CARTORIO_4OFICIO, localizador, link };
}

/** dd/mm/aaaa → aaaa-mm-dd (data inexistente = null). */
export function dataBrParaIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export const somenteDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Aviso "Avise-me" da CENPROT (HTML): uma linha por ocorrência, com credor, número do título, valor, vencimento, cartório e
 * protocolo. Só "Apontamento" é intimação a tratar; as demais ocorrências (protesto lavrado, cancelamento…) são contadas.
 * O aviso não traz custas nem o prazo de pagamento: esses vêm da intimação.
 */
export function lerAvisoCenprot(html: string): { apontamentos: IntimacaoLida[]; ignoradas: number; linhasInvalidas: number } {
  const apontamentos: IntimacaoLida[] = [];
  let ignoradas = 0;
  let linhasInvalidas = 0;
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celulas = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textoDoHtml(c[1]));
    if (celulas.length === 0) continue; // cabeçalho (<th>)
    if (celulas.length < 9) { linhasInvalidas++; continue; }
    const [ocorrencia, credor, devedor, especie, numero, valor, vencimento, cartorio, protocoloData] = celulas;
    if (!/^apontamento$/i.test(ocorrencia.trim())) { ignoradas++; continue; }
    const [credorDoc, ...credorNome] = credor.split("\n");
    const [protocolo, dataProtocolo] = protocoloData.split("\n");
    const centavos = centavosDe(valor);
    const nomeCartorio = cartorio.replace(/\n/g, " ").trim().toUpperCase();
    if (!protocolo?.trim() || !nomeCartorio || centavos === null) { linhasInvalidas++; continue; }
    apontamentos.push({
      ...VAZIA,
      chave: chaveProtocolo(nomeCartorio, protocolo),
      origem: "cenprot",
      cartorio: nomeCartorio,
      protocolo: protocolo.trim(),
      dataProtocolo: dataBrParaIso(dataProtocolo ?? ""),
      credorDocumento: credorDoc.trim() || null,
      credorNome: credorNome.join(" ").trim() || null,
      devedorDocumento: devedor.trim() || null,
      especie: especie.trim() || null,
      numeroTitulo: numero.trim() || null,
      valorTitulo: centavos / 100,
      vencimentoTitulo: dataBrParaIso(vencimento),
    });
  }
  return { apontamentos, ignoradas, linhasInvalidas };
}

/** Lê um e-mail já classificado. Sem dado reconhecível = lista vazia (o e-mail fica registrado como lido, sem intimação). */
export function lerEmail(tipo: TipoEmail, html: string, texto: string): IntimacaoLida[] {
  if (tipo === "cartorio") {
    const i = lerIntimacaoCartorio(html || texto);
    return i ? [i] : [];
  }
  return lerAvisoCenprot(html).apontamentos;
}

// ---------------------------------------------------------------- portal do 4º Ofício (api.protestocuiaba.com.br, público)
// O mesmo que a página do link faz (app.protestocuiaba.com.br/#/directMail/items/<localizador>/payments): GET do item (nome e
// CPF/CNPJ mascarado do intimado) e, com o CNPJ do intimado, GET dos títulos. Lido como uma pessoa que abre o link: o
// parâmetro naoIntimar fica vazio, como na página (decisão do Alan em 23/10/2026: o agente entra no link).

export const URL_API_PORTAL = "https://api.protestocuiaba.com.br/public/directMail/items";
export const linkIntimacao = (localizador: string) => `https://app.protestocuiaba.com.br/#/directMail/items/${localizador}/payments`;

// A máscara do portal ("17." + asteriscos + "-28") confere com "17.209.767/0001-28" (ou só dígitos): cada dígito visível bate.
export function documentoConfereMascara(documento: string, mascara: string): boolean {
  const d = somenteDigitos(documento);
  const m = mascara.replace(/[^0-9*]/g, "");
  return d.length > 0 && d.length === m.length && [...m].every((c, i) => c === "*" || c === d[i]);
}

export type ItemPortal = { uuid: string; entityType?: string; cpfCnpj?: string; name?: string; status?: string };
export type PedidoPortal = {
  valorTotal?: string | number | null;
  titulo?: {
    protocolo?: string; numeroTitulo?: string; naturezaDocumento?: string; dataVencimento?: string; dataProtocolo?: string;
    dataLimitePagamento?: string; valorTitulo?: number | string; valorSaldo?: number | string; status?: string; disponivelPagamento?: boolean;
  };
  credor?: { nome?: string; cpfCnpj?: string };
};

const dataIso = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.exec(String(v ?? ""))?.[0] ?? null;

/**
 * Títulos do portal → intimações. Só "intimado" (com pagamento disponível) é intimação a tratar; "pago", "protestado" e o
 * resto são contados. Custas = total no cartório − saldo do título (só quando o total é maior).
 */
export function intimacoesDoPortal(localizador: string, devedorDocumento: string, pedidos: readonly PedidoPortal[]): { intimacoes: IntimacaoLida[]; situacoes: Record<string, number> } {
  const intimacoes: IntimacaoLida[] = [];
  const situacoes: Record<string, number> = {};
  for (const p of pedidos) {
    const t = p.titulo ?? {};
    const situacao = String(t.status ?? "desconhecida").toLowerCase();
    situacoes[situacao] = (situacoes[situacao] ?? 0) + 1;
    if (situacao !== "intimado" || !t.protocolo) continue;
    const total = centavosDe(p.valorTotal);
    const saldo = centavosDe(t.valorSaldo);
    const custas = total !== null && saldo !== null && total > saldo ? total - saldo : null;
    const valor = centavosDe(t.valorTitulo);
    intimacoes.push({
      ...VAZIA,
      chave: chaveProtocolo(CARTORIO_4OFICIO, String(t.protocolo)),
      origem: "cartorio",
      cartorio: CARTORIO_4OFICIO,
      localizador,
      link: linkIntimacao(localizador),
      protocolo: String(t.protocolo).trim(),
      dataProtocolo: dataIso(t.dataProtocolo),
      credorDocumento: p.credor?.cpfCnpj?.trim() || null,
      credorNome: p.credor?.nome?.trim() || null,
      devedorDocumento,
      especie: t.naturezaDocumento?.trim() || null,
      numeroTitulo: t.numeroTitulo?.trim() || null,
      valorTitulo: valor === null ? null : valor / 100,
      vencimentoTitulo: dataIso(t.dataVencimento),
      dataLimite: dataIso(t.dataLimitePagamento),
      valorTotalCartorio: total === null ? null : total / 100,
      valorCustas: custas === null ? null : custas / 100,
    });
  }
  return { intimacoes, situacoes };
}

async function getPortal(buscar: BuscarGmail, url: string): Promise<unknown> {
  let resp;
  try {
    resp = await buscar(url, { method: "GET", headers: { Accept: "application/json", Origin: "https://app.protestocuiaba.com.br", Referer: "https://app.protestocuiaba.com.br/" } });
  } catch {
    throw new IntimacaoErro("Falha de rede ao falar com o portal do 4º Ofício.");
  }
  const texto = await resp.text();
  if (!resp.ok) throw new IntimacaoErro(`O portal do 4º Ofício respondeu HTTP ${resp.status}.`, resp.status);
  return texto ? JSON.parse(texto) : null;
}

/**
 * Entra no link da intimação: lê o item, descobre a empresa intimada entre `documentosEmpresas` pela máscara do CPF/CNPJ e
 * lê os títulos com esse documento. Sem empresa conferindo = erro (não tenta documentos às cegas).
 */
export async function lerPortal4Oficio(buscar: BuscarGmail, localizador: string, documentosEmpresas: readonly string[]):
  Promise<{ documento: string; intimacoes: IntimacaoLida[]; situacoes: Record<string, number> }> {
  if (!new RegExp(`^${UUID}$`, "i").test(localizador)) throw new IntimacaoErro(`Localizador inválido: ${localizador}.`);
  const item = (await getPortal(buscar, `${URL_API_PORTAL}/${localizador}`)) as ItemPortal | null;
  if (!item?.cpfCnpj) throw new IntimacaoErro("O portal não devolveu o intimado deste localizador.");
  const documento = documentosEmpresas.find((d) => documentoConfereMascara(d, item.cpfCnpj!));
  if (!documento) throw new IntimacaoErro(`O intimado (${item.cpfCnpj}) não confere com nenhuma empresa cadastrada.`);
  const pedidos = (await getPortal(buscar, `${URL_API_PORTAL}/${localizador}/payments?${new URLSearchParams({ naoIntimar: "", cpfCnpj: somenteDigitos(documento) })}`)) as PedidoPortal[] | null;
  if (!Array.isArray(pedidos)) throw new IntimacaoErro("O portal não devolveu os títulos da intimação.");
  return { documento, ...intimacoesDoPortal(localizador.toLowerCase(), documento, pedidos) };
}

// ---------------------------------------------------------------- Gmail (leitura)

type ParteGmail = { mimeType?: string; body?: { data?: string }; parts?: ParteGmail[] };
export type MensagemGmail = { id: string; threadId?: string; internalDate?: string; payload?: ParteGmail & { headers?: { name: string; value: string }[] } };

/** base64url (Gmail) → texto UTF-8. */
export function decodificarBase64Url(dados: string): string {
  const b64 = dados.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Cabeçalhos e corpos (HTML e texto) de uma mensagem `format=full`. */
export function lerMensagemGmail(m: MensagemGmail): { remetente: string; assunto: string; recebidoEm: string | null; html: string; texto: string } {
  const cab = (nome: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === nome)?.value ?? "";
  let html = "";
  let texto = "";
  const visitar = (p: ParteGmail | undefined) => {
    if (!p) return;
    if (p.body?.data && p.mimeType === "text/html") html += decodificarBase64Url(p.body.data);
    if (p.body?.data && p.mimeType === "text/plain") texto += decodificarBase64Url(p.body.data);
    p.parts?.forEach(visitar);
  };
  visitar(m.payload);
  const ms = Number(m.internalDate);
  return { remetente: cab("from"), assunto: cab("subject"), recebidoEm: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null, html, texto };
}

const URL_MENSAGENS = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

/** Mesma forma do `Buscar` de gmail.ts (aqui só GET). */
export type BuscarGmail = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

async function getGmail(buscar: BuscarGmail, accessToken: string, url: string): Promise<unknown> {
  let resp;
  try {
    resp = await buscar(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch {
    throw new IntimacaoErro("Falha de rede ao falar com o Gmail.");
  }
  const texto = await resp.text();
  if (resp.status === 403) throw new IntimacaoErro("O Gmail recusou a leitura (HTTP 403): confira se a Gmail API está ativa e se a caixa autorizou gmail.readonly.", 403);
  if (!resp.ok) throw new IntimacaoErro(`O Gmail respondeu HTTP ${resp.status} ao ler a caixa.`, resp.status);
  return texto ? JSON.parse(texto) : {};
}

/** `messages.list` com a busca, até `maximo` ids (só leitura). */
export async function listarMensagensGmail(buscar: BuscarGmail, accessToken: string, consulta: string, maximo = 200): Promise<string[]> {
  const ids: string[] = [];
  let pagina: string | undefined;
  do {
    const p = new URLSearchParams({ q: consulta, maxResults: "100", ...(pagina ? { pageToken: pagina } : {}) });
    const j = (await getGmail(buscar, accessToken, `${URL_MENSAGENS}?${p}`)) as { messages?: { id: string }[]; nextPageToken?: string };
    ids.push(...(j.messages ?? []).map((m) => m.id));
    pagina = j.nextPageToken;
  } while (pagina && ids.length < maximo);
  return ids.slice(0, maximo);
}

/** `messages.get` com format=full (só leitura). */
export async function lerMensagemCompletaGmail(buscar: BuscarGmail, accessToken: string, id: string): Promise<MensagemGmail> {
  if (!/^[0-9a-zA-Z]+$/.test(id)) throw new IntimacaoErro(`Identificador de mensagem inválido: ${id}.`);
  return (await getGmail(buscar, accessToken, `${URL_MENSAGENS}/${id}?format=full`)) as MensagemGmail;
}

// ---------------------------------------------------------------- título no Contas a Pagar

/** Número do título comparável: só letras e dígitos, sem zeros à esquerda ("0921310" = "921310"; "24827-2" = "24827/2"). */
export const numeroComparavel = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");

/** Os campos de `LancamentoPagarApi` (consistem-pagar.ts, normalizarLancamentoPagar) que a escolha usa. */
export type TituloPagar = { codLancamento: string; tipo: string; numDocumento: string; vencimento: string | null; valorDocumentoCentavos: number; saldoCentavos: number };
export type Candidato = { titulo: TituloPagar; numeroConfere: boolean; valorConfere: boolean };

/**
 * Títulos (tipo C, em aberto) do credor que podem ser o da intimação, do mais provável ao menos. Sugere um só quando é o
 * ÚNICO com número E valor conferindo (ou o único com o número): na dúvida, a pessoa escolhe.
 */
export function casarTitulos(i: Pick<IntimacaoLida, "numeroTitulo" | "valorTitulo">, lista: readonly TituloPagar[]): { candidatos: Candidato[]; sugerido: string | null } {
  const numero = numeroComparavel(i.numeroTitulo);
  const valor = i.valorTitulo === null ? null : Math.round(i.valorTitulo * 100);
  const candidatos: Candidato[] = [];
  for (const t of lista) {
    if (t.tipo !== "C" || t.saldoCentavos <= 0) continue;
    const doc = numeroComparavel(t.numDocumento);
    // Igual, ou um começa pelo outro (parcela "/1" no Consistem) quando os dois têm 4 ou mais caracteres.
    const numeroConfere = numero !== "" && doc !== "" &&
      (doc === numero || (Math.min(doc.length, numero.length) >= 4 && (doc.startsWith(numero) || numero.startsWith(doc))));
    const valorConfere = valor !== null && (t.saldoCentavos === valor || t.valorDocumentoCentavos === valor);
    if (numeroConfere || valorConfere) candidatos.push({ titulo: t, numeroConfere, valorConfere });
  }
  candidatos.sort((a, b) => Number(b.numeroConfere) * 2 + Number(b.valorConfere) - (Number(a.numeroConfere) * 2 + Number(a.valorConfere)));
  const ambos = candidatos.filter((c) => c.numeroConfere && c.valorConfere);
  const soNumero = candidatos.filter((c) => c.numeroConfere);
  const sugerido = ambos.length === 1 ? ambos[0].titulo.codLancamento : ambos.length === 0 && soNumero.length === 1 ? soNumero[0].titulo.codLancamento : null;
  return { candidatos, sugerido };
}

/** Janela de vencimento da busca no Consistem: o vencimento do título ± `dias` (o título pode ter sido prorrogado). */
export function janelaVencimento(vencimento: string, dias = 120): { ini: string; fim: string } {
  const somar = (n: number) => { const d = new Date(`${vencimento}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return { ini: somar(-dias), fim: somar(dias) };
}

// ---------------------------------------------------------------- vencimento no Consistem

export type ResultadoVencimento =
  | { ok: true; jaEstava: boolean; antes: Record<string, unknown>; depois: Record<string, unknown>; resposta: unknown }
  | { ok: false; mensagem: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; resposta: unknown };

/**
 * O Consistem visto pela alteração de vencimento. Em produção (fin-intimacoes-consistem) e nos testes é ligado às rotinas
 * das correções do Cartão: lerDetalhe = GET lancamentoContasPagar/{id} (buscarObjeto); alterar = PUT lancamentoContasPagar/{id}
 * só com o corpo dado (alterarTitulo); jaAlterado, complementoLongo (complementoCabeNaAlteracao) e conferir (conferirAlteracao).
 * Não há porta de inclusão: o agente não cria lançamento.
 */
export type PortaConsistem = {
  lerDetalhe: (codLancamento: string) => Promise<Record<string, unknown>>;
  alterar: (codLancamento: string, corpo: { dataVencimento: string }) => Promise<
    { tipo: "ok"; resposta: unknown } | { tipo: "erro"; mensagem: string; resposta: unknown } | { tipo: "incerto"; mensagem: string; resposta: unknown }>;
  jaAlterado: (d: Record<string, unknown>, esperado: Record<string, unknown>) => boolean;
  complementoLongo: (d: Record<string, unknown>) => string | null;
  conferir: (antes: Record<string, unknown>, depois: Record<string, unknown>, esperado: Record<string, unknown>) => { ok: true } | { ok: false; mensagem: string };
};

/**
 * Altera SÓ a data de vencimento do título (a mesma rotina das correções do Cartão, migration 0176, já usada em produção):
 * lê o título (antes) → recusa o que não for título em aberto → altera com { dataVencimento } → lê de novo (depois) → confere
 * que o vencimento mudou e que TODO o resto (valor inclusive) ficou igual. Uma escrita, sem repetir sozinho: erro ou dúvida
 * vira revisão, com o antes e o depois guardados.
 */
export async function alterarVencimentoNoConsistem(c: PortaConsistem, codLancamento: string, novaData: string): Promise<ResultadoVencimento> {
  if (!/^\d{1,12}$/.test(codLancamento)) return { ok: false, mensagem: `Código de lançamento inválido: ${codLancamento}.`, antes: null, depois: null, resposta: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) return { ok: false, mensagem: `Data inválida: ${novaData}.`, antes: null, depois: null, resposta: null };
  const detalhe = () => c.lerDetalhe(codLancamento);
  const alteracao = { dataVencimento: novaData };

  let antes: Record<string, unknown>;
  try {
    antes = await detalhe();
  } catch (e) {
    return { ok: false, mensagem: `Não foi possível ler o lançamento ${codLancamento} no Consistem: ${(e as Error).message}. Nada foi alterado.`, antes: null, depois: null, resposta: null };
  }
  if (String(antes.tipoLancamento ?? "").toUpperCase() !== "C") {
    return { ok: false, mensagem: `O lançamento ${codLancamento} não é um título a pagar (tipo ${String(antes.tipoLancamento ?? "?")}). Nada foi alterado.`, antes, depois: null, resposta: null };
  }
  if (String(antes.dataPagamento ?? "").trim() !== "") {
    return { ok: false, mensagem: `O título ${codLancamento} já tem data de pagamento (${String(antes.dataPagamento)}). Nada foi alterado.`, antes, depois: null, resposta: null };
  }
  if (c.jaAlterado(antes, alteracao)) return { ok: true, jaEstava: true, antes, depois: antes, resposta: null };
  const longo = c.complementoLongo(antes);
  if (longo) return { ok: false, mensagem: longo, antes, depois: null, resposta: null };

  const r = await c.alterar(codLancamento, alteracao);
  if (r.tipo === "erro") return { ok: false, mensagem: r.mensagem, antes, depois: null, resposta: r.resposta ?? null };
  let depois: Record<string, unknown> | null = null;
  try { depois = await detalhe(); } catch { /* fica sem conferência */ }
  if (!depois) {
    const inicio = r.tipo === "incerto" ? r.mensagem : "O Consistem aceitou a alteração";
    return { ok: false, mensagem: `${inicio}, mas não foi possível ler o lançamento ${codLancamento} depois: confira no Consistem.`, antes, depois: null, resposta: r.resposta ?? null };
  }
  const conf = c.conferir(antes, depois, alteracao);
  if (!conf.ok) return { ok: false, mensagem: conf.mensagem, antes, depois, resposta: r.resposta ?? null };
  return { ok: true, jaEstava: false, antes, depois, resposta: r.resposta ?? null };
}
