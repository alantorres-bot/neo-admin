import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agregarPorChave, type LinhaBanco } from "@/lib/modulos/fiscal/creditos/apuracao";
import { centavos, competencia, data, dataHora, moeda } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, REGRAS, ROTA_CREDITOS, ROTULO_FONTE, ROTULO_SEVERIDADE, ROTULO_STATUS_DIVERGENCIA } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { mudarSituacaoDivergencia } from "../acoes";
import { Indicador, Secao, Selo, tomSeveridade, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormDivergencia } from "../formularios";
import { Campo, FormularioAcao, SELECT, TEXTAREA } from "../ui";

export const metadata: Metadata = { title: "Conciliação" };

type Alerta = {
  regra: string; severidade: string; titulo: string; descricao: string; chave: string; empresa_id: string; estabelecimento_id: string | null; tributo_id: string | null;
  competencia: string | null; credito_id: string | null; obrigacao_id: string | null; periodo_id: string | null; movimento_ids: string[] | null; valor: string | null;
};

export default async function PaginaConciliacao({ searchParams }: PageProps<"/fiscal/creditos/conciliacao">) {
  const { supabase, papel } = await contexto();
  const sp = await searchParams;
  const hoje = hojeEmCuiaba();
  const f = lerFiltros(sp, Number(hoje.slice(0, 4)));
  const regraSel = typeof sp.regra === "string" ? sp.regra : "";
  const cad = await lerCadastros();
  const n = nomes(cad);
  const ini = `${f.ano}-01-01`, fim = `${f.ano}-12-01`;
  const [{ data: alertas, error }, { data: ap }, { data: pers }, { data: comps }, { data: divs }] = await Promise.all([
    supabase.rpc("fis_verificar", { p_empresa: f.empresa || null, p_ano: f.ano }),
    supabase.rpc("fis_apuracao", { p_inicio: ini, p_fim: fim, p_empresa: f.empresa || null, p_estabelecimento: f.estab || null, p_tributo: f.tributo || null }),
    supabase.from("fis_periodos").select("id, estabelecimento_id, tributo_id, competencia, status, saldo_oficial, saldo_declarado, snapshot, requer_reconciliacao").gte("competencia", ini).lte("competencia", fim),
    supabase.from("fis_movimentos").select("estabelecimento_id, tributo_id, competencia, valor, protocolo").eq("tipo", "compensacao").eq("status", "efetivo").eq("estornado", false).gte("competencia", ini).lte("competencia", fim),
    supabase.from("fis_divergencias").select("*").order("criado_em", { ascending: false }).limit(300),
  ]);
  if (error) throw new Error(`Conciliação: ${error.message}`);
  const todos = ((alertas ?? []) as Alerta[]).filter((a) => (!f.estab || a.estabelecimento_id === f.estab) && (!f.tributo || a.tributo_id === f.tributo));
  const visiveis = regraSel ? todos.filter((a) => a.regra === regraSel) : todos;
  const porRegra = Object.entries(todos.reduce<Record<string, number>>((m, a) => ({ ...m, [a.regra]: (m[a.regra] ?? 0) + 1 }), {}));
  const registradas = new Set((divs ?? []).filter((d) => ["aberta", "em_analise"].includes(d.status) && d.regra).map((d) => `${d.regra}|${d.chave_regra}`));
  const periodo = new Map((pers ?? []).map((p) => [`${p.estabelecimento_id}|${p.tributo_id}|${p.competencia}`, p]));
  const linhas = agregarPorChave((ap ?? []) as LinhaBanco[]).filter((l) => l.saldoFinal !== 0 || l.saldoInicial !== 0 || periodo.has(l.chave));
  const comp = (chave: string, comProtocolo: boolean) => (comps ?? []).filter((m) => `${m.estabelecimento_id}|${m.tributo_id}|${m.competencia}` === chave && !!m.protocolo === comProtocolo).reduce((s, m) => s + centavos(m.valor), 0);
  const divergencias = (divs ?? []).filter((d) => (!f.empresa || d.empresa_id === f.empresa) && (!f.estab || d.estabelecimento_id === f.estab) && (!f.tributo || d.tributo_id === f.tributo));
  const base = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, ano: f.ano };
  const linkAlerta = (a: Alerta) => a.credito_id ? `${ROTA_CREDITOS}/creditos/${a.credito_id}` : a.obrigacao_id ? `${ROTA_CREDITOS}/obrigacoes/${a.obrigacao_id}`
    : a.periodo_id || a.competencia ? comFiltros(`${ROTA_CREDITOS}/apuracao`, { estab: a.estabelecimento_id, tributo: a.tributo_id, ano: a.competencia?.slice(0, 4), mes: a.competencia ? Number(a.competencia.slice(5, 7)) : null }) : "";

  return (
    <div className="space-y-4">
      <BarraFiltros cad={cad} f={f} campos={["ano", "empresa", "estab", "tributo"]} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Alertas da verificação" valor={todos.length} tom={todos.some((a) => ["critica", "alta"].includes(a.severidade)) ? "grave" : todos.length ? "atencao" : "bom"} />
        <Indicador rotulo="Críticos e altos" valor={todos.filter((a) => ["critica", "alta"].includes(a.severidade)).length} tom="grave" />
        <Indicador rotulo="Divergências abertas" valor={divergencias.filter((d) => ["aberta", "em_analise"].includes(d.status)).length} tom="atencao" />
        <Indicador rotulo="Diferenças em aberto" valor={moeda(divergencias.filter((d) => ["aberta", "em_analise"].includes(d.status)).reduce((s, d) => s + Math.abs(centavos(d.valor_diferenca)), 0))} />
      </div>

      <Secao titulo={`Verificações automáticas (${f.ano})`} descricao="Cada alerta diz a regra que falhou e os registros envolvidos. Calculadas na hora a partir dos dados."
        acoes={pode(papel, "lancar") ? <FormDivergencia cad={cad} padrao={{ empresa_id: f.empresa, estabelecimento_id: f.estab, tributo_id: f.tributo }} botao="Registrar divergência manual" /> : undefined}>
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <Link href={comFiltros(`${ROTA_CREDITOS}/conciliacao`, base)} className={`rounded-[3px] border px-2 py-0.5 ${!regraSel ? "border-marca bg-marca-clara font-bold" : ""}`}>Todas ({todos.length})</Link>
          {porRegra.map(([r, q]) => <Link key={r} title={REGRAS[r]?.explica} href={comFiltros(`${ROTA_CREDITOS}/conciliacao`, base, { regra: r })} className={`rounded-[3px] border px-2 py-0.5 ${regraSel === r ? "border-marca bg-marca-clara font-bold" : "hover:bg-muted"}`}>{REGRAS[r]?.nome ?? r} ({q})</Link>)}
        </div>
        {visiveis.length === 0 ? <Vazio titulo="Nenhum alerta">Todas as verificações passaram para os filtros escolhidos.</Vazio> : (
          <Table>
            <TableHeader><TableRow><TableHead>Severidade</TableHead><TableHead>Regra</TableHead><TableHead>O que falhou</TableHead><TableHead>Competência</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Registros</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {visiveis.map((a) => (
                <TableRow key={a.chave}>
                  <TableCell><Selo tom={tomSeveridade(a.severidade)}>{ROTULO_SEVERIDADE[a.severidade] ?? a.severidade}</Selo></TableCell>
                  <TableCell title={REGRAS[a.regra]?.explica}>{a.titulo}<span className="block text-[10px] text-muted-foreground">{a.regra}</span></TableCell>
                  <TableCell className="max-w-md whitespace-normal">{a.descricao}</TableCell>
                  <TableCell>{competencia(a.competencia) || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.valor !== null ? moeda(centavos(a.valor)) : "—"}</TableCell>
                  <TableCell>{linkAlerta(a) ? <Link className="text-elo hover:underline" href={linkAlerta(a)}>abrir</Link> : "—"}{a.movimento_ids?.length ? <span className="block text-[11px] text-muted-foreground">{a.movimento_ids.length} lançamento(s)</span> : null}</TableCell>
                  <TableCell>
                    {registradas.has(`${a.regra}|${a.chave}`) ? <Selo tom="info">registrada</Selo> : pode(papel, "lancar") && a.severidade !== "info" && (
                      <FormDivergencia cad={cad} botao="Registrar" padrao={{
                        empresa_id: a.empresa_id, estabelecimento_id: a.estabelecimento_id ?? "", tributo_id: a.tributo_id ?? "", competencia: a.competencia ?? "",
                        regra: a.regra, chave_regra: a.chave, motivo: `${a.titulo}: ${a.descricao}`, ...(a.credito_id ? { credito_id: a.credito_id } : {}),
                        ...(a.obrigacao_id ? { obrigacao_id: a.obrigacao_id } : {}), ...(a.periodo_id ? { periodo_id: a.periodo_id } : {}),
                      }} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>

      <Secao titulo={`Comparativo de saldos (${f.ano})`} descricao="Saldo interno calculado × apuração oficial × declaração, com transporte do período anterior, utilizações, compensações (com e sem protocolo), ressarcimentos e pendentes.">
        {linhas.length === 0 ? <Vazio titulo="Sem saldos no exercício" /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Estabelecimento</TableHead><TableHead>Tributo</TableHead><TableHead>Competência</TableHead><TableHead className="text-right">Transportado do anterior</TableHead>
              <TableHead className="text-right">Utilizado</TableHead><TableHead className="text-right">Compensado c/ protocolo</TableHead><TableHead className="text-right">Compensado s/ protocolo</TableHead>
              <TableHead className="text-right">Ressarcido/baixado</TableHead><TableHead className="text-right">Saldo interno</TableHead><TableHead className="text-right">Apuração oficial</TableHead>
              <TableHead className="text-right">Declarado</TableHead><TableHead className="text-right">Pendentes</TableHead><TableHead>Situação</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const p = periodo.get(l.chave);
                const ofi = p?.saldo_oficial != null ? centavos(p.saldo_oficial) : null;
                const dec = p?.saldo_declarado != null ? centavos(p.saldo_declarado) : null;
                const semProt = comp(l.chave, false);
                return (
                  <TableRow key={l.chave}>
                    <TableCell>{n.estab.get(l.estabelecimentoId)}</TableCell><TableCell>{n.tributo.get(l.tributoId)}</TableCell>
                    <TableCell><Link className="text-elo hover:underline" href={comFiltros(`${ROTA_CREDITOS}/apuracao`, { estab: l.estabelecimentoId, tributo: l.tributoId, ano: f.ano, mes: Number(l.competencia.slice(5, 7)) })}>{competencia(l.competencia)}</Link></TableCell>
                    <TableCell className="text-right tabular-nums">{moeda(l.saldoInicial - l.implantado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moeda(l.utilizado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moeda(comp(l.chave, true))}</TableCell>
                    <TableCell className={`text-right tabular-nums ${semProt ? "font-bold text-amber-700" : ""}`}>{moeda(semProt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moeda(l.baixado)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{moeda(l.saldoFinal)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${ofi !== null && ofi !== l.saldoFinal ? "font-bold text-red-700" : ""}`}>{ofi === null ? "—" : moeda(ofi)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${dec !== null && dec !== l.saldoFinal ? "font-bold text-red-700" : ""}`}>{dec === null ? "—" : moeda(dec)}</TableCell>
                    <TableCell className="text-right">{l.pendentes || ""}</TableCell>
                    <TableCell>{p?.status === "fechado" ? <Selo tom={p.requer_reconciliacao ? "grave" : "bom"}>{p.requer_reconciliacao ? "reconciliar" : "fechada"}</Selo> : <Selo>{p?.status === "em_revisao" ? "em revisão" : "aberta"}</Selo>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Secao>

      <Secao titulo="Divergências registradas">
        {divergencias.length === 0 ? <Vazio titulo="Nenhuma divergência registrada" /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nº</TableHead><TableHead>Estab./Tributo</TableHead><TableHead>Competência</TableHead><TableHead>Fonte</TableHead><TableHead className="text-right">Interno</TableHead>
              <TableHead className="text-right">Externo</TableHead><TableHead className="text-right">Diferença</TableHead><TableHead>Motivo / providência</TableHead><TableHead>Responsável</TableHead>
              <TableHead>Prazo</TableHead><TableHead>Situação</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {divergencias.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.numero}{d.regra && <span className="block text-[10px] text-muted-foreground">{d.regra}</span>}</TableCell>
                  <TableCell>{d.estabelecimento_id ? n.estab.get(d.estabelecimento_id) : "—"} / {d.tributo_id ? n.tributo.get(d.tributo_id) : "—"}</TableCell>
                  <TableCell>{competencia(d.competencia) || "—"}</TableCell>
                  <TableCell>{d.fonte_comparada ? ROTULO_FONTE[d.fonte_comparada] : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.valor_interno !== null ? moeda(centavos(d.valor_interno)) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.valor_externo !== null ? moeda(centavos(d.valor_externo)) : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{moeda(centavos(d.valor_diferenca))}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal">{d.motivo}{d.providencia && <span className="block text-xs text-muted-foreground">Providência: {d.providencia}</span>}{d.resolucao && <span className="block text-xs">Solução: {d.resolucao}</span>}</TableCell>
                  <TableCell>{d.responsavel_id ? n.usuario.get(d.responsavel_id) : "—"}</TableCell>
                  <TableCell className={d.prazo_interno && d.prazo_interno < hoje && ["aberta", "em_analise"].includes(d.status) ? "font-bold text-red-700" : ""}>{data(d.prazo_interno) || "—"}</TableCell>
                  <TableCell><Selo tom={["aberta", "em_analise"].includes(d.status) ? "atencao" : "bom"}>{ROTULO_STATUS_DIVERGENCIA[d.status]}</Selo><span className="block text-[10px] text-muted-foreground">{dataHora(d.criado_em)}</span></TableCell>
                  <TableCell>
                    {pode(papel, "lancar") && ["aberta", "em_analise"].includes(d.status) && (
                      <FormularioAcao titulo={`Divergência nº ${d.numero}`} botao="Tratar" tamanho="xs" acao={mudarSituacaoDivergencia} ocultos={{ id: d.id }} rotuloSalvar="Salvar"
                        descricao="Justificar, resolver ou cancelar exige revisor/contador/admin e registro do que foi feito.">
                        <Campo rotulo="Nova situação" htmlFor={`dvs-${d.id}`}>
                          <select id={`dvs-${d.id}`} name="status" className={SELECT} defaultValue="em_analise">
                            <option value="em_analise">Em análise</option><option value="justificada">Justificada</option><option value="resolvida">Resolvida</option><option value="cancelada">Cancelada</option>
                          </select>
                        </Campo>
                        <Campo rotulo="Responsável" htmlFor={`dvr-${d.id}`}>
                          <select id={`dvr-${d.id}`} name="responsavel_id" className={SELECT} defaultValue={d.responsavel_id ?? ""}><option value="">(manter)</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
                        </Campo>
                        <Campo rotulo="Análise / justificativa / solução" htmlFor={`dvt-${d.id}`}><textarea id={`dvt-${d.id}`} name="texto" className={TEXTAREA} /></Campo>
                      </FormularioAcao>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>
    </div>
  );
}
