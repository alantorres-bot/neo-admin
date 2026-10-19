import { notFound } from "next/navigation";
import { MODULO_PEDIDOS } from "@/lib/modulos/comercial/pedidos/carteira";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutPedidos({ children }: LayoutProps<"/comercial/pedidos">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_PEDIDOS);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PEDIDOS)) notFound();
  return <div className="space-y-6">{children}</div>;
}
