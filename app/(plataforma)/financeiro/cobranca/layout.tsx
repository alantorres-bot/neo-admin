import { Suspense } from "react";
import { notFound } from "next/navigation";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { AbasCobrancaComNumeros, AbasCobrancaSemNumeros } from "./abas-cobranca";
import { MODULO_COBRANCA } from "./fila";

export default async function LayoutCobranca({ children }: LayoutProps<"/financeiro/cobranca">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COBRANCA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cobrança</h1>
        <p className="text-sm text-muted-foreground">
          O trabalho do contas a receber, por etapa. As listas são calculadas na hora a partir da situação dos títulos: ao fazer a tarefa, o item sai da lista sozinho.
        </p>
      </div>
      <Suspense fallback={<AbasCobrancaSemNumeros />}>
        <AbasCobrancaComNumeros />
      </Suspense>
      {children}
    </div>
  );
}
