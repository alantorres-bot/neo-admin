import { notFound } from "next/navigation";
import { MODULO_COLABORADORES } from "@/lib/modulos/rh/colaboradores/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutColaboradores({ children }: LayoutProps<"/rh/colaboradores">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COLABORADORES);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Colaboradores</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro único do RH, usado pelo vale-transporte e pela folha: código de fornecedor no Consistem (nome e CPF vêm de lá), matrícula no escritório, empresa, forma de pagamento habitual, conta para o arquivo do BB e os dados de VT de quem recebe.
        </p>
      </div>
      {children}
    </div>
  );
}
