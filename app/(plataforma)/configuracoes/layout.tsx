import { redirect } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutConfiguracoes({ children }: LayoutProps<"/configuracoes">) {
  const sessao = await exigirSessao();
  if (!temAcessoAlgumaArea(sessao.acesso, sessao.areas)) redirect("/inicio");

  const abas = [
    { href: "/configuracoes/empresas", rotulo: "Empresas" },
    { href: "/configuracoes/contrapartes", rotulo: "Contrapartes e contatos" },
    ...(sessao.acesso.adminGeral
      ? [{ href: "/configuracoes/usuarios", rotulo: "Usuários e permissões" }, { href: "/configuracoes/aplicativos", rotulo: "Aplicativos" }]
      : []),
    ...(temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador") ? [{ href: "/configuracoes/importador", rotulo: "Importador" }] : []),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
      <Abas abas={abas} />
      {children}
    </div>
  );
}
