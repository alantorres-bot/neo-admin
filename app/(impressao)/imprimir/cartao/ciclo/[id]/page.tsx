import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { conciliacaoDaRequisicao, lerCiclo, lerTrocas, quandoEm, type FechamentoLinha } from "@/app/(plataforma)/financeiro/cartao/dados";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { ROTULO_SITUACAO, rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ROTULO_DECISAO, type DecisaoItem, type ResultadoConciliacao } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { MODULO_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Relatório de conciliação do cartão" };

/**
 * Relatório do mês do cartão para imprimir ou salvar em PDF (Fase 3). Mês fechado ou pago: o resultado congelado no fechamento
 * (a prova). Em conciliação: o cálculo do momento, com o selo "SEM VALIDADE — MÊS NÃO FECHADO".
 */
export default async function PaginaImprimirCiclo({ params }: PageProps<"/imprimir/cartao/ciclo/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_CARTAO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await criarClienteServidor();
  const lido = await lerCiclo(supabase, id);
  if (!lido) notFound();
  const { ciclo, fechamentos } = lido;
  const { data: empresa } = await supabase.from("empresas").select("razao_social, cnpj").eq("id", ciclo.empresa_id).maybeSingle();

  const vigente: FechamentoLinha | null = fechamentos.find((f) => f.reaberto_em === null) ?? null;
  const fechado = (ciclo.situacao === "fechada" || ciclo.situacao === "paga") && vigente;
  const aoVivo = !fechado && ciclo.fatura_id ? await conciliacaoDaRequisicao(ciclo.fatura_id) : null;
  const r: ResultadoConciliacao | null = fechado ? vigente.resultado.resultado : aoVivo?.resultado ?? null;
  const decisoes: DecisaoItem[] = r?.decisoes ?? [];
  const selo = fechado ? null : "SEM VALIDADE — MÊS NÃO FECHADO";
  const trocas = fechado ? (await lerTrocas(supabase, ciclo)).trocas : [];
  const trocados = trocas.filter((t) => t.situacao === "trocado");

  return (
    <>
      <BotaoImprimir />
      <article className="relatorio">
        <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <p className="text-[15px] font-bold uppercase leading-tight">{empresa?.razao_social ?? ciclo.empresa_nome}</p>
            <p className="text-[11px]">CNPJ {empresa?.cnpj ?? "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold uppercase leading-tight">Conciliação da fatura {ciclo.cartao_nome} {rotuloCompetencia(ciclo.competencia)}</p>
            <p className="text-[11px]">Fechamento do cartão {formatarData(ciclo.fechamento)} · vencimento {formatarData(ciclo.vencimento_nominal)} · situação: {ROTULO_SITUACAO[ciclo.situacao]}</p>
            <p className="text-[11px]">Emitido em {quandoEm(new Date().toISOString())}</p>
            {selo && <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-[12px] font-bold tracking-wide">{selo}</p>}
          </div>
        </header>

        {!r ? (
          <p className="text-[12px] italic">A fatura deste mês ainda não foi importada.</p>
        ) : (
          <>
            <Secao titulo="Quadro de conciliação">
              <table className="w-[520px] border-collapse text-[11px]">
                <tbody>
                  {r.quadro.map((q) => (
                    <tr key={q.rotulo} className={q.destaque ? "border-t border-black font-bold" : ""}>
                      <td className="py-0.5 pr-4">{q.rotulo}</td><td className="whitespace-nowrap py-0.5 text-right tabular-nums">{formatarMoeda(q.centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px]">
                {r.contagens.linhas} linhas de despesa na fatura · {r.contagens.titulos} títulos do cartão · {r.contagens.conciliados} conciliados
                {r.contagens.manuais ? ` · ${r.contagens.manuais} casados à mão` : ""} · {r.contagens.agrupamentos} agrupados · {r.contagens.compensados} compensações ·
                {" "}{r.pendentes ?? r.aLancar.length} pendentes · leitura da fatura {r.integridadeOk ? "íntegra (soma = total)" : "DIVERGENTE"}
              </p>
            </Secao>

            <Secao titulo={`Itens da fatura sem título (${r.aLancar.length})`}>
              {r.aLancar.length === 0 ? <Nenhum /> : (
                <Tabela cabecalhos={["Data", "Descrição na fatura", "Natureza", "Categoria / conta", "Complemento sugerido", "Decisão", "Valor"]}
                  linhas={r.aLancar.map((a) => [formatarData(a.linha.dataCompra), a.linha.descricao, a.natureza, `${a.categoria} / ${a.contaFluxo}`, a.complementoSugerido,
                    textoDecisoes([a.justificativa, a.classificacao, ...(a.observacoes ?? [])]) || "PENDENTE", formatarMoeda(a.linha.valorCentavos)])} />
              )}
            </Secao>

            <Secao titulo={`Títulos sem linha na fatura (${r.divergencias.length})`}>
              {r.divergencias.length === 0 ? <Nenhum /> : (
                <Tabela cabecalhos={["Nº do título", "Fornecedor", "Vencimento", "Complemento", "Causa provável", "Decisão", "Valor"]}
                  linhas={r.divergencias.map((d) => [d.titulo.numeroTitulo, d.titulo.fornecedor, formatarData(d.titulo.vencimento), d.titulo.complemento, d.causa,
                    textoDecisoes([d.justificativa, ...(d.observacoes ?? [])]) || "—", formatarMoeda(d.titulo.valorCentavos)])} />
              )}
            </Secao>

            <Secao titulo={`Conciliados (${r.conciliados.length})`}>
              {r.conciliados.length === 0 ? <Nenhum /> : (
                <Tabela cabecalhos={["Data", "Descrição na fatura", "Nº do título", "Complemento do título", "Modo", "Valor"]}
                  linhas={r.conciliados.map((c) => [formatarData(c.linhas[0].dataCompra),
                    c.linhas.length > 1 ? `${c.linhas[0].descricao} (+${c.linhas.length - 1})` : c.linhas[0].descricao,
                    [c.titulo, ...(c.titulosExtras ?? [])].map((t) => t.numeroTitulo).join(", "), c.titulo.complemento,
                    c.modo === "Manual" ? `À mão: ${c.decisao?.motivo ?? ""}` : c.modo === "Arredondamento" ? `Arredondamento (${formatarMoeda(c.diferencaCentavos)})` : c.modo,
                    formatarMoeda(c.linhas.reduce((s, l) => s + l.valorCentavos, 0))])} />
              )}
            </Secao>

            {r.compensados.length > 0 && (
              <Secao titulo={`Compensados (${r.compensados.length})`}>
                <Tabela cabecalhos={["Débito", "Crédito", "Como", "Valor"]}
                  linhas={r.compensados.map((c) => [c.debito.descricao, c.credito.descricao, c.decisao ? `À mão: ${c.decisao.motivo ?? ""}` : "Automático", formatarMoeda(c.debito.valorCentavos)])} />
              </Secao>
            )}

            {decisoes.length > 0 && (
              <Secao titulo={`Decisões registradas (${decisoes.length})`}>
                <Tabela cabecalhos={["Tipo", "Motivo / detalhe", "Por", "Quando"]}
                  linhas={decisoes.map((d) => [ROTULO_DECISAO[d.tipo], d.tipo === "classificar" ? [d.categoria, d.contaFluxo].filter(Boolean).join(" / ") : d.motivo ?? "", d.autor ?? "", quandoEm(d.em)])} />
              </Secao>
            )}
          </>
        )}

        <footer className="mt-6 grid grid-cols-2 gap-6 border-t border-black pt-3 text-[11px]">
          <div>
            <p className="font-bold">Fechamento</p>
            {fechado
              ? <p>Versão {vigente.versao} · {quandoEm(vigente.fechado_em)}{vigente.fechado_por_nome ? ` · ${vigente.fechado_por_nome}` : ""}</p>
              : <p>Mês não fechado.</p>}
            {fechamentos.filter((f) => f.reaberto_em).map((f) => (
              <p key={f.id} className="text-[10px]">Versão {f.versao} reaberta em {quandoEm(f.reaberto_em!)}{f.reaberto_por_nome ? ` por ${f.reaberto_por_nome}` : ""}: {f.motivo_reabertura}</p>
            ))}
          </div>
          <div>
            <p className="font-bold">Pagamento</p>
            <p>{ciclo.paga_em ? `Paga em ${formatarData(ciclo.paga_em)} (título provisório ${ciclo.paga_por_cod_lancamento ?? ""} saiu do Consistem)` : "Não pago."}</p>
            {trocas.length > 0 && (
              <p>Marcas da fatura no Consistem: {trocados.length} de {trocas.length} {trocas.length === 1 ? "título" : "títulos"} com banco {trocas[0].portador_novo}{trocas[0].historico_novo ? ` e histórico ${trocas[0].historico_novo}` : ""}
                {trocados.length < trocas.length ? ` (com erro: ${trocas.filter((t) => t.situacao !== "trocado").map((t) => t.cod_lancamento).join(", ")})` : ""}.</p>
            )}
          </div>
        </footer>
      </article>
    </>
  );
}

function textoDecisoes(lista: (DecisaoItem | undefined)[]): string {
  return lista.filter((d): d is DecisaoItem => !!d)
    .map((d) => `${ROTULO_DECISAO[d.tipo]}: ${d.tipo === "classificar" ? [d.categoria, d.contaFluxo].filter(Boolean).join(" / ") : d.motivo ?? ""}${d.autor ? ` (${d.autor})` : ""}`)
    .join(" | ");
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 break-inside-avoid-page">
      <h2 className="mb-1 text-[13px] font-bold uppercase">{titulo}</h2>
      {children}
    </section>
  );
}

const Nenhum = () => <p className="text-[11px] italic">Nenhum.</p>;

function Tabela({ cabecalhos, linhas }: { cabecalhos: string[]; linhas: string[][] }) {
  return (
    <table className="w-full border-collapse text-[10.5px]">
      <thead>
        <tr className="border-b border-black text-left">
          {cabecalhos.map((c, i) => <th key={c} className={`py-1 pr-2 font-bold ${i === cabecalhos.length - 1 ? "text-right" : ""}`}>{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-b border-gray-300 align-top">
            {l.map((v, j) => <td key={j} className={`py-1 pr-2 ${j === l.length - 1 ? "whitespace-nowrap text-right font-medium tabular-nums" : ""}`}>{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
