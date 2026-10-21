import type { Metadata } from "next";
import Link from "next/link";
import { CartoesApps } from "@/components/plataforma/cartoes-apps";
import { ROTA_JUSTIFICAR } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, FUSO } from "@/lib/nucleo/fila";
import { montarMenu } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerLotesDoLider } from "../ponto/justificar/dados";

export const metadata: Metadata = { title: "Início" };

/** Super painel: um cartão por módulo do Neo Admin e por aplicativo externo, só o que o usuário pode ver. */
export default async function PaginaInicio() {
  const sessao = await exigirSessao();
  const menu = montarMenu(sessao.areas, sessao.modulos, sessao.acesso, sessao.aplicativos);
  const dataExtenso = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  // Líder de setor (RH > Ponto): o ponto que ele tem de justificar, mesmo sem nenhuma área liberada.
  const pontoDoLider = await lerLotesDoLider(await criarClienteServidor());
  const paraJustificar = pontoDoLider.filter((l) => l.status === "enviado" || l.status === "devolvido");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {sessao.perfil.nome.split(" ")[0]}</h1>
        <p className="text-sm capitalize text-muted-foreground">{dataExtenso}</p>
      </header>
      {paraJustificar.map((l) => (
        <Link key={l.id} href={`${ROTA_JUSTIFICAR}/${l.id}`} className="block rounded-lg border border-amber-600 bg-amber-50 p-4 hover:bg-amber-100">
          <p className="font-medium">Justificar o ponto — {l.setor}, {formatarData(l.periodo_inicio)} a {formatarData(l.periodo_fim)}</p>
          <p className="text-sm text-muted-foreground">
            {l.status === "devolvido" ? "Devolvido pelo RH para correção. " : ""}{l.justificadas} de {l.ocorrencias} justificada(s){l.prazo ? ` · prazo ${formatarData(l.prazo)}` : ""}
          </p>
        </Link>
      ))}
      {pontoDoLider.length > 0 && paraJustificar.length === 0 && (
        <p className="text-sm"><Link href={ROTA_JUSTIFICAR} className="text-elo hover:underline">Ponto do setor (histórico)</Link></p>
      )}
      {menu.length === 0 && pontoDoLider.length > 0 ? null : menu.length === 0 ? (
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
