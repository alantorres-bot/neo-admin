"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelarPagamento } from "../../acoes";

/** Cancela um pagamento na folha lançado por engano (gestor, com motivo; nada é apagado). */
export function CancelarPagamento({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  if (!aberto) return <Button size="sm" variant="ghost" onClick={() => setAberto(true)}>Cancelar</Button>;
  return (
    <div className="flex items-center gap-1">
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo do cancelamento" className="h-8 w-48" maxLength={300} />
      <Button size="sm" variant="destructive" disabled={pendente || motivo.trim().length < 5}
        onClick={() => iniciar(async () => { const r = await cancelarPagamento(id, motivo); if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Cancelado."); router.refresh(); } })}>
        Confirmar
      </Button>
    </div>
  );
}
