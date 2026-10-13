import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { temAcesso, temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { AbasFilialComNumeros, AbasFilialSemNumeros } from "./abas-filial";

export default async function LayoutFilial({ children }: LayoutProps<"/financeiro/filial">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeEnviar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");
  const ehCuiaba = temAcesso(sessao.acesso, "financeiro", "operador");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faturamento Filial</h1>
          <p className="text-sm text-muted-foreground">
            As notas da Filial Contagem, por etapa: implantar no Consistem, anexar o boleto e enviar ao cliente. Ao fazer a tarefa, a nota passa sozinha para a etapa seguinte.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ehCuiaba && <Button variant="outline" render={<Link href={`${ROTA_FILIAL}/boletos`} />}>Anexar boletos</Button>}
          {podeEnviar && <Button render={<Link href={`${ROTA_FILIAL}/enviar`} />}>Enviar faturas</Button>}
        </div>
      </div>
      <Suspense fallback={<AbasFilialSemNumeros />}>
        <AbasFilialComNumeros />
      </Suspense>
      {children}
    </div>
  );
}
