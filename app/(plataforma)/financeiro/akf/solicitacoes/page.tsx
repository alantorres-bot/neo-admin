import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ehStatusSolicitacao, ROTA_AKF, ROTULO_STATUS_SOLICITACAO, STATUS_SOLICITACAO, type StatusSolicitacao } from "@/lib/modulos/financeiro/akf/solicitacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { listarSolicitacoes } from "./dados";

export const metadata: Metadata = { title: "Solicitações de antecipação à AKF" };

const POR_PAGINA = 50;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const COR_STATUS: Record<StatusSolicitacao, "default" | "secondary" | "outline" | "destructive"> = { rascunho: "outline", solicitada: "default", cancelada: "destructive" };

export default async function PaginaSolicitacoes({ searchParams }: PageProps<"/financeiro/akf/solicitacoes">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === "financeiro.akf");
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const parametros = await searchParams;
  const statusPedido = primeiro(parametros.status);
  const status = ehStatusSolicitacao(statusPedido) ? statusPedido : null;
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const supabase = await criarClienteServidor();
  const { linhas, total } = await listarSolicitacoes(supabase, { status, pagina, porPagina: POR_PAGINA });
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const link = (p: number) => `${ROTA_AKF}/solicitacoes?${new URLSearchParams({ ...(status ? { status } : {}), ...(p > 1 ? { pagina: String(p) } : {}) })}`;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={ROTA_AKF} />}><ArrowLeft /> Voltar à AKF</Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Solicitações de antecipação</h1>
          <p className="text-sm text-muted-foreground">Histórico do que foi pedido à AKF, com os títulos copiados no momento da solicitação. Nada é apagado: uma solicitação é solicitada ou cancelada, sempre com quem e quando.</p>
        </div>
        {podeOperar && <Button render={<Link href={`${ROTA_AKF}/solicitar`} />}>Nova solicitação</Button>}
      </div>

      <nav aria-label="Situação" className="flex flex-wrap gap-1">
        {([null, ...STATUS_SOLICITACAO] as (StatusSolicitacao | null)[]).map((s) => (
          <Button key={s ?? "todas"} size="sm" variant={s === status ? "default" : "outline"} render={<Link href={`${ROTA_AKF}/solicitacoes${s ? `?status=${s}` : ""}`} />}>
            {s ? ROTULO_STATUS_SOLICITACAO[s] : "Todas"}
          </Button>
        ))}
      </nav>

      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          {status ? "Nenhuma solicitação com esta situação." : "Nenhuma solicitação ainda. Use “Nova solicitação” para marcar os títulos."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Títulos</TableHead>
                <TableHead className="text-right">Total solicitado</TableHead>
                <TableHead>Parciais</TableHead>
                <TableHead>Sem boleto</TableHead>
                <TableHead>Montada por</TableHead>
                <TableHead>Rascunho no Gmail</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium tabular-nums"><Link href={`${ROTA_AKF}/solicitacoes/${s.id}`} className="hover:underline">{s.numero}</Link></TableCell>
                  <TableCell className="tabular-nums">{formatarData(s.data)}</TableCell>
                  <TableCell><Badge variant={COR_STATUS[s.status]}>{ROTULO_STATUS_SOLICITACAO[s.status]}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{s.itens}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(s.totalCentavos)}</TableCell>
                  <TableCell className="tabular-nums">{s.parciais > 0 ? s.parciais : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="tabular-nums">{s.semBoleto > 0 ? s.semBoleto : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{s.criadoPorNome ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.solicitadaEm ? `criado em ${formatarData(s.solicitadaEm)}` : "—"}</TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" render={<Link href={`${ROTA_AKF}/solicitacoes/${s.id}`} />}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{total} {total === 1 ? "solicitação" : "solicitações"}</span>
        {totalPaginas > 1 && (
          <span className="flex items-center gap-2">
            {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={link(pagina - 1)} />}>Anterior</Button>}
            Página {pagina} de {totalPaginas}
            {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={link(pagina + 1)} />}>Próxima</Button>}
          </span>
        )}
      </div>
    </div>
  );
}
