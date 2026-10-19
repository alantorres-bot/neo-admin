import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lerAutorizacao, quandoEm, type LinhaExtraAutorizacao, type LinhaItemAutorizacao } from "@/app/(plataforma)/financeiro/contas-pagar/dados";
import { compararComCaixa, resumirItens, ROTULO_STATUS } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { lerComposicaoGravada } from "@/lib/modulos/financeiro/contas-pagar/caixa";
import { MODULO_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoImprimir } from "./botao-imprimir";

export const metadata: Metadata = { title: "Relatório de autorização de pagamento" };

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));

/**
 * Relatório de autorização de pagamento para imprimir ou salvar em PDF (impressora virtual do navegador). Sem a moldura do
 * painel. Mostra o que foi autorizado: títulos e antecipações copiados no momento da autorização, com complemento do
 * histórico, pagamentos extras (fora do Consistem), subtotal por tipo e total geral; selo quando é rascunho ou foi cancelada.
 */
export default async function PaginaImprimirAutorizacao({ params }: PageProps<"/imprimir/contas-pagar/autorizacao/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_CONTAS_PAGAR);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const lido = await lerAutorizacao(await criarClienteServidor(), id);
  if (!lido) notFound();
  const { autorizacao: a, itens, extras } = lido;
  const ativos = itens.filter((i) => i.removido_em === null);
  const titulos = ativos.filter((i) => i.tipo === "titulo");
  const antecipacoes = ativos.filter((i) => i.tipo === "antecipacao");
  const extrasAtivos = extras.filter((x) => x.removido_em === null);
  const resumo = resumirItens(
    ativos.map((i) => ({ tipo: i.tipo, valorCentavos: centavos(i.valor), removido: false, baixadoConsistemEm: i.baixado_consistem_em })),
    extrasAtivos.map((x) => ({ valorCentavos: centavos(x.valor), removido: false })),
  );
  const caixa = compararComCaixa(resumo.geral.centavos, a.caixa_disponivel === null ? null : centavos(a.caixa_disponivel));
  const composicao = lerComposicaoGravada(a.caixa_composicao);
  const selo = a.status === "rascunho" ? "RASCUNHO — SEM VALIDADE" : a.status === "cancelada" ? `CANCELADA EM ${formatarData(a.cancelada_em ?? "")}` : null;

  return (
    <>
      <BotaoImprimir />
      <article className="relatorio">
        <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <p className="text-[15px] font-bold uppercase leading-tight">{a.empresa_razao_social}</p>
            <p className="text-[11px]">CNPJ {a.empresa_cnpj ?? "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold uppercase leading-tight">Autorização de pagamento {a.codigo}</p>
            <p className="text-[11px]">Data: {formatarData(a.data)} · Emitido em {quandoEm(new Date().toISOString())}</p>
            {selo && <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-[12px] font-bold tracking-wide">{selo}</p>}
          </div>
        </header>

        {a.observacao && <p className="mb-3 text-[12px]"><span className="font-bold">Observação:</span> {a.observacao}</p>}
        {a.motivo_cancelamento && <p className="mb-3 text-[12px]"><span className="font-bold">Motivo do cancelamento:</span> {a.motivo_cancelamento}</p>}

        <TabelaImpressa titulo="Títulos a pagar" lista={titulos} colunaData="Vencimento" subtotal={resumo.titulos.centavos} />
        <TabelaImpressa titulo="Antecipações a fornecedor" lista={antecipacoes} colunaData="Pagamento programado" subtotal={resumo.antecipacoes.centavos} />
        {extrasAtivos.length > 0 && <TabelaExtrasImpressa lista={extrasAtivos} subtotal={resumo.extras.centavos} />}

        <table className="mt-3 ml-auto w-[320px] border-collapse text-[12px]">
          <tbody>
            <tr><td className="py-0.5 pr-4">Subtotal títulos ({resumo.titulos.quantidade})</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(resumo.titulos.centavos)}</td></tr>
            <tr><td className="py-0.5 pr-4">Subtotal antecipações ({resumo.antecipacoes.quantidade})</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(resumo.antecipacoes.centavos)}</td></tr>
            {extrasAtivos.length > 0 && <tr><td className="py-0.5 pr-4">Subtotal pagamentos extras ({resumo.extras.quantidade})</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(resumo.extras.centavos)}</td></tr>}
            <tr className="border-t-2 border-black text-[13px] font-bold"><td className="py-1 pr-4">Total geral ({resumo.geral.quantidade} {resumo.geral.quantidade === 1 ? "item" : "itens"})</td><td className="py-1 text-right tabular-nums">{formatarMoeda(resumo.geral.centavos)}</td></tr>
            {caixa && (
              <>
                <tr className="border-t border-black"><td className="py-0.5 pr-4">Caixa disponível</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(caixa.caixaCentavos)}</td></tr>
                <tr><td className="py-0.5 pr-4">Total autorizado</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(resumo.geral.centavos)}</td></tr>
                <tr className="text-[13px] font-bold"><td className="py-1 pr-4">{caixa.ultrapassa ? "Excedente (acima do caixa)" : "Sobra de caixa"}</td><td className="py-1 text-right tabular-nums">{formatarMoeda(caixa.ultrapassa ? caixa.excedenteCentavos : caixa.sobraCentavos)}</td></tr>
              </>
            )}
          </tbody>
        </table>
        {caixa && composicao.length > 0 && (
          <section className="mt-3">
            <p className="mb-1 text-[12px] font-bold uppercase">Composição do caixa</p>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-0.5 pr-2">Descrição</th>
                  <th className="py-0.5 pr-2">Origem</th>
                  <th className="py-0.5 pr-2">Data do saldo</th>
                  <th className="py-0.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {composicao.map((l, n) => (
                  <tr key={n} className="border-b border-neutral-400">
                    <td className="py-0.5 pr-2">{l.descricao}</td>
                    <td className="py-0.5 pr-2">{l.tipo === "saldo" ? "Saldo conciliado" : "Adicional do dia"}</td>
                    <td className="py-0.5 pr-2 tabular-nums">{l.tipo === "saldo" ? (l.dataSaldo ? formatarData(l.dataSaldo) : "sem saldo") : "—"}</td>
                    <td className="py-0.5 text-right tabular-nums">{formatarMoeda(l.valorCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {caixa?.ultrapassa && (
          <p className="mt-2 border-2 border-black p-2 text-[12px] font-bold">O total autorizado ultrapassa o caixa disponível em {formatarMoeda(caixa.excedenteCentavos)}. Decidir quais itens deixar de pagar.</p>
        )}

        <footer className="mt-6 border-t border-black pt-2 text-[11px]">
          <p>Montada por {a.criado_por_nome ?? "—"} em {quandoEm(a.criado_em)}.</p>
          {a.autorizada_em && <p>Autorizada por {a.autorizada_por_nome ?? "—"} em {quandoEm(a.autorizada_em)}.</p>}
          {a.cancelada_em && <p>Cancelada por {a.cancelada_por_nome ?? "—"} em {quandoEm(a.cancelada_em)}.</p>}
          <p className="mt-1 text-[10px]">Situação: {ROTULO_STATUS[a.status]}. Relatório gerado pelo Neo Admin a partir dos lançamentos do Consistem copiados no momento da autorização. O pagamento e a baixa são feitos no Consistem.</p>
        </footer>
      </article>
    </>
  );
}

function TabelaExtrasImpressa({ lista, subtotal }: { lista: LinhaExtraAutorizacao[]; subtotal: number }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1 text-[13px] font-bold uppercase">Pagamentos extras — fora do Consistem <span className="font-normal normal-case">({lista.length})</span></h2>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2 font-bold">Descrição</th>
            <th className="py-1 pr-2 font-bold">Favorecido</th>
            <th className="py-1 text-right font-bold">Valor</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((x) => (
            <tr key={x.id} className="border-b border-gray-300 align-top">
              <td className="py-1 pr-2">{x.descricao}</td>
              <td className="py-1 pr-2">{x.favorecido}</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatarMoeda(centavos(x.valor))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={2} className="py-1 pr-2 text-right">Subtotal</td>
            <td className="py-1 text-right tabular-nums">{formatarMoeda(subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function TabelaImpressa({ titulo, lista, colunaData, subtotal }: { titulo: string; lista: LinhaItemAutorizacao[]; colunaData: string; subtotal: number }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1 text-[13px] font-bold uppercase">{titulo} <span className="font-normal normal-case">({lista.length})</span></h2>
      {lista.length === 0 ? (
        <p className="text-[11px] italic">Nenhum.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2 font-bold">Fornecedor</th>
              <th className="py-1 pr-2 font-bold">Documento</th>
              <th className="py-1 pr-2 font-bold">{colunaData}</th>
              <th className="py-1 pr-2 font-bold">Histórico</th>
              <th className="py-1 text-right font-bold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => (
              <tr key={i.id} className="border-b border-gray-300 align-top">
                <td className="py-1 pr-2">
                  <span className="block">{i.fornecedor_nome}</span>
                </td>
                <td className="py-1 pr-2 tabular-nums">
                  <span className="block">{i.num_documento || "—"}</span>
                </td>
                <td className="py-1 pr-2 tabular-nums">{formatarData(i.tipo === "titulo" ? i.data_vencimento : i.data_pagamento) || "—"}</td>
                <td className="py-1 pr-2">{i.complemento_historico || "—"}</td>
                <td className="py-1 text-right font-medium tabular-nums">{formatarMoeda(centavos(i.valor))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={4} className="py-1 pr-2 text-right">Subtotal</td>
              <td className="py-1 text-right tabular-nums">{formatarMoeda(subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
