"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { salvarPreferenciaBooleana } from "@/app/(plataforma)/preferencias";
import { PREFERENCIAS } from "@/lib/nucleo/preferencias";

/**
 * Caixa "Ocultar vencidos há mais de 90 dias". Ao clicar, grava a escolha como preferência da pessoa (vale em qualquer
 * computador) e abre a Carteira já no novo estado, mantendo os outros filtros.
 */
export function CaixaOcultar({ ligado, destino, rotulo, detalhe }: { ligado: boolean; destino: string; rotulo: string; detalhe?: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function alternar() {
    iniciar(async () => {
      const r = await salvarPreferenciaBooleana(PREFERENCIAS.recebiveisOcultarVencidos90, !ligado);
      if (!r.ok) toast.error(r.erro);
      router.push(destino);
    });
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ligado}
      disabled={pendente}
      onClick={alternar}
      className="flex items-center gap-2 rounded-[3px] px-1 py-1 text-[13px] hover:bg-cabecalho disabled:opacity-60"
    >
      <span className={`flex size-4 items-center justify-center rounded-[3px] border ${ligado ? "border-botao bg-botao text-white" : "border-grade bg-white"}`} aria-hidden>
        {ligado && <Check className="size-3" />}
      </span>
      {rotulo}
      {detalhe && <span className="text-[12px] text-muted-foreground">{detalhe}</span>}
    </button>
  );
}
