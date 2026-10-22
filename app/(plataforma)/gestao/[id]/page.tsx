import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { descreverPrazo, formatarData, formatarDataHora, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { ROTULO_PRIORIDADE, acaoRecomendada, descreverMotivo, ordenarMotivos } from "@/lib/nucleo/gestao/destaque";
import { descreverEvento, type EventoHistorico } from "@/lib/nucleo/gestao/historico";
import { MODULO_TAREFAS_GERAIS, ROTULO_CATEGORIA, type Categoria } from "@/lib/nucleo/gestao/tarefas";
import { nivelAtinge, nivelNaArea, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_ORIGEM, SeloDestaque, linkInterno, textoSituacao } from "../componentes";
import { lerPendencia } from "../dados";
import { AcaoComTexto, AjustarDestaque, Alterar, Atribuir, Bloquear, BotaoAcao, type Pessoa } from "../formularios";

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

// Detalhe de uma pendência na Central: dados, motivos do destaque, ações permitidas, comentários e histórico, e o caminho
// para a tela do módulo de origem. Some quem não pode ver (a função do banco aplica a RLS de quem consulta). Os botões
// seguem o nível do usuário só para não oferecer o que ele não pode; quem decide é o banco.
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

  const nivel = nivelNaArea(sessao.acesso, p.area);
  const gestor = nivelAtinge(nivel, "gestor");
  const operador = nivelAtinge(nivel, "operador");
  const responsavel = p.responsavel_id === sessao.userId;

  const [extras, historico, candidatos, dependencias] = await Promise.all([
    supabase.from("pendencias").select("criado_por, destaque_manual, precisa_distribuir").eq("id", id).maybeSingle(),
    supabase.rpc("pendencia_historico", { p_id: id }),
    // Gestor distribui: nas "Tarefas gerais", para qualquer pessoa ativa; nos módulos, para quem atua na área.
    gestor && aberta
      ? p.modulo === MODULO_TAREFAS_GERAIS
        ? supabase.from("perfis").select("id, nome").eq("ativo", true).order("nome")
        : supabase.rpc("usuarios_da_area", { p_area: p.area })
      : Promise.resolve(null),
    (gestor || responsavel) && aberta && !p.bloqueada
      ? supabase.rpc("central_pendencias", { p_visao: gestor ? "gestao" : "minhas", p_filtros: {} }).select("id, titulo").order("titulo").limit(100)
      : Promise.resolve(null),
  ]);
  if (historico.error) throw new Error(`Falha ao ler o histórico: ${historico.error.message}`);
  const criador = extras.data?.criado_por === sessao.userId;
  const destaqueManual = (extras.data?.destaque_manual as string | null) ?? null;
  const eventos = (historico.data ?? []) as EventoHistorico[];
  const pessoas = ((candidatos?.data ?? []) as Pessoa[]).map((x) => ({ id: x.id, nome: x.nome }));
  const outras = ((dependencias?.data ?? []) as { id: string; titulo: string }[]).filter((d) => d.id !== id);
  const podeComentar = operador || responsavel || criador;
  const podeAndar = aberta && (gestor || responsavel);

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

      <section aria-label="Ações" className="flex flex-wrap gap-2">
        {podeAndar && p.status === "aberta" && <BotaoAcao id={id} acao="iniciar" rotulo="Iniciar" sucesso="Pendência em andamento." variante="default" />}
        {podeAndar && p.status === "em_andamento" && <BotaoAcao id={id} acao="pausar" rotulo="Voltar para aberta" sucesso="Pendência voltou para aberta." />}
        {aberta && operador && p.responsavel_id === null && <BotaoAcao id={id} acao="assumir" rotulo="Assumir" sucesso="Pendência assumida." />}
        {aberta && (gestor || responsavel || (operador && p.responsavel_id === null)) && (
          <AcaoComTexto id={id} acao="concluir" rotulo="Concluir" titulo="Concluir pendência" campo="Observação da conclusão (opcional)" obrigatorio={false} sucesso="Pendência concluída." variante="default" />
        )}
        {podeAndar && !p.bloqueada && <Bloquear id={id} dependencias={outras} />}
        {podeAndar && p.bloqueada && (
          <AcaoComTexto id={id} acao="desbloquear" rotulo="Desbloquear" titulo="Desbloquear" campo="O que destravou? (opcional)" obrigatorio={false} sucesso="Pendência desbloqueada." />
        )}
        {aberta && responsavel && !p.aguarda_gestor && (
          <AcaoComTexto id={id} acao="pedir_decisao" rotulo="Pedir decisão do gestor" titulo="Pedir decisão do gestor" campo="O que precisa ser decidido?" sucesso="Pedido enviado ao gestor." />
        )}
        {aberta && gestor && p.aguarda_gestor && (
          <AcaoComTexto id={id} acao="responder_decisao" rotulo="Responder decisão" titulo="Responder ao pedido de decisão" descricao={p.aguarda_gestor_motivo ?? undefined} campo="Sua decisão" sucesso="Decisão registrada." variante="default" />
        )}
        {aberta && gestor && <Atribuir id={id} atual={p.responsavel_id} candidatos={pessoas} />}
        {aberta && gestor && (
          <Alterar id={id} dados={{ titulo: p.titulo, descricao: p.descricao, prazo: p.prazo, prioridade: p.prioridade, categoria: p.categoria, precisaDistribuir: Boolean(extras.data?.precisa_distribuir) }} />
        )}
        {aberta && gestor && <AjustarDestaque id={id} atual={destaqueManual} />}
        {aberta && gestor && p.responsavel_id && (
          <AcaoComTexto id={id} acao="cobrar" rotulo="Cobrar andamento" titulo="Cobrar andamento do responsável" descricao="Fica registrado no histórico da pendência." campo="Mensagem ao responsável" sucesso="Cobrança registrada." />
        )}
        {aberta && p.origem === "manual" && (gestor || criador) && (
          <AcaoComTexto id={id} acao="cancelar" rotulo="Cancelar tarefa" titulo="Cancelar tarefa" descricao="A tarefa não é apagada: fica cancelada, com o motivo no histórico." campo="Motivo do cancelamento" sucesso="Tarefa cancelada." />
        )}
        {!aberta && gestor && <BotaoAcao id={id} acao="reabrir" rotulo="Reabrir" sucesso="Pendência reaberta." confirmar="Reabrir esta pendência?" />}
      </section>

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
            {p.categoria && <Campo rotulo="Categoria">{ROTULO_CATEGORIA[p.categoria as Categoria] ?? p.categoria}</Campo>}
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

      <Card>
        <CardHeader>
          <CardTitle>Comentários e histórico</CardTitle>
          <CardDescription>Nada aqui é apagado. Mudanças feitas pelas rotinas automáticas aparecem como &quot;Sistema&quot;.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {podeComentar && (
            <AcaoComTexto id={id} acao="comentar" rotulo="Comentar" titulo="Novo comentário" campo="Comentário" sucesso="Comentário registrado." />
          )}
          {eventos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem registros.</p>
          ) : (
            <ol className="space-y-1.5 border-l-2 border-grade pl-3 text-sm">
              {[...eventos].reverse().map((e, i) => (
                <li key={`${e.em}-${e.evento}-${i}`}>
                  <span className="text-[11px] text-muted-foreground">{formatarDataHora(e.em)} · {e.quem}</span>
                  <p className="whitespace-pre-line">{descreverEvento(e)}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
