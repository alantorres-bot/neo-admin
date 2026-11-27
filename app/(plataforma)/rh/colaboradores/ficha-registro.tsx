"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lerFicha } from "./acoes";
import type { RascunhoColaborador } from "./dados";
import { DialogoColaborador } from "./form-colaborador";

/**
 * "Novo pela ficha" (27/11/2026): o RH escolhe o PDF da Ficha Registro de Empregado do escritório, o servidor lê os campos e o
 * formulário de novo colaborador abre preenchido. O PDF não é guardado.
 */
export function NovoPelaFicha({ empresas, empregadores }: { empresas: { id: string; nome: string }[]; empregadores: string[] }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [lido, setLido] = useState<{ rascunho: RascunhoColaborador; avisos: string[]; chave: number } | null>(null);
  const [lendo, iniciar] = useTransition();

  const ler = (arquivo: File) => iniciar(async () => {
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    const r = await lerFicha(dados);
    if (entrada.current) entrada.current.value = "";
    if (!r.ok) { toast.error(r.erro); return; }
    setLido({ rascunho: r.rascunho, avisos: r.avisos, chave: Date.now() });
  });

  return (
    <>
      <input ref={entrada} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="PDF da ficha de registro"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} />
      <Button variant="outline" disabled={lendo} onClick={() => entrada.current?.click()}><FileUp /> {lendo ? "Lendo a ficha…" : "Novo pela ficha"}</Button>
      {lido && (
        <DialogoColaborador key={lido.chave} rascunho={lido.rascunho} avisos={lido.avisos} aberto aoMudarAberto={(v) => { if (!v) setLido(null); }}
          empresas={empresas} empregadores={empregadores} />
      )}
    </>
  );
}
