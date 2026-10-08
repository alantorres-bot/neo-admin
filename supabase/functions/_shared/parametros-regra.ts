// Parâmetros editáveis da regra de cobrança (tela Cobrança > Regra de cobrança). Regras puras, sem imports: este arquivo é usado
// pela Edge Function `rec-sincronizar-consistem` (Deno) e pelo app (Next), que carregam as linhas de `configuracoes` e passam para
// `lerParametrosRegra`. Valor ausente ou inválido cai no padrão (que é o comportamento de antes de a regra ser editável).

const BASE = "financeiro.recebiveis.";

/** Chaves de `configuracoes` que a tela edita (a função de banco `rec_salvar_regua` aceita só estas, com as mesmas faixas). */
export const CHAVES_REGRA = {
  esteira: `${BASE}esteira_a_partir_de`,
  regua: `${BASE}regua_a_partir_de`,
  minimo: `${BASE}confirmacao_valor_minimo`,
  janelaBoleto: `${BASE}janela_anexar_boleto_dias`,
  janelaConfirmacao: `${BASE}janela_confirmacao_dias`,
  prazoContato: `${BASE}prazo_contato_antes_dias`,
  trava: `${BASE}trava_pendencias_cobranca`,
} as const;

/** Quem alterou por último e quando (gravado pela função de banco; o gestor não lê a auditoria). */
export const CHAVE_ULTIMA_ALTERACAO_REGRA = `${BASE}regra_ultima_alteracao`;

export const TODAS_AS_CHAVES_REGRA: readonly string[] = [...Object.values(CHAVES_REGRA), CHAVE_ULTIMA_ALTERACAO_REGRA];

export type ParametrosRegra = {
  /** Títulos novos entram na esteira a partir desta data (aaaa-mm-dd); sem data, a esteira fica desligada. */
  esteiraAPartirDe: string | null;
  /** Vencimentos a partir desta data entram na régua de cobrança; sem data, a régua fica desligada. */
  reguaAPartirDe: string | null;
  /** Corte (em centavos) da soma das parcelas do cliente para abrir "Confirmar pagamento". */
  minimoConfirmacaoCentavos: number;
  /** "Anexar boleto" só vira tarefa a até N dias do vencimento. */
  janelaBoletoDias: number;
  /** "Confirmar pagamento" abre quando faltam até N dias para o vencimento. */
  janelaConfirmacaoDias: number;
  /** O prazo do contato de confirmação é o vencimento menos N dias. */
  prazoContatoAntesDias: number;
  /** Se uma rodada abrir mais que N cobranças novas, nenhuma é aberta (algo está errado na configuração). */
  travaPendenciasCobranca: number;
};

/** Faixas aceitas (o banco confere as mesmas). */
export const FAIXAS_REGRA = {
  janelaBoletoDias: { min: 1, max: 365 },
  janelaConfirmacaoDias: { min: 1, max: 60 },
  prazoContatoAntesDias: { min: 0, max: 30 },
  travaPendenciasCobranca: { min: 1, max: 500 },
  minimoConfirmacaoReais: { min: 0, max: 100_000_000 },
} as const;

export const PARAMETROS_PADRAO: ParametrosRegra = {
  esteiraAPartirDe: null,
  reguaAPartirDe: null,
  minimoConfirmacaoCentavos: 25_000_00,
  janelaBoletoDias: 30,
  janelaConfirmacaoDias: 7,
  prazoContatoAntesDias: 4,
  travaPendenciasCobranca: 40,
};

// Confere o calendário de verdade: `Date.parse` aceita "2026-02-31" e devolve 3 de março.
const ehDataIso = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function inteiroNaFaixa(v: unknown, faixa: { min: number; max: number }, padrao: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= faixa.min && n <= faixa.max ? n : padrao;
}

/** Monta os parâmetros a partir das linhas de `configuracoes` (`valor` é o jsonb já decodificado). */
export function lerParametrosRegra(linhas: readonly { chave: string; valor: unknown }[] | null | undefined): ParametrosRegra {
  const por = new Map((linhas ?? []).map((l) => [l.chave, l.valor]));
  const reais = por.get(CHAVES_REGRA.minimo);
  const minimoReais = typeof reais === "number" ? reais : typeof reais === "string" && reais.trim() !== "" ? Number(reais) : NaN;
  return {
    esteiraAPartirDe: ehDataIso(por.get(CHAVES_REGRA.esteira)) ? (por.get(CHAVES_REGRA.esteira) as string) : null,
    reguaAPartirDe: ehDataIso(por.get(CHAVES_REGRA.regua)) ? (por.get(CHAVES_REGRA.regua) as string) : null,
    minimoConfirmacaoCentavos:
      Number.isFinite(minimoReais) && minimoReais > 0 && minimoReais <= FAIXAS_REGRA.minimoConfirmacaoReais.max
        ? Math.round(minimoReais * 100)
        : PARAMETROS_PADRAO.minimoConfirmacaoCentavos,
    janelaBoletoDias: inteiroNaFaixa(por.get(CHAVES_REGRA.janelaBoleto), FAIXAS_REGRA.janelaBoletoDias, PARAMETROS_PADRAO.janelaBoletoDias),
    janelaConfirmacaoDias: inteiroNaFaixa(por.get(CHAVES_REGRA.janelaConfirmacao), FAIXAS_REGRA.janelaConfirmacaoDias, PARAMETROS_PADRAO.janelaConfirmacaoDias),
    prazoContatoAntesDias: inteiroNaFaixa(por.get(CHAVES_REGRA.prazoContato), FAIXAS_REGRA.prazoContatoAntesDias, PARAMETROS_PADRAO.prazoContatoAntesDias),
    travaPendenciasCobranca: inteiroNaFaixa(por.get(CHAVES_REGRA.trava), FAIXAS_REGRA.travaPendenciasCobranca, PARAMETROS_PADRAO.travaPendenciasCobranca),
  };
}

/** Quem alterou por último (`{ por, em }`), se houver. */
export function lerUltimaAlteracaoRegra(linhas: readonly { chave: string; valor: unknown }[] | null | undefined): { por: string; em: string } | null {
  const v = (linhas ?? []).find((l) => l.chave === CHAVE_ULTIMA_ALTERACAO_REGRA)?.valor;
  if (v && typeof v === "object" && typeof (v as { por?: unknown }).por === "string" && typeof (v as { em?: unknown }).em === "string") {
    return { por: (v as { por: string }).por, em: (v as { em: string }).em };
  }
  return null;
}
