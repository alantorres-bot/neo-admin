// Cálculo do VT de uma pessoa no mês (docs/modulos/rh-vale-transporte.md, regras 2 e 3). Espelho EXATO da função SQL
// rh_vt_calcular_item (migration 0502): o banco grava o valor; esta conta só mostra na tela antes de salvar.
import { diasUteisDoPeriodoNoMes } from "@/lib/modulos/rh/calendario";

export type EntradaCalculo = {
  competencia: string;          // 1º dia do mês do VT
  dias_uteis: number;
  faltas: number;               // do mês que fecha
  atestados: number;            // do mês que fecha; desconta como falta
  extras: number;               // do mês que fecha
  ferias_inicio: string | null; // período; conta só o que cai no mês do VT
  ferias_fim: string | null;
  afastamento_inicio: string | null;
  afastamento_fim: string | null;
  abat_dias: number;
  abat_valor: number;           // R$
  sem_vt: boolean;
  tarifa: number | null;
  valor_fixo: number | null;
  passagens_dia: number;
};

export type ResultadoCalculo = { dias_ferias: number; dias_afastamento: number; dias_pagos: number; valor: number };

const centavos = (v: number) => Math.round(v * 100);

export function calcularItem(e: EntradaCalculo): ResultadoCalculo {
  const dias_ferias = diasUteisDoPeriodoNoMes(e.ferias_inicio, e.ferias_fim, e.competencia);
  const dias_afastamento = diasUteisDoPeriodoNoMes(e.afastamento_inicio, e.afastamento_fim, e.competencia);
  if (e.sem_vt) return { dias_ferias, dias_afastamento, dias_pagos: 0, valor: 0 };
  const dias_pagos = Math.max(0, e.dias_uteis - e.faltas - e.atestados - dias_ferias - dias_afastamento - e.abat_dias + e.extras);
  let brutoCentavos: number;
  if (e.valor_fixo !== null) {
    brutoCentavos = e.dias_uteis > 0 ? Math.round((centavos(e.valor_fixo) * dias_pagos) / e.dias_uteis) : 0;
  } else {
    brutoCentavos = dias_pagos * e.passagens_dia * centavos(e.tarifa ?? 0);
  }
  return { dias_ferias, dias_afastamento, dias_pagos, valor: Math.max(0, brutoCentavos - centavos(e.abat_valor)) / 100 };
}
