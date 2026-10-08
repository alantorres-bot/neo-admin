import { redirect } from "next/navigation";
import { contarFilas } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { abaInicialDaCobranca } from "./abas";
import { tarefasDaRequisicao } from "./dados";

// A Cobrança abre na primeira etapa que tem itens pendentes.
export default async function PaginaCobranca() {
  redirect(abaInicialDaCobranca(contarFilas(await tarefasDaRequisicao())));
}
