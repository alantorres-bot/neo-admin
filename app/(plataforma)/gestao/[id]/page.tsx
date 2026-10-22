import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { descreverPrazo, formatarData, formatarDataHora, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { ROTULO_PRIORIDADE, acaoRecomendada, descreverMotivo, ordenarMotivos } from "@/lib/nucleo/gestao/destaque";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_ORIGEM, SeloDestaque, linkInterno, textoSituacao } from "../componentes";
import { lerPendencia } from "../dados";

export const metadata: Metadata = { title: "Pendência — Central de Gestão" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTULO_IMPACTO = { financeiro: "Financeiro", fiscal: "Fiscal", operacional: "Operacional" } as const;

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Detalhe de uma pendência na Central: dados, motivos do destaque e o caminho para a tela do módulo de origem.
// Some quem não pode ver (a função do banco aplica a RLS de quem consulta).
export default async function PaginaPendencia({ params }: PageProps<"/gestao/[id]">) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await criarClienteServidor();
  const p = await lerPendencia(supabase, id);
  if (!p) notFound();

  const hoje = hojeEmCuiaba();
  const motivos = ordenarMotivos(p.motivos);
  const ajustadoPor = motivos.find((m) => m.codigo === "AJUSTE_MANUAL")?.por;
  const nomes = new Map<string, string>();
  if (ajustadoPor) {
    const { data } = await supabase.from("perfis").select("id, nome").eq("id", ajustadoPor).maybeSingle();
    if (data) nomes.set(data.id as string, data.nome as string);
  }
  const acao = acaoRecomendada(p.motivos, p.responsavel_id !== null);
  const origem = linkInterno(p.link);
  const aberta = p.status === "aberta" || p.status === "em_andamento";

  return (
    <div className="max-w-4xl space-y-4">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao" />}><ArrowLeft /> Central de Gestão</Button>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{p.titulo}</h1>
          {aberta && <SeloDestaque nivel={p.destaque} />}
          <Badge variant="outline">{textoSituacao(p)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{p.area_nome} › {p.modulo_nome}{p.contraparte_nome ? ` · ${p.contraparte_nome}` : ""}</p>
      </header>

      {origem && (
        <Button size="sm" nativeButton={false} render={<Link href={origem} />}>Abrir no módulo <ArrowUpRight /></Button>
      )}

      {aberta && (
        <Card>
          <CardHeader className={p.destaque === "intervir" ? "border-l-4 border-l-marca" : undefined}>
            <CardTitle>Por que está em destaque</CardTitle>
            <CardDescription>Calculado em {formatarDataHora(p.calculado_em)} pelas regras da Central (prazo, situação, bloqueio, distribuição e movimentação).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {motivos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma regra se aplica: a pendência segue o andamento normal.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {motivos.map((m, i) => (
                  <li key={`${m.codigo}-${i}`} className={m.nivel === "intervir" ? "font-medium text-marca" : undefined}>
                    {descreverMotivo(m, nomes)}
                  </li>
                ))}
              </ul>
            )}
            {acao && <p className="text-sm"><span className="text-muted-foreground">Ação recomendada:</span> <strong>{acao}</strong></p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Dados</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Campo rotulo="Responsável">{p.responsavel_nome ?? "Sem responsável"}</Campo>
            <Campo rotulo="Prazo">{p.prazo ? `${formatarData(p.prazo)}${aberta ? ` · ${descreverPrazo(p.prazo, hoje)}` : ""}` : "Sem prazo"}</Campo>
            <Campo rotulo="Prioridade">{ROTULO_PRIORIDADE[p.prioridade]}</Campo>
            <Campo rotulo="Origem">{ROTULO_ORIGEM[p.origem]}{p.criado_por_nome ? ` · criada por ${p.criado_por_nome}` : ""}</Campo>
            <Campo rotulo="Criada em">{formatarDataHora(p.criado_em)}</Campo>
            <Campo rotulo="Última movimentação">{formatarDataHora(p.movimentado_em)}</Campo>
            {p.concluido_em && <Campo rotulo="Concluída em">{formatarDataHora(p.concluido_em)}</Campo>}
            {p.categoria && <Campo rotulo="Categoria">{p.categoria}</Campo>}
            {p.impacto && <Campo rotulo="Impacto">{ROTULO_IMPACTO[p.impacto]}: {p.impacto_fundamento}</Campo>}
          </dl>
          {p.descricao && <p className="mt-3 whitespace-pre-line border-t border-grade-clara pt-3 text-sm">{p.descricao}</p>}
        </CardContent>
      </Card>

      {(p.bloqueada || p.aguarda_gestor) && (
        <Card>
          <CardHeader><CardTitle>Marcas</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.bloqueada && <p><strong>Bloqueada</strong> desde {formatarDataHora(p.bloqueada_em)}: {p.bloqueio_motivo}</p>}
            {p.aguarda_gestor && <p><strong>Aguarda decisão do gestor</strong> desde {formatarDataHora(p.aguarda_gestor_em)}: {p.aguarda_gestor_motivo}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
