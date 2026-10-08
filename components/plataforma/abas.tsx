"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Abas({ abas }: { abas: { href: string; rotulo: string; contagem?: number }[] }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Seções" className="flex gap-1 overflow-x-auto border-b">
      {abas.map((a) => {
        const ativa = caminho === a.href || caminho.startsWith(a.href + "/");
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              ativa ? "border-marca font-bold text-texto" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {a.rotulo}
            {a.contagem !== undefined && a.contagem > 0 && <span className="ml-1.5 rounded-[3px] bg-cabecalho px-1.5 text-[11px] font-bold tabular-nums text-texto ring-1 ring-grade">{a.contagem}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
