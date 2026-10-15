import type { Metadata } from "next";
import { PaginaFila } from "../fila";

export const metadata: Metadata = { title: "Confirmados — Cobrança" };

export default function PaginaConfirmados({ searchParams }: PageProps<"/financeiro/cobranca/confirmados">) {
  return <PaginaFila filas={["confirmados"]} caminho="/financeiro/cobranca/confirmados" searchParams={searchParams} />;
}
