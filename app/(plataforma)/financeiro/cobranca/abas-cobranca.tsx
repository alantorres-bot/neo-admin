import { Abas } from "@/components/plataforma/abas";
import { contarFilas } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { ABAS_COBRANCA, contagemDasAbas } from "./abas";
import { tarefasDaRequisicao } from "./dados";

// As abas aparecem logo; os números chegam depois (o cálculo das filas lê muito do banco), dentro de <Suspense> no layout.

export function AbasCobrancaSemNumeros() {
  return <Abas abas={ABAS_COBRANCA.map((a) => ({ href: a.href, rotulo: a.rotulo }))} />;
}

export async function AbasCobrancaComNumeros() {
  const porAba = contagemDasAbas(contarFilas(await tarefasDaRequisicao()));
  return <Abas abas={ABAS_COBRANCA.map((a) => ({ href: a.href, rotulo: a.rotulo, contagem: porAba[a.href] }))} />;
}
