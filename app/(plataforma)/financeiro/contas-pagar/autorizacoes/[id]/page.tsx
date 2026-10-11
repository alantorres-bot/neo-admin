import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer } from "lucide-react";
import { compararComCaixa, mensagemSlack, podeAutorizar, podeCancelar, podeEditarExtras, podeRemoverItem, resumirItens, ROTULO_STATUS, rotaImpressao, situacaoDoItem, type StatusAutorizacao } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { CHAVES_CONTAS_PAGAR, lerParametrosContasPagar } from "@/lib/modulos/financeiro/contas-pagar/parametros";
import { ROTA_CONTAS_PAGAR, ROTULO_TIPO } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerAutorizacao, quandoEm, type LinhaExtraAutorizacao, type LinhaItemAutorizacao } from "../../dados";
import { AnexarAssinada, BotaoAutorizar, BotaoEnviarSlack, BotaoRemoverExtra, BotaoRemoverItem, DialogoCaixa, DialogoCancelar, DialogoExtraAutorizacao } from "./componentes";

export const metadata: Metadata = { title: "Autorização de pagamento" };

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));
const COR_STATUS: Record<StatusAutorizacao, "default" | "secondary" | "outline" | "destructive"> = { rascunho: "outline", autorizada: "default", cancelada: "destructive" };

