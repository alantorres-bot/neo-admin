import type { Metadata } from "next";
import { PaginaEtapa } from "../lista";

export const metadata: Metadata = { title: "Enviadas — Faturamento Filial" };

export default function Pagina({ searchParams }: PageProps<"/financeiro/filial/enviadas">) {
  return <PaginaEtapa etapa="enviada" caminho="/financeiro/filial/enviadas" searchParams={searchParams} />;
}
