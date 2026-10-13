import type { Metadata } from "next";
import { PaginaEtapa } from "../lista";

export const metadata: Metadata = { title: "A implantar — Faturamento Filial" };

export default function Pagina({ searchParams }: PageProps<"/financeiro/filial/a-implantar">) {
  return <PaginaEtapa etapa="recebida" caminho="/financeiro/filial/a-implantar" searchParams={searchParams} />;
}
