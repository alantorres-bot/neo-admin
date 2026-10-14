import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diasUteisDoMes, prazosDaCompetencia, rotuloMes, somarMeses } from "@/lib/modulos/rh/calendario";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerMeses, ROTULO_STATUS, totaisDoAno, type StatusMes } from "../dados";
import { AbrirMes } from "./abrir-mes";

export const metadata: Metadata = { title: "Vale-transporte — meses" };

const COR_STATUS: Record<StatusMes, string> = {
  aberta: "border-amber-600 text-amber-700", enviada: "border-sky-700 text-sky-800", aprovada: "border-marca text-marca", paga: "border-grade text-muted-foreground",
};

export default async function PaginaMeses({ searchParams }: PageProps<"/rh/vale_transporte/meses">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const hoje = hojeEmCuiaba();
  const parametros = await searchParams;
  const anoAtual = Number(hoje.slice(0, 4));
  const ano = /^\d{4}$/.test(String(parametros.ano ?? "")) ? Number(parametros.ano) : anoAtual;
  const supabase = await criarClienteServidor();
  const meses = await lerMeses(supabase, ano);
  const totais = await totaisDoAno(supabase, meses.map((m) => m.id));
  const porCompetencia = new Map(meses.map((m) => [m.competencia, m]));
  // Próximo mês a abrir: o do VT que se paga no fim deste mês.
  const proximo = somarMeses(hoje, 1);
  const sugestaoAberta = podeOperar && !porCompetencia.has(proximo) && proximo.startsWith(String(ano));
  const totalAno = [...totais.values()].reduce((s, t) => s + Math.round(t.total * 100), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_VT}/meses?ano=${ano - 1}`} />}>← {ano - 1}</Button>
          <span className="text-base font-bold">{ano}</span>
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_VT}/meses?ano=${ano + 1}`} />}>{ano + 1} →</Button>
          <span className="ml-3 text-muted-foreground">Total do ano: <strong className="text-texto">{formatarMoeda(totalAno)}</strong></span>
        </div>
        {podeOperar && <AbrirMes sugestao={sugestaoAberta ? proximo.slice(0, 7) : null} diasSugeridos={diasUteisDoMes(proximo)} />}
      </div>
      <p className="text-sm text-muted-foreground">
        Cada linha é o VT de um mês, pago no último dia útil do mês anterior. Faltas, atestados e extras lançados no mês são os do mês que fecha; férias e afastamentos contam no mês do VT.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês do VT</TableHead><TableHead>Pagamento</TableHead><TableHead>Prazo para fechar</TableHead><TableHead>Situação</TableHead>
            <TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">FOPAG</TableHead><TableHead className="text-right">PIX</TableHead><TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 12 }, (_, i) => somarMeses(`${ano}-01-01`, i)).map((comp) => {
            const m = porCompetencia.get(comp);
            const t = m ? totais.get(m.id) : undefined;
            const prazos = prazosDaCompetencia(comp);
            return (
              <TableRow key={comp} className={m ? "" : "text-muted-foreground"}>
                <TableCell className="font-medium">
                  {m ? <Link href={`${ROTA_VT}/mes/${m.id}`} className="text-elo hover:underline">{rotuloMes(comp)}</Link> : rotuloMes(comp)}
                </TableCell>
                <TableCell className="tabular-nums">{formatarData(m?.data_pagamento ?? prazos.pagamento)}</TableCell>
                <TableCell className="tabular-nums">{formatarData(m?.prazo_fechamento ?? prazos.fechamento)}</TableCell>
                <TableCell>
                  {m ? <Badge variant="outline" className={COR_STATUS[m.status]}>{ROTULO_STATUS[m.status]}{m.importada ? " (planilha)" : ""}</Badge> : "Não aberto"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t ? t.pessoas : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{t ? formatarMoeda(Math.round(t.fopag * 100)) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{t ? formatarMoeda(Math.round(t.pix * 100)) : ""}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{t ? formatarMoeda(Math.round(t.total * 100)) : ""}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
