"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { horas, minutos } from "@/lib/modulos/rh/ponto/modulo";
import { salvarParametros } from "../acoes";
import type { Parametros } from "../dados";

export function FormularioParametros({ par, ehGestor }: { par: Parametros; ehGestor: boolean }) {
  const router = useRouter();
  const [inicio, setInicio] = useState(par.inicio);
  const [validade, setValidade] = useState(String(par.validadeMeses));
  const [aviso, setAviso] = useState(String(par.avisoDias));
  const [limite, setLimite] = useState(horas(par.limiteNegativoMin));
  const [pendente, iniciar] = useTransition();
  const salvar = () => iniciar(async () => {
    const r = await salvarParametros({ inicio, validadeMeses: Number(validade), avisoDias: Number(aviso), limiteNegativoMin: minutos(limite) ?? -1 });
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Salvo."); router.refresh(); }
  });
  const campo = "grid gap-1.5";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className={campo}><Label htmlFor="bhInicio">Início da conta (dia 26)</Label><Input id="bhInicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={!ehGestor} className="h-8 w-40" /></div>
      <div className={campo}><Label htmlFor="bhValidade">Validade (meses)</Label><Input id="bhValidade" type="number" min={1} max={24} value={validade} onChange={(e) => setValidade(e.target.value)} disabled={!ehGestor} className="h-8 w-24" /></div>
      <div className={campo}><Label htmlFor="bhAviso">Aviso (dias antes)</Label><Input id="bhAviso" type="number" min={1} max={120} value={aviso} onChange={(e) => setAviso(e.target.value)} disabled={!ehGestor} className="h-8 w-24" /></div>
      <div className={campo}><Label htmlFor="bhLimite">Alerta de negativo (hh:mm)</Label><Input id="bhLimite" value={limite} onChange={(e) => setLimite(e.target.value)} disabled={!ehGestor} className="h-8 w-24" maxLength={6} /></div>
      {ehGestor && <Button size="sm" onClick={salvar} disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</Button>}
    </div>
  );
}
