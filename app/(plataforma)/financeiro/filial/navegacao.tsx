"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";

/** Duas visões do Faturamento Filial: a fila (por urgência) e as remessas (por lote). */
export function NavegacaoFilial() {
  const caminho = usePathname();
  const naRemessa = caminho.startsWith(`${ROTA_FILIAL}/remessas`);
  const item = (href: string, rotulo: string, ativo: boolean) => (
    <Link href={href} aria-current={ativo ? "page" : undefined}
      className={`px-4 py-1.5 text-[13px] ${ativo ? "border-b-2 border-marca bg-white font-bold" : "bg-cabecalho hover:bg-white"}`}>
      {rotulo}
    </Link>
  );
  return (
    <nav aria-label="Visões do Faturamento Filial" className="inline-flex gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
      {item(ROTA_FILIAL, "Fila", !naRemessa)}
      {item(`${ROTA_FILIAL}/remessas`, "Remessas", naRemessa)}
    </nav>
  );
}
