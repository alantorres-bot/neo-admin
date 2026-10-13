"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { linksDaRemessa } from "../../acoes";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Baixa, um a um, a nota fatura e o demonstrativo de todas as NFs da remessa (o navegador pode pedir permissão). */
export function BotaoBaixarTudo({ remessaId }: { remessaId: string }) {
  const [pendente, iniciar] = useTransition();

  function baixar() {
    iniciar(async () => {
      const r = await linksDaRemessa(remessaId);
      if (!r.ok) return void toast.error(r.erro);
      if (r.links.length === 0) return void toast.error("A remessa não tem arquivos.");
      for (const l of r.links) {
        const a = document.createElement("a");
        a.href = l.url;
        a.download = l.nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await esperar(400);
      }
      toast.success(`${r.links.length} ${r.links.length === 1 ? "arquivo baixado" : "arquivos baixados"}. Se o navegador pedir, permita vários downloads.`);
    });
  }

  return <Button variant="outline" onClick={baixar} disabled={pendente}>{pendente ? "Baixando…" : "Baixar todas as notas"}</Button>;
}
