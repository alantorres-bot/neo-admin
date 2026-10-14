import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { somarMeses } from "@/lib/modulos/rh/calendario";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerResumoAno } from "../dados";

export const metadata: Metadata = { title: "Vale-transporte — resumo do ano" };

const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Fechamento do ano: quanto cada pessoa recebeu de VT em cada mês (mês do VT), com totais por pessoa e por mês. */
export default async function PaginaAno({ searchParams }: PageProps<"/rh/vale_transporte/ano">) {
  await exigirSessao();
  const parametros = await searchParams;
  const ano = /^\d{4}$/.test(String(parametros.ano ?? "")) ? Number(parametros.ano) : Number(hojeEmCuiaba().slice(0, 4));
  const supabase = await criarClienteServidor();
  const { meses, linhas } = await lerResumoAno(supabase, ano);
  const competencias = Array.from({ length: 12 }, (_, i) => somarMeses(`${ano}-01-01`, i));
  const abertos = new Set(meses.map((m) => m.competencia));
  const totalMes = (c: string) => linhas.reduce((s, l) => s + Math.round((l.valores[c] ?? 0) * 100), 0) / 100;
  const totalPessoa = (v: Record<string, number>) => Object.values(v).reduce((s, x) => s + Math.round(x * 100), 0) / 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" size="sm" render={<Link href={`${ROTA_VT}/ano?ano=${ano - 1}`} />}>← {ano - 1}</Button>
        <span className="text-base font-bold">{ano}</span>
        <Button variant="outline" size="sm" render={<Link href={`${ROTA_VT}/ano?ano=${ano + 1}`} />}>{ano + 1} →</Button>
      </div>
      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Nenhum mês de {ano} no módulo.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead><TableHead>Funcionário</TableHead>
              {competencias.map((c, i) => <TableHead key={c} className="text-right">{MES_CURTO[i]}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.colaborador_id}>
                <TableCell className="tabular-nums">{l.cod_fornecedor}</TableCell>
                <TableCell className="whitespace-nowrap">{l.nome}</TableCell>
                {competencias.map((c) => <TableCell key={c} className="text-right text-xs tabular-nums">{l.valores[c] ? reais(l.valores[c]) : abertos.has(c) ? "—" : ""}</TableCell>)}
                <TableCell className="text-right font-medium tabular-nums">{reais(totalPessoa(l.valores))}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold">
              <TableCell colSpan={2}>Total do mês</TableCell>
              {competencias.map((c) => <TableCell key={c} className="text-right text-xs tabular-nums">{abertos.has(c) ? reais(totalMes(c)) : ""}</TableCell>)}
              <TableCell className="text-right tabular-nums">{reais(linhas.reduce((s, l) => s + Math.round(totalPessoa(l.valores) * 100), 0) / 100)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
