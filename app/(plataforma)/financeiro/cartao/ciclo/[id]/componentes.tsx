"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fecharCiclo, reabrirCiclo } from "../../acoes";

/** "Fechar o mês" (gestor). Desabilitado, com o motivo, enquanto houver algo a lançar ou diferença. Confirmação em dois cliques. */
export function BotaoFechar({ id, rotulo, bloqueio }: { id: string; rotulo: string; bloqueio: string | null }) {
  const router = useRouter();
  const [armado, setArmado] = useState(false);
  const [pendente, iniciar] = useTransition();
  if (bloqueio) return <Button disabled title={bloqueio}>Fechar o mês</Button>;
  if (!armado) return <Button onClick={() => setArmado(true)}>Fechar o mês</Button>;
  return (
    <div role="alert" className="flex max-w-md flex-col gap-2 rounded-[3px] border border-marca bg-marca-clara p-2 text-[13px]">
      <p>Fechar a fatura <strong>{rotulo}</strong>? A conciliação é recalculada agora; se estiver zerada, o resultado fica gravado como prova e a planilha é anexada.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={pendente} onClick={() => iniciar(async () => {
          const r = await fecharCiclo({ id });
          setArmado(false);
          if (r.ok) { toast.success(r.aviso); router.refresh(); } else toast.error(r.erro);
        })}>{pendente ? "Fechando…" : "Confirmar fechamento"}</Button>
        <Button size="sm" variant="outline" disabled={pendente} onClick={() => setArmado(false)}>Voltar</Button>
      </div>
    </div>
  );
}

/** "Reabrir" (gestor), com motivo. */
export function BotaoReabrir({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => { setMotivo(""); setErro(undefined); setAberto(true); }}>Reabrir</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reabrir o mês do cartão</DialogTitle>
              <DialogDescription>O fechamento atual fica no histórico, marcado como reaberto, com o seu nome e o motivo. A conciliação volta a ser calculada ao vivo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: título lançado com valor errado" autoFocus />
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button disabled={pendente || motivo.trim().length < 3} onClick={() => iniciar(async () => {
                  const r = await reabrirCiclo({ id, motivo });
                  if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
                })}>{pendente ? "Reabrindo…" : "Reabrir"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
