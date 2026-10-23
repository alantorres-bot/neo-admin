// Blocos da Central de Gestão (componentes de servidor; a interação é por links e formulário GET). A fila, com a
// atribuição em lote, fica em fila.tsx.
// Regras e textos: docs/modulos/administrativo-gestao.md, seções 5 e 7.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { descreverPrazo, formatarDataHora } from "@/lib/nucleo/fila";
import {
  ROTULO_DESTAQUE, acaoRecomendada, descreverMotivo, ordenarMotivos, type NivelDestaque,
} from "@/lib/nucleo/gestao/destaque";
import { hrefCentral, type FiltrosCentral, type Recorte, type Visao } from "@/lib/nucleo/gestao/filtros";
import type { LinhaArea, LinhaCentral, LinhaEquipe, Resumo } from "./dados";

const ROTULO_STATUS: Record<LinhaCentral["status"], string> = {
  aberta: "Aberta", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada",
};

export const ROTULO_ORIGEM: Record<LinhaCentral["origem"], string> = { modulo: "Módulo", manual: "Manual" };

/** Situação = status + marcas (bloqueada, aguardando gestor). */
export function textoSituacao(p: Pick<LinhaCentral, "status" | "bloqueada" | "aguarda_gestor">): string {
  const partes = [ROTULO_STATUS[p.status]];
  if (p.bloqueada) partes.push("bloqueada");
  if (p.aguarda_gestor) partes.push("aguarda gestor");
  return partes.join(" · ");
}

/** Link para a tela do módulo de origem: só rotas do próprio painel, e não a da própria Central (tarefas manuais). */
export const linkInterno = (link: string | null) =>
  link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/gestao") ? link : null;

const COR_DESTAQUE: Record<NivelDestaque, string> = {
  intervir: "border-marca bg-marca-clara text-marca",
  avaliar: "border-elo text-elo",
  acompanhar: "border-grade bg-grade-clara text-texto",
  normal: "border-transparent text-muted-foreground",
};

export function SeloDestaque({ nivel }: { nivel: NivelDestaque }) {
  return <Badge variant="outline" className={COR_DESTAQUE[nivel]}>{ROTULO_DESTAQUE[nivel]}</Badge>;
}

// --- Indicadores -------------------------------------------------------------------------------------------------------

const INDICADORES: { recorte: Recorte | null; chave: keyof Resumo; rotulo: string; alerta?: boolean }[] = [
  { recorte: null, chave: "em_aberto", rotulo: "Em aberto" },
  { recorte: "atrasadas", chave: "atrasadas", rotulo: "Atrasadas", alerta: true },
  { recorte: "hoje", chave: "vencem_hoje", rotulo: "Vencem hoje" },
  { recorte: "intervir", chave: "intervir", rotulo: "Exigem intervenção", alerta: true },
  { recorte: "aguarda_gestor", chave: "aguarda_gestor", rotulo: "Aguardando gestor", alerta: true },
  { recorte: "bloqueadas", chave: "bloqueadas", rotulo: "Bloqueadas" },
  { recorte: "distribuir", chave: "distribuir", rotulo: "Precisam distribuir" },
];

