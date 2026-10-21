"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { devolverOuCancelarFechamento, passoFechamento } from "../../acoes";
import type { StatusFechamento } from "../../dados";

const ETAPAS: { status: StatusFechamento; rotulo: string }[] = [
  { status: "emitido", rotulo: "1. Emitido" }, { status: "aprovado", rotulo: "2. Aprovado pelo gestor" },
  { status: "enviado", rotulo: "3. Enviado ao escritório" }, { status: "lancado", rotulo: "4. Lançado na folha" },
];

/** Os passos do fechamento, com o próximo botão de quem pode clicar. */
export function PassosFechamento({ id, status, podeOperar, ehGestor }: { id: string; status: StatusFechamento; podeOperar: boolean; ehGestor: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [acaoMotivo, setAcaoMotivo] = useState<"devolver" | "cancelar" | null>(null);
  const atual = ETAPAS.findIndex((e) => e.status === status);
  const passo = (p: "aprovar" | "enviado" | "lancado") => iniciar(async () => {
    const r = await passoFechamento(id, p);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Feito."); router.refresh(); }
  });

  if (status === "cancelado" || status === "devolvido") return null;
  return (
    <div className="space-y-3 rounded-[3px] border border-grade p-3">
      <ol className="flex flex-wrap gap-2 text-sm">
        {ETAPAS.map((e, i) => (
          <li key={e.status} className={`rounded-[3px] border px-2 py-1 ${i <= atual ? "border-marca font-medium" : "border-grade text-muted-foreground"}`}>{e.rotulo}{i <= atual ? " ✓" : ""}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {status === "emitido" && (ehGestor
          ? <Button onClick={() => passo("aprovar")} disabled={pendente}>Aprovar</Button>
          : <span className="text-sm text-muted-foreground">Próximo passo: o gestor do RH confere e aprova.</span>)}
        {status === "aprovado" && podeOperar && (
          <>
            <span className="text-sm">Imprima o relatório e envie ao escritório contábil junto com o ponto. Depois:</span>
            <Button onClick={() => passo("enviado")} disabled={pendente}>Enviado ao escritório</Button>
          </>
        )}
        {status === "enviado" && podeOperar && (
          <>
            <span className="text-sm">Quando o escritório lançar na folha (horas extras e descontos), clique:</span>
            <Button onClick={() => passo("lancado")} disabled={pendente}>Lançado na folha</Button>
          </>
        )}
        {status === "lancado" && <span className="text-sm text-muted-foreground">Concluído: as horas pagas e descontadas já saíram do saldo de cada pessoa.</span>}
        {ehGestor && (
          <span className="ml-auto flex items-center gap-1">
            {acaoMotivo ? (
              <>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo" className="h-8 w-56" maxLength={300} />
                <Button size="sm" variant="destructive" disabled={pendente || motivo.trim().length < 5}
                  onClick={() => iniciar(async () => { const r = await devolverOuCancelarFechamento(id, acaoMotivo, motivo); if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Feito."); router.refresh(); } })}>
                  Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAcaoMotivo(null)}>Voltar</Button>
              </>
            ) : (
              <>
                {(status === "emitido" || status === "aprovado") && <Button size="sm" variant="ghost" onClick={() => setAcaoMotivo("devolver")}>Devolver</Button>}
                <Button size="sm" variant="ghost" onClick={() => setAcaoMotivo("cancelar")}>Cancelar</Button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
