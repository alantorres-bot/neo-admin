"use client";

// Aplicativo externo embutido no painel: barra fina com o nome e os botões, e o app ocupando o resto da tela.
// Sem `sandbox`: o app precisa do próprio armazenamento para manter o login. Cada app pede o seu login uma vez por navegador.
import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuadroApp({ nome, url }: { nome: string; url: string }) {
  const [versao, setVersao] = useState(0);
  return (
    // Cancela o espaçamento do <main> para o quadro ir de borda a borda. Altura: tela menos barra vermelha (44 px) e trilha (31 px);
    // no celular desconta também a barra inferior do menu (56 px).
    <div className="-mx-3 -mt-3 -mb-20 flex h-[calc(100svh-131px)] flex-col sm:-mx-4 sm:-mt-4 md:-m-5 md:h-[calc(100svh-75px)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-grade-clara bg-cabecalho px-3 py-1 text-[12px]">
        <span className="truncate font-bold">{nome}</span>
        <span className="hidden text-muted-foreground sm:inline">· aplicativo externo; se não carregar aqui, abra em nova aba.</span>
        <div className="ml-auto flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => setVersao((v) => v + 1)} title="Recarregar o aplicativo">
            <RefreshCw /> Recarregar
          </Button>
          <Button size="sm" variant="outline" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink /> Abrir em nova aba
          </Button>
        </div>
      </div>
      <iframe
        key={versao}
        src={url}
        title={nome}
        className="w-full flex-1 border-0 bg-white"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
