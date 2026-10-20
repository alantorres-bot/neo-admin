import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Check, ChevronLeft, FileDown, Printer, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MODULO_COMISSOES, ROTA_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, FUSO } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { buscarTitulosPagos, fecharMes } from "../acoes";
import { AjusteLinha, BotaoAcao, FormLancamento, ImportarCreditos } from "../componentes";
import { lerFechamento, ROTULO_BAIXA, ROTULO_ORIGEM, rotuloCompetencia, type LinhaFechamento } from "../dados";

export const metadata: Metadata = { title: "Fechamento de comissões" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reais = (v: number | string | null) => (v === null ? "—" : formatarMoeda(Math.round(Number(v) * 100)));
const perc = (v: number | string) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
const dataHora = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const fimDoMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Cor da etiqueta de origem (título, adiantamento, manual, antecipação). */
const COR_ORIGEM: Record<LinhaFechamento["origem"], string> = {
  titulo: "bg-muted text-foreground/80",
  credito: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  manual: "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
  antecipacao: "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
};

const linkBotao = "inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted";

/** Uma etapa do fechamento: feita (check), atual (destaque) ou a fazer. */
function Etapa({ n, titulo, situacao, estado, children }: { n: number; titulo: string; situacao: string; estado: "feita" | "atual" | "afazer"; children?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl bg-card p-4",
      estado === "atual" ? "border-2 border-primary" : estado === "afazer" ? "border border-dashed bg-muted/30" : "border")}>
      <span className={cn("flex size-7 flex-none items-center justify-center rounded-full text-sm font-bold",
        estado === "feita" ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200"
          : estado === "atual" ? "bg-primary text-primary-foreground" : "border bg-muted text-muted-foreground")}>
        {estado === "feita" ? <Check className="size-4" aria-hidden /> : n}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <strong className="text-sm">{n}. {titulo}</strong>
        <span className="text-xs text-muted-foreground">{situacao}</span>
        {children}
      </div>
    </div>
  );
}

