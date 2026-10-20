import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarRange, Check, FileDown, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_COMISSOES, ROTA_COMISSOES } from "@/lib/modulos/comercial/comissoes/regras";
import { resumirAno, type FechamentoResumo } from "@/lib/modulos/comercial/comissoes/resumo";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AbrirFechamento } from "./componentes";
import { rotuloCompetencia } from "./dados";
import { GraficoMensal } from "./grafico";

export const metadata: Metadata = { title: "Comissões" };

/** Cores dos representantes no gráfico, na ordem fixa do cadastro (validadas para daltonismo). */
const CORES = ["#2563EB", "#EA8A2E", "#0F766E", "#9333EA"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const linkBotao = "inline-flex h-10 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted";
const situacao = (f: FechamentoResumo) => (f.historico ? "Histórico (planilha)" : f.status === "fechado" ? "Fechado" : "Em conferência");

export default async function PaginaComissoes({ searchParams }: PageProps<"/comercial/comissoes">) {
  const sessao = await exigirSessao();
  const ehOperador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "operador");
  const ehGestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "gestor");
  const hoje = hojeEmCuiaba();
  const anoParam = Number((await searchParams).ano);
  const ano = Number.isInteger(anoParam) && anoParam >= 2020 && anoParam <= 2100 ? anoParam : Number(hoje.slice(0, 4));
  const supabase = await criarClienteServidor();
  const [{ data: fechamentos }, { data: linhas }, { data: reps }, { data: reaberturas }] = await Promise.all([
    supabase.from("fin_com_fechamentos").select("id, competencia, status, historico, fechado_em, z_sem_credito").order("competencia", { ascending: false }),
    supabase.from("fin_com_linhas").select("fechamento_id, cod_representante, origem, incluida, valor_comissao, cod_titulo, observacao, motivo").range(0, 19_999),
    supabase.from("fin_com_representantes").select("cod_representante, nome, perc_venda, perc_locacao, recebe_de, ativo").order("cod_representante"),
    supabase.from("fin_com_reaberturas").select("fechamento_id, motivo, reaberto_em").order("reaberto_em", { ascending: false }),
  ]);
  const todos = (fechamentos ?? []) as (FechamentoResumo & { z_sem_credito: unknown[] })[];
  const todasLinhas = linhas ?? [];
  const resumo = resumirAno(todos, todasLinhas, ano);
  const representantes = (reps ?? []).filter((r) => r.ativo || resumo.porRepresentante[r.cod_representante]);
  const nomeRep = new Map((reps ?? []).map((r) => [r.cod_representante as string, r.nome as string]));
  const anos = [...new Set([Number(hoje.slice(0, 4)), ...todos.map((f) => Number(f.competencia.slice(0, 4)))])].sort((a, b) => b - a);

  // Mês de trabalho aberto (em conferência) e o último mês do ano, para os relatórios dos cartões.
  const abertos = todos.filter((f) => f.status === "em_conferencia" && !f.historico);
  const ultimoDoAno = resumo.meses[0];
  const aPagar = ultimoDoAno?.total.saldo ?? 0;
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const mesAnterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  const proximo = todos[0] ? (() => {
    const [y, mm] = [Number(todos[0].competencia.slice(0, 4)), Number(todos[0].competencia.slice(5, 7))];
    const prox = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    return prox <= `${a}-${String(m).padStart(2, "0")}` ? prox : mesAnterior;
  })() : mesAnterior;

  // Pontos de atenção.
  const idsAno = new Set(resumo.meses.map((x) => x.fechamento.id));
  const idsAbertos = new Set(abertos.map((f) => f.id));
  const competenciaDe = new Map(todos.map((f) => [f.id, f.competencia]));
  const repetidos = todasLinhas.filter((l) => idsAno.has(l.fechamento_id) && (l.observacao ?? "").startsWith("Repetido"));
  const excluidasAbertos = todasLinhas.filter((l) => idsAbertos.has(l.fechamento_id) && !l.incluida);
  const barradasTeto = excluidasAbertos.filter((l) => (l.motivo ?? "").startsWith("Excede o"));
  const zSemCredito = abertos.reduce((s, f) => s + (Array.isArray(f.z_sem_credito) ? f.z_sem_credito.length : 0), 0);

  // Gráfico: os 12 meses do ano, comissão antes das antecipações.
  const series = representantes.map((r, i) => ({ cod: r.cod_representante as string, nome: r.nome as string, cor: CORES[i % CORES.length] }));
  const porCompetencia = new Map(resumo.meses.map((x) => [x.fechamento.competencia.slice(0, 7), x]));
  const mesesGrafico = MESES.map((rot, i) => {
    const chave = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const x = porCompetencia.get(chave);
    return {
      rotulo: rot, nome: rotuloCompetencia(`${chave}-01`), situacao: x ? situacao(x.fechamento) : "Sem fechamento",
      valores: Object.fromEntries(series.map((s) => [s.cod, x?.porRepresentante[s.cod]?.total ?? 0])),
    };
  });
  const inicial = ultimoDoAno ? Number(ultimoDoAno.fechamento.competencia.slice(5, 7)) - 1 : Number(hoje.slice(5, 7)) - 1;
  const relatorio = (id: string, cod: string) => ({
    imprimir: `/imprimir/comissoes/${id}?rep=${encodeURIComponent(cod)}`, excel: `${ROTA_COMISSOES}/${id}/planilha?rep=${encodeURIComponent(cod)}`,
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Comissões</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Fechamento mensal da comissão dos representantes: créditos da CCCCI010, títulos pagos no mês (Consistem), conferência, fechamento e relatórios.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Link href={`${ROTA_COMISSOES}/representantes`} className={linkBotao}>Representantes e percentuais</Link>
          {ehGestor && <Link href={`${ROTA_COMISSOES}/representantes#historico`} className={linkBotao}>Histórico das planilhas</Link>}
          {ehOperador && <div className="rounded-lg border bg-card p-2"><AbrirFechamento mesPadrao={proximo} /></div>}
        </div>
      </div>

      {abertos.map((f) => {
        const r = (reaberturas ?? []).find((x) => x.fechamento_id === f.id);
        return (
          <div key={f.id} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 flex-none text-amber-700 dark:text-amber-300" aria-hidden />
              <div>
                <p className="font-semibold first-letter:uppercase">{rotuloCompetencia(f.competencia)} {r ? "reaberto e " : ""}em conferência</p>
                <p className="text-sm text-muted-foreground">
                  {r ? `Reaberto em ${new Date(r.reaberto_em).toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })}: ${r.motivo}. ` : ""}
                  Confira e feche antes de enviar os relatórios.
                </p>
              </div>
            </div>
            <Link href={`${ROTA_COMISSOES}/${f.id}`} className="inline-flex h-10 items-center rounded-md bg-amber-900 px-4 text-sm font-semibold text-white hover:bg-amber-950">Ir para a conferência</Link>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Ano">
        <span className="text-muted-foreground">Ano:</span>
        {anos.map((x) => (
          <Link key={x} href={`?ano=${x}`} aria-current={x === ano ? "true" : undefined}
            className={`inline-flex h-8 items-center rounded-md px-3 ${x === ano ? "bg-foreground text-background" : "border bg-background hover:bg-muted"}`}>{x}</Link>
        ))}
      </div>

      <section aria-label="Resumo do ano" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">Comissão do ano{resumo.meses.length ? ` (${MESES[Number(resumo.meses.at(-1)!.fechamento.competencia.slice(5, 7)) - 1]}–${MESES[Number(resumo.meses[0].fechamento.competencia.slice(5, 7)) - 1]}/${ano})` : ""}</span>
          <strong className="text-2xl font-bold tabular-nums">{formatarMoeda(resumo.total.total)}</strong>
          <span className="text-xs text-muted-foreground">{series.map((s) => `${s.nome.split(" ")[0]} ${formatarMoeda(resumo.porRepresentante[s.cod]?.total ?? 0)}`).join(" · ")}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">Antecipações descontadas</span>
          <strong className="text-2xl font-bold tabular-nums">{formatarMoeda(resumo.total.antecipado)}</strong>
          <span className="text-xs text-muted-foreground">{todasLinhas.filter((l) => idsAno.has(l.fechamento_id) && l.incluida && l.origem === "antecipacao").length} antecipação(ões) no ano</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">Saldo dos meses</span>
          <strong className="text-2xl font-bold tabular-nums">{formatarMoeda(resumo.total.saldo)}</strong>
          <span className="text-xs text-muted-foreground">Comissão − antecipações</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border-2 border-primary bg-card p-4">
          <span className="text-xs font-semibold text-primary">{ultimoDoAno ? `A pagar em ${rotuloCompetencia(ultimoDoAno.fechamento.competencia)}` : "A pagar"}</span>
          <strong className="text-2xl font-bold tabular-nums text-primary">{formatarMoeda(aPagar)}</strong>
          <span className="text-xs text-muted-foreground">{ultimoDoAno ? situacao(ultimoDoAno.fechamento) : "Nenhum fechamento no ano"}</span>
        </div>
      </section>

      <div className="flex flex-wrap gap-5">
        <Card className="min-w-0 flex-[999_1_640px]">
          <CardHeader>
            <CardTitle>Comissão por mês — {ano}</CardTitle>
            <CardDescription>Antes das antecipações · passe o mouse sobre a barra</CardDescription>
          </CardHeader>
          <CardContent><GraficoMensal meses={mesesGrafico} series={series} inicial={inicial} /></CardContent>
        </Card>
        <Card className="min-w-0 flex-[1_1_320px]">
          <CardHeader><CardTitle>Pontos de atenção</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {repetidos.length > 0 && (
                <li className="flex gap-2.5">
                  <span className="flex size-6 flex-none items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">{repetidos.length}</span>
                  <span><strong>Títulos pagos duas vezes nas planilhas</strong><br />
                    <span className="text-muted-foreground">
                      {repetidos.map((l) => {
                        const antes = (l.observacao ?? "").match(/(\d{2})\/\d{4}/);
                        const depois = Number((competenciaDe.get(l.fechamento_id) ?? "").slice(5, 7));
                        return `${l.cod_titulo} (${antes ? MESES[Number(antes[1]) - 1] : "?"} e ${MESES[depois - 1] ?? "?"}) ${formatarMoeda(Math.round(Number(l.valor_comissao) * 100))} — ${nomeRep.get(l.cod_representante) ?? l.cod_representante}`;
                      }).join(" · ")}
                    </span>
                  </span>
                </li>
              )}
              {excluidasAbertos.length > 0 && (
                <li className="flex gap-2.5">
                  <span className="flex size-6 flex-none items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">{excluidasAbertos.length}</span>
                  <span><strong>Linha(s) excluída(s) no mês em conferência</strong><br />
                    <span className="text-muted-foreground">{excluidasAbertos.slice(0, 5).map((l) => `${l.cod_titulo ?? "lançamento"}${l.motivo ? ` (${l.motivo})` : ""}`).join(" · ")}</span>
                  </span>
                </li>
              )}
              {[
                [zSemCredito === 0, "Títulos Z com crédito", zSemCredito === 0 ? "Nenhum Z sem crédito na CCCCI010 nos meses em conferência" : `${zSemCredito} título(s) Z sem crédito na CCCCI010`],
                [barradasTeto.length === 0, "Teto por pedido", barradasTeto.length === 0 ? "Nenhuma linha acima do valor do pedido" : `${barradasTeto.length} linha(s) barrada(s) pelo teto do pedido`],
              ].map(([ok, titulo, texto]) => (
                <li key={String(titulo)} className="flex gap-2.5">
                  <span className={`flex size-6 flex-none items-center justify-center rounded-full ${ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
                    {ok ? <Check className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
                  </span>
                  <span><strong>{titulo}</strong><br /><span className="text-muted-foreground">{texto}</span></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section aria-label="Relatórios por representante" className="space-y-3">
        <h2 className="text-lg font-semibold">Relatórios por representante</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {series.map((s) => {
            const r = representantes.find((x) => x.cod_representante === s.cod)!;
            const doAno = resumo.porRepresentante[s.cod];
            const outros = (r.recebe_de as string[]).filter((x) => x !== s.cod).map((x) => nomeRep.get(x) ?? x);
            return (
              <article key={s.cod} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-base">{s.nome}</strong>
                    <p className="text-xs text-muted-foreground">
                      Venda {Number(r.perc_venda).toLocaleString("pt-BR")}% · Locação {Number(r.perc_locacao).toLocaleString("pt-BR")}%{outros.length > 0 && ` · recebe também pelas vendas de ${outros.join(", ")}`}
                    </p>
                  </div>
                  <span aria-hidden className="mt-1.5 size-2.5 rounded-sm" style={{ background: s.cor }} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><span className="block text-xs text-muted-foreground">Comissão no ano</span><strong className="tabular-nums">{formatarMoeda(doAno?.total ?? 0)}</strong></div>
                  <div><span className="block text-xs text-muted-foreground">Antecipado no ano</span><strong className="tabular-nums">{formatarMoeda(doAno?.antecipado ?? 0)}</strong></div>
                  <div><span className="block text-xs text-muted-foreground">{ultimoDoAno ? `${rotuloCompetencia(ultimoDoAno.fechamento.competencia).split("/")[0]} a pagar` : "A pagar"}</span>
                    <strong className="tabular-nums text-primary">{formatarMoeda(ultimoDoAno?.porRepresentante[s.cod]?.saldo ?? 0)}</strong></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ultimoDoAno && (
                    <a href={relatorio(ultimoDoAno.fechamento.id, s.cod).imprimir} target="_blank" rel="noreferrer" className={linkBotao}><Printer className="size-4" aria-hidden /> Relatório do mês</a>
                  )}
                  <a href={`/imprimir/comissoes/extrato?rep=${encodeURIComponent(s.cod)}&ano=${ano}`} target="_blank" rel="noreferrer" className={linkBotao}><CalendarRange className="size-4" aria-hidden /> Extrato do ano</a>
                  {ultimoDoAno && <a href={relatorio(ultimoDoAno.fechamento.id, s.cod).excel} className={linkBotao}><FileDown className="size-4" aria-hidden /> Excel</a>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Fechamentos</CardTitle>
          <CardDescription>Saldo a pagar de cada representante (comissão − antecipações)</CardDescription>
        </CardHeader>
        <CardContent>
          {resumo.meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum fechamento em {ano}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Situação</TableHead>
                  {series.map((s) => <TableHead key={s.cod} className="text-right">{s.nome.split(" ")[0]}</TableHead>)}
                  <TableHead className="text-right">Total a pagar</TableHead>
                  <TableHead>Relatórios</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumo.meses.map((x) => (
                  <TableRow key={x.fechamento.id}>
                    <TableCell><Link href={`${ROTA_COMISSOES}/${x.fechamento.id}`} className="font-medium underline-offset-4 hover:underline">{rotuloCompetencia(x.fechamento.competencia)}</Link></TableCell>
                    <TableCell><Badge variant={x.fechamento.status === "em_conferencia" ? "outline" : "secondary"}>{situacao(x.fechamento)}</Badge></TableCell>
                    {series.map((s) => (
                      <TableCell key={s.cod} className="text-right tabular-nums">{x.porRepresentante[s.cod] ? formatarMoeda(x.porRepresentante[s.cod].saldo) : "—"}</TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">{formatarMoeda(x.total.saldo)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {series.filter((s) => x.porRepresentante[s.cod]).map((s) => (
                          <a key={s.cod} href={relatorio(x.fechamento.id, s.cod).imprimir} target="_blank" rel="noreferrer"
                            className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs hover:bg-muted">{s.nome.split(" ")[0]}</a>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
