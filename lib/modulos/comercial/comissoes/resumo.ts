// Comercial / Comissões: totais por mês e por representante (painel e extrato do ano). Puro; valores em centavos.

export type Totais = { total: number; antecipado: number; saldo: number };
export type FechamentoResumo = { id: string; competencia: string; status: "em_conferencia" | "fechado"; historico: boolean; fechado_em: string | null };
export type LinhaResumo = { fechamento_id: string; cod_representante: string; origem: string; incluida: boolean; valor_comissao: number | string };
export type MesResumo = { fechamento: FechamentoResumo; porRepresentante: Record<string, Totais>; total: Totais };

const zero = (): Totais => ({ total: 0, antecipado: 0, saldo: 0 });
const centavos = (v: number | string) => Math.round(Number(v) * 100);

function somar(a: Totais, b: Totais): Totais {
  return { total: a.total + b.total, antecipado: a.antecipado + b.antecipado, saldo: a.saldo + b.saldo };
}

/**
 * Totais de cada fechamento do ano, por representante: comissão das linhas incluídas (menos antecipações), antecipações
 * incluídas e saldo (comissão − antecipado). Meses do mais recente para o mais antigo; o ano soma todos.
 */
export function resumirAno(fechamentos: FechamentoResumo[], linhas: LinhaResumo[], ano: number) {
  const doAno = fechamentos.filter((f) => Number(f.competencia.slice(0, 4)) === ano).sort((a, b) => b.competencia.localeCompare(a.competencia));
  const ids = new Set(doAno.map((f) => f.id));
  const porFechamento = new Map<string, Record<string, Totais>>();
  for (const l of linhas) {
    if (!ids.has(l.fechamento_id) || !l.incluida) continue;
    const mapa = porFechamento.get(l.fechamento_id) ?? {};
    const t = mapa[l.cod_representante] ?? zero();
    const v = centavos(l.valor_comissao);
    if (l.origem === "antecipacao") t.antecipado += v;
    else t.total += v;
    t.saldo = t.total - t.antecipado;
    mapa[l.cod_representante] = t;
    porFechamento.set(l.fechamento_id, mapa);
  }
  const meses: MesResumo[] = doAno.map((f) => {
    const porRepresentante = porFechamento.get(f.id) ?? {};
    return { fechamento: f, porRepresentante, total: Object.values(porRepresentante).reduce(somar, zero()) };
  });
  const porRepresentante: Record<string, Totais> = {};
  for (const m of meses) for (const [cod, t] of Object.entries(m.porRepresentante)) porRepresentante[cod] = somar(porRepresentante[cod] ?? zero(), t);
  return { meses, porRepresentante, total: meses.reduce((s, m) => somar(s, m.total), zero()) };
}
