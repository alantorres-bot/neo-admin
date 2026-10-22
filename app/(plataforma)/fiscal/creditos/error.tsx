"use client";

import { Button } from "@/components/ui/button";

export default function ErroCreditos({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-[3px] border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="font-condensada text-lg font-bold">Não foi possível carregar esta tela</h2>
      <p className="text-sm text-muted-foreground">
        Tente de novo. Se persistir, informe o código ao administrador{error.digest ? `: ${error.digest}` : ""}. Nenhum dado foi alterado.
      </p>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
