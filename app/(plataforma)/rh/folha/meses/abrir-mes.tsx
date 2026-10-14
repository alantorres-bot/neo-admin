"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pagamentoDaFolha } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { abrirMes } from "../mes/acoes";

const data = (iso: string) => iso.split("-").reverse().join("/");

/** Abre a folha de um mês com todos os colaboradores ativos (valores zerados, para lançar). */
export function AbrirMesFolha({ sugestao }: { sugestao: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(sugestao ?? "");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const valido = /^\d{4}-\d{2}$/.test(mes);

  const confirmar = () => iniciar(async () => {
    const r = await abrirMes(mes);
    if (!r.ok) { setErro(r.erro); return; }
    toast.success("Folha aberta com os colaboradores ativos.");
    setAberto(false);
    router.push(`${ROTA_FOLHA}/mes/${r.id}`);
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button />}><CalendarPlus /> Abrir mês</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir a folha de um mês</DialogTitle>
          <DialogDescription>Entram todos os colaboradores ativos do cadastro, com os dados de hoje e os valores zerados.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="mesFolha">Mês da folha</Label>
          <Input id="mesFolha" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
        {valido && <p className="text-sm text-muted-foreground">Pagamento até {data(pagamentoDaFolha(`${mes}-01`))} (5º dia útil do mês seguinte; feriados não contados).</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end"><Button onClick={confirmar} disabled={pendente || !valido}>{pendente ? "Abrindo…" : "Abrir"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
