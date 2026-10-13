import type { Metadata } from "next";
import { PaginaEtapa } from "../lista";

export const metadata: Metadata = { title: "Boletos a anexar — Faturamento Filial" };

export default function Pagina({ searchParams }: PageProps<"/financeiro/filial/boletos-a-anexar">) {
  return <PaginaEtapa etapa="implantada" caminho="/financeiro/filial/boletos-a-anexar" searchParams={searchParams} />;
}
