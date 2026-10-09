"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { atualizarDoConsistem, type ModoAtualizacao, type ResultadoAtualizacao } from "./acoes";

/** Botões "Medir", "Simular" e "Atualizar do Consistem" (operador ou acima) e o resumo do último resultado. */
export function BotoesAtualizar() {
  const [pendente, iniciar] = useTransition();
  const [executando, setExecutando] = useState<ModoAtualizacao>();
  const [resultado, setResultado] = useState<ResultadoAtualizacao>();

  function executar(modo: ModoAtualizacao) {
    setExecutando(modo);
    iniciar(async () => {
      try {
        const r = await atualizarDoConsistem(modo);
        setResultado(r);
        if (r.ok) toast.success(modo === "gravar" ? "Lista atualizada do Consistem." : modo === "simular" ? "Simulação concluída. Nada foi gravado." : "Medição concluída. Nada foi gravado.");
        else toast.error(r.erro);
      } catch {
        const r: ResultadoAtualizacao = { ok: false, erro: "Não foi possível atualizar. Tente novamente." };
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
        <Button variant="outline" disabled={pendente} onClick={() => executar("medir")} title="Só lê a API e mede o tempo; nada é gravado">
          {executando === "medir" ? "Medindo…" : "Medir"}
        </Button>
        <Button variant="outline" disabled={pendente} onClick={() => executar("simular")}>
          {executando === "simular" ? "Simulando…" : "Simular"}
        </Button>
        <Button disabled={pendente} onClick={() => executar("gravar")}>
          <RefreshCw className={executando === "gravar" ? "animate-spin" : ""} />
          {executando === "gravar" ? "Atualizando…" : "Atualizar do Consistem"}
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
