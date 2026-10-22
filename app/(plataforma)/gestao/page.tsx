import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { hrefCentral, lerFiltros, temFiltro } from "@/lib/nucleo/gestao/filtros";
import { areasComNivel, temAcesso, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { Equipe, Filtros, Fila, Indicadores, Intervencao } from "./componentes";
import { lerCentral } from "./dados";

export const metadata: Metadata = { title: "Central de Gestão" };

const ROTULO_RECORTE = {
  atrasadas: "Atrasadas", hoje: "Vencem hoje", intervir: "Exigem intervenção", aguarda_gestor: "Aguardando gestor",
  bloqueadas: "Bloqueadas", distribuir: "Precisam distribuir",
} as const;

// Central de Gestão (docs/modulos/administrativo-gestao.md): visão gerencial das pendências de todos os módulos que o
// usuário pode ver. Só leitura nesta fase; as ações sobre a pendência ficam nas telas dos módulos (link "Abrir no módulo").
export default async function PaginaCentral({ searchParams }: PageProps<"/gestao">) {
  const sessao = await exigirSessao();
  // Usuário restrito à unidade (Contagem) só usa o Faturamento Filial; sem área nenhuma, não há o que mostrar.
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();

  const areasGestor = areasComNivel(sessao.acesso, sessao.areas, "gestor");
  const ehGestor = areasGestor.length > 0;
  const { visao, filtros, pagina } = lerFiltros(await searchParams, ehGestor);
  const supabase = await criarClienteServidor();
  const { resumo, intervencao, fila, total, porPagina, equipe } = await lerCentral(supabase, visao, filtros, pagina);

  const hoje = hojeEmCuiaba();
  const extenso = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const dataExtenso = extenso.charAt(0).toUpperCase() + extenso.slice(1);
  const areasVisiveis = sessao.areas.filter((a) => temAcesso(sessao.acesso, a.codigo));
  const codigosAreas = new Set(areasVisiveis.map((a) => a.codigo));
  const nomeArea = new Map(areasVisiveis.map((a) => [a.codigo, a.nome]));
  const opcoesModulos = sessao.modulos
    .filter((m) => codigosAreas.has(m.area) && (!filtros.area || m.area === filtros.area))
    .map((m) => ({ valor: m.codigo, rotulo: `${nomeArea.get(m.area)} › ${m.nome}` }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const opcoesResponsaveis = equipe?.map((l) => ({ valor: l.responsavel_id, rotulo: l.nome })) ?? null;
  const descricaoVisao = visao === "gestao"
    ? areasGestor.length === sessao.areas.length ? "Gestão: todas as áreas" : "Gestão: as áreas em que você é gestor"
    : "Minhas pendências e as sem responsável das áreas em que você atua";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Gestão</h1>
          <p className="text-sm text-muted-foreground">{dataExtenso} · {descricaoVisao}</p>
        </div>
        {ehGestor && (
          <nav aria-label="Visão da Central" className="flex gap-1 rounded-[3px] border border-grade p-0.5">
            <Button size="sm" variant={visao === "gestao" ? "secondary" : "ghost"} nativeButton={false} render={<Link href={hrefCentral("gestao", filtros)} />}>Gestão</Button>
            <Button size="sm" variant={visao === "minhas" ? "secondary" : "ghost"} nativeButton={false} render={<Link href={hrefCentral("minhas", filtros)} />}>Minhas pendências</Button>
          </nav>
        )}
      </header>

      <Indicadores resumo={resumo} visao={visao} filtros={filtros} />

      <Intervencao itens={intervencao} total={resumo.intervir} hoje={hoje} visao={visao} filtros={filtros} />

      {equipe && <Equipe linhas={equipe} visao={visao} filtros={filtros} />}

      <section id="fila" aria-labelledby="titulo-fila" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="titulo-fila" className="text-lg font-semibold tracking-tight">Fila consolidada</h2>
          {filtros.recorte && (
            <span className="inline-flex items-center gap-1 rounded-[3px] border border-marca bg-marca-clara px-2 py-0.5 text-[12px] text-marca">
              Mostrando: {ROTULO_RECORTE[filtros.recorte]}
              <Link href={`${hrefCentral(visao, filtros, { recorte: undefined, pagina: 1 })}#fila`} className="font-bold" aria-label="Remover o recorte">×</Link>
            </span>
          )}
          {temFiltro(filtros) && <span className="text-[12px] text-muted-foreground">Filtros aplicados também aos indicadores e à equipe.</span>}
        </div>
        <Filtros
          visao={visao} filtros={filtros}
          areas={areasVisiveis.map((a) => ({ valor: a.codigo, rotulo: a.nome }))}
          modulos={opcoesModulos}
          responsaveis={opcoesResponsaveis}
        />
        <Fila linhas={fila} total={total} pagina={pagina} porPagina={porPagina} hoje={hoje} visao={visao} filtros={filtros} />
      </section>
    </div>
  );
}
