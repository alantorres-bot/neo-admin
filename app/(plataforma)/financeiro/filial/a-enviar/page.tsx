import type { Metadata } from "next";
import { PaginaEtapa } from "../lista";

export const metadata: Metadata = { title: "A enviar ao cliente — Faturamento Filial" };

export default function Pagina({ searchParams }: PageProps<"/financeiro/filial/a-enviar">) {
  return <PaginaEtapa etapa="pronta" caminho="/financeiro/filial/a-enviar" searchParams={searchParams} />;
}
