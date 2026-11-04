import { notFound } from "next/navigation";
import { MODULO_PORTAL_LIDER } from "@/lib/modulos/rh/portal-lider/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutPedidosDoLider({ children }: LayoutProps<"/rh/portal_lider">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_PORTAL_LIDER);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portal do Líder</h1>
        <p className="text-sm text-muted-foreground">
          Pedidos que os líderes fazem pelo portal (férias, função/salário, desligamento, atestado, contratação). Cada um entra na fila do dia; responda aqui e o líder vê a resposta.
        </p>
      </div>
      {children}
    </div>
  );
}
