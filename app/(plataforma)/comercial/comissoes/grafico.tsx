"use client";

import { useState } from "react";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";

export type MesGrafico = { rotulo: string; nome: string; situacao: string; valores: Record<string, number> };
export type SerieGrafico = { cod: string; nome: string; cor: string };

/**
 * Comissão por mês do ano (antes das antecipações), barras empilhadas por representante. Passar o mouse, focar ou
 * clicar num mês mostra os valores dele na faixa de baixo. Cor por representante, na ordem fixa do cadastro.
 */
export function GraficoMensal({ meses, series, inicial }: { meses: MesGrafico[]; series: SerieGrafico[]; inicial: number }) {
  const [sel, setSel] = useState(inicial);
  const totalDe = (m: MesGrafico) => series.reduce((s, x) => s + (m.valores[x.cod] ?? 0), 0);
  const maior = Math.max(1, ...meses.map(totalDe));
  // Teto do eixo arredondado para cima em múltiplos de R$ 5 mil.
  const teto = Math.ceil(maior / 500_000) * 500_000;
  const ALTURA = 240;
  const altura = (v: number) => (v <= 0 ? 0 : Math.max(4, Math.round((v / teto) * ALTURA)));
  const atual = meses[sel];
  const mil = (c: number) => `R$ ${(c / 100_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        {series.map((s) => (
          <span key={s.cod} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.cor }} />{s.nome}</span>
        ))}
      </div>
      <div className="relative border-b" style={{ height: ALTURA }}>
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed" />
        <span aria-hidden className="absolute left-0 -top-2 bg-card pr-1 text-[11px] text-muted-foreground">{mil(teto)}</span>
        <span aria-hidden className="absolute left-0 top-[calc(50%-8px)] bg-card pr-1 text-[11px] text-muted-foreground">{mil(teto / 2)}</span>
        <div className="absolute inset-y-0 left-[72px] right-0 grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))` }}>
          {meses.map((m, i) => (
            <button key={m.rotulo} type="button" onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}
              aria-label={`${m.nome}: ${series.map((s) => `${s.nome} ${formatarMoeda(m.valores[s.cod] ?? 0)}`).join(", ")}`}
              className={`flex h-full flex-col-reverse justify-start gap-0.5 rounded-t-md ${i === sel ? "bg-primary/5" : ""}`}>
              {series.map((s, k) => {
                const v = m.valores[s.cod] ?? 0;
                const ultimo = series.slice(k + 1).every((x) => (m.valores[x.cod] ?? 0) <= 0);
                return v > 0 ? <span key={s.cod} className="block w-full" style={{ height: altura(v), background: s.cor, borderRadius: ultimo ? "4px 4px 0 0" : 0 }} /> : null;
              })}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-[72px] grid gap-2 text-center text-xs text-muted-foreground" style={{ gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))` }}>
        {meses.map((m, i) => <span key={m.rotulo} className={i === sel ? "font-bold text-foreground" : ""}>{m.rotulo}</span>)}
      </div>
      {atual && (
        <div aria-live="polite" className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-sm">
          <strong>{atual.nome}</strong>
          {series.map((s) => <span key={s.cod}>{s.nome.split(" ")[0]} <strong className="tabular-nums">{formatarMoeda(atual.valores[s.cod] ?? 0)}</strong></span>)}
          <span>Total <strong className="tabular-nums">{formatarMoeda(totalDe(atual))}</strong></span>
          <span className="text-muted-foreground">{atual.situacao}</span>
        </div>
      )}
    </div>
  );
}
