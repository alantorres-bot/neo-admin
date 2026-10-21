import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_PONTO, ROTULO_STATUS } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerLotes, lerSetores } from "../dados";
import { ImportarRelatorio } from "./importar";
import { COR_STATUS } from "./status";

export const metadata: Metadata = { title: "Ponto — quinzenas" };

export default async function PaginaLotesPonto({ searchParams }: PageProps<"/rh/ponto/lotes">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const hoje = hojeEmCuiaba();
  const parametros = await searchParams;
  const ano = /^\d{4}$/.test(String(parametros.ano ?? "")) ? Number(parametros.ano) : Number(hoje.slice(0, 4));
  const supabase = await criarClienteServidor();
  const [lotes, setores] = await Promise.all([lerLotes(supabase, ano), lerSetores(supabase)]);
  const ativos = setores.filter((s) => s.ativo).map((s) => ({ id: s.id, nome: s.nome }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_PONTO}/lotes?ano=${ano - 1}`} />}>← {ano - 1}</Button>
          <span className="text-base font-bold">{ano}</span>
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_PONTO}/lotes?ano=${ano + 1}`} />}>{ano + 1} →</Button>
        </div>
        {podeOperar && <ImportarRelatorio setores={ativos} />}
      </div>
      {setores.length === 0 && (
        <p className="rounded-[3px] border border-amber-600/50 p-3 text-sm text-amber-800">
          Nenhum setor cadastrado. O gestor do RH cadastra o setor e o líder em <Link href={`${ROTA_PONTO}/setores`} className="underline">Setores e líderes</Link>.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Setor</TableHead><TableHead>Período</TableHead><TableHead>Situação</TableHead><TableHead>Prazo do líder</TableHead>
            <TableHead className="text-right">Ocorrências</TableHead><TableHead className="text-right">Justificadas</TableHead><TableHead className="text-right">Ajustadas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lotes.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma quinzena importada em {ano}.</TableCell></TableRow>}
          {lotes.map((l) => {
            const vencido = (l.status === "enviado" || l.status === "devolvido") && l.prazo !== null && l.prazo < hoje;
            return (
              <TableRow key={l.id} className={l.status === "cancelado" ? "text-muted-foreground line-through" : ""}>
                <TableCell className="font-medium"><Link href={`${ROTA_PONTO}/lote/${l.id}`} className="text-elo hover:underline">{l.setor}</Link></TableCell>
                <TableCell className="tabular-nums">{formatarData(l.periodo_inicio)} a {formatarData(l.periodo_fim)}</TableCell>
                <TableCell><Badge variant="outline" className={COR_STATUS[l.status]}>{ROTULO_STATUS[l.status]}</Badge></TableCell>
                <TableCell className={`tabular-nums ${vencido ? "font-medium text-destructive" : ""}`}>{l.status === "enviado" || l.status === "devolvido" ? formatarData(l.prazo) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{l.ocorrencias}</TableCell>
                <TableCell className="text-right tabular-nums">{l.justificadas}</TableCell>
                <TableCell className="text-right tabular-nums">{l.ajustadas}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
