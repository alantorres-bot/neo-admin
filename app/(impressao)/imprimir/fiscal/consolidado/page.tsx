import type { Metadata } from "next";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerConsolidado } from "@/app/(plataforma)/fiscal/creditos/consolidado/dados";
import { contexto, lerCadastros, lerFiltros, nomes } from "@/app/(plataforma)/fiscal/creditos/dados";
import type { Consolidado } from "@/lib/modulos/fiscal/creditos/apuracao";
import { dataHora, moeda } from "@/lib/modulos/fiscal/creditos/formatos";
import { AVISO_RESPONSABILIDADE } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";

export const metadata: Metadata = { title: "Consolidado anual (impressão)" };

const COLS: [string, (c: Consolidado) => number][] = [
  ["Saldo inicial", (c) => c.saldoInicial], ["Implantado", (c) => c.implantadoNoAno], ["Gerados", (c) => c.gerado], ["Reconhecidos", (c) => c.reconhecido],
  ["Ajustes", (c) => c.ajustesPositivos - c.ajustesNegativos], ["Utilizações", (c) => c.utilizado], ["Compensações", (c) => c.compensado],
  ["Ressarc./baixas", (c) => c.baixado], ["Transf.", (c) => c.transferidoEntrada - c.transferidoSaida], ["Saldo final", (c) => c.saldoFinal],
];

/** Versão para impressão (o navegador salva em PDF). Mesmos dados e filtros da tela. */
export default async function ImprimirConsolidado({ searchParams }: PageProps<"/imprimir/fiscal/consolidado">) {
  const { supabase, sessao } = await contexto();
  const f = lerFiltros(await searchParams, Number(hojeEmCuiaba().slice(0, 4)));
  const cad = await lerCadastros();
  const n = nomes(cad);
  const r = await lerConsolidado(supabase, f);
  const th = "border border-zinc-400 px-1 py-0.5 text-right font-bold";
  const td = "border border-zinc-300 px-1 py-0.5 text-right tabular-nums";
  return (
    <>
      <BotaoImprimir />
      <article className="flex flex-col gap-3 text-[10.5px] leading-snug">
        <header className="border-b-2 border-zinc-900 pb-2">
          <h1 className="text-[16px] font-bold">Fiscal Control — Consolidado do exercício {f.ano}</h1>
          <p>Emitido em {dataHora(new Date().toISOString())} por {sessao.perfil.nome}</p>
          <p>Empresa: {f.empresa ? n.empresa.get(f.empresa) : "todas do escopo"} · Estabelecimento: {f.estab ? n.estab.get(f.estab) : "todos"} · Tributo: {f.tributo ? n.tributo.get(f.tributo) : "todos"}</p>
        </header>
        <table className="w-full border-collapse">
          <thead><tr><th className={`${th} text-left`}>Tributo</th>{COLS.map(([c]) => <th key={c} className={th}>{c}</th>)}</tr></thead>
          <tbody>
            {r.porTributo.filter((g) => g.atual).map((g) => (
              <tr key={g.chave}><td className="border border-zinc-300 px-1 py-0.5">{n.tributo.get(g.chave)}</td>{COLS.map(([c, fn]) => <td key={c} className={td}>{moeda(fn(g.atual!))}</td>)}</tr>
            ))}
            {r.total && <tr className="font-bold"><td className="border border-zinc-400 px-1 py-0.5">Total</td>{COLS.map(([c, fn]) => <td key={c} className={td}>{moeda(fn(r.total!))}</td>)}</tr>}
          </tbody>
        </table>
        <h2 className="mt-2 text-[12px] font-bold">Por estabelecimento</h2>
        <table className="w-full border-collapse">
          <thead><tr><th className={`${th} text-left`}>Estabelecimento</th><th className={`${th} text-left`}>Tributo</th>{COLS.map(([c]) => <th key={c} className={th}>{c}</th>)}</tr></thead>
          <tbody>
            {r.porEstab.filter((g) => g.atual).map((g) => {
              const [e, t] = g.chave.split("|");
              return <tr key={g.chave}><td className="border border-zinc-300 px-1 py-0.5">{n.estab.get(e)}</td><td className="border border-zinc-300 px-1 py-0.5">{n.tributo.get(t)}</td>{COLS.map(([c, fn]) => <td key={c} className={td}>{moeda(fn(g.atual!))}</td>)}</tr>;
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[9px] text-zinc-600">{AVISO_RESPONSABILIDADE} Saldo final do exercício = saldo transportado para {f.ano + 1}.</p>
      </article>
    </>
  );
}
