"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { atualizarRegrasNeoFiscal } from "../acoes";

/** "Atualizar do Neo Fiscal": copia as regras fornecedor → cartão (o cadastro é só lá). */
export function BotaoAtualizarRegras() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
      const r = await atualizarRegrasNeoFiscal();
      if (r.ok) { toast.success(r.aviso); router.refresh(); } else toast.error(r.erro);
    })}>
      <RefreshCw className={pendente ? "animate-spin" : ""} /> {pendente ? "Atualizando…" : "Atualizar do Neo Fiscal"}
    </Button>
  );
}
