import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { podeAutorizar, podeCancelar, podeRemoverItem, resumirItens, ROTULO_STATUS, situacaoDoItem, type StatusAutorizacao } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { ROTA_CONTAS_PAGAR, ROTULO_TIPO } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerAutorizacao, quandoEm, type LinhaItemAutorizacao } from "../../dados";
import { BotaoAutorizar, BotaoRemoverItem, DialogoCancelar } from "./componentes";

export const metadata: Metadata = { title: "Autorização de pagamento" };

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));
const COR_STATUS: Record<StatusAutorizacao, "default" | "secondary" | "outline" | "destructive"> = { rascunho: "outline", autorizada: "default", cancelada: "destructive" };

export default async function PaginaAutorizacao({ params }: PageProps<"/financeiro/contas-pagar/autorizacoes/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lido = await lerAutorizacao(supabase, id);
  if (!lido) notFound();
  const { autorizacao: a, itens } = lido;

  const papel = { podeOperar: temAcesso(sessao.acesso, "financeiro", "operador"), ehGestor: temAcesso(sessao.acesso, "financeiro", "gestor"), userId: sessao.userId };
  const resumo = resumirItens(itens.map((i) => ({ tipo: i.tipo, valorCentavos: centavos(i.valor), removido: i.removido_em !== null, baixadoConsistemEm: i.baixado_consistem_em })));
  const ativos = itens.filter((i) => i.removido_em === null);
  const titulos = ativos.filter((i) => i.tipo === "titulo");
  const antecipacoes = ativos.filter((i) => i.tipo === "antecipacao");
  const removidos = itens.filter((i) => i.removido_em !== null);
  const resumoTexto = `${resumo.titulos.quantidade} ${resumo.titulos.quantidade === 1 ? "título" : "títulos"} (${formatarMoeda(resumo.titulos.centavos)}) e ${resumo.antecipacoes.quantidade} ${resumo.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"} (${formatarMoeda(resumo.antecipacoes.centavos)}), total ${formatarMoeda(resumo.geral.centavos)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Autorização de pagamento nº {a.numero} <Badge variant={COR_STATUS[a.status]} className="ml-1 align-middle">{ROTULO_STATUS[a.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            {a.empresa_nome} · data {formatarData(a.data)} · montada por {a.criado_por_nome ?? "—"} em {quandoEm(a.criado_em)}
            {a.autorizada_em && <> · autorizada por {a.autorizada_por_nome ?? "—"} em {quandoEm(a.autorizada_em)}</>}
            {a.cancelada_em && <> · cancelada por {a.cancelada_por_nome ?? "—"} em {quandoEm(a.cancelada_em)}</>}
          </p>
          {a.observacao && <p className="mt-1 text-sm">{a.observacao}</p>}
          {a.motivo_cancelamento && <p className="mt-1 text-sm text-destructive">Motivo do cancelamento: {a.motivo_cancelamento}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" render={<Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes`} />}>Voltar ao histórico</Button>
          {podeAutorizar(a.status, papel) && <BotaoAutorizar id={a.id} numero={a.numero} resumo={resumoTexto} />}
          {podeCancelar(a.status, a.criado_por, papel) && a.status !== "cancelada" && <DialogoCancelar id={a.id} numero={a.numero} status={a.status} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Títulos</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.titulos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.titulos.quantidade} {resumo.titulos.quantidade === 1 ? "título" : "títulos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Antecipações</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.antecipacoes.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.antecipacoes.quantidade} {resumo.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Total autorizado</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.geral.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.geral.quantidade} {resumo.geral.quantidade === 1 ? "item" : "itens"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Baixados no Consistem</CardDescription><CardTitle className="text-xl tabular-nums">{a.status === "cancelada" ? "—" : `${resumo.baixados} de ${resumo.geral.quantidade}`}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">anotado pela atualização do Consistem</CardContent>
        </Card>
      </div>

      {a.status === "rascunho" && (
        <p className="rounded-lg border border-grade bg-marca-clara p-3 text-sm">
          Rascunho: {papel.ehGestor ? "confira os itens e clique em “Autorizar pagamento”." : "aguarda um gestor do Financeiro autorizar."} Itens ainda podem ser removidos.
        </p>
      )}

      <SecaoItens titulo="Títulos" lista={titulos} total={resumo.titulos.centavos} autorizacaoId={a.id} podeRemover={podeRemoverItem(a.status, papel)} />
      <SecaoItens titulo="Antecipações" lista={antecipacoes} total={resumo.antecipacoes.centavos} autorizacaoId={a.id} podeRemover={podeRemoverItem(a.status, papel)} />

      {removidos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-muted-foreground">Removidos do rascunho ({removidos.length})</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {removidos.map((i) => (
              <li key={i.id}>{ROTULO_TIPO[i.tipo]} · {i.fornecedor_nome} · {i.num_documento || i.cod_lancamento} · {formatarMoeda(centavos(i.valor))} — {i.motivo_remocao ?? "sem motivo"}{i.removido_em ? ` (${quandoEm(i.removido_em)})` : ""}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SecaoItens({ titulo, lista, total, autorizacaoId, podeRemover }: { titulo: string; lista: LinhaItemAutorizacao[]; total: number; autorizacaoId: string; podeRemover: boolean }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold">{titulo}</h3>
        <span className="text-sm tabular-nums">{lista.length} {lista.length === 1 ? "item" : "itens"} · <strong>{formatarMoeda(total)}</strong></span>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>{titulo === "Antecipações" ? "Pagamento programado" : "Vencimento"}</TableHead>
                <TableHead>Histórico</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>No Consistem</TableHead>
                {podeRemover && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="max-w-72">
                    <span className="block truncate" title={i.fornecedor_nome}>{i.fornecedor_nome}</span>
                    <span className="block text-[11px] text-muted-foreground">{i.fornecedor_documento ?? `cód. ${i.cod_fornecedor ?? "—"}`}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">{i.num_documento || "—"}<span className="block text-[11px] text-muted-foreground">lanç. {i.cod_lancamento}</span></TableCell>
                  <TableCell className="tabular-nums">{formatarData(i.data_emissao) || "—"}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(i.tipo === "titulo" ? i.data_vencimento : i.data_pagamento) || "—"}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={i.complemento_historico ?? ""}>{i.complemento_historico || "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(centavos(i.valor))}</TableCell>
                  <TableCell className={i.baixado_consistem_em ? "text-emerald-700" : "text-muted-foreground"}>
                    {situacaoDoItem({ removido: false, baixadoConsistemEm: i.baixado_consistem_em, tipo: i.tipo })}{i.baixado_consistem_em ? ` em ${formatarData(i.baixado_consistem_em)}` : ""}
                  </TableCell>
                  {podeRemover && (
                    <TableCell className="text-right"><BotaoRemoverItem autorizacaoId={autorizacaoId} itemId={i.id} descricao={`${i.fornecedor_nome} · ${i.num_documento || i.cod_lancamento} · ${formatarMoeda(centavos(i.valor))}`} /></TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
