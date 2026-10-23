import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarDataHora, hojeEmCuiaba } from "@/lib/nucleo/fila";
import {
  ROTULO_PRIORIDADE_SUGESTAO, ROTULO_SITUACAO_SUGESTAO, descreverEventoSugestao, type EventoSugestao, type PrioridadeSugestao, type SituacaoSugestao,
} from "@/lib/nucleo/gestao/sugestoes";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AvaliarSugestao, ComentarSugestao, CriarTarefaSugestao } from "../formularios";

export const metadata: Metadata = { title: "Sugestão de melhoria" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sugestao = {
  id: string; numero: number; titulo: string; area: string; modulo: string | null; problema: string | null; como_hoje: string | null;
  melhoria: string; resultado_esperado: string | null; status: SituacaoSugestao; prioridade: PrioridadeSugestao | null;
  justificativa: string | null; avaliada_em: string | null; pendencia_id: string | null; criado_em: string;
  autor: { nome: string } | null; avaliador: { nome: string } | null; tarefa: { titulo: string; status: string } | null;
};

function Bloco({ titulo, texto }: { titulo: string; texto: string | null }) {
  if (!texto) return null;
  return (<div><h3 className="text-[11px] text-muted-foreground">{titulo}</h3><p className="whitespace-pre-line text-sm">{texto}</p></div>);
}

// Detalhe da sugestão: só o autor e os avaliadores chegam aqui (a RLS some com a linha para os demais).
export default async function PaginaSugestao({ params }: PageProps<"/gestao/sugestoes/[id]">) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("sugestoes")
    .select("*, autor:perfis!sugestoes_autor_id_fkey(nome), avaliador:perfis!sugestoes_avaliada_por_fkey(nome), tarefa:pendencias!sugestoes_pendencia_id_fkey(titulo, status)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao ler a sugestão: ${error.message}`);
  if (!data) notFound();
  const s = data as unknown as Sugestao;

  const [historico, avaliador, pessoas] = await Promise.all([
    supabase.rpc("sugestao_historico", { p_id: id }),
    supabase.rpc("pode_avaliar_sugestoes"),
    supabase.from("perfis").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const podeAvaliar = avaliador.data === true;
  const eventos = (historico.data ?? []) as EventoSugestao[];
  const area = sessao.areas.find((a) => a.codigo === s.area)?.nome ?? s.area;
  const modulo = s.modulo ? (sessao.modulos.find((m) => m.codigo === s.modulo)?.nome ?? s.modulo) : null;
  const tarefaAberta = s.tarefa && (s.tarefa.status === "aberta" || s.tarefa.status === "em_andamento");

  return (
    <div className="max-w-4xl space-y-4">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao/sugestoes" />}><ArrowLeft /> Sugestões</Button>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Sugestão nº {s.numero}: {s.titulo}</h1>
          <Badge variant="outline">{ROTULO_SITUACAO_SUGESTAO[s.status]}</Badge>
          {s.prioridade && <Badge variant="secondary">Prioridade {ROTULO_PRIORIDADE_SUGESTAO[s.prioridade].toLowerCase()}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {area}{modulo ? ` › ${modulo}` : ""} · enviada por {s.autor?.nome ?? "—"} em {formatarDataHora(s.criado_em)}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {podeAvaliar && <AvaliarSugestao id={s.id} atual={s.status} prioridade={s.prioridade} />}
        {podeAvaliar && (s.status === "aprovada" || s.status === "em_desenvolvimento") && !tarefaAberta && (
          <CriarTarefaSugestao id={s.id} pessoas={(pessoas.data ?? []) as { id: string; nome: string }[]} hoje={hojeEmCuiaba()} />
        )}
        <ComentarSugestao id={s.id} />
      </div>

      <Card>
        <CardHeader><CardTitle>Sugestão</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Bloco titulo="Melhoria sugerida" texto={s.melhoria} />
          <Bloco titulo="Problema observado" texto={s.problema} />
          <Bloco titulo="Como é feito hoje" texto={s.como_hoje} />
          <Bloco titulo="Resultado esperado" texto={s.resultado_esperado} />
        </CardContent>
      </Card>

      {(s.justificativa || s.tarefa) && (
        <Card>
          <CardHeader><CardTitle>Decisão</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {s.justificativa && <p>{s.justificativa}{s.avaliador ? ` — ${s.avaliador.nome}, ${formatarDataHora(s.avaliada_em)}` : ""}</p>}
            {s.tarefa && s.pendencia_id && (
              <p>Tarefa de implementação: <Link href={`/gestao/${s.pendencia_id}`} className="text-elo hover:underline">{s.tarefa.titulo}</Link></p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Histórico e comentários</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-1.5 border-l-2 border-grade pl-3 text-sm">
            {[...eventos].reverse().map((e, i) => (
              <li key={`${e.em}-${i}`}>
                <span className="text-[11px] text-muted-foreground">{formatarDataHora(e.em)} · {e.quem}</span>
                <p className="whitespace-pre-line">{descreverEventoSugestao(e)}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
