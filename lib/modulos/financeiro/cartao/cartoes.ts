/**
 * Cartões de crédito — regras puras (sem rede, sem banco), portadas do motor `cartao.ts` do Neo Fiscal (docs/CARTAO.md lá).
 *
 * O Consistem não tem "forma de pagamento": o cartão só aparece no TEXTO do complemento do título, de forma irregular
 * ("CARTAO INTER - …", "CARTAO SICRED - …", "… - CARTÃO SICREDI 3 X"). O texto quase nunca diz PF/PJ; nesse caso o cartão
 * exato sai do VENCIMENTO do título (Inter PF vence 28 × PJ 10; Sicredi PF 10 × PJ 23).
 */

export interface CartaoInfo {
  /** Nome sem acento, em maiúsculas (ex.: "ITAU PJ"); chave de `crt_cartoes`. */
  codigo: string;
  /** Nome padronizado para o complemento (ex.: "ITAÚ PJ"). */
  nome: string;
  banco: string;
  tipoPessoa: "PF" | "PJ";
  diaFechamento: number;
  diaVencimento: number;
  tipoTitulo?: number | null;
}

/** Tamanho máximo do complemento do histórico no Contas a Pagar do Consistem. */
export const MAX_COMPLEMENTO = 70;

// ------------------------------------------------------------------ texto

/** Maiúsculas, sem acento, só letras/dígitos separados por um espaço. */
export function normalizarTexto(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** "Itaú pj" → "ITAU PJ" (o `codigo` do cartão). */
export const normalizarNomeCartao = normalizarTexto;

/** Distância de edição contando a troca de duas letras vizinhas como 1 erro ("CRATAO", "NUBNAK"). */
function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}

/** O token é a palavra CARTÃO? Aceita "CART", "CARTOES" e 1 erro de digitação com as 6 letras ("CRATAO", "CARTOA"; "CARTA" não). */
function ehMarcaCartao(token: string): boolean {
  if (token === "CART" || token === "CARTOES") return true;
  return token.length >= 6 && distancia(token, "CARTAO") <= 1;
}

/** O token escrito no título é o banco do cartão? Tolera abreviação ("SICRED") e 1 erro de grafia ("NUBANCK", "NUBNAK"). */
function mesmoBanco(token: string, banco: string): boolean {
  if (token === banco) return true;
  if (banco.length < 5 || token.length < 4) return false;
  if (banco.startsWith(token) && token.length >= banco.length - 2) return true;
  return distancia(token, banco) <= 1;
}

// ------------------------------------------------------------------ leitura do complemento

export interface LeituraComplemento {
  /** O texto cita um cartão (palavra CARTÃO + banco conhecido). */
  citaCartao: boolean;
  /** Só a palavra CARTÃO apareceu, sem banco reconhecido. */
  soMarca: boolean;
  /** Cartões possíveis (mesmo banco; se o texto traz PF/PJ, só esse tipo). */
  candidatos: CartaoInfo[];
  tipoPessoa?: "PF" | "PJ";
  /** Número de parcelas escrito no texto ("3 X", "10X"). */
  parcelas?: number;
}

/** Lê o complemento do título e diz que cartão (ou cartões) ele cita. */
export function lerComplemento(complemento: string, cartoes: readonly CartaoInfo[]): LeituraComplemento {
  const texto = normalizarTexto(complemento);
  const tokens = texto.split(" ").filter(Boolean);
  const marca = tokens.some(ehMarcaCartao);
  const parcelasM = /(?:^|\s)(\d{1,2})\s?X(?:\s|$)/.exec(texto);
  const parcelas = parcelasM ? Number(parcelasM[1]) : undefined;
  const pessoa = tokens.includes("PF") ? "PF" : tokens.includes("PJ") ? "PJ" : undefined;

  const bancos = [...new Set(cartoes.map((c) => normalizarTexto(c.banco)))];
  const citados = bancos.filter((b) => tokens.some((t) => mesmoBanco(t, b)));
  const daqueles = cartoes.filter((c) => citados.includes(normalizarTexto(c.banco)));
  const candidatos = pessoa ? daqueles.filter((c) => c.tipoPessoa === pessoa) : daqueles;

  const base: LeituraComplemento = { citaCartao: marca && candidatos.length > 0, soMarca: marca && candidatos.length === 0, candidatos: marca ? candidatos : [] };
  if (pessoa) base.tipoPessoa = pessoa;
  if (parcelas && parcelas >= 1) base.parcelas = parcelas;
  return base;
}

// ------------------------------------------------------------------ identificação do cartão do título

export interface IdentificacaoCartao {
  /** 'cartao' = identificado; 'ambiguo' = cita o banco mas não dá para saber qual; 'sem_cartao' = não é de cartão. */
  situacao: "cartao" | "ambiguo" | "sem_cartao";
  cartao?: CartaoInfo;
  candidatos: CartaoInfo[];
  parcelas?: number;
  /** Como foi decidido. */
  por?: "texto" | "vencimento";
  /** O vencimento do título bate com o dia de vencimento do cartão identificado. */
  vencimentoCoerente?: boolean;
  /** Só havia a palavra CARTÃO, sem banco. */
  soMarca?: boolean;
}

const diaDe = (iso: string) => Number(iso.slice(8, 10));

/**
 * Cartão de um título do Contas a Pagar a partir do complemento e do vencimento. Se o texto não diz PF/PJ e há mais de um
 * cartão do banco, desambigua pelo dia de vencimento.
 */
