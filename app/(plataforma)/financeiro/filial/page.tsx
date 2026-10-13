import { redirect } from "next/navigation";
import { abaInicialDaFilial } from "@/lib/modulos/financeiro/filial/abas";
import { contarKits } from "./abas-filial";

// Como a Cobrança: o Faturamento Filial abre na primeira etapa que tem notas pendentes.
export default async function PaginaFilial() {
  redirect(abaInicialDaFilial(await contarKits()));
}
