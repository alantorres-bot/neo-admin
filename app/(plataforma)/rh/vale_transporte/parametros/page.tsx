import type { Metadata } from "next";
import { SecaoParametrosConsistem } from "../../_consistem/secao-parametros";

export const metadata: Metadata = { title: "Vale-transporte — parâmetros" };

export default function PaginaParametros() {
  return <SecaoParametrosConsistem />;
}
