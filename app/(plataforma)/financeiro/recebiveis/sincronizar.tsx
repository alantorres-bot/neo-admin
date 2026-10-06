"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sincronizarConsistem, type ResultadoSincronizacao } from "./acoes";

/** Botões "Simular" e "Sincronizar agora" (só gestor vê) e o resumo do último resultado. */
export function BotoesSincronizacao() {
  const [pendente, iniciar] = useTransition();
  const [executando, setExecutando] = useState<"simular" | "gravar">();
  const [resultado, setResultado] = useState<ResultadoSincronizacao>();

  function executar(simular: boolean) {
    setExecutando(simular ? "simular" : "gravar");
    iniciar(async () => {
      try {
        const r = await sincronizarConsistem(simular);
        setResultado(r);
        if (r.ok) toast.success(simular ? "Simulação concluída. Nada foi gravado." : "Sincronização concluída.");
        else toast.error(r.erro);
      } catch {
        const r: ResultadoSincronizacao = { ok: false, erro: "Não foi possível sincronizar. Tente novamente." };
        setResultado(r);
        toast.error(r.erro);
      } finally {
        setExecutando(undefined);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={pendente} onClick={() => executar(true)}>
          {executando === "simular" ? "Simulando…" : "Simular"}
        </Button>
        <Button disabled={pendente} onClick={() => executar(false)}>
          <RefreshCw className={executando === "gravar" ? "animate-spin" : ""} />
          {executando === "gravar" ? "Sincronizando…" : "Sincronizar agora"}
        </Button>
      </div>
      {resultado && (
        <div role={resultado.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${resultado.ok ? "bg-muted/40" : "border-destructive/40 text-destructive"}`}>
          {resultado.ok ? (
            <ul className="space-y-1">
              {resultado.linhas.map((linha, i) => <li key={i}>{linha}</li>)}
            </ul>
          ) : (
            resultado.erro
          )}
        </div>
      )}
    </div>
  );
}
