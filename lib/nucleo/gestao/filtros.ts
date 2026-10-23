// Central de Gestão: leitura e montagem dos filtros da URL (/gestao?...). Tudo que vem da URL é validado aqui antes de
// chegar às funções do banco (`central_pendencias`, `central_resumo`, `central_equipe`); valor inválido é ignorado.

export type Visao = "gestao" | "minhas";

export const RECORTES = ["atrasadas", "hoje", "intervir", "aguarda_gestor", "bloqueadas", "distribuir"] as const;
export const SITUACOES = ["aberta", "em_andamento", "bloqueada", "aguarda_gestor", "concluida", "cancelada"] as const;
export const PRIORIDADES = ["critica", "alta", "normal"] as const;
export const DESTAQUES = ["intervir", "avaliar", "acompanhar", "normal"] as const;
export const ORIGENS = ["modulo", "manual"] as const;

export type Recorte = (typeof RECORTES)[number];
export type Situacao = (typeof SITUACOES)[number];

/** Chaves aceitas por `central_pendencias` (todas opcionais). */
export type FiltrosCentral = {
  area?: string;
  modulo?: string;
  responsavel?: string;           // uuid ou "sem"
  situacao?: Situacao;
  prioridade?: (typeof PRIORIDADES)[number];
  destaque?: (typeof DESTAQUES)[number];
  origem?: (typeof ORIGENS)[number];
  prazo_de?: string;              // aaaa-mm-dd
  prazo_ate?: string;
  busca?: string;
  recorte?: Recorte;
};

export type ParametrosUrl = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[a-z_]+(\.[a-z_-]+)?$/;

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const entre = <T extends string>(lista: readonly T[], v: string | undefined): T | undefined =>
  v !== undefined && (lista as readonly string[]).includes(v) ? (v as T) : undefined;
const dataValida = (v: string | undefined) => (v && DATA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined);

/** Escapa os curingas do ILIKE (% _ \): a busca é por texto literal. */
export function escaparBusca(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lê visão, filtros e página. Quem não é gestor fica sempre na visão "minhas" (a visão "gestao" só mostraria a ele as
 * próprias pendências, porque o banco filtra pelo nível; aqui se evita a confusão).
 */
export function lerFiltros(sp: ParametrosUrl, ehGestor: boolean): { visao: Visao; filtros: FiltrosCentral; pagina: number } {
  const visaoPedida = um(sp.visao);
  const visao: Visao = ehGestor && visaoPedida !== "minhas" ? "gestao" : "minhas";

  const filtros: FiltrosCentral = {};
  const area = um(sp.area);
  if (area && CODIGO.test(area) && !area.includes(".")) filtros.area = area;
  const modulo = um(sp.modulo);
  if (modulo && CODIGO.test(modulo)) filtros.modulo = modulo;
  const responsavel = um(sp.responsavel);
  if (responsavel === "sem" || (responsavel && UUID.test(responsavel))) filtros.responsavel = responsavel;
  const situacao = entre(SITUACOES, um(sp.situacao));
  if (situacao) filtros.situacao = situacao;
  const prioridade = entre(PRIORIDADES, um(sp.prioridade));
  if (prioridade) filtros.prioridade = prioridade;
  const destaque = entre(DESTAQUES, um(sp.destaque));
  if (destaque) filtros.destaque = destaque;
  const origem = entre(ORIGENS, um(sp.origem));
  if (origem) filtros.origem = origem;
  const de = dataValida(um(sp.prazo_de));
  if (de) filtros.prazo_de = de;
  const ate = dataValida(um(sp.prazo_ate));
  if (ate) filtros.prazo_ate = ate;
  const busca = um(sp.busca);
  if (busca) filtros.busca = busca.slice(0, 100);
  const recorte = entre(RECORTES, um(sp.recorte));
  if (recorte) filtros.recorte = recorte;

  const n = Number(um(sp.pagina));
  const pagina = Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
  return { visao, filtros, pagina };
}

/** Filtros no formato da função do banco (busca com curingas escapados). */
export function filtrosParaBanco(filtros: FiltrosCentral): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor) saida[chave] = chave === "busca" ? escaparBusca(valor) : valor;
  }
  return saida;
}

/** Endereço da Central com a visão e os filtros atuais, aplicando `mudancas` (undefined remove a chave). */
export function hrefCentral(visao: Visao, filtros: FiltrosCentral, mudancas: Partial<FiltrosCentral> & { pagina?: number } = {}): string {
  const params = new URLSearchParams();
  params.set("visao", visao);
  const juntos: Record<string, string | number | undefined> = { ...filtros, ...mudancas };
  for (const [chave, valor] of Object.entries(juntos)) {
    if (valor === undefined || valor === "") continue;
    if (chave === "pagina" && valor === 1) continue;
    params.set(chave, String(valor));
  }
  return `/gestao?${params.toString()}`;
}

/** Há algum filtro de cabeçalho aplicado (o recorte não conta: ele vem dos indicadores)? */
export function temFiltro(filtros: FiltrosCentral): boolean {
  return Object.entries(filtros).some(([chave, valor]) => chave !== "recorte" && Boolean(valor));
}
