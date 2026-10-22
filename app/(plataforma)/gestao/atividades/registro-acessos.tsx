"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { definirRegistroAcessos } from "./acoes";

const AVISO_LIGAR =
  "Ligar o registro de acessos?\n\nA partir de agora, cada tela e registro aberto por cada pessoa fica gravado (agrupado a cada 30 minutos) e é guardado por 12 meses.\n\nConfirme que a equipe já foi comunicada.";

export function AlternarRegistroAcessos({ ligado }: { ligado: boolean }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      size="sm" variant={ligado ? "outline" : "default"} disabled={pendente}
      onClick={() => {
        if (!window.confirm(ligado ? "Desligar o registro de acessos? Os já gravados continuam até vencer o prazo." : AVISO_LIGAR)) return;
        iniciar(async () => {
          const r = await definirRegistroAcessos(!ligado);
          if (r.ok) toast.success(ligado ? "Registro de acessos desligado." : "Registro de acessos ligado.");
          else toast.error(r.erro);
        });
      }}
    >
      {pendente ? "Aguarde…" : ligado ? "Desligar registro de acessos" : "Ligar registro de acessos"}
    </Button>
  );
}
