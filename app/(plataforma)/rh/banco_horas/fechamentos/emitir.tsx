"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { emitirFechamento } from "../acoes";

/** Emite o fechamento do mês: foto de quem vence até o dia 25 (a empresa paga / descontar). */
export function EmitirFechamento({ sugestao }: { sugestao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(sugestao);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const [a, m] = mes.split("-");
  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button />}><ClipboardCheck /> Emitir fechamento</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Emitir o fechamento do banco de horas</DialogTitle>
          <DialogDescription>
            Antes, importe o CSV do Control iD até o dia 25 do mês (Neo e Oeste). O sistema lista quem venceu até o dia 25: a empresa paga as horas a mais e
            desconta as horas a menos, na folha do mês.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="mesFech">Folha do mês</Label>
          <Input id="mesFech" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          {a && m && <p className="text-sm text-muted-foreground">Ciclo que fecha em 25/{m}/{a}.</p>}
        </div>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end">
          <Button disabled={pendente || !/^\d{4}-\d{2}$/.test(mes)}
            onClick={() => iniciar(async () => { const r = await emitirFechamento(mes); if (!r.ok) setErro(r.erro); else { setAberto(false); router.push(`${ROTA_BANCO_HORAS}/fechamentos/${r.id}`); } })}>
            {pendente ? "Emitindo…" : "Emitir"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