export function Indicadores({ resumo, visao, filtros }: { resumo: Resumo; visao: Visao; filtros: FiltrosCentral }) {
  return (
    <section aria-label="Indicadores" className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {INDICADORES.map((i) => {
          const valor = resumo[i.chave];
          const ativo = (filtros.recorte ?? null) === i.recorte;
          return (
            <Link
              key={i.chave}
              href={`${hrefCentral(visao, filtros, { recorte: i.recorte ?? undefined, pagina: 1 })}#fila`}
              aria-current={ativo ? "true" : undefined}
              className={cn(
                "rounded-[3px] border bg-card p-2.5 text-center transition-colors hover:bg-grade-clara",
                ativo ? "border-marca ring-1 ring-marca" : "border-grade",
                i.recorte === null && "bg-cabecalho",
              )}
            >
              <span className={cn("block font-condensada text-2xl font-bold", i.alerta && valor > 0 && "text-marca")}>{valor}</span>
              <span className="block text-[11px] text-muted-foreground">{i.rotulo}</span>
            </Link>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        &quot;Em aberto&quot; é o total. Os demais são recortes dele e podem se sobrepor (uma pendência atrasada e bloqueada aparece
        nos dois): não some os números. Clique num indicador para ver as pendências que o compõem.{" "}
        <Link href="/gestao/regras" className="text-elo hover:underline">Como a Central classifica</Link>
      </p>
    </section>
  );
}

// --- Exige minha intervenção ------------------------------------------------------------------------------------------

export function Intervencao({ itens, total, hoje, visao, filtros }: { itens: LinhaCentral[]; total: number; hoje: string; visao: Visao; filtros: FiltrosCentral }) {
  return (
    <Card>
      <CardHeader className="border-l-4 border-l-marca">
        <CardTitle>Exige minha intervenção ({total})</CardTitle>
        <CardDescription>Cada pendência aparece uma vez, com todos os motivos do destaque. As regras estão na especificação da Central.</CardDescription>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nada exige sua intervenção agora{total === 0 ? "." : " nos filtros aplicados."}
          </p>
        ) : (
          <ul className="divide-y divide-grade-clara">
            {itens.map((p) => {
              const motivos = ordenarMotivos(p.motivos);
              const acao = acaoRecomendada(p.motivos, p.responsavel_id !== null);
              const origem = linkInterno(p.link);
              return (
                <li key={p.id} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/gestao/${p.id}`} className="font-medium text-elo hover:underline">{p.titulo}</Link>
                    <span className="text-[12px] text-muted-foreground">{textoSituacao(p)}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {p.area_nome} › {p.modulo_nome} · {p.responsavel_nome ?? "sem responsável"} · {descreverPrazo(p.prazo, hoje)}
                  </p>
                  <ul className="space-y-0.5 text-[12px]">
                    {motivos.map((m, i) => (
                      <li key={`${m.codigo}-${i}`} className={m.nivel === "intervir" ? "font-medium text-marca" : "text-texto"}>
                        {descreverMotivo(m)}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-3 text-[12px]">
                    {acao && <span><span className="text-muted-foreground">Ação recomendada:</span> <strong>{acao}</strong></span>}
                    <Link href={`/gestao/${p.id}`} className="text-elo hover:underline">Detalhes</Link>
                    {origem && (
                      <Link href={origem} className="inline-flex items-center gap-0.5 text-elo hover:underline">
                        Abrir no módulo <ArrowUpRight className="size-3" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {total > itens.length && (
          <p className="mt-2 text-[12px]">
            Mostrando {itens.length} de {total}.{" "}
            <Link href={`${hrefCentral(visao, filtros, { recorte: "intervir", pagina: 1 })}#fila`} className="text-elo hover:underline">Ver todas na fila</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Áreas e módulos que precisam de atenção --------------------------------------------------------------------------

/** Módulos com algo a olhar (intervenção, avaliação, atraso, bloqueio, decisão ou distribuição), o mais urgente primeiro. */
export function AreasAtencao({ linhas, visao, filtros }: { linhas: LinhaArea[]; visao: Visao; filtros: FiltrosCentral }) {
  const comAtencao = linhas.filter((l) => l.intervir + l.avaliar + l.atrasadas + l.bloqueadas + l.aguarda_gestor + l.distribuir > 0);
  const tranquilos = linhas.length - comAtencao.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Áreas e módulos que precisam de atenção</CardTitle>
        <CardDescription>
          Por módulo, com as mesmas regras dos indicadores. Os números de uma linha se sobrepõem (uma pendência atrasada e bloqueada conta
          nas duas colunas). Clique no módulo para filtrar a fila.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {comAtencao.length === 0 ? (
          <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum módulo com pontos de atenção.</p>
        ) : (
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Área</TableHead><TableHead>Módulo</TableHead><TableHead>Abertas</TableHead><TableHead>Exigem intervenção</TableHead>
                <TableHead>Avaliar</TableHead><TableHead>Atrasadas</TableHead><TableHead>Bloqueadas</TableHead><TableHead>Aguardando gestor</TableHead>
                <TableHead>Precisam distribuir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comAtencao.map((l) => (
                <TableRow key={l.modulo}>
                  <TableCell>{l.area_nome}</TableCell>
                  <TableCell>
                    <Link href={`${hrefCentral(visao, filtros, { area: l.area, modulo: l.modulo, recorte: undefined, pagina: 1 })}#fila`} className="text-elo hover:underline">
                      {l.modulo_nome}
                    </Link>
                  </TableCell>
                  <TableCell>{l.abertas}</TableCell>
                  <TableCell className={l.intervir > 0 ? "font-medium text-marca" : undefined}>{l.intervir}</TableCell>
                  <TableCell>{l.avaliar}</TableCell>
                  <TableCell>{l.atrasadas}</TableCell>
                  <TableCell>{l.bloqueadas}</TableCell>
                  <TableCell>{l.aguarda_gestor}</TableCell>
                  <TableCell>{l.distribuir}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {tranquilos > 0 && <p className="text-[12px] text-muted-foreground">{tranquilos} {tranquilos === 1 ? "módulo" : "módulos"} com pendências abertas e sem pontos de atenção.</p>}
      </CardContent>
    </Card>
  );
}

// --- Acompanhamento da equipe -----------------------------------------------------------------------------------------

export function Equipe({ linhas, visao, filtros }: { linhas: LinhaEquipe[]; visao: Visao; filtros: FiltrosCentral }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acompanhamento da equipe</CardTitle>
        <CardDescription>
          Pendências abertas por responsável, só nas áreas que você acompanha. Não é medida de produtividade: volume, complexidade e
          responsabilidades variam de pessoa para pessoa e de área para área.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {linhas.length === 0 ? (
          <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma pendência aberta com responsável.</p>
        ) : (
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead><TableHead>Áreas</TableHead><TableHead>Abertas</TableHead><TableHead>Atrasadas</TableHead>
                <TableHead>Vencem hoje</TableHead><TableHead>Bloqueadas</TableHead><TableHead>Aguardando gestor</TableHead>
                <TableHead>Última movimentação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.responsavel_id}>
                  <TableCell>
                    <Link href={`${hrefCentral(visao, filtros, { responsavel: l.responsavel_id, recorte: undefined, pagina: 1 })}#fila`} className="text-elo hover:underline">
                      {l.nome}
                    </Link>
                  </TableCell>
                  <TableCell>{l.areas}</TableCell>
                  <TableCell>{l.abertas}</TableCell>
                  <TableCell className={l.atrasadas > 0 ? "text-marca" : undefined}>{l.atrasadas}</TableCell>
                  <TableCell>{l.vencem_hoje}</TableCell>
                  <TableCell>{l.bloqueadas}</TableCell>
                  <TableCell>{l.aguarda_gestor}</TableCell>
                  <TableCell>{formatarDataHora(l.ultima_movimentacao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Filtros ----------------------------------------------------------------------------------------------------------

const CLASSE_CAMPO =
  "h-8 w-full min-w-0 rounded-[3px] border border-input bg-white px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Opcao = { valor: string; rotulo: string };

function Selecao({ nome, rotulo, valor, opcoes }: { nome: string; rotulo: string; valor?: string; opcoes: Opcao[] }) {
  return (
    <label className="space-y-0.5 text-[11px] text-muted-foreground">
      <span>{rotulo}</span>
      <select name={nome} defaultValue={valor ?? ""} className={CLASSE_CAMPO}>
        <option value="">Todas</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </label>
  );
}

export function Filtros({
  visao, filtros, areas, modulos, responsaveis,
}: { visao: Visao; filtros: FiltrosCentral; areas: Opcao[]; modulos: Opcao[]; responsaveis: Opcao[] | null }) {
  return (
    <form method="get" action="/gestao" className="grid grid-cols-2 gap-2 rounded-[3px] border border-grade bg-cabecalho p-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <input type="hidden" name="visao" value={visao} />
      {filtros.recorte && <input type="hidden" name="recorte" value={filtros.recorte} />}
      <label className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground">
        <span>Buscar (título, descrição ou cliente/fornecedor)</span>
        <input type="search" name="busca" defaultValue={filtros.busca ?? ""} maxLength={100} className={CLASSE_CAMPO} />
      </label>
      <Selecao nome="area" rotulo="Área" valor={filtros.area} opcoes={areas} />
      <Selecao nome="modulo" rotulo="Módulo" valor={filtros.modulo} opcoes={modulos} />
      {responsaveis && (
        <Selecao nome="responsavel" rotulo="Responsável" valor={filtros.responsavel} opcoes={[{ valor: "sem", rotulo: "Sem responsável" }, ...responsaveis]} />
      )}
      <Selecao nome="situacao" rotulo="Situação" valor={filtros.situacao} opcoes={[
        { valor: "aberta", rotulo: "Aberta" }, { valor: "em_andamento", rotulo: "Em andamento" }, { valor: "bloqueada", rotulo: "Bloqueada" },
        { valor: "aguarda_gestor", rotulo: "Aguardando gestor" }, { valor: "concluida", rotulo: "Concluída" }, { valor: "cancelada", rotulo: "Cancelada" },
      ]} />
      <Selecao nome="prioridade" rotulo="Prioridade" valor={filtros.prioridade} opcoes={[
        { valor: "critica", rotulo: "Crítica" }, { valor: "alta", rotulo: "Alta" }, { valor: "normal", rotulo: "Normal" },
      ]} />
      <Selecao nome="destaque" rotulo="Destaque" valor={filtros.destaque} opcoes={[
        { valor: "intervir", rotulo: "Intervir" }, { valor: "avaliar", rotulo: "Avaliar" }, { valor: "acompanhar", rotulo: "Acompanhar" }, { valor: "normal", rotulo: "Normal" },
      ]} />
      <Selecao nome="origem" rotulo="Origem" valor={filtros.origem} opcoes={[{ valor: "modulo", rotulo: "Módulo" }, { valor: "manual", rotulo: "Manual" }]} />
      <label className="space-y-0.5 text-[11px] text-muted-foreground">
        <span>Prazo de</span>
        <input type="date" name="prazo_de" defaultValue={filtros.prazo_de ?? ""} className={CLASSE_CAMPO} />
      </label>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">
        <span>Prazo até</span>
        <input type="date" name="prazo_ate" defaultValue={filtros.prazo_ate ?? ""} className={CLASSE_CAMPO} />
      </label>
      <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
        <Button type="submit" size="sm">Filtrar</Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={hrefCentral(visao, {})} />}>Limpar</Button>
      </div>
    </form>
  );
}
