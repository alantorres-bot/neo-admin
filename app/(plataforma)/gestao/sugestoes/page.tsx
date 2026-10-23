import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SugerirMelhoria } from "@/components/plataforma/sugerir-melhoria";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData } from "@/lib/nucleo/fila";
import {
  ROTULO_PRIORIDADE_SUGESTAO, ROTULO_SITUACAO_SUGESTAO, SITUACOES_SUGESTAO, type PrioridadeSugestao, type SituacaoSugestao,
} from "@/lib/nucleo/gestao/sugestoes";
import { montarMenu, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Sugestões de melhoria" };

type Linha = {
  id: string; numero: number; titulo: string; area: string; area_nome: string; modulo: string | null; modulo_nome: string | null;
  status: SituacaoSugestao; prioridade: PrioridadeSugestao | null; justificativa: string | null; criado_em: string; avaliada_em: string | null; minha: boolean;
};

// Sugestões de melhoria (docs/modulos/administrativo-gestao.md, 5.8): todos veem número, título, área, módulo, situação e
// a decisão; abrem o detalhe só o autor e os avaliadores (admin geral ou gestor do Administrativo).
export default async function PaginaSugestoes({ searchParams }: PageProps<"/gestao/sugestoes">) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();
  const sp = await searchParams;
  const situacao = SITUACOES_SUGESTAO.find((s) => s === sp.situacao) ?? null;
  const minhas = sp.minhas === "sim";
  const supabase = await criarClienteServidor();
  const [lista, avaliador] = await Promise.all([supabase.rpc("sugestoes_publicas"), supabase.rpc("pode_avaliar_sugestoes")]);
  if (lista.error) throw new Error(`Falha ao ler as sugestões: ${lista.error.message}`);
  const todas = (lista.data ?? []) as Linha[];
  const linhas = todas.filter((l) => (!situacao || l.status === situacao) && (!minhas || l.minha));
  const podeAvaliar = avaliador.data === true;
  const menu = montarMenu(sessao.areas, sessao.modulos, sessao.acesso, sessao.aplicativos, { incluirVazias: true });
  const contagem = (s: SituacaoSugestao) => todas.filter((l) => l.status === s).length;
  const href = (m: { situacao?: string | null; minhas?: boolean }) => {
    const p = new URLSearchParams();
    const s = m.situacao === undefined ? situacao : m.situacao;
    if (s) p.set("situacao", s);
    if (m.minhas ?? minhas) p.set("minhas", "sim");
    return `/gestao/sugestoes${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao" />}><ArrowLeft /> Central de Gestão</Button>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sugestões de melhoria</h1>
          <p className="text-sm text-muted-foreground">
            Dificuldades e ideias da equipe para o Neo Admin e os processos. Aprovar não muda o sistema sozinho: a melhoria segue o fluxo
            de especificação, construção, testes e validação.{podeAvaliar ? " Você avalia as sugestões." : ""}
          </p>
        </div>
        <SugerirMelhoria menu={menu.filter((m) => m.modulos.length > 0 || m.area.codigo === "administrativo")} caminho="/gestao/sugestoes" variante="default" />
      </header>

      <nav aria-label="Situação" className="flex flex-wrap gap-1 text-[12px]">
        <Button size="sm" variant={!situacao ? "secondary" : "ghost"} nativeButton={false} render={<Link href={href({ situacao: null })} />}>Todas ({todas.length})</Button>
        {SITUACOES_SUGESTAO.map((s) => (
          <Button key={s} size="sm" variant={situacao === s ? "secondary" : "ghost"} nativeButton={false} render={<Link href={href({ situacao: s })} />}>
            {ROTULO_SITUACAO_SUGESTAO[s]} ({contagem(s)})
          </Button>
        ))}
        <Button size="sm" variant={minhas ? "secondary" : "ghost"} nativeButton={false} render={<Link href={href({ minhas: !minhas })} />}>
          {minhas ? "Mostrando só as minhas" : "Só as minhas"}
        </Button>
      </nav>

      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma sugestão {situacao || minhas ? "com este filtro" : "ainda"}. Use &quot;Sugerir melhoria&quot; (também no alto de cada tela).
        </p>
      ) : (
        <Table className="cartoes">
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead><TableHead>Título</TableHead><TableHead>Área</TableHead><TableHead>Módulo</TableHead>
              <TableHead>Situação</TableHead><TableHead>Prioridade</TableHead><TableHead>Enviada em</TableHead><TableHead>Decisão</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.numero}</TableCell>
                <TableCell className="max-w-[24rem] whitespace-normal">
                  {l.minha || podeAvaliar ? <Link href={`/gestao/sugestoes/${l.id}`} className="text-elo hover:underline">{l.titulo}</Link> : l.titulo}
                  {l.minha && <span className="ml-1.5 text-[11px] text-muted-foreground">(minha)</span>}
                </TableCell>
                <TableCell>{l.area_nome}</TableCell>
                <TableCell>{l.modulo_nome ?? "—"}</TableCell>
                <TableCell>{ROTULO_SITUACAO_SUGESTAO[l.status]}</TableCell>
                <TableCell>{l.prioridade ? ROTULO_PRIORIDADE_SUGESTAO[l.prioridade] : "—"}</TableCell>
                <TableCell>{formatarData(l.criado_em)}</TableCell>
                <TableCell className="max-w-[24rem] whitespace-normal text-[12px]">{l.justificativa ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
