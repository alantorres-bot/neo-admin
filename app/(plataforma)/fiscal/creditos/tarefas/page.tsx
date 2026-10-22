import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { competencia, data, dataHora, reais } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, ROTULO_STATUS_TAREFA, ROTULO_TIPO_TAREFA, ROTULO_VALIDACAO, type Validacao } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { mudarSituacaoTarefa } from "../acoes";
import { AcoesMovimento, Historico } from "../blocos";
import { Secao, Selo, Vazio } from "../componentes";
import { contexto, lerCadastros, lerHistorico, nomes } from "../dados";
import { FormTarefa } from "../formularios";
import { Campo, FormularioAcao, SELECT, TEXTAREA } from "../ui";

export const metadata: Metadata = { title: "Tarefas e aprovações" };

export default async function PaginaTarefas({ searchParams }: PageProps<"/fiscal/creditos/tarefas">) {
  const { supabase, papel, sessao } = await contexto();
  const sp = await searchParams;
  const hoje = hojeEmCuiaba();
  const filtro = sp.ver === "todas" ? "todas" : sp.ver === "encerradas" ? "encerradas" : "minhas";
  const tarefaSel = typeof sp.tarefa === "string" && /^[0-9a-f-]{36}$/i.test(sp.tarefa) ? sp.tarefa : "";
  const cad = await lerCadastros();
  const n = nomes(cad);
  let qt = supabase.from("fis_tarefas").select("*").order("prazo", { ascending: true, nullsFirst: false }).order("criado_em", { ascending: false }).limit(300);
  if (filtro === "minhas") qt = qt.or(`responsavel_id.eq.${sessao.userId},solicitante_id.eq.${sessao.userId},responsavel_id.is.null`).in("status", ["aberta", "em_andamento"]);
  else if (filtro === "todas") qt = qt.in("status", ["aberta", "em_andamento"]);
  else qt = qt.in("status", ["concluida", "cancelada"]);
  const [{ data: tarefas }, { data: creditosPend }, { data: movsPend }, { data: periodosRev }, { data: obrigs }, { data: decisoes }] = await Promise.all([
    qt,
    supabase.from("fis_creditos").select("id, codigo, descricao, valor_original, validacao, responsavel_lancamento, criado_em").in("validacao", ["pendente", "em_analise"]).eq("arquivado", false).order("criado_em").limit(200),
    supabase.from("fis_movimentos").select("id, numero, credito_id, tipo, valor_assinado, competencia, descricao, status, estornado, registrado_por, registrado_em, credito:fis_creditos(codigo)").eq("status", "pendente").order("registrado_em").limit(200),
    supabase.from("fis_periodos").select("id, estabelecimento_id, tributo_id, competencia, enviado_revisao_por, enviado_revisao_em, requer_reconciliacao, status").or("status.eq.em_revisao,requer_reconciliacao.eq.true").order("competencia").limit(200),
    supabase.from("fis_obrigacoes").select("id, tipo_id, estabelecimento_id, competencia, status, transmitida_por").in("status", ["aguardando_aprovacao", "transmitida"]).order("competencia").limit(200),
    supabase.from("fis_decisoes").select("id, alvo, alvo_id, decisao, justificativa, usuario_id, em").order("id", { ascending: false }).limit(60),
  ]);
  const sel = tarefaSel ? (await supabase.from("fis_tarefas").select("*").eq("id", tarefaSel).maybeSingle()).data : null;
  const histSel = sel ? await lerHistorico(supabase, "tarefa", sel.id) : null;
  const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
  const linkAlvo = (alvo: string | null, id: string | null) => !alvo || !id ? null
    : alvo === "credito" ? `${ROTA_CREDITOS}/creditos/${id}` : alvo === "obrigacao" ? `${ROTA_CREDITOS}/obrigacoes/${id}` : alvo === "documento" ? `${ROTA_CREDITOS}/documentos?doc=${id}` : alvo === "divergencia" || alvo === "periodo" ? `${ROTA_CREDITOS}/conciliacao` : null;
  const aprovador = pode(papel, "validar");
  const qtd = (creditosPend ?? []).length + (movsPend ?? []).length + (periodosRev ?? []).length + (obrigs ?? []).length;

  return (
    <div className="space-y-4">
      <Secao titulo={`Fila de aprovações e revisões (${qtd})`} descricao={aprovador ? "Você só pode aprovar o que não lançou (segregação de funções)." : "Somente revisor, contador ou administrador aprova; aqui você acompanha o que aguarda decisão."}>
        {qtd === 0 ? <Vazio titulo="Nada aguardando decisão" /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-bold">Créditos aguardando validação ({(creditosPend ?? []).length})</h3>
              <ul className="space-y-1 text-sm">
                {(creditosPend ?? []).map((c) => (
                  <li key={c.id}><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${c.id}`}>{c.codigo}</Link> · {reais(c.valor_original)} · <Selo tom="atencao">{ROTULO_VALIDACAO[c.validacao as Validacao]}</Selo>
                    <span className="text-xs text-muted-foreground"> · lançado por {c.responsavel_lancamento ? n.usuario.get(c.responsavel_lancamento) : "sistema"}{c.responsavel_lancamento === sessao.userId ? " (você: outra pessoa valida)" : ""}</span></li>
                ))}
              </ul>
              <h3 className="mb-1 mt-3 text-sm font-bold">Competências em revisão ou a reconciliar ({(periodosRev ?? []).length})</h3>
              <ul className="space-y-1 text-sm">
                {(periodosRev ?? []).map((p) => (
                  <li key={p.id}><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/apuracao?estab=${p.estabelecimento_id}&tributo=${p.tributo_id}&ano=${p.competencia.slice(0, 4)}&mes=${Number(p.competencia.slice(5, 7))}`}>
                    {n.estab.get(p.estabelecimento_id)} · {n.tributo.get(p.tributo_id)} · {competencia(p.competencia)}</Link> {p.requer_reconciliacao ? <Selo tom="grave">reconciliar</Selo> : <Selo tom="info">em revisão</Selo>}</li>
                ))}
              </ul>
              <h3 className="mb-1 mt-3 text-sm font-bold">Obrigações aguardando aprovação ou conferência ({(obrigs ?? []).length})</h3>
              <ul className="space-y-1 text-sm">
                {(obrigs ?? []).map((o) => (
                  <li key={o.id}><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${o.id}`}>{n.tipoObr.get(o.tipo_id)} · {n.estab.get(o.estabelecimento_id)} · {competencia(o.competencia)}</Link> <Selo tom="info">{o.status === "transmitida" ? "conferir entrega" : "aprovar transmissão"}</Selo></li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-bold">Lançamentos pendentes de aprovação ({(movsPend ?? []).length})</h3>
              {(movsPend ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Crédito</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Por</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(movsPend ?? []).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>{m.numero}</TableCell>
                        <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${m.credito_id}`}>{um(m.credito as unknown as { codigo: string } | null)?.codigo}</Link><span className="block text-[11px]">{competencia(m.competencia)}</span></TableCell>
                        <TableCell title={m.descricao}>{n.tipoMov.get(m.tipo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{reais(m.valor_assinado)}</TableCell>
                        <TableCell className="text-xs">{m.registrado_por ? n.usuario.get(m.registrado_por) : "sistema"}</TableCell>
                        <TableCell><AcoesMovimento m={m} papel={papel} usuarioId={sessao.userId} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Secao>

      <Secao titulo="Tarefas" acoes={pode(papel, "lancar") ? <FormTarefa cad={cad} /> : undefined}>
        <div className="mb-2 flex gap-2 text-sm">
          {([["minhas", "Minhas e sem responsável"], ["todas", "Todas abertas"], ["encerradas", "Encerradas"]] as const).map(([k, r]) => (
            <Link key={k} href={`${ROTA_CREDITOS}/tarefas?ver=${k}`} className={`rounded-[3px] border px-2 py-0.5 ${filtro === k ? "border-marca bg-marca-clara font-bold" : ""}`}>{r}</Link>
          ))}
        </div>
        {(tarefas ?? []).length === 0 ? <Vazio titulo="Nenhuma tarefa" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Tarefa</TableHead><TableHead>Tipo</TableHead><TableHead>Responsável</TableHead><TableHead>Solicitante</TableHead><TableHead>Prazo</TableHead><TableHead>Situação</TableHead><TableHead>Registro</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {(tarefas ?? []).map((t) => {
                const atrasada = t.prazo && t.prazo < hoje && ["aberta", "em_andamento"].includes(t.status);
                const alvo = linkAlvo(t.alvo, t.alvo_id);
                return (
                  <TableRow key={t.id} className={t.id === tarefaSel ? "bg-marca-clara/60" : ""}>
                    <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/tarefas?ver=${filtro}&tarefa=${t.id}`}>{t.titulo}</Link>{t.ficticio && <span className="ml-1 text-[10px] text-muted-foreground">(fictício)</span>}{alvo && <Link className="block text-[11px] text-elo" href={alvo}>abrir registro</Link>}</TableCell>
                    <TableCell>{ROTULO_TIPO_TAREFA[t.tipo]}{t.tipo_documento_solicitado && <span className="block text-[11px]">{n.tipoDoc.get(t.tipo_documento_solicitado)}</span>}</TableCell>
                    <TableCell>{t.responsavel_id ? n.usuario.get(t.responsavel_id) : "—"}</TableCell>
                    <TableCell>{t.solicitante_id ? n.usuario.get(t.solicitante_id) : "sistema"}</TableCell>
                    <TableCell className={atrasada ? "font-bold text-red-700" : ""}>{data(t.prazo) || "—"}{atrasada ? " (atrasada)" : ""}</TableCell>
                    <TableCell><Selo tom={t.status === "concluida" ? "bom" : t.status === "cancelada" ? "neutro" : atrasada ? "grave" : "atencao"}>{ROTULO_STATUS_TAREFA[t.status]}</Selo></TableCell>
                    <TableCell className="text-xs">{dataHora(t.criado_em)}</TableCell>
                    <TableCell>
                      {pode(papel, "lancar") && ["aberta", "em_andamento"].includes(t.status) && (
                        <FormularioAcao titulo={t.titulo} botao="Atualizar" tamanho="xs" acao={mudarSituacaoTarefa} ocultos={{ id: t.id }} rotuloSalvar="Salvar"
                          descricao={t.tipo === "solicitacao_documento" ? "Solicitação de documento só é concluída quando o documento estiver vinculado ao registro." : undefined}>
                          <Campo rotulo="Situação" htmlFor={`ts-${t.id}`}>
                            <select id={`ts-${t.id}`} name="status" className={SELECT} defaultValue={t.status}><option value="aberta">Aberta</option><option value="em_andamento">Em andamento</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select>
                          </Campo>
                          {pode(papel, "atribuir") && (
                            <Campo rotulo="Reatribuir a" htmlFor={`tr-${t.id}`}>
                              <select id={`tr-${t.id}`} name="responsavel_id" className={SELECT} defaultValue=""><option value="">(manter)</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
                            </Campo>
                          )}
                          <Campo rotulo="Resposta / comentário" htmlFor={`tc-${t.id}`}><textarea id={`tc-${t.id}`} name="resposta" className={TEXTAREA} /></Campo>
                        </FormularioAcao>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Secao>

      {sel && histSel && (
        <Secao titulo={`Tarefa: ${sel.titulo}`} descricao={sel.descricao ?? undefined}>
          <Historico decisoes={histSel.decisoes} comentarios={histSel.comentarios} nomeUsuario={n.usuario} alvo="tarefa" alvoId={sel.id} papel={papel} />
        </Secao>
      )}

      <Secao titulo="Histórico de decisões (últimas 60)" descricao="Quem decidiu, quando, o quê e por quê. Registros imutáveis.">
        {(decisoes ?? []).length === 0 ? <Vazio titulo="Sem decisões registradas" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Quem</TableHead><TableHead>Registro</TableHead><TableHead>Decisão</TableHead><TableHead>Justificativa</TableHead></TableRow></TableHeader>
            <TableBody>
              {(decisoes ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{dataHora(d.em)}</TableCell>
                  <TableCell>{d.usuario_id ? n.usuario.get(d.usuario_id) : "sistema"}</TableCell>
                  <TableCell>{linkAlvo(d.alvo, d.alvo_id) ? <Link className="text-elo hover:underline" href={linkAlvo(d.alvo, d.alvo_id)!}>{d.alvo}</Link> : d.alvo}</TableCell>
                  <TableCell>{d.decisao}</TableCell>
                  <TableCell className="max-w-md whitespace-normal">{d.justificativa ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>
    </div>
  );
}
