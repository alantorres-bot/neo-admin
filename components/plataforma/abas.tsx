"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Abas({ abas }: { abas: { href: string; rotulo: string }[] }) {
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
          </Link>
        );
      })}
    </nav>
  );
}
