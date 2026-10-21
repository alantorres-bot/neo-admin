"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { horas, minutos } from "@/lib/modulos/rh/ponto/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { registrarPagamento } from "../acoes";

type Linha = { id: string; nome: string; setor: string; vencidoMin: number };

function LinhaPagar({ l, podeOperar }: { l: Linha; podeOperar: boolean }) {
  const router = useRouter();
  const [horasTxt, setHoras] = useState(horas(l.vencidoMin));
  const [mes, setMes] = useState(hojeEmCuiaba().slice(0, 7));
  const [obs, setObs] = useState("");
  const [pendente, iniciar] = useTransition();
  const min = minutos(horasTxt);
  const valido = min !== null && min > 0 && min <= l.vencidoMin && /^\d{4}-\d{2}$/.test(mes);
  return (
    <TableRow>
      <TableCell className="font-medium">{l.nome}</TableCell>
      <TableCell>{l.setor}</TableCell>
      <TableCell className="text-right tabular-nums font-medium text-destructive">{horas(l.vencidoMin)}</TableCell>
      {podeOperar && (
        <>
          <TableCell><Input value={horasTxt} onChange={(e) => setHoras(e.target.value)} aria-label={`Horas pagas de ${l.nome}`} className="h-8 w-20" maxLength={6} /></TableCell>
          <TableCell><Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Folha" className="h-8 w-36" /></TableCell>
          <TableCell><Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" aria-label="Observação" className="h-8 w-48" maxLength={300} /></TableCell>
          <TableCell>
            <Button size="sm" disabled={pendente || !valido}
              onClick={() => iniciar(async () => {
                const r = await registrarPagamento({ pessoa: l.id, minutos: min!, competencia: mes, observacao: obs });
                if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Registrado."); router.refresh(); }
              })}>
              Pago na folha
            </Button>
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

export function GradePagar({ linhas, podeOperar }: { linhas: Linha[]; podeOperar: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pessoa</TableHead><TableHead>Setor</TableHead><TableHead className="text-right">Vencido</TableHead>
          {podeOperar && <><TableHead>Horas pagas</TableHead><TableHead>Folha</TableHead><TableHead>Observação</TableHead><TableHead /></>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.length === 0 && <TableRow><TableCell colSpan={podeOperar ? 7 : 3} className="text-center text-muted-foreground">Nada vencido a pagar.</TableCell></TableRow>}
        {linhas.map((l) => <LinhaPagar key={`${l.id}-${l.vencidoMin}`} l={l} podeOperar={podeOperar} />)}
      </TableBody>
    </Table>
  );
}
