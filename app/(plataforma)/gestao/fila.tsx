"use client";

// Fila consolidada da Central. Para o gestor, caixas de marcação e a barra "Atribuir selecionadas": cada pendência passa
// pela mesma ação "atribuir" da tela de detalhe, e o banco decide (uma recusa não impede as demais).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useLinhasVisiveis } from "@/components/ui/table";
import { descreverPrazo, formatarData, formatarDataHora } from "@/lib/nucleo/fila";
import { ROTULO_PRIORIDADE } from "@/lib/nucleo/gestao/destaque";
import { hrefCentral, type FiltrosCentral, type Visao } from "@/lib/nucleo/gestao/filtros";
import { LIMITE_LOTE, resumirLote } from "@/lib/nucleo/gestao/tarefas";
import { atribuirEmLote } from "./acoes";
import { ROTULO_ORIGEM, SeloDestaque, textoSituacao } from "./componentes";
import type { LinhaCentral } from "./dados";
import type { Pessoa } from "./formularios";

/** Quem pode distribuir: as áreas em que é gestor e as pessoas que pode escolher. */
export type Atribuicao = { areasGestor: string[]; candidatos: Pessoa[] };

const SEM_RESPONSAVEL = "sem";

export function Fila({
  linhas, total, pagina, porPagina, hoje, visao, filtros, atribuicao,
}: {
  linhas: LinhaCentral[]; total: number; pagina: number; porPagina: number; hoje: string; visao: Visao; filtros: FiltrosCentral;
  atribuicao: Atribuicao | null;
}) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [responsavel, setResponsavel] = useState("");
  const [recado, setRecado] = useState("");
  const [recusadas, setRecusadas] = useState<{ titulo: string; erro: string }[]>([]);
  const [enviando, iniciar] = useTransition();
  const { visivel, aoFiltrar } = useLinhasVisiveis();

  const podeMarcar = (p: LinhaCentral) =>
    atribuicao !== null && (p.status === "aberta" || p.status === "em_andamento") && atribuicao.areasGestor.includes(p.area);
  // "Marcar todos" pega só o que o filtro das colunas deixou à vista.
  const idsSelecionaveis = linhas.filter((p) => podeMarcar(p) && visivel(p.id)).map((p) => p.id);
  const todasMarcadas = idsSelecionaveis.length > 0 && idsSelecionaveis.every((id) => marcadas.has(id));
  const alternar = (ids: string[]) => setMarcadas((atual) => {
    const novo = new Set(atual);
    const todas = ids.every((id) => novo.has(id));
    for (const id of ids) {
      if (todas) novo.delete(id);
      else novo.add(id);
    }
    return novo;
  });

  function atribuir() {
    const ids = [...marcadas];
    iniciar(async () => {
      const r = await atribuirEmLote({ ids, responsavel_id: responsavel === SEM_RESPONSAVEL ? "" : responsavel, texto: recado });
      if ("erro" in r) {
        toast.error(r.erro);
        return;
      }
      const titulo = new Map(linhas.map((p) => [p.id, p.titulo]));
      setRecusadas(r.recusadas.map((x) => ({ titulo: titulo.get(x.id) ?? x.id, erro: x.erro })));
      setMarcadas(new Set(r.recusadas.map((x) => x.id)));
      if (r.recusadas.length > 0) toast.warning(resumirLote(r));
      else toast.success(resumirLote(r));
      router.refresh();
    });
  }

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (linhas.length === 0) {
    return (
      <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhuma pendência encontrada com estes filtros.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {atribuicao && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[3px] border border-grade bg-marca-clara px-3 py-2 text-sm shadow-sm">
          <strong className="tabular-nums">{marcadas.size} {marcadas.size === 1 ? "selecionada" : "selecionadas"}</strong>
          <label className="flex items-center gap-1 text-[13px]">
            Atribuir a
            <select
              value={responsavel} onChange={(e) => setResponsavel(e.target.value)}
              className="h-7 rounded-[3px] border border-input bg-white px-2 text-[13px]"
            >
              <option value="">Escolha…</option>
              <option value={SEM_RESPONSAVEL}>Sem responsável</option>
              {atribuicao.candidatos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <Input
            value={recado} onChange={(e) => setRecado(e.target.value)} maxLength={4000} placeholder="Recado ao responsável (opcional)"
            aria-label="Recado ao responsável" className="h-7 w-64 bg-white"
          />
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" onClick={atribuir} disabled={marcadas.size === 0 || marcadas.size > LIMITE_LOTE || responsavel === "" || enviando}>
              {enviando ? "Atribuindo…" : "Atribuir selecionadas"}
            </Button>
            {marcadas.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setMarcadas(new Set())}>Limpar seleção</Button>}
          </span>
          {recusadas.length > 0 && (
            <ul role="alert" className="basis-full space-y-0.5 text-[12px] text-destructive">
              {recusadas.map((x, i) => <li key={i}>Recusada: {x.titulo} — {x.erro}</li>)}
            </ul>
          )}
        </div>
      )}
      <Table className="cartoes" aoFiltrar={atribuicao ? aoFiltrar : undefined}>
        <TableHeader>
          <TableRow>
            {atribuicao && (
              <TableHead className="w-8">
                <input
                  type="checkbox" className="size-4" aria-label="Marcar todas as visíveis desta página" checked={todasMarcadas}
                  onChange={() => alternar(idsSelecionaveis)} disabled={idsSelecionaveis.length === 0}
                />
              </TableHead>
            )}
            <TableHead>Título</TableHead><TableHead>Módulo</TableHead><TableHead>Área</TableHead><TableHead>Responsável</TableHead>
            <TableHead>Prazo</TableHead><TableHead>Prioridade</TableHead><TableHead>Situação</TableHead><TableHead>Destaque</TableHead>
            <TableHead>Origem</TableHead><TableHead>Última movimentação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((p) => (
            <TableRow key={p.id}>
              {atribuicao && (
                <TableCell>
                  {podeMarcar(p) && (
                    <input type="checkbox" className="size-4" aria-label={`Marcar ${p.titulo}`} checked={marcadas.has(p.id)} onChange={() => alternar([p.id])} />
                  )}
                </TableCell>
              )}
              <TableCell className="max-w-[28rem] whitespace-normal">
                <Link href={`/gestao/${p.id}`} className="text-elo hover:underline">{p.titulo}</Link>
                {p.contraparte_nome && <span className="block text-[11px] text-muted-foreground">{p.contraparte_nome}</span>}
              </TableCell>
              <TableCell>{p.modulo_nome}</TableCell>
              <TableCell>{p.area_nome}</TableCell>
              <TableCell>{p.responsavel_nome ?? "Sem responsável"}</TableCell>
              <TableCell className={p.atrasada ? "text-marca" : undefined} title={descreverPrazo(p.prazo, hoje)}>
                {p.prazo ? formatarData(p.prazo) : "Sem prazo"}
              </TableCell>
              <TableCell>{ROTULO_PRIORIDADE[p.prioridade]}</TableCell>
              <TableCell>{textoSituacao(p)}</TableCell>
              <TableCell><SeloDestaque nivel={p.destaque} /></TableCell>
              <TableCell>{ROTULO_ORIGEM[p.origem]}</TableCell>
              <TableCell>{formatarDataHora(p.movimentado_em)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {total} {total === 1 ? "pendência" : "pendências"} · página {pagina} de {paginas}. A classificação e o filtro das colunas valem
          para esta página; os filtros acima valem para todas.
        </span>
        <span className="flex gap-1">
          {pagina > 1 && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${hrefCentral(visao, filtros, { pagina: pagina - 1 })}#fila`} />}>Anterior</Button>}
          {pagina < paginas && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${hrefCentral(visao, filtros, { pagina: pagina + 1 })}#fila`} />}>Próxima</Button>}
        </span>
      </nav>
    </div>
  );
}
