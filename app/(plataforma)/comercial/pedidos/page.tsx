import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  diasAtraso, emCentavos, pedidoAberto, previsaoFaturamento, ROTA_PEDIDOS, rotuloSituacao, type Faixa,
} from "@/lib/modulos/comercial/pedidos/carteira";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotoesAtualizar } from "./botoes";

export const metadata: Metadata = { title: "Pedidos" };

type Pedido = {
  id: string; cod_pedido: string; situacao: string; nome_cliente: string | null; nome_representante: string | null;
  data_digitacao: string | null; data_prev_fat: string | null; valor_total: number; valor_faturado: number; valor_saldo: number;
};

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const dataHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default async function PaginaPedidos({ searchParams }: PageProps<"/comercial/pedidos">) {
  const sessao = await exigirSessao();
  const ehGestor = temAcesso(sessao.acesso, "comercial", "gestor");
  const todos = primeiro((await searchParams).ver) === "todos";
  const hoje = hojeEmCuiaba();
  const supabase = await criarClienteServidor();

  const [{ data: linhas, error }, { data: ultima }] = await Promise.all([
    supabase.from("com_pedidos")
      .select("id, cod_pedido, situacao, nome_cliente, nome_representante, data_digitacao, data_prev_fat, valor_total, valor_faturado, valor_saldo")
      .order("data_prev_fat", { ascending: true, nullsFirst: false }).limit(5000),
    supabase.from("com_sincronizacoes").select("iniciada_em, concluida_em, erro").not("concluida_em", "is", null)
      .order("iniciada_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pedidos = ((linhas ?? []) as Pedido[]).map((p) => ({ ...p, valor_total: Number(p.valor_total), valor_faturado: Number(p.valor_faturado), valor_saldo: Number(p.valor_saldo) }));
  const abertos = pedidos.filter(pedidoAberto);
  const visiveis = todos ? pedidos : abertos;
  const previsao = previsaoFaturamento(pedidos, hoje);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-muted-foreground">
            Carteira de pedidos de venda do Consistem: o que falta faturar, a previsão e as NFs de cada pedido. O Neo Admin só lê o ERP.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ultima?.concluida_em
              ? `Última atualização: ${dataHora(ultima.concluida_em as string)}${ultima.erro ? " (com falha)" : ""}. Atualiza sozinho a cada 30 minutos nos dias úteis.`
              : "Ainda não atualizado do Consistem."}
          </p>
        </div>
        {ehGestor && <BotoesAtualizar />}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">Não foi possível ler os pedidos.</p>}

      <Card>
        <CardHeader>
          <CardTitle>Previsão de faturamento</CardTitle>
          <CardDescription>
            Saldo a faturar dos {previsao.total.pedidos} pedidos em aberto: {formatarMoeda(previsao.total.saldoCentavos)}. Por data de previsão de faturamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table interativa={false}>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Saldo a faturar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[previsao.atrasados, ...previsao.semanas, ...previsao.meses, previsao.semPrevisao]
                .filter((f, i) => i <= previsao.semanas.length || f.pedidos > 0)
                .map((f: Faixa) => (
                  <TableRow key={f.rotulo} className={f === previsao.atrasados && f.pedidos > 0 ? "text-destructive" : ""}>
                    <TableCell className={f === previsao.atrasados ? "font-medium" : ""}>{f.rotulo}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.pedidos}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(f.saldoCentavos)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{todos ? "Todos os pedidos" : "Pedidos em aberto"}</CardTitle>
              <CardDescription>
                {todos ? `${pedidos.length} pedidos digitados nos últimos 2 anos.` : `${abertos.length} pedidos com saldo a faturar.`} Clique no pedido para ver itens, NFs e parcelas.
              </CardDescription>
            </div>
            <Link href={todos ? ROTA_PEDIDOS : `${ROTA_PEDIDOS}?ver=todos`} className="text-sm underline underline-offset-4">
              {todos ? "Ver só os em aberto" : "Ver todos, inclusive os faturados"}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {visiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido{todos ? "" : " em aberto"}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Representante</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Digitação</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead>Atraso</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Faturado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((p) => {
                  const atraso = diasAtraso(p, hoje);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums">
                        <Link href={`${ROTA_PEDIDOS}/${p.id}`} className="font-medium underline-offset-4 hover:underline">{p.cod_pedido}</Link>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={p.nome_cliente ?? ""}>{p.nome_cliente ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.nome_representante ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{rotuloSituacao(p.situacao)}</TableCell>
                      <TableCell className="tabular-nums">{formatarData(p.data_digitacao)}</TableCell>
                      <TableCell className="tabular-nums">{formatarData(p.data_prev_fat) || "—"}</TableCell>
                      <TableCell>{atraso > 0 ? <Badge variant="destructive">{atraso === 1 ? "1 dia" : `${atraso} dias`}</Badge> : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(p.valor_total))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(p.valor_faturado))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(p.valor_saldo))}</TableCell>
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
