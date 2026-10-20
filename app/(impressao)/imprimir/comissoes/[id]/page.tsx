import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerFechamento, ROTULO_ORIGEM, rotuloCompetencia } from "@/app/(plataforma)/financeiro/comissoes/dados";
import { MODULO_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Comissões do mês" };

const reais = (v: number | string) => formatarMoeda(Math.round(Number(v) * 100));
const perc = (v: number | string) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;

/** "COMISSÕES - <REPRESENTANTE>": uma folha por representante, só as linhas incluídas, total, antecipações e saldo a pagar. */
export default async function PaginaImprimirComissoes({ params }: PageProps<"/imprimir/comissoes/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COMISSOES);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES)) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dados = await lerFechamento(await criarClienteServidor(), id);
  if (!dados) notFound();
  const { fechamento: f, porRepresentante } = dados;
  const selo = f.status === "fechado" ? null : "PRÉVIA — FECHAMENTO EM CONFERÊNCIA";

  return (
    <>
      <BotaoImprimir />
      {porRepresentante.map(({ representante: r, linhas, total, antecipado, saldo }, i) => {
        const incluidas = linhas.filter((l) => l.incluida && l.origem !== "antecipacao");
        const antecipacoes = linhas.filter((l) => l.incluida && l.origem === "antecipacao");
        return (
          <article key={r.cod_representante} className="relatorio" style={i > 0 ? { breakBefore: "page" } : undefined}>
            <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
              <div>
                <p className="text-[16px] font-bold uppercase leading-tight">Comissões — {r.nome}</p>
                <p className="text-[12px]">Mês de referência: {rotuloCompetencia(f.competencia)} · Venda {perc(r.perc_venda)} · Locação {perc(r.perc_locacao)}</p>
              </div>
              <div className="text-right text-[11px]">
                {f.fechado_em && <p>Fechado em {formatarData(f.fechado_em)}</p>}
                {selo && <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-[12px] font-bold tracking-wide">{selo}</p>}
              </div>
            </header>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-1">Nº docto</th><th>Sacado</th><th>Dt. pagamento</th><th className="text-right">Vl. total</th><th>Tipo</th><th className="text-right">%</th><th className="text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {incluidas.map((l) => (
                  <tr key={l.id} className="border-b border-gray-300">
                    <td className="py-0.5 tabular-nums">{l.cod_titulo ?? ""}</td>
                    <td>{l.nome_cliente ?? l.cod_cliente ?? ""}{l.origem !== "titulo" ? ` (${ROTULO_ORIGEM[l.origem]}${l.observacao && l.origem === "manual" ? `: ${l.observacao}` : ""})` : ""}</td>
                    <td className="tabular-nums">{formatarData(l.data_pagamento)}</td>
                    <td className="text-right tabular-nums">{reais(l.valor_base)}</td>
                    <td>{l.tipo === "locacao" ? "Locação" : "Venda"}</td>
                    <td className="text-right tabular-nums">{perc(l.percentual)}</td>
                    <td className="text-right tabular-nums">{reais(l.valor_comissao)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-[12px]">
                <tr><td colSpan={6} className="pt-2 text-right font-bold">TOTAL DO MÊS</td><td className="pt-2 text-right font-bold tabular-nums">{formatarMoeda(total)}</td></tr>
                {antecipacoes.map((a) => (
                  <tr key={a.id}><td colSpan={6} className="text-right">{a.observacao ?? "Antecipação"}{a.data_pagamento ? ` - ${formatarData(a.data_pagamento)}` : ""}</td><td className="text-right tabular-nums">− {reais(a.valor_comissao)}</td></tr>
                ))}
                {antecipado > 0 && <tr><td colSpan={6} className="text-right">Antecipado</td><td className="text-right tabular-nums">− {formatarMoeda(antecipado)}</td></tr>}
                <tr><td colSpan={6} className="text-right font-bold">SALDO A PAGAR</td><td className="text-right font-bold tabular-nums">{formatarMoeda(saldo)}</td></tr>
              </tfoot>
            </table>
          </article>
        );
      })}
    </>
  );
}
