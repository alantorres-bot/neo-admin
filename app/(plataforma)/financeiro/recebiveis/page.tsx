import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  descreverAtraso, ehFaixa, emCentavos, FAIXAS_ABERTAS, formatarMoeda, formatarValor, resumirCarteira, ROTULO_FAIXA,
  type Faixa, type LinhaResumo,
} from "@/lib/modulos/financeiro/recebiveis/carteira";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { FUSO, formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { titulaNoEscopoDeCadastro } from "@/lib/modulos/financeiro/recebiveis/clientes";
import { temContatoUtil, type ContatoEscolha } from "@/supabase/functions/_shared/contatos";
import { PREFERENCIAS, lerPreferenciaBooleana } from "@/lib/nucleo/preferencias";
import { RecebiveisAbas } from "./abas-recebiveis";
import { CaixaOcultar } from "./caixa-ocultar";
import { BotoesSincronizacao } from "./sincronizar";

export const metadata: Metadata = { title: "Recebíveis" };

const MODULO = "financeiro.recebiveis";
const POR_PAGINA = 50;
const DIAS_OCULTAR = 90;
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
  valor: number | string; valor_atualizado: number | string; estagio: string; dias_atraso: number; faixa: string; cedido: boolean; contestado: boolean; regua_pausada_ate: string | null;
  nota_fiscal: string | null; nota_saida_id: string | null; unidade: string; forma_pagamento: string;
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
  // Unidade: Matriz ou Filial Contagem (documento que começa com 400). Sem escolha, mostra as duas.
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;

  const supabase = await criarClienteServidor();

  // Cada ida ao banco custa a latência da rede (~200 ms com o banco no Canadá): o que não depende de outra leitura sai junto.
  // Onda 1: preferência do usuário, resumo de TODA a carteira em aberto (PostgREST devolve até 1000 por vez), clientes da busca
  // e última sincronização.
  const lerResumo = async () => {
    const linhas: LinhaResumo[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase
        .from("rec_vw_titulos")
        .select("faixa, valor, valor_atualizado, contraparte_id, estagio, cedido, contestado, unidade, dias_atraso")
        .neq("faixa", "encerrado")
        .order("id")
        .range(de, de + 999);
      if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
      linhas.push(...((data ?? []) as LinhaResumo[]));
      if (!data || data.length < 1000) break;
    }
    return linhas;
  };
  const buscarClientes = async () => {
    if (!busca) return [] as string[];
    const { data } = await supabase.from("contrapartes").select("id")
      .or(`nome.ilike.%${busca}%,codigo_erp.ilike.%${busca}%,documento.ilike.%${busca}%`).limit(200);
    return (data ?? []).map((c) => c.id as string);
  };
  const [salvoOcultar, todasLinhas, idsClientes, { data: ultimas }] = await Promise.all([
    lerPreferenciaBooleana(supabase, PREFERENCIAS.recebiveisOcultarVencidos90),
    lerResumo(),
    buscarClientes(),
    supabase.from("importacoes")
      .select("criado_em, linhas_novas, linhas_alteradas, linhas_baixadas")
      .eq("modulo", MODULO).eq("arquivo", "api:consistem").order("criado_em", { ascending: false }).limit(1),
  ]);

  // "Ocultar vencidos há mais de 90 dias": vale para a tela toda (cartões, aging, abas e lista), para os números baterem.
  // Sem nada no endereço, vale a preferência salva da pessoa; ?ocultar90=1 ou =0 vale só para aquela visita e é repassado
  // pelos links enquanto for diferente do que está salvo.
  const pedidoOcultar = primeiro(parametros.ocultar90);
  const ocultar = pedidoOcultar === "1" ? true : pedidoOcultar === "0" ? false : salvoOcultar;
  const paramOcultar = ocultar !== salvoOcultar ? (ocultar ? "1" : "0") : null;

  const resumoLinhas = ocultar ? todasLinhas.filter((l) => (l.dias_atraso ?? 0) <= DIAS_OCULTAR) : todasLinhas;
  const ocultos = todasLinhas.filter((l) => (l.dias_atraso ?? 0) > DIAS_OCULTAR && (!unidade || l.unidade === unidade));
  // Totais por unidade (para o seletor) e a carteira da unidade escolhida (para o resto da tela).
  const porUnidade = (u: Unidade) => {
    const linhas = resumoLinhas.filter((l) => l.unidade === u);
    return { quantidade: linhas.length, centavos: linhas.reduce((x, l) => x + emCentavos(l.valor), 0) };
  };
  const totaisUnidade = { matriz: porUnidade("matriz"), contagem: porUnidade("contagem") };
  const linhasDaUnidade = unidade ? resumoLinhas.filter((l) => l.unidade === unidade) : resumoLinhas;
  const resumo = resumirCarteira(linhasDaUnidade);
  const vencidoAtualizado = resumo.atualizadoCentavos - resumo.aVencer.centavos; // a vencer não tem encargos

  // Onda 2: a lista filtrada e paginada.
  let consulta = supabase
    .from("rec_vw_titulos")
    .select("id, contraparte_id, documento, parcela, emissao, vencimento, valor, valor_atualizado, estagio, dias_atraso, faixa, cedido, contestado, regua_pausada_ate, nota_fiscal, nota_saida_id, unidade, forma_pagamento", { count: "exact" })
    .neq("faixa", "encerrado")
    .order("vencimento")
    .order("documento")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (faixa) consulta = consulta.eq("faixa", faixa);
  if (unidade) consulta = consulta.eq("unidade", unidade);
  if (ocultar) consulta = consulta.lte("dias_atraso", DIAS_OCULTAR);
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
  const idsNotas = [...new Set(titulos.map((t) => t.nota_saida_id).filter((x): x is string => x !== null))];

  // Onda 3: tudo o que depende só dos títulos desta página sai junto.
  const [nomes, contatosPorCliente, partes, pedidosDaNota] = await Promise.all([
    // nomes dos clientes
    (async () => {
      const m = new Map<string, string>();
      if (idsDaPagina.length > 0) {
        const { data } = await supabase.from("contrapartes").select("id, nome").in("id", idsDaPagina);
        for (const c of data ?? []) m.set(c.id as string, c.nome as string);
      }
      return m;
    })(),
    // Clientes sem nenhum meio de contato (e-mail, WhatsApp ou telefone): o selo "Sem contato" aparece nos títulos que estão no
    // escopo do cadastro combinado (Matriz, a vencer ou vencido há menos de 60 dias).
    (async () => {
      const m = new Map<string, ContatoEscolha[]>();
      if (idsDaPagina.length > 0) {
        const { data } = await supabase.from("contatos").select("id, contraparte_id, nome, email, whatsapp, telefone, finalidades, ativo").in("contraparte_id", idsDaPagina).eq("ativo", true);
        for (const c of data ?? []) m.set(c.contraparte_id as string, [...(m.get(c.contraparte_id as string) ?? []), c as unknown as ContatoEscolha]);
      }
      return m;
    })(),
    // Antecipação parcial na AKF (migration 0113): quanto do título já está na AKF e quanto resta com a Neo.
    lerPartes(supabase, titulos.map((t) => t.id)),
    // NF e pedidos dos títulos desta página.
    (async () => {
      const m = new Map<string, string[]>();
      if (idsNotas.length > 0) {
        const { data } = await supabase.from("rec_notas_saida").select("id, pedidos").in("id", idsNotas);
        for (const n of data ?? []) m.set(n.id as string, (n.pedidos as string[]) ?? []);
      }
      return m;
    })(),
  ]);
  const semContato = (t: LinhaTitulo) => titulaNoEscopoDeCadastro(t) && !temContatoUtil(contatosPorCliente.get(t.contraparte_id) ?? []);

  // Última sincronização com o Consistem (lida na onda 1).
  const ultima = ultimas?.[0] as { criado_em: string; linhas_novas: number | null; linhas_alteradas: number | null; linhas_baixadas: number | null } | undefined;
  const quando = ultima
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ultima.criado_em))
    : null;

  const link = (p: number) => {
    const qs = new URLSearchParams();
    if (busca) qs.set("q", busca);
    if (faixa) qs.set("faixa", faixa);
    if (unidade) qs.set("unidade", unidade);
    if (paramOcultar) qs.set("ocultar90", paramOcultar);
    if (p > 1) qs.set("pagina", String(p));
    const texto = qs.toString();
    return `/financeiro/recebiveis${texto ? `?${texto}` : ""}`;
  };

  const hrefUnidade = (u: Unidade | null) => {
    const qs = new URLSearchParams();
    if (u) qs.set("unidade", u);
    if (paramOcultar) qs.set("ocultar90", paramOcultar);
    const texto = qs.toString();
    return `/financeiro/recebiveis${texto ? `?${texto}` : ""}`;
  };
  // Liga e desliga o "ocultar vencidos há mais de 90 dias" mantendo os outros filtros.
  const hrefOcultar = (() => {
    const qs = new URLSearchParams();
    if (busca) qs.set("q", busca);
    if (faixa) qs.set("faixa", faixa);
    if (unidade) qs.set("unidade", unidade);
    const texto = qs.toString();
    return `/financeiro/recebiveis${texto ? `?${texto}` : ""}`;
  })();

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
          {ehGestor && <BotoesSincronizacao />}
        </div>
      </div>

      <RecebiveisAbas ativa="carteira" />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <nav aria-label="Unidade" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade sm:w-fit">
        {([
          { u: null as Unidade | null, rotulo: "Todas as unidades", ...{ quantidade: totaisUnidade.matriz.quantidade + totaisUnidade.contagem.quantidade, centavos: totaisUnidade.matriz.centavos + totaisUnidade.contagem.centavos } },
          { u: "matriz" as Unidade | null, rotulo: ROTULO_UNIDADE.matriz, ...totaisUnidade.matriz },
          { u: "contagem" as Unidade | null, rotulo: ROTULO_UNIDADE.contagem, ...totaisUnidade.contagem },
        ]).map((o) => {
          const ativa = o.u === unidade;
          return (
            <Link
              key={o.u ?? "todas"}
              href={hrefUnidade(o.u)}
              aria-current={ativa ? "page" : undefined}
              className={`min-w-44 px-4 py-2 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}
            >
              <span className={`flex items-center justify-between gap-3 text-[13px] ${ativa ? "font-bold" : ""}`}>
                {o.rotulo}
                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade">{o.quantidade}</span>
              </span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">{formatarMoeda(o.centavos)}</span>
            </Link>
          );
        })}
      </nav>
      <CaixaOcultar
        ligado={ocultar}
        destino={hrefOcultar}
        rotulo={`Ocultar vencidos há mais de ${DIAS_OCULTAR} dias`}
        detalhe={ocultar && ocultos.length > 0
          ? `(${ocultos.length} ${ocultos.length === 1 ? "título oculto" : "títulos ocultos"} · ${formatarMoeda(ocultos.reduce((x, l) => x + emCentavos(l.valor), 0))})`
          : undefined}
      />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Carteira em aberto{unidade ? ` — ${ROTULO_UNIDADE[unidade]}` : ""}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(resumo.totalCentavos)}</CardTitle></CardHeader>
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
            <Link key={f.faixa} href={`/financeiro/recebiveis?faixa=${f.faixa}${unidade ? `&unidade=${unidade}` : ""}${paramOcultar ? `&ocultar90=${paramOcultar}` : ""}`} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted/50 sm:grid-cols-[9rem_1fr_16rem]">
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
        <div>
          <h2 className="text-base font-bold">Títulos em aberto</h2>
          <p className="text-xs text-muted-foreground">As etapas do trabalho de cobrança (boleto, envio, confirmação, cobrança e baixas) ficam em Cobrança, no menu ao lado.</p>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          {unidade && <input type="hidden" name="unidade" value={unidade} />}
          {paramOcultar && <input type="hidden" name="ocultar90" value={paramOcultar} />}
          <Input name="q" defaultValue={busca} placeholder="Cliente, código ou documento" aria-label="Buscar" className="w-64" />
          <select name="faixa" defaultValue={faixa ?? ""} aria-label="Faixa de atraso" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
            <option value="">Todas as faixas</option>
            {FAIXAS_ABERTAS.map((f) => <option key={f} value={f}>{ROTULO_FAIXA[f]}</option>)}
          </select>
          <Button type="submit" variant="secondary">Filtrar</Button>
          {(busca || faixa) && <Button variant="ghost" render={<Link href={hrefUnidade(unidade)} />}>Limpar</Button>}
        </form>

        {titulos.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {total === 0 && !busca && !faixa ? "Nenhum título em aberto. Use “Sincronizar agora” para trazer a carteira do Consistem." : "Nenhum título encontrado com esse filtro."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[3px] border border-grade">
            <Table className="cartoes">
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {titulos.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link href={`/financeiro/recebiveis/${t.id}`} className="hover:underline">{t.documento}{t.parcela !== "1" ? `/${t.parcela}` : ""}</Link>
                      {t.unidade === "contagem" && !unidade && <Badge variant="outline" className="ml-1.5 align-middle">Contagem</Badge>}
                    </TableCell>
                    <TableCell className="text-xs leading-tight text-muted-foreground">
                      {t.nota_fiscal ? <span className="block">NF {t.nota_fiscal}</span> : <span className="block">—</span>}
                      {(t.nota_saida_id && pedidosDaNota.get(t.nota_saida_id)?.length) ? <span className="block">Pedido {pedidosDaNota.get(t.nota_saida_id)!.join(", ")}</span> : null}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={nomes.get(t.contraparte_id)}>
                      <Link href={`/financeiro/recebiveis/clientes/${t.contraparte_id}`} className="hover:underline">{nomes.get(t.contraparte_id) ?? "—"}</Link>
                      {semContato(t) && <Badge variant="outline" className="ml-1.5 border-marca align-middle text-marca" title="Cliente sem e-mail, WhatsApp nem telefone cadastrado">Sem contato</Badge>}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatarData(t.emissao) || "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                    <TableCell className={t.dias_atraso > 0 ? "font-medium text-red-700" : "text-muted-foreground"}>{descreverAtraso(t.dias_atraso)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarValor(t.valor)}
                      {partes.get(t.id) && (
                        <span className="block text-[11px] font-normal text-sky-800" title="Antecipação parcial na AKF">
                          {formatarMoeda(partes.get(t.id)!.akfCentavos)} na AKF · resta {formatarMoeda(partes.get(t.id)!.restanteCentavos)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.dias_atraso > 0 ? formatarValor(t.valor_atualizado) : "—"}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" render={<Link href={`/financeiro/recebiveis/${t.id}`} />}>Abrir</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{total} {total === 1 ? "título" : "títulos"}{(busca || faixa || unidade || ocultar) ? " no filtro" : ""}</span>
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
