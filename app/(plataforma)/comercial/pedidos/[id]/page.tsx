import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diasAtraso, emCentavos, ROTA_PEDIDOS, rotuloSituacao, situacaoParcela } from "@/lib/modulos/comercial/pedidos/carteira";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoDocumento } from "../botoes";

export const metadata: Metadata = { title: "Pedido" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITUACAO_NF: Record<string, string> = { "1": "Gerada", "2": "Emitida", "3": "Cancelada" };
const ROTULO_PARCELA = { paga: "Paga", vencida: "Vencida", a_vencer: "A vencer" } as const;
const quantidade = (v: number | string) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const dataHora = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

type Nota = {
  id: string; nota: string; serie: string; chave_acesso: string | null; situacao: string | null; data_emissao: string | null;
  data_hora_saida: string | null; valor_total: number | null; sem_titulos: boolean;
  com_nota_parcelas: { id: string; cod_titulo: string; data_vencimento: string | null; data_pagamento: string | null; valor: number }[];
};

export default async function PaginaPedido({ params }: PageProps<"/comercial/pedidos/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const hoje = hojeEmCuiaba();
  const supabase = await criarClienteServidor();
  const [{ data: pedido }, { data: itens }, { data: notas }] = await Promise.all([
    supabase.from("com_pedidos").select("*").eq("id", id).maybeSingle(),
    supabase.from("com_pedido_itens").select("item, cod_produto, qtd_pedida, qtd_faturada, qtd_cancelada, preco_unitario").eq("pedido_id", id).order("item"),
    supabase.from("com_notas")
      .select("id, nota, serie, chave_acesso, situacao, data_emissao, data_hora_saida, valor_total, sem_titulos, com_nota_parcelas(id, cod_titulo, data_vencimento, data_pagamento, valor)")
      .eq("pedido_id", id).order("data_emissao"),
  ]);
  if (!pedido) notFound();
  const listaNotas = (notas ?? []) as Nota[];
  const parcelas = listaNotas
    .flatMap((n) => n.com_nota_parcelas.map((x) => ({ ...x, nota: n.nota })))
    .sort((a, b) => (a.data_vencimento ?? "").localeCompare(b.data_vencimento ?? "") || a.cod_titulo.localeCompare(b.cod_titulo));
  const p = { ...pedido, valor_saldo: Number(pedido.valor_saldo) } as typeof pedido & { valor_saldo: number };
  const atraso = diasAtraso(p, hoje);

  const campos: [string, string][] = [
    ["Cliente", pedido.nome_cliente ?? "—"],
    ["Representante", pedido.nome_representante ?? "—"],
    ["Tipo de nota", pedido.desc_tipo_nf ?? pedido.cod_tipo_nf ?? "—"],
    ["Condição de venda", pedido.desc_cond_venda ?? pedido.cod_cond_venda ?? "—"],
    ["Emissão", formatarData(pedido.data_emissao) || "—"],
    ["Digitação", formatarData(pedido.data_digitacao) || "—"],
    ["Previsão de faturamento", formatarData(pedido.data_prev_fat) || "—"],
    ["Último faturamento", formatarData(pedido.data_ultimo_fat) || "—"],
    ["Total", formatarMoeda(emCentavos(pedido.valor_total))],
    ["Faturado", formatarMoeda(emCentavos(pedido.valor_faturado))],
    ["Saldo a faturar", formatarMoeda(emCentavos(pedido.valor_saldo))],
    ["Cancelado", formatarMoeda(emCentavos(pedido.valor_cancelado))],
  ];
  if (pedido.valor_antecipado !== null && Number(pedido.valor_antecipado) > 0) campos.push(["Adiantamento do cliente", formatarMoeda(emCentavos(pedido.valor_antecipado))]);

  return (
    <>
      <div>
        <Link href={ROTA_PEDIDOS} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pedido {pedido.cod_pedido}</h1>
          <Badge variant="secondary">{rotuloSituacao(pedido.situacao)}</Badge>
          {atraso > 0 && <Badge variant="destructive">Previsão vencida há {atraso === 1 ? "1 dia" : `${atraso} dias`}</Badge>}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-x-8 gap-y-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo}>
              <div className="text-xs text-muted-foreground">{rotulo}</div>
              <div className="text-sm font-medium tabular-nums">{valor}</div>
            </div>
          ))}
          {pedido.observacao && (
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-xs text-muted-foreground">Observação do pedido</div>
              <div className="whitespace-pre-line text-sm">{pedido.observacao}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Itens</CardTitle>
          {!pedido.detalhado_em && <CardDescription>Os itens ainda não foram lidos do Consistem; entram na próxima atualização.</CardDescription>}
        </CardHeader>
        <CardContent>
          {(itens ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum item.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Pedida</TableHead>
                  <TableHead className="text-right">Faturada</TableHead>
                  <TableHead className="text-right">Cancelada</TableHead>
                  <TableHead className="text-right">A faturar</TableHead>
                  <TableHead className="text-right">Preço unitário</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itens ?? []).map((i) => (
                  <TableRow key={i.item}>
                    <TableCell className="tabular-nums">{i.item >= 10_000 ? "—" : i.item}</TableCell>
                    <TableCell>{i.cod_produto ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantidade(i.qtd_pedida)}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantidade(i.qtd_faturada)}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantidade(i.qtd_cancelada)}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantidade(Math.max(0, Number(i.qtd_pedida) - Number(i.qtd_faturada) - Number(i.qtd_cancelada)))}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.preco_unitario === null ? "—" : Number(i.preco_unitario).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notas fiscais</CardTitle>
          <CardDescription>NFs de saída do pedido no Consistem. DANFE e XML são baixados na hora, direto do ERP.</CardDescription>
        </CardHeader>
        <CardContent>
          {listaNotas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma NF {pedido.notas_lidas_em ? "para este pedido" : "lida ainda"}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NF</TableHead>
                  <TableHead>Série</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Saída</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Documentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaNotas.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="tabular-nums">{n.nota}</TableCell>
                    <TableCell className="tabular-nums">{n.serie || "—"}</TableCell>
                    <TableCell>{SITUACAO_NF[n.situacao ?? ""] ?? n.situacao ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(n.data_emissao)}</TableCell>
                    <TableCell className="tabular-nums">{dataHora(n.data_hora_saida)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.valor_total === null ? "—" : formatarMoeda(emCentavos(n.valor_total))}</TableCell>
                    <TableCell>
                      {n.chave_acesso && n.situacao !== "3" ? (
                        <div className="flex gap-2"><BotaoDocumento notaId={n.id} tipo="danfe" /><BotaoDocumento notaId={n.id} tipo="xml" /></div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{n.situacao === "3" ? "Cancelada" : "Sem NF-e"}</span>
                      )}
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
          <CardTitle>Parcelas</CardTitle>
          <CardDescription>Títulos gerados pelas NFs do pedido (só NF eletrônica; NF que não gera duplicata não tem parcela).</CardDescription>
        </CardHeader>
        <CardContent>
          {parcelas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma parcela.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NF</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parcelas.map((x) => {
                  const s = situacaoParcela(x, hoje);
                  return (
                    <TableRow key={x.id}>
                      <TableCell className="tabular-nums">{x.nota}</TableCell>
                      <TableCell className="tabular-nums">{x.cod_titulo}</TableCell>
                      <TableCell className="tabular-nums">{formatarData(x.data_vencimento)}</TableCell>
                      <TableCell className="tabular-nums">{formatarData(x.data_pagamento)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(x.valor))}</TableCell>
                      <TableCell>
                        <Badge variant={s === "paga" ? "secondary" : s === "vencida" ? "destructive" : "outline"}>{ROTULO_PARCELA[s]}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
