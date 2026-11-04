import { notFound } from "next/navigation";
import { MODULO_BONIFICACOES } from "@/lib/modulos/rh/bonificacoes/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutBonificacoes({ children }: LayoutProps<"/rh/bonificacoes">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_BONIFICACOES);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bonificações</h1>
        <p className="text-sm text-muted-foreground">
          Por mês e setor: o líder marca pelo link quem tem direito e o percentual (5, 10, 15 ou 20% do salário); o RH aprova e a bonificação vira recibo Eventual na Folha.
        </p>
      </div>
      {children}
    </div>
  );
}
