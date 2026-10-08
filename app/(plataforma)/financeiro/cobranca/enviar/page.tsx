import type { Metadata } from "next";
import { PaginaFila } from "../fila";

export const metadata: Metadata = { title: "A enviar — Cobrança" };

export default function PaginaEnviar({ searchParams }: PageProps<"/financeiro/cobranca/enviar">) {
  return <PaginaFila filas={["enviar", "dados"]} caminho="/financeiro/cobranca/enviar" searchParams={searchParams} />;
}
