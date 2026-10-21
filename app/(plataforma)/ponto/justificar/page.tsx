import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_JUSTIFICAR, ROTULO_STATUS } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { COR_STATUS } from "@/app/(plataforma)/rh/ponto/lotes/status";
import { lerLotesDoLider } from "./dados";

export const metadata: Metadata = { title: "Ponto do setor" };

/** Histórico do líder: as quinzenas dos setores em que ele é titular ou substituto. */
export default async function PaginaPontoDoLider() {
  await exigirSessao();
  const supabase = await criarClienteServidor();
  const lotes = await lerLotesDoLider(supabase);
  const hoje = hojeEmCuiaba();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ponto do setor</h1>
        <p className="text-sm text-muted-foreground">Inconsistências do ponto que o RH enviou para você justificar.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Setor</TableHead><TableHead>Período</TableHead><TableHead>Situação</TableHead><TableHead>Prazo</TableHead><TableHead className="text-right">Justificadas</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {lotes.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nada para você por aqui.</TableCell></TableRow>}
          {lotes.map((l) => {
            const aberto = l.status === "enviado" || l.status === "devolvido";
            return (
              <TableRow key={l.id}>
                <TableCell className="font-medium"><Link href={`${ROTA_JUSTIFICAR}/${l.id}`} className="text-elo hover:underline">{l.setor}</Link></TableCell>
                <TableCell className="tabular-nums">{formatarData(l.periodo_inicio)} a {formatarData(l.periodo_fim)}</TableCell>
                <TableCell><Badge variant="outline" className={COR_STATUS[l.status]}>{aberto ? "Para justificar" : ROTULO_STATUS[l.status]}</Badge></TableCell>
                <TableCell className={`tabular-nums ${aberto && l.prazo && l.prazo < hoje ? "font-medium text-destructive" : ""}`}>{aberto ? formatarData(l.prazo) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{l.justificadas} de {l.ocorrencias}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
