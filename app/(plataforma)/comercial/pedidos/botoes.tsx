"use client";

import { useState, useTransition } from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { atualizarPedidos, baixarDocumentoNota, type ResultadoAtualizacao } from "./acoes";

/** "Simular" e "Atualizar do Consistem" (só o gestor vê) e o resumo do último resultado. */
export function BotoesAtualizar() {
  const [pendente, iniciar] = useTransition();
  const [executando, setExecutando] = useState<"simular" | "gravar">();
  const [resultado, setResultado] = useState<ResultadoAtualizacao>();

  function executar(simular: boolean) {
    setExecutando(simular ? "simular" : "gravar");
    iniciar(async () => {
      try {
        const r = await atualizarPedidos(simular);
        setResultado(r);
        if (r.ok) toast.success(simular ? "Simulação concluída. Nada foi gravado." : "Pedidos atualizados.");
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
        <Button variant="outline" disabled={pendente} onClick={() => executar(true)}>
          {executando === "simular" ? "Simulando…" : "Simular"}
        </Button>
        <Button disabled={pendente} onClick={() => executar(false)}>
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

/** Baixa o DANFE (PDF) ou o XML da NF direto do Consistem (o arquivo não fica guardado no Neo Admin). */
export function BotaoDocumento({ notaId, tipo }: { notaId: string; tipo: "danfe" | "xml" }) {
  const [pendente, iniciar] = useTransition();
  function baixar() {
    iniciar(async () => {
      try {
        const r = await baixarDocumentoNota(notaId, tipo);
        if (!r.ok) {
          toast.error(r.erro);
          return;
        }
        const bytes = Uint8Array.from(atob(r.arquivo), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: r.tipo }));
        const link = document.createElement("a");
        link.href = url;
        link.download = r.nome;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        toast.error("Não foi possível baixar o documento.");
      }
    });
  }
  return (
    <Button variant="outline" size="sm" disabled={pendente} onClick={baixar}>
      <FileDown />
      {pendente ? "Baixando…" : tipo === "danfe" ? "DANFE" : "XML"}
    </Button>
  );
}
