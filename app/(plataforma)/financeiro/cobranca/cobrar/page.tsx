import type { Metadata } from "next";
import { PaginaFila } from "../fila";

export const metadata: Metadata = { title: "Cobrar — Cobrança" };

export default function PaginaCobrar({ searchParams }: PageProps<"/financeiro/cobranca/cobrar">) {
  return <PaginaFila filas={["cobrar"]} caminho="/financeiro/cobranca/cobrar" searchParams={searchParams} />;
}
