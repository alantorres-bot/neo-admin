import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EM_ANDAMENTO, ehStatus, ROTA_INTIMACOES, ROTULO_STATUS, STATUS, type StatusIntimacao } from "@/lib/modulos/financeiro/intimacoes/intimacoes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoLerGmail } from "./componentes";
import { listarIntimacoes } from "./dados";

export const metadata: Metadata = { title: "Intimações de cartório" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));
const COR: Partial<Record<StatusIntimacao, "default" | "secondary" | "outline" | "destructive">> = {
  revisao: "destructive", aguardando_aprovacao: "default", adiantamento_pendente: "default", concluida: "secondary", descartada: "outline",
};

export default async function PaginaIntimacoes({ searchParams }: PageProps<"/financeiro/intimacoes">) {
  const sessao = await exigirSessao();
  const pedido = primeiro((await searchParams).status);
  const filtro: readonly StatusIntimacao[] = pedido === "todas" ? STATUS : ehStatus(pedido) ? [pedido] : EM_ANDAMENTO;
  const supabase = await criarClienteServidor();
  const linhas = await listarIntimacoes(supabase, filtro);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Etapa" className="flex flex-wrap gap-1">
          <Button size="sm" variant={!pedido ? "default" : "outline"} render={<Link href={ROTA_INTIMACOES} />}>Em andamento</Button>
          {(["aguardando_aprovacao", "adiantamento_pendente", "revisao", "concluida"] as StatusIntimacao[]).map((s) => (
            <Button key={s} size="sm" variant={pedido === s ? "default" : "outline"} render={<Link href={`${ROTA_INTIMACOES}?status=${s}`} />}>{ROTULO_STATUS[s]}</Button>
          ))}
          <Button size="sm" variant={pedido === "todas" ? "default" : "outline"} render={<Link href={`${ROTA_INTIMACOES}?status=todas`} />}>Todas</Button>
        </nav>
        {temAcesso(sessao.acesso, "financeiro", "operador") && <BotaoLerGmail />}
      </div>

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma intimação nesta etapa. As intimações chegam pela leitura do Gmail (4º Ofício e aviso da CENPROT).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Recebida</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Credor</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="text-right">Custas</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((i) => {
                const valor = centavos(i.valor_titulo);
                const custas = centavos(i.valor_custas);
                return (
                  <TableRow key={i.id}>
                    <TableCell><Link className="underline-offset-2 hover:underline" href={`${ROTA_INTIMACOES}/${i.id}`}>{formatarData(i.criado_em)}</Link></TableCell>
                    <TableCell><Badge variant={COR[i.status] ?? "outline"}>{ROTULO_STATUS[i.status]}</Badge></TableCell>
                    <TableCell>{i.credor_nome ?? <span className="text-muted-foreground">a informar</span>}</TableCell>
                    <TableCell>{i.numero_titulo ?? "—"}{i.cod_lancamento ? ` · lanç. ${i.cod_lancamento}` : ""}</TableCell>
                    <TableCell className="text-right">{valor === null ? "—" : formatarMoeda(valor)}</TableCell>
                    <TableCell>{formatarData(i.data_limite) || "—"}</TableCell>
                    <TableCell className="text-right">{custas === null ? "—" : formatarMoeda(custas)}</TableCell>
                    <TableCell>{i.protocolo ? `Protocolo ${i.protocolo}` : "Só localizador"} · {i.dados_portal_em ? "portal do 4º Ofício" : i.origem === "cenprot" ? "CENPROT" : "4º Ofício"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
