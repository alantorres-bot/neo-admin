"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Abre a caixa de impressão do navegador: "Salvar como PDF" gera o arquivo. Some na folha impressa. */
export function BotaoImprimir() {
  return (
    <div className="nao-imprimir mb-4 flex flex-wrap items-center gap-2 rounded-[3px] border border-grade bg-cabecalho p-3 text-sm">
      <Button type="button" onClick={() => window.print()}><Printer /> Imprimir / salvar PDF</Button>
      <span className="text-muted-foreground">Na janela de impressão, escolha a impressora ou “Salvar como PDF”. Esta barra não sai no papel.</span>
      <Button type="button" variant="ghost" onClick={() => window.close()}>Fechar</Button>
    </div>
  );
}