export default async function PaginaAutorizacao({ params }: PageProps<"/financeiro/contas-pagar/autorizacoes/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const [lido, { data: configs }, cabecalhos] = await Promise.all([
    lerAutorizacao(supabase, id),
    supabase.from("configuracoes").select("chave, valor").in("chave", [...CHAVES_CONTAS_PAGAR]),
    headers(),
  ]);
  if (!lido) notFound();
  const parametrosModulo = lerParametrosContasPagar((configs ?? []) as { chave: string; valor: unknown }[]);
  // Link absoluto da autorização para a mensagem (host e protocolo da própria requisição).
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host") ?? "localhost:3000";
  const protocolo = cabecalhos.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const { autorizacao: a, itens, extras, anexos } = lido;

  const papel = { podeOperar: temAcesso(sessao.acesso, "financeiro", "operador"), ehGestor: temAcesso(sessao.acesso, "financeiro", "gestor"), userId: sessao.userId };
  const resumo = resumirItens(
    itens.map((i) => ({ tipo: i.tipo, valorCentavos: centavos(i.valor), removido: i.removido_em !== null, baixadoConsistemEm: i.baixado_consistem_em })),
    extras.map((x) => ({ valorCentavos: centavos(x.valor), removido: x.removido_em !== null })),
  );
  const ativos = itens.filter((i) => i.removido_em === null);
  const extrasAtivos = extras.filter((x) => x.removido_em === null);
  const extrasRemovidos = extras.filter((x) => x.removido_em !== null);
  const titulos = ativos.filter((i) => i.tipo === "titulo");
  const antecipacoes = ativos.filter((i) => i.tipo === "antecipacao");
  const removidos = itens.filter((i) => i.removido_em !== null);
  const caixaCentavos = a.caixa_disponivel === null ? null : centavos(a.caixa_disponivel);
  const caixa = compararComCaixa(resumo.geral.centavos, caixaCentavos);
  const textoSlack = mensagemSlack({
    codigo: a.codigo, data: formatarData(a.data), empresa: a.empresa_nome, status: a.status, titulos: resumo.titulos, antecipacoes: resumo.antecipacoes, extras: resumo.extras,
    totalCentavos: resumo.geral.centavos, caixa, autorizadaPor: a.autorizada_por_nome, observacao: a.observacao, link: `${protocolo}://${host}${ROTA_CONTAS_PAGAR}/autorizacoes/${a.id}`,
  });
  const resumoTexto = `${resumo.titulos.quantidade} ${resumo.titulos.quantidade === 1 ? "título" : "títulos"} (${formatarMoeda(resumo.titulos.centavos)}) e ${resumo.antecipacoes.quantidade} ${resumo.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"} (${formatarMoeda(resumo.antecipacoes.centavos)})${resumo.extras.quantidade > 0 ? ` e ${resumo.extras.quantidade} ${resumo.extras.quantidade === 1 ? "pagamento extra" : "pagamentos extras"} (${formatarMoeda(resumo.extras.centavos)})` : ""}, total ${formatarMoeda(resumo.geral.centavos)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Autorização de pagamento {a.codigo} <Badge variant={COR_STATUS[a.status]} className="ml-1 align-middle">{ROTULO_STATUS[a.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            {a.empresa_nome} · data {formatarData(a.data)} · montada por {a.criado_por_nome ?? "—"} em {quandoEm(a.criado_em)}
            {a.autorizada_em && <> · autorizada por {a.autorizada_por_nome ?? "—"} em {quandoEm(a.autorizada_em)}</>}
            {a.cancelada_em && <> · cancelada por {a.cancelada_por_nome ?? "—"} em {quandoEm(a.cancelada_em)}</>}
            {a.slack_retirada_em && <> · retirada do Slack em {quandoEm(a.slack_retirada_em)}</>}
            {a.slack_enviada_em && !a.slack_retirada_em && <> · enviada no Slack por {a.slack_enviada_por_nome ?? "—"} em {quandoEm(a.slack_enviada_em)}{a.slack_permalink ? <> (<a href={a.slack_permalink} target="_blank" rel="noopener" className="text-elo hover:underline">ver mensagem</a>)</> : null}</>}
          </p>
          {a.observacao && <p className="mt-1 text-sm">{a.observacao}</p>}
          {a.motivo_cancelamento && <p className="mt-1 text-sm text-destructive">Motivo do cancelamento: {a.motivo_cancelamento}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" render={<Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes`} />}>Voltar ao histórico</Button>
          <Button variant="outline" render={<a href={rotaImpressao(a.id)} target="_blank" rel="noopener" />}><Printer /> Imprimir / salvar PDF</Button>
          {a.status !== "cancelada" && <BotaoEnviarSlack id={a.id} codigo={a.codigo} mensagem={textoSlack} canalUrl={parametrosModulo.slackCanalUrl} ehGestor={papel.ehGestor} jaEnviadaEm={a.slack_enviada_em ? quandoEm(a.slack_enviada_em) : null} />}
          {papel.podeOperar && a.status !== "rascunho" && <AnexarAssinada autorizacaoId={a.id} temAnexo={anexos.length > 0} />}
          {podeAutorizar(a.status, papel) && <BotaoAutorizar id={a.id} codigo={a.codigo} resumo={resumoTexto} />}
          {podeCancelar(a.status, a.criado_por, papel) && a.status !== "cancelada" && <DialogoCancelar id={a.id} codigo={a.codigo} status={a.status} enviadaSlack={Boolean(a.slack_enviada_em && !a.slack_retirada_em)} />}
          {a.status === "rascunho" && papel.podeOperar && <DialogoCaixa id={a.id} caixaCentavos={caixaCentavos} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card size="sm">
          <CardHeader><CardDescription>Títulos</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.titulos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.titulos.quantidade} {resumo.titulos.quantidade === 1 ? "título" : "títulos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Antecipações</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.antecipacoes.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.antecipacoes.quantidade} {resumo.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Pagamentos extras</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.extras.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.extras.quantidade === 0 ? "nenhum (fora do Consistem)" : `${resumo.extras.quantidade} fora do Consistem`}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Total autorizado</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.geral.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.geral.quantidade} {resumo.geral.quantidade === 1 ? "item" : "itens"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Baixados no Consistem</CardDescription><CardTitle className="text-xl tabular-nums">{a.status === "cancelada" ? "—" : `${resumo.baixados} de ${resumo.lancamentos.quantidade}`}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">anotado pela atualização do Consistem</CardContent>
        </Card>
      </div>

      {caixa && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="sm">
            <CardHeader><CardDescription>Caixa disponível</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(caixa.caixaCentavos)}</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">informado ao montar a autorização</CardContent>
          </Card>
          <Card size="sm">
            <CardHeader><CardDescription>{caixa.ultrapassa ? "Excedente" : "Sobra"}</CardDescription><CardTitle className={`text-xl tabular-nums ${caixa.ultrapassa ? "text-red-700" : "text-emerald-700"}`}>{formatarMoeda(caixa.ultrapassa ? caixa.excedenteCentavos : caixa.sobraCentavos)}</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">{caixa.ultrapassa ? "autorizado acima do caixa" : "autorizado dentro do caixa"}</CardContent>
          </Card>
        </div>
      )}
      {a.status !== "cancelada" && ativos.some((i) => i.tipo === "antecipacao" && i.tem_bordero === true && !i.baixado_consistem_em) && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Esta autorização inclui antecipação que <strong>já consta como paga no Consistem (tem borderô)</strong>. {a.status === "rascunho" ? "Remova o item do rascunho antes de autorizar." : "Confira antes de pagar de novo."}
        </p>
      )}
      {caixa?.ultrapassa && a.status !== "cancelada" && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          O total autorizado passa do caixa disponível em <strong>{formatarMoeda(caixa.excedenteCentavos)}</strong>.{a.status === "rascunho" ? " Decida quais itens não pagar agora (remova do rascunho) ou ajuste o caixa." : " Decida quais itens deixar de pagar."}
        </p>
      )}

      {a.status === "rascunho" && (
        <p className="rounded-lg border border-grade bg-marca-clara p-3 text-sm">
          Rascunho: {papel.ehGestor ? "confira os itens e clique em “Autorizar pagamento”." : "aguarda um gestor do Financeiro autorizar."} Itens ainda podem ser removidos e pagamentos extras (fora do Consistem) incluídos.
        </p>
      )}

      <SecaoItens titulo="Títulos" lista={titulos} total={resumo.titulos.centavos} autorizacaoId={a.id} podeRemover={podeRemoverItem(a.status, papel)} />
      <SecaoItens titulo="Antecipações" lista={antecipacoes} total={resumo.antecipacoes.centavos} autorizacaoId={a.id} podeRemover={podeRemoverItem(a.status, papel)} />
      <SecaoExtras lista={extrasAtivos} total={resumo.extras.centavos} totalAutorizacao={resumo.geral.centavos} caixaCentavos={caixaCentavos} autorizacaoId={a.id} podeEditar={podeEditarExtras(a.status, papel)} />

      {(anexos.length > 0 || a.status === "autorizada") && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold">Relatório assinado</h3>
          {anexos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum arquivo anexado. Depois de imprimir e colher a assinatura, anexe o PDF ou a foto aqui para ficar junto do histórico.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {anexos.map((x) => (
                <li key={x.id}>
                  {x.url ? <a href={x.url} target="_blank" rel="noopener" className="text-elo hover:underline">{x.nome}</a> : <span>{x.nome}</span>}
                  <span className="ml-2 text-xs text-muted-foreground">enviado em {x.enviadoEm}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(removidos.length > 0 || extrasRemovidos.length > 0) && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-muted-foreground">Removidos do rascunho ({removidos.length + extrasRemovidos.length})</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {removidos.map((i) => (
              <li key={i.id}>{ROTULO_TIPO[i.tipo]} · {i.fornecedor_nome} · {i.num_documento || i.cod_lancamento} · {formatarMoeda(centavos(i.valor))} — {i.motivo_remocao ?? "sem motivo"}{i.removido_em ? ` (${quandoEm(i.removido_em)})` : ""}</li>
            ))}
            {extrasRemovidos.map((x) => (
              <li key={x.id}>Pagamento extra · {x.descricao} · {x.favorecido} · {formatarMoeda(centavos(x.valor))} — {x.motivo_remocao ?? "sem motivo"}{x.removido_em ? ` (${quandoEm(x.removido_em)})` : ""}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Terceiro bloco: pagamentos extras (fora do Consistem), com descrição, favorecido e valor. */
function SecaoExtras({ lista, total, totalAutorizacao, caixaCentavos, autorizacaoId, podeEditar }: {
  lista: LinhaExtraAutorizacao[]; total: number; totalAutorizacao: number; caixaCentavos: number | null; autorizacaoId: string; podeEditar: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold">Pagamentos extras <span className="text-sm font-normal text-muted-foreground">(fora do Consistem)</span></h3>
        <span className="flex items-center gap-3 text-sm tabular-nums">
          {lista.length} {lista.length === 1 ? "item" : "itens"} · <strong>{formatarMoeda(total)}</strong>
          {podeEditar && <DialogoExtraAutorizacao autorizacaoId={autorizacaoId} totalAtualCentavos={totalAutorizacao} caixaCentavos={caixaCentavos} />}
        </span>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum.{podeEditar ? " Use “Incluir pagamento extra” para um pedido que não existe no Consistem (frete avulso, reembolso, taxa…)." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Favorecido</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Incluído por</TableHead>
                {podeEditar && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="max-w-96 whitespace-normal">{x.descricao}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{x.favorecido}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(centavos(x.valor))}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{x.criado_por_nome ?? "—"}<span className="block">{quandoEm(x.criado_em)}</span></TableCell>
                  {podeEditar && (
                    <TableCell className="text-right"><BotaoRemoverExtra autorizacaoId={autorizacaoId} extraId={x.id} descricao={`${x.descricao} · ${x.favorecido} · ${formatarMoeda(centavos(x.valor))}`} /></TableCell>
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
                  <TableCell className={i.tipo === "antecipacao" && i.tem_bordero === true && !i.baixado_consistem_em ? "font-medium text-red-700" : i.baixado_consistem_em ? "text-emerald-700" : "text-muted-foreground"}>
                    {i.tipo === "antecipacao" && i.tem_bordero === true && !i.baixado_consistem_em
                      ? "já paga (tem borderô no Consistem)"
                      : <>{situacaoDoItem({ removido: false, baixadoConsistemEm: i.baixado_consistem_em, tipo: i.tipo })}{i.baixado_consistem_em ? ` em ${formatarData(i.baixado_consistem_em)}` : ""}</>}
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
