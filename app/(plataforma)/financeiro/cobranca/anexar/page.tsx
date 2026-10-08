import type { Metadata } from "next";
import { PaginaFila } from "../fila";

export const metadata: Metadata = { title: "Boletos a anexar — Cobrança" };

export default function PaginaAnexar({ searchParams }: PageProps<"/financeiro/cobranca/anexar">) {
  return <PaginaFila filas={["anexar"]} caminho="/financeiro/cobranca/anexar" searchParams={searchParams} />;
}
