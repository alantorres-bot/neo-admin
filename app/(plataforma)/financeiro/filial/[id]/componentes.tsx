"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ROTULO_DOCUMENTO_KIT, tipoPeloNome, type TipoDocumentoKit } from "@/lib/modulos/financeiro/filial/arquivos";
import { anexarDocumentoKit, cancelarKit } from "../acoes";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";

/** Anexa um documento avulso ao kit (o que faltou no lote, ou a carta de cessão de Cuiabá). */
export function AnexarDocumento({ kitId, tipos, sugerido }: { kitId: string; tipos: TipoDocumentoKit[]; sugerido: TipoDocumentoKit | null }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [tipo, setTipo] = useState<TipoDocumentoKit | "">(sugerido ?? "");
  const [pendente, iniciar] = useTransition();

  function escolher(f: File | null) {
    setArquivo(f);
    if (f && !tipo) setTipo(tipoPeloNome(f.name) ?? "");
  }

  function enviar() {
    if (!arquivo) return toast.error("Escolha o arquivo.");
    if (!tipo) return toast.error("Escolha o tipo do documento.");
    iniciar(async () => {
      const fd = new FormData();
      fd.set("kitId", kitId);
      fd.set("tipo", tipo);
      fd.set("arquivo", arquivo);
      const r = await anexarDocumentoKit(fd);
      if (!r.ok) return void toast.error(r.erro);
      toast.success(r.aviso);
      setArquivo(null);
      setTipo(sugerido ?? "");
      if (entrada.current) entrada.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <input ref={entrada} type="file" accept="application/pdf,image/*" aria-label="Arquivo" onChange={(e) => escolher(e.target.files?.[0] ?? null)}
        className="max-w-60 text-[13px] file:mr-2 file:rounded-[3px] file:border file:border-input file:bg-white file:px-2 file:py-1" />
      <select className={SELECAO} value={tipo} aria-label="Tipo do documento" onChange={(e) => setTipo(e.target.value as TipoDocumentoKit | "")}>
        <option value="">Tipo…</option>
        {tipos.map((t) => <option key={t} value={t}>{ROTULO_DOCUMENTO_KIT[t]}</option>)}
      </select>
      <Button size="sm" onClick={enviar} disabled={pendente || !arquivo || !tipo}>{pendente ? "Anexando…" : "Anexar"}</Button>
    </div>
  );
}

/** Cancelar o kit com motivo (fica registrado; a NF fica livre para um novo kit). */
export function BotaoCancelarKit({ id, nota }: { id: string; nota: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function cancelar() {
    iniciar(async () => {
      const r = await cancelarKit({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else setErro(r.erro);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setMotivo(""); setAberto(true); }}>Cancelar kit</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar o kit da NF {nota}</DialogTitle>
              <DialogDescription>As pendências do kit são encerradas e a NF fica livre para um novo envio. Os documentos continuam guardados.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="kit-motivo" className="text-sm font-medium">Motivo</label>
                <Input id="kit-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: NF cancelada no Syslock e reemitida" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={cancelar} disabled={pendente}>{pendente ? "Cancelando…" : "Cancelar kit"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
