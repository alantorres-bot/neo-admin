"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { autorizar, cancelar, removerItem } from "./acoes";

/** Autorizar em dois cliques: o botão abre a confirmação com o total. */
export function BotaoAutorizar({ id, numero, resumo }: { id: string; numero: number; resumo: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await autorizar(id);
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" onClick={() => { setErro(undefined); setAberto(true); }}>Autorizar pagamento</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Autorizar a autorização nº {numero}?</DialogTitle>
              <DialogDescription>{resumo}. A pendência “Executar autorização de pagamento” é aberta na Fila do dia para o financeiro. Depois de autorizada, os itens não mudam mais.</DialogDescription>
            </DialogHeader>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Autorizando…" : "Sim, autorizar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function DialogoCancelar({ id, numero, status }: { id: string; numero: number; status: "rascunho" | "autorizada" }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await cancelar({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}>Cancelar autorização</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar a autorização nº {numero}?</DialogTitle>
              <DialogDescription>
                {status === "autorizada" ? "Ela já foi autorizada: a pendência de execução será cancelada e " : "O rascunho é cancelado e "}
                os itens voltam à lista de pendentes. O registro fica no histórico com o motivo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="cap-motivo-cancelar" className="text-sm font-medium">Motivo</label>
                <Input id="cap-motivo-cancelar" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: pagamento adiado pela diretoria" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={confirmar} disabled={pendente}>{pendente ? "Cancelando…" : "Cancelar autorização"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function BotaoRemoverItem({ autorizacaoId, itemId, descricao }: { autorizacaoId: string; itemId: string; descricao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await removerItem({ autorizacaoId, itemId, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => { setErro(undefined); setAberto(true); }}>Remover</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remover item do rascunho</DialogTitle>
              <DialogDescription>{descricao}. O item volta à lista de pendentes; a remoção fica registrada com o motivo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={`cap-motivo-${itemId}`} className="text-sm font-medium">Motivo</label>
                <Input id={`cap-motivo-${itemId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: fornecedor pediu para segurar" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Removendo…" : "Remover item"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
