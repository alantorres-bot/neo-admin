import { redirect } from "next/navigation";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { contarFilas } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { abaInicialDaCobranca } from "./abas";
import { tarefasDaRequisicao } from "./dados";

// A Cobrança abre na primeira etapa que tem itens pendentes.
export default async function PaginaCobranca() {
  const sessao = await exigirSessao();
  redirect(abaInicialDaCobranca(contarFilas(await tarefasDaRequisicao()), !!sessao.acesso.restrito));
}
