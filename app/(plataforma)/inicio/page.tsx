import type { Metadata } from "next";
import { CartoesApps } from "@/components/plataforma/cartoes-apps";
import { FUSO } from "@/lib/nucleo/fila";
import { montarMenu } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export const metadata: Metadata = { title: "Início" };

/** Super painel: um cartão por módulo do Neo Admin e por aplicativo externo, só o que o usuário pode ver. */
export default async function PaginaInicio() {
  const sessao = await exigirSessao();
  const menu = montarMenu(sessao.areas, sessao.modulos, sessao.acesso, sessao.aplicativos);
  const dataExtenso = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {sessao.perfil.nome.split(" ")[0]}</h1>
        <p className="text-sm capitalize text-muted-foreground">{dataExtenso}</p>
      </header>
      {menu.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">Você ainda não tem acesso a nenhum aplicativo.</p>
          <p className="mt-1 text-sm text-muted-foreground">Peça ao administrador da plataforma para liberar as áreas que você usa.</p>
        </div>
      ) : (
        <CartoesApps menu={menu} />
      )}
    </div>
  );
}
