"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { diasUteisDoMes, prazosDaCompetencia } from "@/lib/modulos/rh/vale-transporte/calendario";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { abrirMes } from "../mes/acoes";

const data = (iso: string) => iso.split("-").reverse().join("/");

/** Abre o VT de um mês com todos os colaboradores ativos; sugere os dias úteis (seg–sex; ajuste os feriados). */
export function AbrirMes({ sugestao, diasSugeridos }: { sugestao: string | null; diasSugeridos: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(sugestao ?? "");
  const [dias, setDias] = useState(String(diasSugeridos));
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const prazos = /^\d{4}-\d{2}$/.test(mes) ? prazosDaCompetencia(`${mes}-01`) : null;

  const trocarMes = (valor: string) => {
    setMes(valor);
    if (/^\d{4}-\d{2}$/.test(valor)) setDias(String(diasUteisDoMes(`${valor}-01`)));
  };

  const confirmar = () => iniciar(async () => {
    const r = await abrirMes({ mes, diasUteis: Number(dias) });
    if (!r.ok) { setErro(r.erro); return; }
    toast.success("Mês aberto com os colaboradores ativos.");
    setAberto(false);
    router.push(`${ROTA_VT}/mes/${r.id}`);
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button />}><CalendarPlus /> Abrir mês</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir o VT de um mês</DialogTitle>
          <DialogDescription>Entram todos os colaboradores ativos, com os dados do cadastro de hoje. Depois é só lançar as ocorrências.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="mes">Mês do VT</Label>
            <Input id="mes" type="month" value={mes} onChange={(e) => trocarMes(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dias">Dias úteis do mês</Label>
            <Input id="dias" type="number" min={0} max={31} value={dias} onChange={(e) => setDias(e.target.value)} />
          </div>
        </div>
        {prazos && <p className="text-sm text-muted-foreground">Pagamento em {data(prazos.pagamento)}; fechar até {data(prazos.fechamento)}. Os dias úteis sugeridos contam de segunda a sexta: desconte os feriados.</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end"><Button onClick={confirmar} disabled={pendente || !prazos}>{pendente ? "Abrindo…" : "Abrir"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
