import { Abas } from "@/components/plataforma/abas";
import { contarFilas } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { abasDaCobranca, contagemDasAbas } from "./abas";
import { tarefasDaRequisicao } from "./dados";

// As abas aparecem logo; os números chegam depois (o cálculo das filas lê muito do banco), dentro de <Suspense> no layout.

export function AbasCobrancaSemNumeros({ restrito = false }: { restrito?: boolean }) {
  return <Abas abas={abasDaCobranca(restrito).map((a) => ({ href: a.href, rotulo: a.rotulo }))} />;
}

export async function AbasCobrancaComNumeros({ restrito = false }: { restrito?: boolean }) {
  const porAba = contagemDasAbas(contarFilas(await tarefasDaRequisicao()));
  return <Abas abas={abasDaCobranca(restrito).map((a) => ({ href: a.href, rotulo: a.rotulo, contagem: porAba[a.href] }))} />;
}
