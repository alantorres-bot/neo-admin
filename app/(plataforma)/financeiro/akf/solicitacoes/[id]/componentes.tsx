"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ROTA_AKF } from "@/lib/modulos/financeiro/akf/solicitacao";
import { cancelarSolicitacao, criarRascunhoSolicitacao, excluirSolicitacao } from "../acoes";

/** "Criar rascunho no Gmail": grava a mensagem e chama a Edge Function; mostra o link do rascunho quando pronto. */
export function BotaoRascunhoGmail({ id, desativado }: { id: string; desativado: boolean }) {
  const router = useRouter();
  const [link, setLink] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function criar() {
    iniciar(async () => {
      const r = await criarRascunhoSolicitacao(id);
      if (r.ok) {
        setLink(r.url);
        toast.success(r.aviso ?? "Rascunho criado no Gmail. Confira e envie por lá.");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  if (link) return <Button render={<a href={link} target="_blank" rel="noreferrer" />}>Abrir o rascunho no Gmail</Button>;
  return (
    <Button type="button" onClick={criar} disabled={pendente || desativado} title={desativado ? "Cadastre um contato da AKF com e-mail" : "Cria o rascunho na caixa autorizada; nada é enviado"}>
      {pendente ? "Criando rascunho…" : "Criar rascunho no Gmail"}
    </Button>
  );
}

/** Cancelar com motivo (obrigatório; fica no histórico de cada título). Confirmação em diálogo. */
export function BotaoCancelar({ id, numero }: { id: string; numero: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function cancelar() {
    iniciar(async () => {
      const r = await cancelarSolicitacao({ id, motivo });
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
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setMotivo(""); setAberto(true); }}>Cancelar solicitação</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar a solicitação nº {numero}</DialogTitle>
              <DialogDescription>Os títulos voltam a ficar disponíveis para outra solicitação. O registro continua no histórico com o motivo. Se o rascunho já estiver no Gmail, apague-o por lá.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="akf-motivo" className="text-sm font-medium">Motivo</label>
                <Input id="akf-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: a AKF não operou; refazer com outros títulos" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={cancelar} disabled={pendente}>{pendente ? "Cancelando…" : "Cancelar solicitação"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** "Excluir da lista": só para solicitação cancelada e só gestor. Some das telas, mas fica gravada (nada é apagado). */
export function BotaoExcluir({ id, numero }: { id: string; numero: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function excluir() {
    iniciar(async () => {
      const r = await excluirSolicitacao({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.push(`${ROTA_AKF}/solicitacoes`);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => { setErro(undefined); setMotivo(""); setAberto(true); }}>Excluir da lista</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Excluir a solicitação nº {numero} da lista</DialogTitle>
              <DialogDescription>Ela some do histórico e das telas. O registro continua guardado no banco com quem excluiu, quando e o motivo, e o histórico dos títulos não muda.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="akf-motivo-exclusao" className="text-sm font-medium">Motivo (opcional)</label>
                <Input id="akf-motivo-exclusao" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: solicitação de teste" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={excluir} disabled={pendente}>{pendente ? "Excluindo…" : "Excluir da lista"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
