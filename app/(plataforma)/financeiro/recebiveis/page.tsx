import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  descreverAtraso, ehFaixa, FAIXAS_ABERTAS, formatarMoeda, formatarValor, resumirCarteira, ROTULO_ESTAGIO, ROTULO_FAIXA,
  type Faixa, type LinhaResumo,
} from "@/lib/modulos/financeiro/recebiveis/carteira";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { FUSO, formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotoesSincronizacao } from "./sincronizar";

export const metadata: Metadata = { title: "Recebíveis" };

const MODULO = "financeiro.recebiveis";
const POR_PAGINA = 50;
const COR_FAIXA: Record<Faixa, string> = {
  a_vencer: "bg-emerald-500",
  "01_15": "bg-amber-400",
  "16_30": "bg-orange-500",
  "31_60": "bg-red-500",
  "60_mais": "bg-red-800",
};

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type LinhaTitulo = {
  id: string; contraparte_id: string; documento: string; parcela: string; emissao: string | null; vencimento: string;
  valor: number | string; valor_atualizado: number | string; estagio: string; dias_atraso: number; faixa: string; cedido: boolean; contestado: boolean;
  nota_fiscal: string | null; nota_saida_id: string | null;
};

export default async function PaginaRecebiveis({ searchParams }: PageProps<"/financeiro/recebiveis">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");

  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const faixaPedida = primeiro(parametros.faixa);
  const faixa = ehFaixa(faixaPedida) ? faixaPedida : null;
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);
  const aguardandoBoleto = primeiro(parametros.situacao) === "aguardando_boleto";

  const supabase = await criarClienteServidor();

  // 1) Resumo de TODA a carteira em aberto (independe do filtro da lista). PostgREST devolve até 1000 por vez.
  const resumoLinhas: LinhaResumo[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from("rec_vw_titulos")
      .select("faixa, valor, valor_atualizado, contraparte_id")
      .neq("faixa", "encerrado")
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
    resumoLinhas.push(...((data ?? []) as LinhaResumo[]));
    if (!data || data.length < 1000) break;
  }
  const resumo = resumirCarteira(resumoLinhas);
  const { count: qtdBaixasAConferir } = await supabase.from("pendencias").select("id", { count: "exact", head: true })
    .eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").like("titulo", "Possível baixa:%").in("status", ["aberta", "em_andamento"]);
  const { count: qtdAguardandoBoleto } = await supabase.from("rec_vw_titulos").select("id", { count: "exact", head: true }).eq("estagio", "aguardando_boleto");
  const vencidoAtualizado = resumo.atualizadoCentavos - resumo.aVencer.centavos; // a vencer não tem encargos

  // 2) Lista filtrada e paginada.
  let idsClientes: string[] = [];
  if (busca) {
    const { data } = await supabase.from("contrapartes").select("id")
      .or(`nome.ilike.%${busca}%,codigo_erp.ilike.%${busca}%,documento.ilike.%${busca}%`).limit(200);
    idsClientes = (data ?? []).map((c) => c.id as string);
  }
  let consulta = supabase
    .from("rec_vw_titulos")
    .select("id, contraparte_id, documento, parcela, emissao, vencimento, valor, valor_atualizado, estagio, dias_atraso, faixa, cedido, contestado, nota_fiscal, nota_saida_id", { count: "exact" })
    .neq("faixa", "encerrado")
    .order("vencimento")
    .order("documento")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (faixa) consulta = consulta.eq("faixa", faixa);
  if (aguardandoBoleto) consulta = consulta.eq("estagio", "aguardando_boleto");
  if (busca) {
    consulta = idsClientes.length > 0
      ? consulta.or(`documento.ilike.%${busca}%,contraparte_id.in.(${idsClientes.join(",")})`)
      : consulta.ilike("documento", `%${busca}%`);
  }
  const { data: titulosBrutos, count, error: erroLista } = await consulta;
  if (erroLista) throw new Error(`Falha ao ler os títulos: ${erroLista.message}`);
  const titulos = (titulosBrutos ?? []) as LinhaTitulo[];
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const idsDaPagina = [...new Set(titulos.map((t) => t.contraparte_id))];
  const nomes = new Map<string, string>();
  if (idsDaPagina.length > 0) {
    const { data } = await supabase.from("contrapartes").select("id, nome").in("id", idsDaPagina);
    for (const c of data ?? []) nomes.set(c.id as string, c.nome as string);
  }

  // NF e pedidos dos títulos desta página.
  const idsNotas = [...new Set(titulos.map((t) => t.nota_saida_id).filter((x): x is string => x !== null))];
  const pedidosDaNota = new Map<string, string[]>();
  if (idsNotas.length > 0) {
    const { data } = await supabase.from("rec_notas_saida").select("id, pedidos").in("id", idsNotas);
    for (const n of data ?? []) pedidosDaNota.set(n.id as string, (n.pedidos as string[]) ?? []);
  }

  // 3) Última sincronização com o Consistem.
  const { data: ultimas } = await supabase.from("importacoes")
    .select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
    .eq("modulo", MODULO).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1);
  const ultima = ultimas?.[0] as { criado_em: string; linhas_novas: number | null; linhas_alteradas: number | null; linhas_baixadas: number | null } | undefined;
  const quando = ultima
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ultima.criado_em))
    : null;

  const link = (p: number) => {
    const qs = new URLSearchParams();
    if (busca) qs.set("q", busca);
    if (faixa) qs.set("faixa", faixa);
    if (aguardandoBoleto) qs.set("situacao", "aguardando_boleto");
    if (p > 1) qs.set("pagina", String(p));
    const texto = qs.toString();
    return `/financeiro/recebiveis${texto ? `?${texto}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recebíveis</h1>
          <p className="text-sm text-muted-foreground">
            Carteira de contas a receber em aberto, vinda do Consistem.{" "}
            {quando ? `Última sincronização: ${quando}.` : "Ainda não foi sincronizada."}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" render={<Link href="/financeiro/recebiveis/baixas" />}>
            Baixas a conferir{qtdBaixasAConferir ? ` (${qtdBaixasAConferir})` : ""}
          </Button>
          {ehGestor && <BotoesSincronizacao />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Carteira em aberto</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.totalCentavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.quantidade} títulos · {resumo.clientes} clientes</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>A vencer</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.aVencer.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{resumo.aVencer.quantidade} títulos</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencido</CardDescription><CardTitle className="text-xl tabular-nums text-red-700">{formatarMoeda(resumo.vencido.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {resumo.vencido.quantidade} títulos · {resumo.totalCentavos > 0 ? Math.round((resumo.vencido.centavos / resumo.totalCentavos) * 100) : 0}% da carteira
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencido atualizado*</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(vencidoAtualizado)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">com multa e juros até hoje</CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader><CardTitle>Atraso (aging)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {resumo.porFaixa.map((f) => (
            <Link key={f.faixa} href={`/financeiro/recebiveis?faixa=${f.faixa}`} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted/50 sm:grid-cols-[9rem_1fr_16rem]">
              <span>{ROTULO_FAIXA[f.faixa]}</span>
              <span className="h-2.5 rounded-full bg-muted" aria-hidden>
                <span className={`block h-2.5 rounded-full ${COR_FAIXA[f.faixa]}`} style={{ width: `${f.percentual}%` }} />
              </span>
              <span className="text-right tabular-nums">
                {formatarMoeda(f.centavos)} <span className="text-xs text-muted-foreground">· {f.quantidade} · {f.percentual}%</span>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          <Input name="q" defaultValue={busca} placeholder="Cliente, código ou documento" aria-label="Buscar" className="w-64" />
          <select name="faixa" defaultValue={faixa ?? ""} aria-label="Faixa de atraso" className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">Todas as faixas</option>
            {FAIXAS_ABERTAS.map((f) => <option key={f} value={f}>{ROTULO_FAIXA[f]}</option>)}
          </select>
          <select name="situacao" defaultValue={aguardandoBoleto ? "aguardando_boleto" : ""} aria-label="Situação" className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">Todas as situações</option>
            <option value="aguardando_boleto">Aguardando boleto ({qtdAguardandoBoleto ?? 0})</option>
          </select>
          <Button type="submit" variant="secondary">Filtrar</Button>
          {(busca || faixa || aguardandoBoleto) && <Button variant="ghost" render={<Link href="/financeiro/recebiveis" />}>Limpar</Button>}
        </form>

        {titulos.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {total === 0 && !busca && !faixa && !aguardandoBoleto ? "Nenhum título em aberto. Use “Sincronizar agora” para trazer a carteira do Consistem." : "Nenhum título encontrado com esse filtro."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Pedido / NF</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Atraso</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Valor atualizado*</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {titulos.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link href={`/financeiro/recebiveis/${t.id}`} className="hover:underline">{t.documento}{t.parcela !== "1" ? `/${t.parcela}` : ""}</Link>
                    </TableCell>
                    <TableCell className="text-xs leading-tight text-muted-foreground">
                      {t.nota_fiscal ? <span className="block">NF {t.nota_fiscal}</span> : <span className="block">—</span>}
                      {(t.nota_saida_id && pedidosDaNota.get(t.nota_saida_id)?.length) ? <span className="block">Pedido {pedidosDaNota.get(t.nota_saida_id)!.join(", ")}</span> : null}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={nomes.get(t.contraparte_id)}>{nomes.get(t.contraparte_id) ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(t.emissao) || "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                    <TableCell className={t.dias_atraso > 0 ? "font-medium text-red-700" : "text-muted-foreground"}>{descreverAtraso(t.dias_atraso)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarValor(t.valor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.dias_atraso > 0 ? formatarValor(t.valor_atualizado) : "—"}</TableCell>
                    <TableCell className="space-x-1">
                      <Badge variant="secondary">{ROTULO_ESTAGIO[t.estagio] ?? t.estagio}</Badge>
                      {t.cedido && <Badge variant="outline">Cedido</Badge>}
                      {t.contestado && <Badge variant="outline">Contestado</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{total} {total === 1 ? "título" : "títulos"}{(busca || faixa || aguardandoBoleto) ? " no filtro" : ""}</span>
          {totalPaginas > 1 && (
            <span className="flex items-center gap-2">
              {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={link(pagina - 1)} />}>Anterior</Button>}
              Página {pagina} de {totalPaginas}
              {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={link(pagina + 1)} />}>Próxima</Button>}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          * Valor atualizado = valor + multa de 2% + juros de 2% ao mês, pro rata dia, dos títulos vencidos. É o padrão do módulo; o percentual
          definitivo de cada cliente será o do contrato (ainda não cadastrado).
        </p>
      </section>
    </div>
  );
}
