"use client";

import { useTransition } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { iniciarConexaoGmail } from "@/app/(plataforma)/financeiro/filial/acoes";
import { rascunhoAoLider } from "../acoes";

/** E-mail ao líder do setor (rascunho no Gmail de quem clica) com quem tem crédito vencendo. */
export function AvisoAoLider({ setorId, gmail }: { setorId: string; gmail: string | null }) {
  const [pendente, iniciar] = useTransition();
  if (!gmail) {
    return (
      <Button size="sm" variant="outline" className="mt-2" disabled={pendente}
        onClick={() => iniciar(async () => { const r = await iniciarConexaoGmail(window.location.href); if (r.ok) window.location.href = r.url; else toast.error(r.erro); })}>
        Conectar meu Gmail
      </Button>
    );
  }
  return (
    <Button size="sm" className="mt-2" disabled={pendente}
      onClick={() => iniciar(async () => {
        const r = await rascunhoAoLider(setorId);
        if (!r.ok) { toast.error(r.erro); return; }
        toast.success(r.aviso ?? `Rascunho criado no seu Gmail (${gmail}). Confira e envie por lá.`);
        window.open(r.url, "_blank", "noopener");
      })}>
      <Mail /> {pendente ? "Criando rascunho…" : "E-mail ao líder"}
    </Button>
  );
}
