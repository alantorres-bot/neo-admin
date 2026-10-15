import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emCentavos, formatarMoeda, resumirCarteira, ROTULO_FAIXA, type Faixa } from "@/lib/modulos/financeiro/recebiveis/carteira";
import {
  formatarCurto, formatarPercentual, inadimplencia, montarPainel, somarRecebido, type LinhaPaga, type LinhaPainel,
} from "@/lib/modulos/financeiro/recebiveis/painel";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { formatarData, FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { PREFERENCIAS, lerPreferenciaBooleana } from "@/lib/nucleo/preferencias";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { RecebiveisAbas } from "../abas-recebiveis";
import { CaixaOcultar } from "../caixa-ocultar";

export const metadata: Metadata = { title: "Painel — Recebíveis" };

const MODULO = "financeiro.recebiveis";
const ROTA = "/financeiro/recebiveis/painel";
const DIAS_OCULTAR = 90;
const DIAS_RECEBIDO = 30;
const ALTURA_BARRA = 190;
const COR_FAIXA: Record<Faixa, string> = {
  a_vencer: "bg-emerald-500",
  "01_15": "bg-amber-400",
  "16_30": "bg-orange-500",
  "31_60": "bg-red-500",
  "60_mais": "bg-red-800",
};
const COR_NEO = "bg-[#24548a]";
const COR_AKF = "bg-[#f2b26b]";

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Painel dos Recebíveis (Fase 5): indicadores, aging com o cedido à AKF, previsão de recebimento das próximas 8 semanas
 * (caixa da Neo × AKF) e os 10 maiores devedores. Mesmos filtros da Carteira (unidade, cliente e "ocultar vencidos há mais de
 * 90 dias", que é a mesma preferência salva). Só leitura.
 */
export default async function PaginaPainel({ searchParams }: PageProps<"/financeiro/recebiveis/painel">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO)) notFound();

  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = sessao.acesso.restrito ? "contagem" : unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;
  const hoje = hojeEmCuiaba();
  const desde = new Date(Date.parse(`${hoje}T00:00:00Z`) - DIAS_RECEBIDO * 86_400_000).toISOString().slice(0, 10);

  const supabase = await criarClienteServidor();
  const lerAbertos = async () => {
    const linhas: LinhaPainel[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase
        .from("rec_vw_titulos")
        .select("faixa, valor, valor_atualizado, contraparte_id, cedido, unidade, dias_atraso, vencimento")
        .neq("faixa", "encerrado")
        .order("id")
        .range(de, de + 999);
      if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
      linhas.push(...((data ?? []) as LinhaPainel[]));
      if (!data || data.length < 1000) break;
    }
    return linhas;
  };
  const lerPagos = async () => {
    const { data, error } = await supabase
      .from("rec_vw_titulos")
      .select("consistem_pago_em, consistem_valor_pago, valor, unidade, contraparte_id")
      .gte("consistem_pago_em", desde)
      .limit(1000);
    if (error) throw new Error(`Falha ao ler os recebimentos: ${error.message}`);
    return (data ?? []) as (LinhaPaga & { unidade: string; contraparte_id: string })[];
  };
  const buscarClientes = async () => {
    if (!busca) return null;
    const { data } = await supabase.from("contrapartes").select("id")
      .or(`nome.ilike.%${busca}%,codigo_erp.ilike.%${busca}%,documento.ilike.%${busca}%`).limit(200);
    return new Set((data ?? []).map((c) => c.id as string));
  };
  const [salvoOcultar, abertos, pagos, clientesDaBusca, { data: ultimas }] = await Promise.all([
    lerPreferenciaBooleana(supabase, PREFERENCIAS.recebiveisOcultarVencidos90),
    lerAbertos(),
    lerPagos(),
    buscarClientes(),
    supabase.from("importacoes").select("criado_em").eq("modulo", MODULO).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
  ]);

  // "Ocultar vencidos há mais de 90 dias": a mesma preferência da Carteira; ?ocultar90=1|0 vale só para esta visita.
  const pedidoOcultar = primeiro(parametros.ocultar90);
  const ocultar = pedidoOcultar === "1" ? true : pedidoOcultar === "0" ? false : salvoOcultar;
  const paramOcultar = ocultar !== salvoOcultar ? (ocultar ? "1" : "0") : null;

  const doCliente = <T extends { contraparte_id: string }>(l: T) => !clientesDaBusca || clientesDaBusca.has(l.contraparte_id);
  const visiveis = abertos.filter((l) => doCliente(l) && (!ocultar || (l.dias_atraso ?? 0) <= DIAS_OCULTAR));
  const ocultos = abertos.filter((l) => doCliente(l) && (l.dias_atraso ?? 0) > DIAS_OCULTAR && (!unidade || l.unidade === unidade));
  const daUnidade = (u: Unidade) => visiveis.filter((l) => l.unidade === u);
  const resumoUnidade = { matriz: resumirCarteira(daUnidade("matriz")), contagem: resumirCarteira(daUnidade("contagem")) };
  const painel = montarPainel(unidade ? daUnidade(unidade) : visiveis, hoje);
  const { resumo } = painel;
  const recebido = somarRecebido(pagos.filter((l) => doCliente(l) && (!unidade || l.unidade === unidade)), desde);

  const idsDevedores = painel.devedores.map((d) => d.contraparteId);
  const { data: nomesBrutos } = idsDevedores.length
    ? await supabase.from("contrapartes").select("id, nome").in("id", idsDevedores)
    : { data: [] as { id: string; nome: string }[] };
  const nomes = new Map((nomesBrutos ?? []).map((c) => [c.id as string, c.nome as string]));

  const ultima = ultimas?.[0] as { criado_em: string } | undefined;
  const quando = ultima
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ultima.criado_em))
    : null;

  const qs = (extra: Record<string, string | null>, rota = ROTA) => {
    const p = new URLSearchParams();
    const valores = { q: busca || null, unidade, ocultar90: paramOcultar, ...extra };
    for (const [k, v] of Object.entries(valores)) if (v) p.set(k, v);
    const texto = p.toString();
    return `${rota}${texto ? `?${texto}` : ""}`;
  };
  const hrefCarteira = (faixa: Faixa) => qs({ faixa }, "/financeiro/recebiveis");
  const totalCedido = Object.values(painel.cedidoPorFaixa).reduce((s, c) => s + c, 0);
  const somaPrevisao = painel.previsao.reduce((s, x) => ({ quantidade: s.quantidade + x.quantidade, neo: s.neo + x.neoCentavos, akf: s.akf + x.akfCentavos }), { quantidade: 0, neo: 0, akf: 0 });
  const maiorSemana = Math.max(1, ...painel.previsao.map((s) => s.neoCentavos + s.akfCentavos));
  const somaDevedores = painel.devedores.reduce((s, d) => s + d.centavos, 0);
  const altura = (c: number) => (c > 0 ? Math.max(2, Math.round((c / maiorSemana) * ALTURA_BARRA)) : 0);
  const parteDoVencido = (c: number) => (painel.vencidoCentavos > 0 ? c / painel.vencidoCentavos : null);
  const milhoes = (c: number) => `R$ ${formatarCurto(c)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recebíveis</h1>
        <p className="text-sm text-muted-foreground">
          Situação da carteira em {formatarData(hoje)}, a partir do Consistem.{quando ? ` Última sincronização: ${quando}.` : ""}
        </p>
      </div>

      <RecebiveisAbas ativa="painel" restrito={!!sessao.acesso.restrito} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {!sessao.acesso.restrito && (
          <nav aria-label="Unidade" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade sm:w-fit">
            {([
              { u: null, rotulo: "Todas as unidades", quantidade: resumoUnidade.matriz.quantidade + resumoUnidade.contagem.quantidade },
              { u: "matriz", rotulo: ROTULO_UNIDADE.matriz, quantidade: resumoUnidade.matriz.quantidade },
              { u: "contagem", rotulo: ROTULO_UNIDADE.contagem, quantidade: resumoUnidade.contagem.quantidade },
            ] as { u: Unidade | null; rotulo: string; quantidade: number }[]).map((o) => {
              const ativa = o.u === unidade;
              return (
                <Link key={o.u ?? "todas"} href={qs({ unidade: o.u })} aria-current={ativa ? "page" : undefined}
                  className={`min-w-40 px-4 py-2 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
                  <span className={`flex items-center justify-between gap-3 text-[13px] ${ativa ? "font-bold" : ""}`}>
                    {o.rotulo}
                    <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade">{o.quantidade}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        )}
        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          {unidade && !sessao.acesso.restrito && <input type="hidden" name="unidade" value={unidade} />}
          {paramOcultar && <input type="hidden" name="ocultar90" value={paramOcultar} />}
          <Input name="q" defaultValue={busca} placeholder="Cliente: nome, código ou CNPJ" aria-label="Buscar cliente" className="w-64" />
          <Button type="submit" variant="secondary">Filtrar</Button>
          {busca && <Button variant="ghost" render={<Link href={qs({ q: null })} />}>Limpar</Button>}
        </form>
        <CaixaOcultar
          ligado={ocultar}
          destino={qs({ ocultar90: null })}
          rotulo={`Ocultar vencidos há mais de ${DIAS_OCULTAR} dias`}
          detalhe={ocultar && ocultos.length > 0
            ? `(${ocultos.length} ${ocultos.length === 1 ? "título oculto" : "títulos ocultos"} · ${formatarMoeda(ocultos.reduce((x, l) => x + emCentavos(l.valor), 0))})`
            : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card size="sm">
          <CardHeader><CardDescription>Carteira em aberto{unidade ? ` — ${ROTULO_UNIDADE[unidade]}` : ""}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.totalCentavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {resumo.quantidade} títulos{!unidade && ` · Matriz ${milhoes(resumoUnidade.matriz.totalCentavos)} · Filial ${milhoes(resumoUnidade.contagem.totalCentavos)}`}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>A vencer</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.aVencer.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.aVencer.quantidade} títulos · {milhoes(painel.cedidoPorFaixa.a_vencer)} cedidos à AKF</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencido</CardDescription><CardTitle className="text-xl tabular-nums text-red-700">{formatarMoeda(resumo.vencido.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.vencido.quantidade} títulos · {milhoes(painel.mais60Centavos)} há mais de 60 dias</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Inadimplência</CardDescription><CardTitle className="text-xl tabular-nums">{formatarPercentual(painel.inadimplencia)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            vencido ÷ carteira{!unidade && ` · Matriz ${formatarPercentual(inadimplencia(resumoUnidade.matriz))} · Filial ${formatarPercentual(inadimplencia(resumoUnidade.contagem))}`}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Recebido em {DIAS_RECEBIDO} dias</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(recebido.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{recebido.quantidade} {recebido.quantidade === 1 ? "título baixado" : "títulos baixados"} no Consistem</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Aging da carteira</CardTitle>
            <CardDescription>Clique numa faixa para ver os títulos na Carteira.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex h-5 gap-0.5 overflow-hidden rounded-[3px]" role="img" aria-label="Distribuição da carteira por faixa de atraso">
              {resumo.porFaixa.filter((f) => f.centavos > 0).map((f) => (
                <span key={f.faixa} className={COR_FAIXA[f.faixa]} style={{ flex: `${Math.max(f.centavos / Math.max(resumo.totalCentavos, 1), 0.006)} 1 0` }} />
              ))}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Faixa</TableHead>
                    <TableHead className="text-right">Títulos</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Cedido à AKF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumo.porFaixa.map((f) => (
                    <TableRow key={f.faixa}>
                      <TableCell>
                        <Link href={hrefCarteira(f.faixa)} className="inline-flex items-center gap-2 hover:underline">
                          <span className={`size-2.5 rounded-[2px] ${COR_FAIXA[f.faixa]}`} aria-hidden />
                          {ROTULO_FAIXA[f.faixa]}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.quantidade}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(f.centavos)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatarPercentual(resumo.totalCentavos > 0 ? f.centavos / resumo.totalCentavos : null)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{painel.cedidoPorFaixa[f.faixa] > 0 ? formatarMoeda(painel.cedidoPorFaixa[f.faixa]) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="flex flex-wrap justify-between gap-2 border-t pt-2 text-[13px] font-bold tabular-nums">
              <span>Total · {resumo.quantidade} títulos</span>
              <span>{formatarMoeda(resumo.totalCentavos)} · cedido {formatarMoeda(totalCedido)}</span>
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Previsão de recebimento — próximas 8 semanas</CardTitle>
            <CardDescription>Pelo vencimento dos títulos a vencer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <span className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-[2px] ${COR_NEO}`} aria-hidden />Entra no caixa da Neo · {formatarMoeda(somaPrevisao.neo)}</span>
              <span className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-[2px] ${COR_AKF}`} aria-hidden />Cedido à AKF · {formatarMoeda(somaPrevisao.akf)}</span>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-8 gap-2.5" role="img" aria-label="Previsão semanal de recebimento, caixa da Neo e AKF">
                {painel.previsao.map((s) => (
                  <div key={s.inicio} className="flex flex-col gap-1">
                    <div className="flex flex-col justify-end gap-1" style={{ height: ALTURA_BARRA + 20 }}>
                      <span className="text-center text-[11px] tabular-nums text-muted-foreground">{s.quantidade > 0 ? formatarCurto(s.neoCentavos + s.akfCentavos) : "—"}</span>
                      <div className="flex flex-col overflow-hidden rounded-t-[2px]">
                        <span className={COR_AKF} style={{ height: altura(s.akfCentavos) }} title={`AKF ${formatarMoeda(s.akfCentavos)}`} />
                        <span className={COR_NEO} style={{ height: altura(s.neoCentavos) }} title={`Neo ${formatarMoeda(s.neoCentavos)}`} />
                      </div>
                    </div>
                    <div className="border-t border-grade pt-1 text-center text-[11px] leading-tight">
                      {ddmm(s.inicio < hoje ? hoje : s.inicio)}–{ddmm(s.fim)}
                      <span className="block text-muted-foreground">{s.quantidade} {s.quantidade === 1 ? "título" : "títulos"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Total previsto: <strong className="text-foreground">{formatarMoeda(somaPrevisao.neo + somaPrevisao.akf)}</strong> em {somaPrevisao.quantidade} títulos.
              Título cedido de cliente que não paga à AKF entra no caixa da Neo e é repassado no dia seguinte.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{painel.devedores.length < 10 ? "Maiores devedores" : "10 maiores devedores"}</CardTitle>
          <CardDescription>
            {painel.devedores.length === 0
              ? "Nenhum título vencido com estes filtros."
              : `Somam ${formatarMoeda(somaDevedores)} — ${formatarPercentual(parteDoVencido(somaDevedores))} do vencido.`}
          </CardDescription>
        </CardHeader>
        {painel.devedores.length > 0 && (
          <CardContent>
            <div className="overflow-x-auto rounded-[3px] border border-grade">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Posição</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Títulos vencidos</TableHead>
                    <TableHead className="text-right">Maior atraso</TableHead>
                    <TableHead className="text-right">Valor vencido</TableHead>
                    <TableHead className="w-56">Parte do vencido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {painel.devedores.map((d, i) => (
                    <TableRow key={d.contraparteId}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <Link href={`/financeiro/recebiveis/clientes/${d.contraparteId}`} className="font-medium hover:underline">{nomes.get(d.contraparteId) ?? "Cliente"}</Link>
                        {d.cedido && <Badge variant="outline" className="ml-2">AKF</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.quantidade}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.maiorAtraso} dias</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(d.centavos)}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-[2px] bg-muted" aria-hidden>
                            <span className={`block h-2 ${d.maiorAtraso > 60 ? "bg-red-800" : "bg-orange-500"}`} style={{ width: `${(d.centavos / painel.devedores[0].centavos) * 100}%` }} />
                          </span>
                          <span className="w-12 text-right tabular-nums text-muted-foreground">{formatarPercentual(parteDoVencido(d.centavos))}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
