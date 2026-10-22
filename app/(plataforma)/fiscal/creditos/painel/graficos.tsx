"use client";

// Gráficos do painel (SVG, sem biblioteca): linha mensal, barras agrupadas (2 séries) e barras horizontais (magnitude).
// Cores da paleta de referência validada (azul/laranja para as duas séries; azul para magnitude), com versão para o tema
// escuro. Toda marca tem dica ao passar o mouse/focar, e cada gráfico tem a tabela com os mesmos números.
import { useState } from "react";
import { moeda } from "@/lib/modulos/fiscal/creditos/formatos";

const ESTILO = `
.fc-viz { --s1: #2a78d6; --s2: #eb6834; --grade: #d9d8d4; --eixo: #52514e; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .fc-viz { --s1: #3987e5; --s2: #d95926; --grade: #3a3a38; --eixo: #c3c2b7; } }
:root[data-theme="dark"] .fc-viz, .dark .fc-viz { --s1: #3987e5; --s2: #d95926; --grade: #3a3a38; --eixo: #c3c2b7; }
`;

const curto = (c: number) => {
  const r = c / 100;
  const abs = Math.abs(r);
  if (abs >= 1_000_000) return `${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(r / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return r.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

function teto(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Ver os números (tabela)</summary>
      <table className="mt-1 w-full border-collapse text-left">
        <thead><tr>{cabecalho.map((c) => <th key={c} className="border-b px-1 py-0.5 font-medium">{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, k) => <td key={k} className={`border-b px-1 py-0.5 ${k > 0 ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

function Dica({ texto }: { texto: string | null }) {
  return <div aria-live="polite" className="min-h-5 text-xs text-muted-foreground">{texto ?? "Passe o mouse ou toque numa marca para ver o valor."}</div>;
}

export type PontoSerie = { rotulo: string; valores: number[] };

/** Linha mensal (uma série). Valores em centavos. */
export function GraficoLinha({ titulo, pontos }: { titulo: string; pontos: { rotulo: string; valor: number }[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 640, H = 220, E = 56, B = 24, T = 10;
  const max = teto(Math.max(...pontos.map((p) => p.valor), 0));
  const min = Math.min(0, ...pontos.map((p) => p.valor));
  const x = (i: number) => E + (i * (W - E - 10)) / Math.max(1, pontos.length - 1);
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min || 1);
  const d = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  return (
    <div className="fc-viz">
      <style>{ESTILO}</style>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={E} x2={W - 6} y1={y(min + (max - min) * f)} y2={y(min + (max - min) * f)} stroke="var(--grade)" strokeWidth={1} />
            <text x={E - 6} y={y(min + (max - min) * f) + 4} textAnchor="end" fontSize={11} fill="var(--eixo)">{curto(min + (max - min) * f)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />
        {pontos.map((p, i) => (
          <g key={p.rotulo}>
            <circle cx={x(i)} cy={y(p.valor)} r={sel === i ? 5 : 4} fill="var(--s1)" stroke="var(--background, #fff)" strokeWidth={2} />
            <rect x={x(i) - 18} y={T} width={36} height={H - T - B} fill="transparent" tabIndex={0}
              aria-label={`${p.rotulo}: ${moeda(p.valor)}`} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)} onMouseLeave={() => setSel(null)} />
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--eixo)" fontWeight={sel === i ? 700 : 400}>{p.rotulo}</text>
          </g>
        ))}
      </svg>
      <Dica texto={sel === null ? null : `${pontos[sel].rotulo}: ${moeda(pontos[sel].valor)}`} />
      <Tabela cabecalho={["Competência", "Saldo"]} linhas={pontos.map((p) => [p.rotulo, moeda(p.valor)])} />
    </div>
  );
}

/** Barras agrupadas de duas séries (ex.: gerados × utilizados). */
export function GraficoBarras2({ titulo, series, pontos }: { titulo: string; series: [string, string]; pontos: PontoSerie[] }) {
  const [sel, setSel] = useState<{ i: number; s: number } | null>(null);
  const W = 640, H = 220, E = 56, B = 24, T = 10;
  const max = teto(Math.max(0, ...pontos.flatMap((p) => p.valores)));
  const larguraGrupo = (W - E - 10) / Math.max(1, pontos.length);
  const barra = Math.max(4, Math.min(18, (larguraGrupo - 8) / 2 - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / max;
  const cor = ["var(--s1)", "var(--s2)"];
  return (
    <div className="fc-viz">
      <style>{ESTILO}</style>
      <div className="mb-1 flex gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        {series.map((s, k) => <span key={s} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: cor[k] }} />{s}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={E} x2={W - 6} y1={y(max * f)} y2={y(max * f)} stroke="var(--grade)" strokeWidth={1} />
            <text x={E - 6} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill="var(--eixo)">{curto(max * f)}</text>
          </g>
        ))}
        {pontos.map((p, i) => {
          const x0 = E + i * larguraGrupo + (larguraGrupo - (barra * 2 + 2)) / 2;
          return (
            <g key={p.rotulo}>
              {p.valores.map((v, s) => {
                const h = Math.max(0, H - B - y(v));
                const xs = x0 + s * (barra + 2);
                return (
                  <g key={s}>
                    {h > 0 && <path d={`M${xs},${H - B} V${H - B - h + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, barra / 2)},-${Math.min(4, h)} H${xs + barra - Math.min(4, barra / 2)} q${Math.min(4, barra / 2)},0 ${Math.min(4, barra / 2)},${Math.min(4, h)} V${H - B} Z`} fill={cor[s]} opacity={sel && sel.i !== i ? 0.55 : 1} />}
                    <rect x={xs - 1} y={T} width={barra + 2} height={H - T - B} fill="transparent" tabIndex={0} aria-label={`${p.rotulo}, ${series[s]}: ${moeda(v)}`}
                      onMouseEnter={() => setSel({ i, s })} onFocus={() => setSel({ i, s })} onClick={() => setSel({ i, s })} onMouseLeave={() => setSel(null)} />
                  </g>
                );
              })}
              <text x={E + i * larguraGrupo + larguraGrupo / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--eixo)">{p.rotulo}</text>
            </g>
          );
        })}
      </svg>
      <Dica texto={sel === null ? null : `${pontos[sel.i].rotulo} · ${series[sel.s]}: ${moeda(pontos[sel.i].valores[sel.s])}`} />
      <Tabela cabecalho={["Período", ...series]} linhas={pontos.map((p) => [p.rotulo, ...p.valores.map(moeda)])} />
    </div>
  );
}

/** Barras horizontais de magnitude (uma cor). `formato` = moeda (centavos) ou quantidade. */
export function GraficoHorizontal({ titulo, itens, formato = "moeda" }: { titulo: string; itens: { rotulo: string; valor: number }[]; formato?: "moeda" | "quantidade" }) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  const fmt = (v: number) => (formato === "moeda" ? moeda(v) : v.toLocaleString("pt-BR"));
  return (
    <div className="fc-viz" role="img" aria-label={titulo}>
      <style>{ESTILO}</style>
      <ul className="grid gap-1.5">
        {itens.map((i) => (
          <li key={i.rotulo} className="grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-2 text-xs" title={`${i.rotulo}: ${fmt(i.valor)}`}>
            <span className="truncate text-foreground">{i.rotulo}</span>
            <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (Math.abs(i.valor) / max) * 100)}%`, background: "var(--s1)", opacity: i.valor < 0 ? 0.5 : 1 }} />
            <span className="tabular-nums text-foreground">{fmt(i.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
