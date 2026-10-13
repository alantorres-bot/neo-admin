"use client";

import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Painel lateral da NF na fila do Faturamento Filial: abre pela URL (?nf=…) e, ao fechar, volta à mesma fila (mesmos filtros).
 * O conteúdo vem pronto do servidor.
 */
export function PainelLateral({ titulo, descricao, fecharHref, children }: { titulo: string; descricao?: string; fecharHref: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(aberto) => { if (!aberto) router.push(fecharHref, { scroll: false }); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{titulo}</SheetTitle>
          {descricao && <SheetDescription>{descricao}</SheetDescription>}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
