import { notFound } from "next/navigation";
import { MODULO_INTIMACOES } from "@/lib/modulos/financeiro/intimacoes/intimacoes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutIntimacoes({ children }: LayoutProps<"/financeiro/intimacoes">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_INTIMACOES);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Intimações de cartório</h1>
        <p className="text-sm text-muted-foreground">
          Intimações de protesto lidas do Gmail: localizar o título no Consistem, alterar o vencimento para o prazo da intimação (com aprovação do gestor)
          e acompanhar o adiantamento das custas ao cartório, que é lançado à mão no Consistem, até a NF e a consignação.
        </p>
      </div>
      {children}
    </div>
  );
}
