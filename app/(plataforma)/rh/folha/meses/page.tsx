import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pagamentoDaFolha, rotuloMes, somarMeses } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerMeses, ROTULO_STATUS, totaisDoAno, type StatusFolha, type TotaisMesFolha } from "../dados";
import { AbrirMesFolha } from "./abrir-mes";

export const metadata: Metadata = { title: "Folha de pagamento — meses" };

const COR_STATUS: Record<StatusFolha, string> = {
  aberta: "border-amber-600 text-amber-700", conferida: "border-sky-700 text-sky-800", aprovada: "border-marca text-marca", paga: "border-grade text-muted-foreground",
};

export default async function PaginaMesesFolha({ searchParams }: PageProps<"/rh/folha/meses">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const hoje = hojeEmCuiaba();
  const parametros = await searchParams;
  const ano = /^\d{4}$/.test(String(parametros.ano ?? "")) ? Number(parametros.ano) : Number(hoje.slice(0, 4));
  const supabase = await criarClienteServidor();
  const meses = await lerMeses(supabase, ano);
  const totais = await totaisDoAno(supabase, meses.map((m) => m.id));
  const porCompetencia = new Map(meses.map((m) => [m.competencia, m]));
  const empresas = [...new Set([...totais.values()].flatMap((t) => Object.keys(t.porEmpresa)))].sort();
  // Sugestão: a folha do mês corrente (paga no começo do mês seguinte).
  const sugestao = somarMeses(hoje, 0);
  const somaAno = (f: (t: TotaisMesFolha) => number) => [...totais.values()].reduce((s, t) => s + f(t), 0);
  const totalAno = somaAno((t) => t.total);
  const moeda = (centavos: number) => (centavos ? formatarMoeda(centavos) : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_FOLHA}/meses?ano=${ano - 1}`} />}>← {ano - 1}</Button>
          <span className="text-base font-bold">{ano}</span>
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_FOLHA}/meses?ano=${ano + 1}`} />}>{ano + 1} →</Button>
          <span className="ml-3 text-muted-foreground">Total do ano: <strong className="text-texto">{formatarMoeda(totalAno)}</strong></span>
        </div>
        {podeOperar && <AbrirMesFolha sugestao={porCompetencia.has(sugestao) ? null : sugestao.slice(0, 7)} />}
      </div>
      <p className="text-sm text-muted-foreground">Cada linha é a folha de um mês, paga no 5º dia útil do mês seguinte. Por empresa: líquido + férias/acréscimos (folha do escritório); 13º e avulsos à parte. A soma das colunas dá o total.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês</TableHead><TableHead>Pagamento</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Pessoas</TableHead>
            {empresas.map((e) => <TableHead key={e} className="text-right">{e}</TableHead>)}
            <TableHead className="text-right">13º</TableHead><TableHead className="text-right">Avulso</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 12 }, (_, i) => somarMeses(`${ano}-01-01`, i)).map((comp) => {
            const m = porCompetencia.get(comp);
            const t = m ? totais.get(m.id) : undefined;
            return (
              <TableRow key={comp} className={m ? "" : "text-muted-foreground"}>
                <TableCell className="font-medium">{m ? <Link href={`${ROTA_FOLHA}/mes/${m.id}`} className="text-elo hover:underline">{rotuloMes(comp)}</Link> : rotuloMes(comp)}</TableCell>
                <TableCell className="tabular-nums">{formatarData(m?.data_pagamento ?? pagamentoDaFolha(comp))}</TableCell>
                <TableCell>{m ? <Badge variant="outline" className={COR_STATUS[m.status]}>{ROTULO_STATUS[m.status]}</Badge> : "Não aberta"}</TableCell>
                <TableCell className="text-right tabular-nums">{t ? t.pessoas : ""}</TableCell>
                {empresas.map((e) => <TableCell key={e} className="text-right tabular-nums">{moeda(t?.porEmpresa[e] ?? 0)}</TableCell>)}
                <TableCell className="text-right tabular-nums">{moeda(t?.decimo ?? 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(t?.avulso ?? 0)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{t ? formatarMoeda(t.total) : ""}</TableCell>
              </TableRow>
            );
          })}
          {/* faixa de subtotal (colSpan: fica fixa no fim, fora da classificação e do filtro) */}
          <TableRow className="border-t-2 border-texto bg-cabecalho font-bold">
            <TableCell colSpan={4}>Subtotal {ano}</TableCell>
            {empresas.map((e) => <TableCell key={e} className="text-right tabular-nums">{formatarMoeda(somaAno((t) => t.porEmpresa[e] ?? 0))}</TableCell>)}
            <TableCell className="text-right tabular-nums">{formatarMoeda(somaAno((t) => t.decimo))}</TableCell>
            <TableCell className="text-right tabular-nums">{formatarMoeda(somaAno((t) => t.avulso))}</TableCell>
            <TableCell className="text-right tabular-nums">{formatarMoeda(totalAno)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
