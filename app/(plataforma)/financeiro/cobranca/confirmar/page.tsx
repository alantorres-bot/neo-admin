import type { Metadata } from "next";
import { PaginaFila } from "../fila";

export const metadata: Metadata = { title: "Confirmar pagamento — Cobrança" };

export default function PaginaConfirmar({ searchParams }: PageProps<"/financeiro/cobranca/confirmar">) {
  return <PaginaFila filas={["confirmar"]} caminho="/financeiro/cobranca/confirmar" searchParams={searchParams} />;
}
