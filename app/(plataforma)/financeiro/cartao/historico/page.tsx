import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLASSE_SITUACAO, ROTULO_SITUACAO, rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerCartoes, listarCiclos, quandoEm } from "../dados";

export const metadata: Metadata = { title: "Histórico do cartão" };

const centavos = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));

/** Todos os meses de um cartão, do mais recente ao mais antigo. */
export default async function PaginaHistorico({ searchParams }: PageProps<"/financeiro/cartao/historico">) {
  await exigirSessao();
  const pedido = (await searchParams).cartao;
  const codigo = typeof pedido === "string" ? pedido : "";
  const supabase = await criarClienteServidor();
  const cartao = (await lerCartoes(supabase)).find((c) => c.codigo === codigo);
  if (!cartao) notFound();
  const ciclos = await listarCiclos(supabase, { cartao: cartao.codigo });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_CARTAO}/meses`} />}><ArrowLeft /> Meses</Button>
      <div>
        <h2 className="text-lg font-bold">Histórico · {cartao.nome}</h2>
        <p className="text-sm text-muted-foreground">{cartao.banco} · {cartao.tipo_pessoa} · fecha dia {cartao.dia_fechamento} e vence dia {cartao.dia_vencimento}</p>
      </div>
      {ciclos.length === 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Nenhum mês ainda para este cartão.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead><TableHead>Fechamento</TableHead><TableHead>Vencimento</TableHead><TableHead>Situação</TableHead>
              <TableHead className="text-right">Total da fatura</TableHead><TableHead className="text-right">A lançar</TableHead><TableHead>Fechada</TableHead><TableHead>Paga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ciclos.map((c) => {
              const total = centavos(c.total_fatura);
              return (
                <TableRow key={c.id}>
                  <TableCell><Link href={`${ROTA_CARTAO}/ciclo/${c.id}`} className="font-medium text-elo hover:underline">{rotuloCompetencia(c.competencia)}</Link></TableCell>
                  <TableCell className="tabular-nums">{formatarData(c.fechamento)}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(c.vencimento_nominal)}</TableCell>
                  <TableCell><span className={`rounded-[3px] border px-2 py-0.5 text-xs ${CLASSE_SITUACAO[c.situacao]}`}>{ROTULO_SITUACAO[c.situacao]}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{total !== null ? formatarMoeda(total) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.situacao === "em_conciliacao" && c.itens_a_lancar !== null ? c.itens_a_lancar : ""}</TableCell>
                  <TableCell className="text-muted-foreground">{c.fechada_em ? `${quandoEm(c.fechada_em)}${c.fechada_por_nome ? ` · ${c.fechada_por_nome}` : ""}` : ""}</TableCell>
                  <TableCell className="tabular-nums">{c.paga_em ? formatarData(c.paga_em) : ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