export default async function PaginaFechamento({ params, searchParams }: PageProps<"/financeiro/comissoes/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const ehOperador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "operador");
  const ehGestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "gestor");
  const supabase = await criarClienteServidor();
  const dados = await lerFechamento(supabase, id);
  if (!dados) notFound();
  const { fechamento: f, porRepresentante, representantes, creditos } = dados;
  const aberto = f.status === "em_conferencia";
  const editavel = aberto && ehOperador;
  const nomeRep = new Map(representantes.map((r) => [r.cod_representante, r.nome]));
  const todas = porRepresentante.flatMap((x) => x.linhas);
  const excluidas = todas.filter((l) => !l.incluida);
  const barradasTeto = excluidas.filter((l) => (l.motivo ?? "").startsWith("Excede o"));
  const linhasRepetidas = todas.filter((l) => (l.observacao ?? "").startsWith("Repetido")).length;
  const repParam = (await searchParams).rep;
  const atual = porRepresentante.find((x) => x.representante.cod_representante === repParam) ?? porRepresentante[0];
  const totalAPagar = porRepresentante.reduce((s, x) => s + x.saldo, 0);
  const lastreiamZ = creditos.filter((c) => c.cod_titulo_z).length;
  // Relatório de comissão de UM representante (o que vai para ele): impressão/PDF e Excel.
  const relatorio = (cod: string) => ({
    imprimir: `/imprimir/comissoes/${id}?rep=${encodeURIComponent(cod)}`,
    excel: `${ROTA_COMISSOES}/${id}/planilha?rep=${encodeURIComponent(cod)}`,
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={ROTA_COMISSOES} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Comissões</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">Comissões de {rotuloCompetencia(f.competencia)}</h1>
          <Badge variant={aberto ? "outline" : "secondary"}>{f.historico ? "Histórico (planilha)" : aberto ? "Em conferência" : `Fechado em ${formatarData(f.fechado_em)}`}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Parcelas pagas de {formatarData(f.competencia)} a {formatarData(fimDoMes(f.competencia))}
          {f.titulos_buscados_em && ` · Última busca no Consistem: ${dataHora(f.titulos_buscados_em)}`}
        </p>
      </div>

      {f.historico ? (
        <Card>
          <CardHeader>
            <CardTitle>Mês pago pelas planilhas</CardTitle>
            <CardDescription>
              Histórico importado de {f.historico_arquivos.join(", ") || "planilha"}. Serve para o sistema não pagar de novo o que já foi pago
              (mesmo título ou acima do valor do pedido). A data é a de vencimento da planilha.
              {linhasRepetidas > 0 && ` ${linhasRepetidas} título(s) deste mês já tinham sido pagos em outro mês da planilha (marcados "Repetido").`}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <nav aria-label="Etapas do fechamento" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Etapa n={1} titulo="Créditos da CCCCI010" estado={creditos.length > 0 ? "feita" : aberto ? "atual" : "afazer"}
              situacao={creditos.length > 0 ? `${creditos.length} crédito(s) importado(s)${lastreiamZ ? ` · ${lastreiamZ} lastreia(m) Z` : ""}` : "Suba a planilha do mês"}>
              {editavel && <ImportarCreditos fechamentoId={id} jaImportado={creditos.length > 0} />}
            </Etapa>
            <Etapa n={2} titulo="Títulos pagos no mês" estado={f.titulos_buscados_em ? "feita" : creditos.length > 0 && aberto ? "atual" : "afazer"}
              situacao={f.titulos_buscados_em ? `${todas.filter((l) => l.origem === "titulo" || l.origem === "credito").length} linha(s) proposta(s)` : "Busca no Consistem e monta a proposta"}>
              {editavel && creditos.length > 0 && (
                <BotaoAcao rotulo={f.titulos_buscados_em ? "Buscar de novo" : "Buscar títulos pagos"} rotuloPendente="Buscando no Consistem…"
                  acao={buscarTitulosPagos.bind(null, id)} variante={f.titulos_buscados_em ? "outline" : "default"} />
              )}
            </Etapa>
            <Etapa n={3} titulo="Conferência" estado={!aberto ? "feita" : f.titulos_buscados_em ? "atual" : "afazer"} situacao="Incluir, excluir com motivo, venda ou locação">
              {excluidas.length > 0 && <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">{excluidas.length} linha(s) excluída(s)</span>}
            </Etapa>
            <Etapa n={4} titulo="Fechar o mês" estado={aberto ? "afazer" : "feita"} situacao={aberto ? "Gestor do Financeiro · depois nada muda" : `Fechado em ${formatarData(f.fechado_em)}`} />
          </nav>

          {creditos.length > 0 && (
            <details className="rounded-xl border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Créditos da CCCCI010 ({creditos.length})
                {f.creditos_importados_em && <span className="font-normal text-muted-foreground"> · {f.creditos_arquivo ?? "planilha"} em {dataHora(f.creditos_importados_em)}</span>}
              </summary>
              <div className="px-4 pb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditos.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="tabular-nums">{formatarData(c.data)}</TableCell>
                        <TableCell className="tabular-nums">{c.cod_cliente}</TableCell>
                        <TableCell>{c.nome_cliente ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{reais(c.valor)}</TableCell>
                        <TableCell className="tabular-nums">{c.cod_pedido ?? ""}</TableCell>
                        <TableCell>
                          {!f.titulos_buscados_em ? <span className="text-xs text-muted-foreground">Aguarda a busca dos títulos</span>
                            : c.cod_titulo_z ? `Lastreia o ${c.cod_titulo_z}`
                            : `Adiantamento${c.cod_representante_sugerido ? ` · ${nomeRep.get(c.cod_representante_sugerido) ?? `representante ${c.cod_representante_sugerido}`}` : " · sem representante identificado"}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}

          {f.titulos_buscados_em && (
            <section aria-label="Avisos" className="grid gap-3 lg:grid-cols-2">
              {f.z_sem_credito.length > 0 && (
                <div role="alert" className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 size-5 flex-none text-destructive" aria-hidden />
                  <div>
                    <p className="font-semibold text-destructive">Título Z sem crédito de cliente na CCCCI010 ({f.z_sem_credito.length})</p>
                    <p className="text-muted-foreground">A baixa do Z não gera movimento bancário: falta lançar o crédito do cliente. O Z entra na proposta, mas confira antes de fechar.</p>
                    <ul className="mt-1 list-inside list-disc tabular-nums">
                      {f.z_sem_credito.map((z) => <li key={z.cod_titulo}>{z.cod_titulo} · cliente {z.cod_cliente ?? "?"} · pago em {formatarData(z.data_pagamento)} · {reais(z.valor)}</li>)}
                    </ul>
                  </div>
                </div>
              )}
              {excluidas.length > 0 && (
                <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/30">
                  <AlertTriangle className="mt-0.5 size-5 flex-none text-amber-700 dark:text-amber-300" aria-hidden />
                  <div>
                    <p className="font-semibold">{excluidas.length} linha(s) excluída(s){barradasTeto.length > 0 && `, ${barradasTeto.length} pelo teto do pedido`}</p>
                    <p className="text-muted-foreground">
                      {excluidas.slice(0, 4).map((l) => `${l.cod_titulo ?? ROTULO_ORIGEM[l.origem]} (${nomeRep.get(l.cod_representante) ?? l.cod_representante})`).join(", ")}
                      {excluidas.length > 4 && "…"}. O motivo aparece na linha; se estiver certa, inclua de novo.
                    </p>
                  </div>
                </div>
              )}
              {f.z_sem_credito.length === 0 && barradasTeto.length === 0 && (
                <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
                  <ShieldCheck className="mt-0.5 size-5 flex-none text-green-700 dark:text-green-400" aria-hidden />
                  <div>
                    <p className="font-semibold">Teto por pedido e créditos em ordem</p>
                    <p className="text-muted-foreground">Nenhuma linha passa do valor do pedido. Nenhum título Z sem crédito na CCCCI010.</p>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <section aria-label="Representantes" className="grid gap-3 md:grid-cols-2">
        {porRepresentante.map(({ representante: r, linhas, total, antecipado, saldo }) => {
          const selecionado = atual?.representante.cod_representante === r.cod_representante;
          const nExcluidas = linhas.filter((l) => !l.incluida).length;
          const nAntecipacoes = linhas.filter((l) => l.origem === "antecipacao").length;
          return (
            <Link key={r.cod_representante} href={`?rep=${encodeURIComponent(r.cod_representante)}`} scroll={false} aria-current={selecionado ? "true" : undefined}
              className={cn("flex flex-col gap-3 rounded-xl bg-card p-4 transition-colors hover:bg-muted/40", selecionado ? "border-2 border-primary shadow-sm" : "border")}>
              <span className="flex items-baseline justify-between gap-2">
                <strong className="text-base">{r.nome}</strong>
                <span className="text-xs text-muted-foreground">Venda {perc(r.perc_venda)} · Locação {perc(r.perc_locacao)}</span>
              </span>
              <span className="grid grid-cols-3 gap-3">
                <span className="flex flex-col"><span className="text-xs text-muted-foreground">Total do mês</span><span className="font-semibold tabular-nums">{formatarMoeda(total)}</span></span>
                <span className="flex flex-col"><span className="text-xs text-muted-foreground">Antecipado</span><span className="font-semibold tabular-nums">{formatarMoeda(antecipado)}</span></span>
                <span className="flex flex-col"><span className="text-xs text-muted-foreground">Saldo a pagar</span><span className="text-lg font-bold tabular-nums text-primary">{formatarMoeda(saldo)}</span></span>
              </span>
              <span className="text-xs text-muted-foreground">
                {linhas.filter((l) => l.incluida && l.origem !== "antecipacao").length} linha(s) incluída(s)
                {nExcluidas > 0 && ` · ${nExcluidas} excluída(s)`}
                {nAntecipacoes > 0 && ` · ${nAntecipacoes} antecipação(ões)`}
              </span>
            </Link>
          );
        })}
      </section>

      {atual && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle>{atual.representante.nome}</CardTitle>
              <CardDescription>
                Venda {perc(atual.representante.perc_venda)} · Locação {perc(atual.representante.perc_locacao)}
                {atual.representante.recebe_de.filter((x) => x !== atual.representante.cod_representante).length > 0 &&
                  ` · recebe também pelas vendas de ${atual.representante.recebe_de.filter((x) => x !== atual.representante.cod_representante).map((x) => nomeRep.get(x) ?? x).join(", ")}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={relatorio(atual.representante.cod_representante).imprimir} target="_blank" rel="noreferrer" className={linkBotao}>
                <Printer className="size-4" aria-hidden /> Relatório de {atual.representante.nome.split(" ")[0]}
              </a>
              <a href={relatorio(atual.representante.cod_representante).excel} className={linkBotao}><FileDown className="size-4" aria-hidden /> Excel</a>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {atual.linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma linha.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origem</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Baixa</TableHead>
                    <TableHead>Venda de</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead className="text-right">Consistem</TableHead>
                    <TableHead>Conferência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atual.linhas.map((l) => (
                    <TableRow key={l.id} className={l.incluida ? "" : "bg-amber-50/60 text-muted-foreground dark:bg-amber-950/20"}>
                      <TableCell className="whitespace-nowrap" title={l.observacao ?? ""}>
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", COR_ORIGEM[l.origem])}>{ROTULO_ORIGEM[l.origem]}</span>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">{l.cod_titulo ?? l.observacao ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={l.nome_cliente ?? ""}>{l.nome_cliente ?? l.cod_cliente ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{l.nota_fiscal ?? ""}</TableCell>
                      <TableCell className="tabular-nums" title={l.teto_valor === null ? "" : `Teto: ${reais(l.teto_valor)}`}>
                        {l.cod_pedido ?? (l.teto_chave?.startsWith("N:") ? "NF sem pedido" : "")}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatarData(l.data_pagamento)}</TableCell>
                      <TableCell>{l.tipo_baixa ? ROTULO_BAIXA[l.tipo_baixa] ?? l.tipo_baixa : ""}</TableCell>
                      <TableCell>{l.cod_representante_venda && l.cod_representante_venda !== atual.representante.cod_representante ? nomeRep.get(l.cod_representante_venda) ?? l.cod_representante_venda : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.origem === "antecipacao" ? "" : reais(l.valor_base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.origem === "antecipacao" ? "" : perc(l.percentual)}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums", !l.incluida && "line-through", l.origem === "antecipacao" && "text-orange-800 dark:text-orange-300")}>
                        {l.origem === "antecipacao" ? `− ${reais(l.valor_comissao)}` : reais(l.valor_comissao)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.valor_consistem === null ? "" : reais(l.valor_consistem)}</TableCell>
                      <TableCell>
                        <AjusteLinha linhaId={l.id} fechamentoId={id} incluida={l.incluida} tipo={l.tipo} motivo={l.motivo} editavel={editavel} antecipacao={l.origem === "antecipacao"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Table interativa={false} className="ml-auto max-w-sm">
              <TableBody>
                <TableRow><TableCell>Total do mês</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatarMoeda(atual.total)}</TableCell></TableRow>
                <TableRow><TableCell>Antecipado</TableCell><TableCell className="text-right tabular-nums">{atual.antecipado ? `− ${formatarMoeda(atual.antecipado)}` : formatarMoeda(0)}</TableCell></TableRow>
                <TableRow className="font-bold"><TableCell>Saldo a pagar</TableCell><TableCell className="text-right text-base tabular-nums text-primary">{formatarMoeda(atual.saldo)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(editavel || (aberto && ehGestor)) && (
        <div className="flex flex-wrap gap-5">
          {editavel && (
            <Card className="min-w-0 flex-[999_1_560px]">
              <CardHeader>
                <CardTitle>Lançamento</CardTitle>
                <CardDescription>Antecipação de comissão já paga (abate do total) ou comissão manual sobre um valor (contrato, título fora da regra).</CardDescription>
              </CardHeader>
              <CardContent>
                <FormLancamento fechamentoId={id} representantes={representantes.filter((r) => r.ativo).map((r) => ({ cod: r.cod_representante, nome: r.nome }))}
                  dataPadrao={fimDoMes(f.competencia)} representantePadrao={atual?.representante.cod_representante} />
              </CardContent>
            </Card>
          )}
          {aberto && ehGestor && (
            <Card className="min-w-0 flex-[1_1_320px]">
              <CardHeader>
                <CardTitle>4. Fechar o mês</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {porRepresentante.map((x) => (
                    <li key={x.representante.cod_representante} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{x.representante.nome}</span><strong className="tabular-nums">{formatarMoeda(x.saldo)}</strong>
                    </li>
                  ))}
                  <li className="flex justify-between gap-2 border-t pt-2"><span className="font-semibold">A pagar no mês</span><strong className="tabular-nums text-primary">{formatarMoeda(totalAPagar)}</strong></li>
                </ul>
                <p className="text-xs text-muted-foreground">Depois de fechado, nada muda: correção vira lançamento no mês seguinte. Um título já pago não entra de novo em outro mês.</p>
                <BotaoAcao rotulo={`Fechar comissões de ${rotuloCompetencia(f.competencia).split("/")[0]}`} rotuloPendente="Fechando…" acao={fecharMes.bind(null, id)}
                  confirmar={`Fechar as comissões de ${rotuloCompetencia(f.competencia)}? Depois não dá para alterar.`} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
