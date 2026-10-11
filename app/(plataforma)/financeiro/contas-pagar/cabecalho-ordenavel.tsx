"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Direcao } from "@/lib/modulos/financeiro/contas-pagar/ordenacao";

type Props = {
  rotulo: string;
  /** Direção atual quando esta coluna é a ordenada; null quando não é. */
  direcao: Direcao | null;
  /** Modo link: muda a URL (lista paginada no servidor). */
  href?: string;
  /** Modo botão: estado local da tabela. */
  aoClicar?: () => void;
  alinharDireita?: boolean;
};

/** Título de coluna clicável: crescente ↔ decrescente, com a seta indicando a direção atual. Vai dentro de um `TableHead`. */
export function CabecalhoOrdenavel({ rotulo, direcao, href, aoClicar, alinharDireita = false }: Props) {
  const Seta = direcao === "asc" ? ArrowUp : direcao === "desc" ? ArrowDown : ArrowUpDown;
  const titulo = direcao === "asc" ? `${rotulo}: crescente (clique para decrescente)` : direcao === "desc" ? `${rotulo}: decrescente (clique para crescente)` : `Ordenar por ${rotulo}`;
  const classe = `inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-1 -mx-1 hover:bg-black/5 hover:underline ${direcao ? "font-bold text-foreground" : ""} ${alinharDireita ? "flex-row-reverse" : ""}`;
  const conteudo = (
    <>
      {rotulo}
      <Seta className={`size-3.5 ${direcao ? "" : "opacity-40"}`} aria-hidden />
    </>
  );
  // aria-sort pertence ao <th>; aqui o estado vai no title e na seta.
  if (href) return <Link href={href} className={classe} title={titulo}>{conteudo}</Link>;
  return <button type="button" onClick={aoClicar} className={classe} title={titulo}>{conteudo}</button>;
}
