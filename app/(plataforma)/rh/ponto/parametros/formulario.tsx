"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarPrazo } from "../acoes";

export function FormularioPrazo({ dias, ehGestor }: { dias: number; ehGestor: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(dias));
  const [pendente, iniciar] = useTransition();
  const salvar = () => iniciar(async () => {
    const r = await salvarPrazo(Number(valor));
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Salvo."); router.refresh(); }
  });
  return (
    <div className="flex items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="prazoLider">Prazo do líder (dias úteis)</Label>
        <Input id="prazoLider" type="number" min={1} max={10} value={valor} onChange={(e) => setValor(e.target.value)} disabled={!ehGestor} className="h-8 w-24" />
      </div>
      {ehGestor && <Button size="sm" onClick={salvar} disabled={pendente || Number(valor) === dias}>{pendente ? "Salvando…" : "Salvar"}</Button>}
    </div>
  );
}
