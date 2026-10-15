// Painel dos Recebíveis (regras puras): indicadores, aging com o cedido à AKF, previsão semanal de recebimento e maiores
// devedores. As linhas vêm da view `rec_vw_titulos` (faixa e dias de atraso já calculados no fuso de Cuiabá). Dinheiro em
// CENTAVOS. O aging e os totais reaproveitam `resumirCarteira`, para o Painel bater com a Carteira.
import { diferencaDias } from "@/lib/nucleo/fila";
import { emCentavos, FAIXAS_ABERTAS, ehFaixa, resumirCarteira, type Faixa, type LinhaResumo, type ResumoCarteira } from "./carteira";

export type LinhaPainel = LinhaResumo & {
  /** 'aaaa-mm-dd' */
  vencimento: string;
};

export type SemanaPrevisao = {
  /** Segunda-feira da semana ('aaaa-mm-dd'). */
  inicio: string;
  /** Domingo da semana. */
  fim: string;
  quantidade: number;
  /** A vencer que entra no caixa da Neo (título não cedido). */
  neoCentavos: number;
  /** A vencer cedido à AKF (inclusive o do cliente que paga à Neo e é repassado no dia seguinte: o dinheiro é da AKF). */
  akfCentavos: number;
};

export type Devedor = {
  contraparteId: string;
  quantidade: number;
  maiorAtraso: number;
  centavos: number;
  /** Algum título vencido do cliente está cedido à AKF. */
  cedido: boolean;
};

export type PainelRecebiveis = {
  resumo: ResumoCarteira;
  cedidoPorFaixa: Record<Faixa, number>;
  /** Vencido ÷ carteira (0 a 1); null sem carteira. */
  inadimplencia: number | null;
  /** Vencido há mais de 60 dias. */
  mais60Centavos: number;
  previsao: SemanaPrevisao[];
  devedores: Devedor[];
  /** Soma dos vencidos de todos os devedores (base do "parte do vencido"). */
  vencidoCentavos: number;
};

const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** Segunda-feira da semana da data ('aaaa-mm-dd'). */
export function segundaDaSemana(iso: string): string {
  const diaSemana = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(iso, -((diaSemana + 6) % 7));
}

/** Inadimplência = vencido ÷ carteira. */
export function inadimplencia(r: Pick<ResumoCarteira, "totalCentavos" | "vencido">): number | null {
  return r.totalCentavos > 0 ? r.vencido.centavos / r.totalCentavos : null;
}

/**
 * Monta o Painel a partir dos títulos em aberto (já filtrados por unidade e pelo "ocultar vencidos há mais de 90 dias").
 * `hoje` no fuso de Cuiabá. A previsão cobre `semanas` semanas a partir da semana de hoje, pelo vencimento dos títulos a vencer.
 */
export function montarPainel(linhas: readonly LinhaPainel[], hoje: string, opcoes: { semanas?: number; devedores?: number } = {}): PainelRecebiveis {
  const semanas = opcoes.semanas ?? 8;
  const resumo = resumirCarteira(linhas);
  const cedidoPorFaixa = Object.fromEntries(FAIXAS_ABERTAS.map((f) => [f, 0])) as Record<Faixa, number>;
  const primeira = segundaDaSemana(hoje);
  const previsao: SemanaPrevisao[] = Array.from({ length: semanas }, (_, i) => ({
    inicio: somarDias(primeira, i * 7), fim: somarDias(primeira, i * 7 + 6), quantidade: 0, neoCentavos: 0, akfCentavos: 0,
  }));
  const porCliente = new Map<string, Devedor>();
  let mais60Centavos = 0;

  for (const l of linhas) {
    if (!ehFaixa(l.faixa)) continue;
    const centavos = emCentavos(l.valor);
    if (l.cedido) cedidoPorFaixa[l.faixa] += centavos;
    if (l.faixa === "60_mais") mais60Centavos += centavos;
    if (l.faixa === "a_vencer") {
      const semana = Math.floor(diferencaDias(l.vencimento, primeira) / 7);
      const s = previsao[semana];
      if (s) {
        s.quantidade++;
        if (l.cedido) s.akfCentavos += centavos;
        else s.neoCentavos += centavos;
      }
      continue;
    }
    const d = porCliente.get(l.contraparte_id) ?? { contraparteId: l.contraparte_id, quantidade: 0, maiorAtraso: 0, centavos: 0, cedido: false };
    d.quantidade++;
    d.centavos += centavos;
    d.maiorAtraso = Math.max(d.maiorAtraso, l.dias_atraso ?? 0);
    d.cedido ||= !!l.cedido;
    porCliente.set(l.contraparte_id, d);
  }

  const devedores = [...porCliente.values()]
    .sort((a, b) => b.centavos - a.centavos || b.maiorAtraso - a.maiorAtraso)
    .slice(0, opcoes.devedores ?? 10);
  return { resumo, cedidoPorFaixa, inadimplencia: inadimplencia(resumo), mais60Centavos, previsao, devedores, vencidoCentavos: resumo.vencido.centavos };
}

export type LinhaPaga = { consistem_pago_em: string | null; consistem_valor_pago: number | string | null; valor: number | string };

/** Recebido desde `desde` (inclusive), pela data de pagamento vinda do Consistem; sem o valor pago, vale o valor do título. */
export function somarRecebido(linhas: readonly LinhaPaga[], desde: string): { quantidade: number; centavos: number } {
  let quantidade = 0;
  let centavos = 0;
  for (const l of linhas) {
    if (!l.consistem_pago_em || l.consistem_pago_em.slice(0, 10) < desde) continue;
    quantidade++;
    centavos += emCentavos(l.consistem_valor_pago ?? l.valor);
  }
  return { quantidade, centavos };
}

/** 0,534 → "53,4%". */
export function formatarPercentual(fracao: number | null): string {
  if (fracao === null) return "—";
  return `${(fracao * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** 4_578_058_28 centavos → "4,58 mi"; 459_755_82 → "460 mil". Rótulo curto das barras. */
export function formatarCurto(centavos: number): string {
  const reais = centavos / 100;
  if (reais >= 1e6) return `${(reais / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (reais >= 1e3) return `${Math.round(reais / 1e3).toLocaleString("pt-BR")} mil`;
  return reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
