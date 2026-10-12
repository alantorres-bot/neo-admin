import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerCartoes, listarFaturas, quandoEm } from "../dados";

export const metadata: Metadata = { title: "Faturas do cartão" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string) => Math.round(Number(v) * 100);

export default async function PaginaFaturas({ searchParams }: PageProps<"/financeiro/cartao/faturas">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const parametros = await searchParams;
  const statusPedido = primeiro(parametros.status);
  const status = statusPedido === "cancelada" ? "cancelada" : statusPedido === "todas" ? null : "importada";
  const cartaoPedido = primeiro(parametros.cartao);

  const supabase = await criarClienteServidor();
  const [cartoes, faturas] = await Promise.all([lerCartoes(supabase), listarFaturas(supabase, { status, cartao: cartaoPedido || null })]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          <select name="cartao" defaultValue={cartaoPedido} aria-label="Cartão" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
            <option value="">Todos os cartões</option>
            {cartoes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
          </select>
          <select name="status" defaultValue={status ?? "todas"} aria-label="Situação" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
            <option value="importada">Importadas</option>
            <option value="cancelada">Canceladas</option>
            <option value="todas">Todas</option>
          </select>
          <Button type="submit" variant="outline" size="sm">Filtrar</Button>
        </form>
        {podeOperar && <Button variant="outline" render={<Link href={`${ROTA_CARTAO}/nova`} />}><Plus /> Importar fatura avulsa</Button>}
      </div>

      {faturas.length === 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-4 text-sm text-muted-foreground">
          Nenhuma fatura {status === "cancelada" ? "cancelada" : "importada"} ainda. O caminho normal é importar pela aba Meses, no mês do cartão.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cartão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead className="text-right">Total da fatura</TableHead>
              <TableHead className="text-right">Linhas</TableHead>
              <TableHead>Importada</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Mês</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {faturas.map((f) => (
              <TableRow key={f.id}>
                <TableCell><Link href={`${ROTA_CARTAO}/${f.id}`} className="font-medium text-elo hover:underline">{f.cartao_nome}</Link></TableCell>
                <TableCell className="tabular-nums">{formatarData(f.vencimento)}</TableCell>
                <TableCell>{f.empresa_nome}</TableCell>
                <TableCell className="text-right tabular-nums">{formatarMoeda(centavos(f.total_informado))}</TableCell>
                <TableCell className="text-right tabular-nums">{f.linhas_lidas - f.linhas_descartadas}{f.linhas_descartadas > 0 && <span className="text-muted-foreground"> (+{f.linhas_descartadas})</span>}</TableCell>
                <TableCell className="text-muted-foreground">{quandoEm(f.importado_em)}{f.importado_por_nome ? ` · ${f.importado_por_nome}` : ""}</TableCell>
                <TableCell>
                  {f.status === "cancelada"
                    ? <Badge variant="outline" title={f.motivo_cancelamento ?? ""}>Cancelada</Badge>
                    : <Badge variant="outline" className="border-marca text-marca">Importada</Badge>}
                </TableCell>
                <TableCell>{f.ciclo_id ? <Link href={`${ROTA_CARTAO}/ciclo/${f.ciclo_id}`} className="text-elo hover:underline">abrir o mês</Link> : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
