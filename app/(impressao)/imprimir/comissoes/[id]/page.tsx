import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerFechamento, rotuloCompetencia, type LinhaFechamento } from "@/app/(plataforma)/financeiro/comissoes/dados";
import { MODULO_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Comissões do mês" };

const reais = (v: number | string) => formatarMoeda(Math.round(Number(v) * 100));
const perc = (v: number | string) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
const centavos = (v: number | string) => Math.round(Number(v) * 100);
const fimDoMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Linha menor sob o sacado: código do cliente e de onde vem a comissão. */
function detalheDaLinha(l: LinhaFechamento, nomeRep: Map<string, string>, codRep: string) {
  const partes = [l.cod_cliente ? `Cód. ${l.cod_cliente}` : null];
  if (l.origem === "credito") partes.push("adiantamento de cliente (CCCCI010)");
  else if (l.origem === "manual") partes.push(`lançamento manual${l.observacao ? ` · ${l.observacao}` : ""}`);
  else if (l.cod_representante_venda && l.cod_representante_venda !== codRep) partes.push(`venda de ${nomeRep.get(l.cod_representante_venda) ?? l.cod_representante_venda}`);
  return partes.filter(Boolean).join(" · ");
}

/**
 * Relatório de comissão do representante (folha A4 aprovada em 20/10/2026): logo, mês, representante, resumo (total,
 * antecipado, saldo), lançamentos incluídos, totais, como foi calculado e assinaturas. Com ?rep=<código>, só o dele (o
 * que vai para ele); sem, uma folha por representante.
 */
export default async function PaginaImprimirComissoes({ params, searchParams }: PageProps<"/imprimir/comissoes/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COMISSOES);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES)) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dados = await lerFechamento(await criarClienteServidor(), id);
  if (!dados) notFound();
  const rep = (await searchParams).rep;
  const { fechamento: f, representantes } = dados;
  const porRepresentante = typeof rep === "string" ? dados.porRepresentante.filter((x) => x.representante.cod_representante === rep) : dados.porRepresentante;
  if (porRepresentante.length === 0) notFound();
  const nomeRep = new Map(representantes.map((r) => [r.cod_representante, r.nome]));
  const previa = f.status !== "fechado";
  const mes = rotuloCompetencia(f.competencia);
  // O título vira o nome do PDF ao imprimir: "Comissões Fernando Grassmann - 09-2026".
  const tituloPdf = `Comissões ${porRepresentante.length === 1 ? `${porRepresentante[0].representante.nome} - ` : ""}${f.competencia.slice(5, 7)}-${f.competencia.slice(0, 4)}`;

  return (
    <>
      <title>{tituloPdf}</title>
      <BotaoImprimir />
      {porRepresentante.map(({ representante: r, linhas, total, antecipado, saldo }, i) => {
        const incluidas = linhas.filter((l) => l.incluida && l.origem !== "antecipacao")
          .sort((a, b) => (a.data_pagamento ?? "").localeCompare(b.data_pagamento ?? "") || (a.cod_titulo ?? "").localeCompare(b.cod_titulo ?? ""));
        const antecipacoes = linhas.filter((l) => l.incluida && l.origem === "antecipacao");
        const base = incluidas.reduce((s, l) => s + centavos(l.valor_base), 0);
        const outros = r.recebe_de.filter((x) => x !== r.cod_representante).map((x) => nomeRep.get(x) ?? x);
        return (
          <article key={r.cod_representante} className="relatorio flex flex-col gap-4 text-[12px] leading-snug text-zinc-900" style={i > 0 ? { breakBefore: "page" } : undefined}>
            <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-3">
              <div className="flex flex-col gap-1.5">
                <Image src="/neo-formas-logo-horizontal.png" alt="Neo Formas para concreto" width={236} height={38} className="mb-2 h-[38px] w-auto" priority unoptimized />
                <h1 className="text-[22px] font-bold tracking-tight">Relatório de comissão</h1>
                <p className="text-[13px] text-zinc-700">
                  Mês de referência: <strong className="text-zinc-900">{mes}</strong> · parcelas pagas de {formatarData(f.competencia)} a {formatarData(fimDoMes(f.competencia))}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-right text-[11px] text-zinc-700">
                {previa
                  ? <span className="border-2 border-zinc-900 px-2 py-0.5 text-[11px] font-bold tracking-wide text-zinc-900">PRÉVIA — EM CONFERÊNCIA</span>
                  : <span>Fechado em {formatarData(f.fechado_em)}</span>}
                <span>Financeiro · Comissões</span>
                <span>Emitido em {formatarData(hojeEmCuiaba())}</span>
              </div>
            </header>

            <section className="flex items-end justify-between gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-zinc-600">Representante</span>
                <strong className="text-[18px]">{r.nome}</strong>
                <span className="text-[11px] text-zinc-700">Código {r.cod_representante} no Consistem{outros.length > 0 && ` · recebe também pelas vendas de ${outros.join(", ")}`}</span>
              </div>
              <div className="flex gap-2 text-[11px]">
                <span className="rounded border border-zinc-400 px-2 py-1">Venda <strong>{perc(r.perc_venda)}</strong></span>
                <span className="rounded border border-zinc-400 px-2 py-1">Locação <strong>{perc(r.perc_locacao)}</strong></span>
              </div>
            </section>

            <section className="grid grid-cols-3 gap-2.5">
              <div className="flex flex-col gap-0.5 rounded-md border border-zinc-300 px-3 py-2.5">
                <span className="text-[11px] text-zinc-600">Total do mês</span>
                <strong className="text-[16px] tabular-nums">{formatarMoeda(total)}</strong>
                <span className="text-[11px] text-zinc-600">{incluidas.length} lançamento(s) · base {formatarMoeda(base)}</span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-md border border-zinc-300 px-3 py-2.5">
                <span className="text-[11px] text-zinc-600">Antecipado</span>
                <strong className="text-[16px] tabular-nums">{formatarMoeda(antecipado)}</strong>
                <span className="text-[11px] text-zinc-600">{antecipacoes.length ? `${antecipacoes.length} antecipação(ões) no mês` : "Nenhuma antecipação no mês"}</span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-md border-2 border-zinc-900 bg-zinc-100 px-3 py-2.5">
                <span className="text-[11px] font-semibold">Saldo a pagar</span>
                <strong className="text-[19px] tabular-nums">{formatarMoeda(saldo)}</strong>
                <span className="text-[11px] text-zinc-700">Total do mês − antecipado</span>
              </div>
            </section>

            <section className="flex flex-col gap-1.5">
              <h2 className="text-[13px] font-bold">Lançamentos do mês</h2>
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-y border-zinc-900 text-left">
                    <th className="py-1.5 pr-1.5 font-semibold">Pagamento</th>
                    <th className="px-1.5 py-1.5 font-semibold">Nº docto</th>
                    <th className="px-1.5 py-1.5 font-semibold">Sacado</th>
                    <th className="px-1.5 py-1.5 font-semibold">NF</th>
                    <th className="px-1.5 py-1.5 font-semibold">Tipo</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold">Vl. base</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold">%</th>
                    <th className="py-1.5 pl-1.5 text-right font-semibold">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {incluidas.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-300 align-top">
                      <td className="whitespace-nowrap py-1.5 pr-1.5 tabular-nums">{formatarData(l.data_pagamento)}</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 font-medium tabular-nums">{l.cod_titulo ?? "—"}</td>
                      <td className="px-1.5 py-1.5">
                        <span className="block">{l.nome_cliente ?? (l.origem === "manual" ? "Lançamento manual" : "—")}</span>
                        <span className="block text-[11px] text-zinc-600">{detalheDaLinha(l, nomeRep, r.cod_representante)}</span>
                      </td>
                      <td className="px-1.5 py-1.5 tabular-nums">{l.nota_fiscal ?? "—"}</td>
                      <td className="px-1.5 py-1.5">{l.tipo === "locacao" ? "Locação" : "Venda"}</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{reais(l.valor_base)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{perc(l.percentual)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-1.5 text-right font-semibold tabular-nums">{reais(l.valor_comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totais fora do <tfoot>: na impressão o tfoot se repetiria em cada página. */}
              <div className="ml-auto flex w-full max-w-[420px] flex-col text-[12px]">
                <div className="flex justify-between gap-4 py-1"><span className="font-semibold">Total do mês</span><strong className="tabular-nums">{formatarMoeda(total)}</strong></div>
                {antecipacoes.map((a) => (
                  <div key={a.id} className="flex justify-between gap-4 py-0.5 text-zinc-700">
                    <span>(−) {a.observacao ?? "Antecipação de comissão"}{a.data_pagamento ? ` · ${formatarData(a.data_pagamento)}` : ""}</span>
                    <span className="tabular-nums">{reais(a.valor_comissao)}</span>
                  </div>
                ))}
                {antecipacoes.length === 0 && <div className="flex justify-between gap-4 py-0.5 text-zinc-700"><span>(−) Antecipações de comissão já pagas</span><span className="tabular-nums">{formatarMoeda(0)}</span></div>}
                <div className="mt-1 flex justify-between gap-4 border-t-2 border-zinc-900 pt-1.5 text-[13px] font-bold"><span>SALDO A PAGAR</span><span className="tabular-nums">{formatarMoeda(saldo)}</span></div>
              </div>
            </section>

            <section className="flex flex-col gap-1 rounded bg-zinc-100 px-3 py-2 text-[11px] text-zinc-700">
              <strong className="text-zinc-900">Como foi calculado</strong>
              <span>
                Comissão = valor da parcela paga no mês × percentual do tipo (venda ou locação). Não geram comissão as baixas por antecipação,
                devolução de cliente e perdas. Adiantamento de cliente (crédito da CCCCI010) gera comissão no mês em que entrou.
              </span>
            </section>

            <section className="mt-6 grid grid-cols-2 gap-10" style={{ breakInside: "avoid" }}>
              <div className="flex flex-col gap-1 pt-8">
                <span className="border-t border-zinc-900 pt-1.5 text-[11px] font-semibold">Conferido por — Financeiro</span>
                <span className="text-[11px] text-zinc-600">Nome e data: ____________________</span>
              </div>
              <div className="flex flex-col gap-1 pt-8">
                <span className="border-t border-zinc-900 pt-1.5 text-[11px] font-semibold">Ciente — {r.nome}</span>
                <span className="text-[11px] text-zinc-600">Data: ____/____/________</span>
              </div>
            </section>

            <footer className="flex justify-between gap-4 border-t border-zinc-300 pt-2 text-[11px] text-zinc-600">
              <span>Neo Admin · Comissões · fechamento de {mes}</span>
              <span>{r.nome}</span>
            </footer>
          </article>
        );
      })}
    </>
  );
}