export function identificarCartaoDoTitulo(titulo: { complemento: string; vencimento?: string | null }, cartoes: readonly CartaoInfo[]): IdentificacaoCartao {
  const l = lerComplemento(titulo.complemento, cartoes);
  const parcelas = l.parcelas === undefined ? {} : { parcelas: l.parcelas };
  if (!l.citaCartao) return { situacao: "sem_cartao", candidatos: [], soMarca: l.soMarca, ...parcelas };

  const marcar = (cartao: CartaoInfo, por: "texto" | "vencimento"): IdentificacaoCartao => ({
    situacao: "cartao", cartao, candidatos: l.candidatos, por,
    ...(titulo.vencimento ? { vencimentoCoerente: diaDe(titulo.vencimento) === cartao.diaVencimento } : {}),
    ...parcelas,
  });

  if (l.candidatos.length === 1) return marcar(l.candidatos[0], "texto");
  if (titulo.vencimento) {
    const dia = diaDe(titulo.vencimento);
    const bate = l.candidatos.filter((c) => c.diaVencimento === dia);
    if (bate.length === 1) return marcar(bate[0], "vencimento");
  }
  return { situacao: "ambiguo", candidatos: l.candidatos, ...parcelas };
}

// ------------------------------------------------------------------ fatura do cartão

const pad = (n: number) => String(n).padStart(2, "0");
const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** Data ('AAAA-MM-DD') do dia `dia` no mês `mes` (1–12) de `ano`, limitado ao último dia do mês. */
function diaDoMes(ano: number, mes: number, dia: number): string {
  const a = ano + Math.floor((mes - 1) / 12);
  const m = ((((mes - 1) % 12) + 12) % 12) + 1;
  return `${a}-${pad(m)}-${pad(Math.min(dia, diasNoMes(a, m)))}`;
}

export interface FaturaDoCartao {
  /** Dia em que a fatura que recebe a compra fecha. */
  fechamento: string;
  /** Vencimento dessa fatura. */
  vencimento: string;
}

/**
 * Fatura em que cai uma compra feita em `compra` ('AAAA-MM-DD'): compra até o dia do fechamento (inclusive) entra na fatura
 * que fecha neste mês; depois dele, na seguinte. O vencimento é o primeiro `diaVencimento` depois do fechamento.
 */
export function faturaDaCompra(compra: string, c: Pick<CartaoInfo, "diaFechamento" | "diaVencimento">): FaturaDoCartao {
  const ano = Number(compra.slice(0, 4));
  const mes = Number(compra.slice(5, 7));
  let fechamento = diaDoMes(ano, mes, c.diaFechamento);
  if (compra > fechamento) fechamento = diaDoMes(ano, mes + 1, c.diaFechamento);
  const fAno = Number(fechamento.slice(0, 4));
  const fMes = Number(fechamento.slice(5, 7));
  let vencimento = diaDoMes(fAno, fMes, c.diaVencimento);
  if (vencimento <= fechamento) vencimento = diaDoMes(fAno, fMes + 1, c.diaVencimento);
  return { fechamento, vencimento };
}

/** Atalho: só o vencimento da fatura. */
export const vencimentoDaFatura = (compra: string, c: Pick<CartaoInfo, "diaFechamento" | "diaVencimento">) => faturaDaCompra(compra, c).vencimento;

/** Vencimento nominal (dia do cartão) da fatura seguinte a um vencimento dado: útil para "parcelas seguintes". */
export function vencimentoSeguinte(vencimento: string, c: Pick<CartaoInfo, "diaVencimento">, meses = 1): string {
  return diaDoMes(Number(vencimento.slice(0, 4)), Number(vencimento.slice(5, 7)) + meses, c.diaVencimento);
}

// ------------------------------------------------------------------ complemento padrão do POP

/**
 * Complemento no padrão do POP: `CARTÃO <NOME> <Nx> — <DESCRIÇÃO>` (até 70 caracteres, limite do campo; a descrição é cortada
 * se não couber).
 */
export function montarComplemento(cartao: Pick<CartaoInfo, "nome">, parcelas: number, descricao: string): string {
  const prefixo = `CARTÃO ${cartao.nome.toUpperCase()} ${Math.max(1, Math.floor(parcelas))}x`;
  const desc = descricao.replace(/\s+/g, " ").trim().toUpperCase();
  if (!desc) return prefixo;
  const completo = `${prefixo} — ${desc}`;
  return completo.length <= MAX_COMPLEMENTO ? completo : completo.slice(0, MAX_COMPLEMENTO).trimEnd();
}

// ------------------------------------------------------------------ regra fornecedor → cartão (do Neo Fiscal)

export interface RegraCartao {
  codFornecedor: string;
  cartao: string;
  parcelasPadrao: number;
  /** 'AAAA-MM-DD'. */
  vigenciaIni: string;
  /** 'AAAA-MM-DD' ou null (em aberto). */
  vigenciaFim: string | null;
}

/** Regra do fornecedor vigente numa data ('AAAA-MM-DD'); a de início mais recente vence se houver mais de uma. */
export function regraVigente(regras: readonly RegraCartao[], codFornecedor: string | null | undefined, data: string | null | undefined): RegraCartao | undefined {
  if (!codFornecedor || !data) return undefined;
  return regras
    .filter((r) => r.codFornecedor === codFornecedor && r.vigenciaIni <= data && (r.vigenciaFim === null || r.vigenciaFim >= data))
    .sort((a, b) => (a.vigenciaIni < b.vigenciaIni ? 1 : -1))[0];
}
