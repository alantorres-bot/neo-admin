import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emCentavos, ROTA_PEDIDOS } from "@/lib/modulos/comercial/pedidos/carteira";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import {
  CHAVE_DIAS_ALERTA_MDFE, diasAlertaMdfe, diasDesdeEmissao, MDFE_EM_ABERTO, SITUACAO_MDFE,
} from "@/supabase/functions/_shared/consistem-comercial";

export const metadata: Metadata = { title: "MDF-e" };

type Mdfe = {
  id: string; numero: string; chave: string | null; uf_final: string | null; placas: string | null; situacao: string | null;
  data_emissao: string | null; hora_emissao: string | null; valor_carga: number | null;
};

export default async function PaginaMdfe() {
  const hoje = hojeEmCuiaba();
  const supabase = await criarClienteServidor();
  const [{ data: linhas, error }, { data: cfg }] = await Promise.all([
    supabase.from("com_mdfes").select("id, numero, chave, uf_final, placas, situacao, data_emissao, hora_emissao, valor_carga")
      .order("data_emissao", { ascending: false }).limit(2000),
    supabase.from("configuracoes").select("valor").eq("chave", CHAVE_DIAS_ALERTA_MDFE).maybeSingle(),
  ]);
  const mdfes = (linhas ?? []) as Mdfe[];
  const prazo = diasAlertaMdfe(cfg?.valor);
  const emAberto = mdfes.filter((m) => m.situacao !== null && MDFE_EM_ABERTO.includes(m.situacao));

  return (
    <>
      <div>
        <Link href={ROTA_PEDIDOS} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Pedidos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">MDF-e</h1>
        <p className="text-sm text-muted-foreground">
          Manifestos emitidos nos últimos 180 dias, lidos do Consistem a cada atualização. A API não informa as NFs de cada manifesto,
          por isso o MDF-e não aparece no pedido. Encerrar continua no Consistem.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">Não foi possível ler os manifestos.</p>}

      <Card>
        <CardHeader>
          <CardTitle>Em aberto ({emAberto.length})</CardTitle>
          <CardDescription>
            Autorizados, com pendência ou em contingência: ainda precisam ser encerrados.{" "}
            {prazo === null
              ? "O alerta na Fila do dia está desligado (o prazo ainda não foi definido em Configurações)."
              : `Com ${prazo} dias ou mais desde a emissão, viram a pendência "MDF-e não encerrado" na Fila do dia.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {emAberto.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum MDF-e em aberto.</p>
          ) : (
            <TabelaMdfe mdfes={emAberto} hoje={hoje} prazo={prazo} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Todos ({mdfes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {mdfes.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum MDF-e lido ainda.</p> : <TabelaMdfe mdfes={mdfes} hoje={hoje} prazo={prazo} />}
        </CardContent>
      </Card>
    </>
  );
}

function TabelaMdfe({ mdfes, hoje, prazo }: { mdfes: Mdfe[]; hoje: string; prazo: number | null }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>MDF-e</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead>Emissão</TableHead>
          <TableHead>Dias</TableHead>
          <TableHead>Destino</TableHead>
          <TableHead>Placa</TableHead>
          <TableHead className="text-right">Valor da carga</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mdfes.map((m) => {
          const aberto = m.situacao !== null && MDFE_EM_ABERTO.includes(m.situacao);
          const dias = diasDesdeEmissao(m.data_emissao, hoje);
          return (
            <TableRow key={m.id}>
              <TableCell className="tabular-nums" title={m.chave ?? ""}>{m.numero}</TableCell>
              <TableCell>
                <Badge variant={aberto ? (prazo !== null && dias >= prazo ? "destructive" : "outline") : "secondary"}>
                  {SITUACAO_MDFE[m.situacao ?? ""] ?? m.situacao ?? "—"}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{formatarData(m.data_emissao)}{m.hora_emissao ? ` ${m.hora_emissao.slice(0, 5)}` : ""}</TableCell>
              <TableCell className="tabular-nums">{aberto ? dias : ""}</TableCell>
              <TableCell>{m.uf_final ?? "—"}</TableCell>
              <TableCell>{m.placas ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{m.valor_carga === null ? "—" : formatarMoeda(emCentavos(m.valor_carga))}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
