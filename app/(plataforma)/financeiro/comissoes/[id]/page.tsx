import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileDown, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_COMISSOES, ROTA_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, FUSO } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { buscarTitulosPagos, fecharMes } from "../acoes";
import { AjusteLinha, BotaoAcao, FormLancamento, ImportarCreditos } from "../componentes";
import { lerFechamento, ROTULO_BAIXA, ROTULO_ORIGEM, rotuloCompetencia } from "../dados";

export const metadata: Metadata = { title: "Fechamento de comissões" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reais = (v: number | string | null) => (v === null ? "—" : formatarMoeda(Math.round(Number(v) * 100)));
const perc = (v: number | string) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
const dataHora = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

export default async function PaginaFechamento({ params }: PageProps<"/financeiro/comissoes/[id]">) {
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
  const barradasTeto = todas.filter((l) => !l.incluida && (l.motivo ?? "").startsWith("Excede o")).length;
  const linhasRepetidas = todas.filter((l) => (l.observacao ?? "").startsWith("Repetido")).length;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={ROTA_COMISSOES} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Comissões</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">Comissões de {rotuloCompetencia(f.competencia)}</h1>
            <Badge variant={aberto ? "outline" : "secondary"}>{f.historico ? "Histórico (planilha)" : aberto ? "Em conferência" : `Fechado em ${formatarData(f.fechado_em)}`}</Badge>
          </div>
        </div>
        <div className="flex gap-3 text-sm">
          <a href={`/imprimir/comissoes/${id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4"><Printer className="size-4" /> Imprimir</a>
          <a href={`${ROTA_COMISSOES}/${id}/planilha`} className="inline-flex items-center gap-1 underline underline-offset-4"><FileDown className="size-4" /> Excel</a>
        </div>
      </div>

      {f.historico && (
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
      )}

      {!f.historico && (<>
      <Card>
        <CardHeader>
          <CardTitle>1. Créditos de cliente (CCCCI010)</CardTitle>
          <CardDescription>
            Suba a planilha do mês (data, código do cliente, nome e valor). Todo título Z pago precisa de um crédito; crédito sem Z é adiantamento e gera comissão.
            {f.creditos_importados_em && ` Última importação: ${f.creditos_arquivo ?? "planilha"} em ${dataHora(f.creditos_importados_em)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editavel && <ImportarCreditos fechamentoId={id} jaImportado={creditos.length > 0} />}
          {creditos.length > 0 && (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Títulos pagos no mês</CardTitle>
          <CardDescription>
            Busca no Consistem os títulos pagos no mês, com o representante e o tipo de baixa, e monta a proposta. Pode refazer: as decisões já tomadas na conferência ficam.
            {f.titulos_buscados_em && ` Última busca: ${dataHora(f.titulos_buscados_em)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editavel && (
            <BotaoAcao rotulo={f.titulos_buscados_em ? "Buscar de novo" : "Buscar títulos pagos"} rotuloPendente="Buscando no Consistem…"
              acao={buscarTitulosPagos.bind(null, id)} variante={f.titulos_buscados_em ? "outline" : "default"} />
          )}
          {f.z_sem_credito.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Título Z sem crédito de cliente na CCCCI010 ({f.z_sem_credito.length})</p>
              <p className="mb-2 text-muted-foreground">A baixa do Z não gera movimento bancário: falta lançar o crédito do cliente. O Z entra na proposta, mas confira antes de fechar.</p>
              <ul className="list-inside list-disc tabular-nums">
                {f.z_sem_credito.map((z) => (
                  <li key={z.cod_titulo}>{z.cod_titulo} · cliente {z.cod_cliente ?? "?"} · pago em {formatarData(z.data_pagamento)} · {reais(z.valor)}</li>
                ))}
              </ul>
            </div>
          )}
          {barradasTeto > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
              <p className="font-medium">{barradasTeto} linha(s) barrada(s) pelo teto do pedido</p>
              <p className="text-muted-foreground">
                A base comissionada de um pedido não passa do valor dele (o que já foi pago em outros meses conta). A linha vem excluída com o motivo;
                se estiver certa, inclua de novo na conferência.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {porRepresentante.map(({ representante: r, linhas, total, antecipado, saldo }) => (
        <Card key={r.cod_representante}>
          <CardHeader>
            <CardTitle>3. {r.nome}</CardTitle>
            <CardDescription>
              Venda {perc(r.perc_venda)} · Locação {perc(r.perc_locacao)}
              {r.recebe_de.filter((x) => x !== r.cod_representante).length > 0 && ` · recebe também pelas vendas de ${r.recebe_de.filter((x) => x !== r.cod_representante).map((x) => nomeRep.get(x) ?? x).join(", ")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {linhas.length === 0 ? (
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
                  {linhas.map((l) => (
                    <TableRow key={l.id} className={l.incluida ? "" : "text-muted-foreground line-through decoration-muted-foreground/50"}>
                      <TableCell className="whitespace-nowrap" title={l.observacao ?? ""}>{ROTULO_ORIGEM[l.origem]}</TableCell>
                      <TableCell className="tabular-nums">{l.cod_titulo ?? l.observacao ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={l.nome_cliente ?? ""}>{l.nome_cliente ?? l.cod_cliente ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{l.nota_fiscal ?? ""}</TableCell>
                      <TableCell className="tabular-nums" title={l.teto_valor === null ? "" : `Teto: ${reais(l.teto_valor)}`}>
                        {l.cod_pedido ?? (l.teto_chave?.startsWith("N:") ? "NF sem pedido" : "")}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatarData(l.data_pagamento)}</TableCell>
                      <TableCell>{l.tipo_baixa ? ROTULO_BAIXA[l.tipo_baixa] ?? l.tipo_baixa : ""}</TableCell>
                      <TableCell>{l.cod_representante_venda && l.cod_representante_venda !== r.cod_representante ? nomeRep.get(l.cod_representante_venda) ?? l.cod_representante_venda : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.origem === "antecipacao" ? "" : reais(l.valor_base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.origem === "antecipacao" ? "" : perc(l.percentual)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.origem === "antecipacao" ? `− ${reais(l.valor_comissao)}` : reais(l.valor_comissao)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.valor_consistem === null ? "" : reais(l.valor_consistem)}</TableCell>
                      <TableCell>
                        <AjusteLinha linhaId={l.id} fechamentoId={id} incluida={l.incluida} tipo={l.tipo} motivo={l.motivo} editavel={editavel} antecipacao={l.origem === "antecipacao"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Table interativa={false} className="max-w-sm">
              <TableBody>
                <TableRow><TableCell>Total do mês</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(total)}</TableCell></TableRow>
                <TableRow><TableCell>Antecipado</TableCell><TableCell className="text-right tabular-nums">{antecipado ? `− ${formatarMoeda(antecipado)}` : formatarMoeda(0)}</TableCell></TableRow>
                <TableRow className="font-semibold"><TableCell>Saldo a pagar</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(saldo)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {editavel && (
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos</CardTitle>
            <CardDescription>Antecipação de comissão já paga (abate do total) ou comissão manual sobre um valor (contrato, título fora da regra).</CardDescription>
          </CardHeader>
          <CardContent>
            <FormLancamento fechamentoId={id} representantes={representantes.filter((r) => r.ativo).map((r) => ({ cod: r.cod_representante, nome: r.nome }))}
              dataPadrao={f.competencia.slice(0, 10)} />
          </CardContent>
        </Card>
      )}

      {aberto && ehGestor && (
        <Card>
          <CardHeader>
            <CardTitle>4. Fechar o mês</CardTitle>
            <CardDescription>Depois de fechado, nada muda: correção vira lançamento no mês seguinte. Um título já pago não entra de novo em outro mês.</CardDescription>
          </CardHeader>
          <CardContent>
            <BotaoAcao rotulo="Fechar comissões do mês" rotuloPendente="Fechando…" acao={fecharMes.bind(null, id)}
              confirmar={`Fechar as comissões de ${rotuloCompetencia(f.competencia)}? Depois não dá para alterar.`} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
