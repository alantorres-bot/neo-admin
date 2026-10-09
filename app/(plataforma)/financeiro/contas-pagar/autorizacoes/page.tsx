import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ehStatus, ROTULO_STATUS, type StatusAutorizacao } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { listarAutorizacoes } from "../dados";

export const metadata: Metadata = { title: "Autorizações de pagamento" };

const POR_PAGINA = 50;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string) => Math.round(Number(v) * 100);
const COR_STATUS: Record<StatusAutorizacao, "default" | "secondary" | "outline" | "destructive"> = { rascunho: "outline", autorizada: "default", cancelada: "destructive" };

export default async function PaginaAutorizacoes({ searchParams }: PageProps<"/financeiro/contas-pagar/autorizacoes">) {
  await exigirSessao();
  const parametros = await searchParams;
  const statusPedido = primeiro(parametros.status);
  const status = ehStatus(statusPedido) ? statusPedido : null;
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const supabase = await criarClienteServidor();
  const { linhas, total } = await listarAutorizacoes(supabase, { status, pagina, porPagina: POR_PAGINA });
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const link = (p: number) => `${ROTA_CONTAS_PAGAR}/autorizacoes?${new URLSearchParams({ ...(status ? { status } : {}), ...(p > 1 ? { pagina: String(p) } : {}) })}`;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold">Autorizações de pagamento</h2>
        <p className="text-xs text-muted-foreground">Histórico com os itens copiados no momento da autorização. Nada é apagado: uma autorização é autorizada ou cancelada, sempre com quem e quando.</p>
      </div>

      <nav aria-label="Situação" className="flex flex-wrap gap-1">
        {([null, "rascunho", "autorizada", "cancelada"] as (StatusAutorizacao | null)[]).map((s) => (
          <Button key={s ?? "todas"} size="sm" variant={s === status ? "default" : "outline"} render={<Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes${s ? `?status=${s}` : ""}`} />}>
            {s ? ROTULO_STATUS[s] : "Todas"}
          </Button>
        ))}
      </nav>

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {status ? "Nenhuma autorização com esta situação." : "Nenhuma autorização ainda. Marque itens em “Autorizar pagamento” e clique em “Gerar autorização”."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Títulos</TableHead>
                <TableHead className="text-right">Antecipações</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Baixados no Consistem</TableHead>
                <TableHead>Montada por</TableHead>
                <TableHead>Autorizada por</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium tabular-nums"><Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes/${a.id}`} className="hover:underline">nº {a.numero}</Link></TableCell>
                  <TableCell className="tabular-nums">{formatarData(a.data)}</TableCell>
                  <TableCell><Badge variant={COR_STATUS[a.status]}>{ROTULO_STATUS[a.status]}</Badge></TableCell>
                  <TableCell>{a.empresa_nome}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(centavos(a.total_titulos))}<span className="block text-[11px] text-muted-foreground">{a.titulos}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(centavos(a.total_antecipacoes))}<span className="block text-[11px] text-muted-foreground">{a.antecipacoes}</span></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(centavos(a.total))}<span className="block text-[11px] font-normal text-muted-foreground">{a.itens} {a.itens === 1 ? "item" : "itens"}</span></TableCell>
                  <TableCell className="tabular-nums">{a.status === "cancelada" ? "—" : `${a.baixados} de ${a.itens}`}</TableCell>
                  <TableCell>{a.criado_por_nome ?? "—"}</TableCell>
                  <TableCell>{a.autorizada_por_nome ? <>{a.autorizada_por_nome}<span className="block text-[11px] text-muted-foreground">{a.autorizada_em ? formatarData(a.autorizada_em) : ""}</span></> : "—"}</TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" render={<Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes/${a.id}`} />}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{total} {total === 1 ? "autorização" : "autorizações"}</span>
        {totalPaginas > 1 && (
          <span className="flex items-center gap-2">
            {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={link(pagina - 1)} />}>Anterior</Button>}
            Página {pagina} de {totalPaginas}
            {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={link(pagina + 1)} />}>Próxima</Button>}
          </span>
        )}
      </div>
    </section>
  );
}
