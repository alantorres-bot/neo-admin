import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { descreverAtraso, emCentavos, formatarMoeda, formatarValor } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import {
  abertoNaAkf, clienteSemBoleto, disponivelParaAntecipar, ESTAGIOS_ANTECIPAVEIS, PORTADOR_AKF, vencidoNaAkf, type DadosAkf,
} from "@/supabase/functions/_shared/akf";
import { ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { TabelaAkf, type LinhaAkf } from "./componentes";

export const metadata: Metadata = { title: "AKF" };

const MODULO = "financeiro.akf";
const POR_PAGINA = 50;
const VISOES = ["na_akf", "vencidos", "disponiveis"] as const;
type Visao = (typeof VISOES)[number];
const ROTULO_VISAO: Record<Visao, string> = { na_akf: "Na AKF", vencidos: "Vencidos na AKF", disponiveis: "Disponíveis para antecipar" };
const EXPLICACAO: Record<Visao, string> = {
  na_akf: "Títulos cedidos à AKF e ainda em aberto: portador 998 no Consistem ou marcados à mão. Ficam fora da régua de cobrança de Recebíveis.",
  vencidos: "Títulos na AKF que já passaram do vencimento: o foco da cobrança junto à AKF.",
  disponiveis: "Títulos a vencer, ainda com a Neo, em estágio normal: podem entrar numa antecipação. Clientes \"sem boleto de factoring\" são operados 1 dia após o vencimento, sem boleto.",
};

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type LinhaResumo = { faixa: string; valor: number | string; contraparte_id: string; estagio: string; cedido: boolean; contestado: boolean; cod_portador: string | null; unidade: string };
type LinhaTitulo = {
  id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string; dias_atraso: number;
  faixa: string; cedido: boolean; cod_portador: string | null; unidade: string;
};

const dados = (l: { estagio: string; faixa: string; cedido: boolean; contestado?: boolean; cod_portador: string | null }): DadosAkf => ({
  estagio: l.estagio, faixa: l.faixa, cedido: l.cedido, contestado: l.contestado, codPortador: l.cod_portador,
});

export default async function PaginaAkf({ searchParams }: PageProps<"/financeiro/akf">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const parametros = await searchParams;
  const visaoPedida = primeiro(parametros.visao);
  const visao: Visao = (VISOES as readonly string[]).includes(visaoPedida) ? (visaoPedida as Visao) : "na_akf";
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const supabase = await criarClienteServidor();

  // 1) Resumo de TODA a carteira em aberto (independe da busca e da página). PostgREST devolve até 1000 por vez.
  const resumoLinhas: LinhaResumo[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from("rec_vw_titulos")
      .select("faixa, valor, contraparte_id, estagio, cedido, contestado, cod_portador, unidade")
      .neq("faixa", "encerrado")
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
    resumoLinhas.push(...((data ?? []) as LinhaResumo[]));
    if (!data || data.length < 1000) break;
  }
  const dasUnidades = { matriz: 0, contagem: 0 };
  for (const l of resumoLinhas) if (abertoNaAkf(dados(l)) || disponivelParaAntecipar(dados(l))) dasUnidades[l.unidade === "contagem" ? "contagem" : "matriz"]++;
  const doRecorte = unidade ? resumoLinhas.filter((l) => l.unidade === unidade) : resumoLinhas;
  const soma = (filtro: (l: LinhaResumo) => boolean) => {
    const sel = doRecorte.filter(filtro);
    return { quantidade: sel.length, centavos: sel.reduce((x, l) => x + emCentavos(l.valor), 0) };
  };
  const totais: Record<Visao, { quantidade: number; centavos: number }> = {
    na_akf: soma((l) => abertoNaAkf(dados(l))),
    vencidos: soma((l) => vencidoNaAkf(dados(l))),
    disponiveis: soma((l) => disponivelParaAntecipar(dados(l))),
  };

  const { data: cfgSemBoleto } = await supabase.from("configuracoes").select("valor").eq("chave", "financeiro.akf.clientes_sem_boleto").maybeSingle();
  const termosSemBoleto = Array.isArray(cfgSemBoleto?.valor) ? (cfgSemBoleto.valor as unknown[]).filter((x): x is string => typeof x === "string") : [];

  // 2) Lista da visão escolhida (as regras de `akf.ts` escritas como filtro), paginada.
  let idsClientes: string[] = [];
  if (busca) {
    const { data } = await supabase.from("contrapartes").select("id")
      .or(`nome.ilike.%${busca}%,codigo_erp.ilike.%${busca}%,documento.ilike.%${busca}%`).limit(200);
    idsClientes = (data ?? []).map((c) => c.id as string);
  }
  let consulta = supabase
    .from("rec_vw_titulos")
    .select("id, contraparte_id, documento, parcela, vencimento, valor, dias_atraso, faixa, cedido, cod_portador, unidade", { count: "exact" })
    .neq("faixa", "encerrado")
    .order("vencimento")
    .order("documento")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (visao === "disponiveis") {
    consulta = consulta.eq("faixa", "a_vencer").eq("cedido", false).eq("contestado", false).in("estagio", [...ESTAGIOS_ANTECIPAVEIS])
      .or(`cod_portador.is.null,cod_portador.neq.${PORTADOR_AKF}`);
  } else {
    consulta = consulta.or(`cedido.eq.true,cod_portador.eq.${PORTADOR_AKF}`);
    if (visao === "vencidos") consulta = consulta.neq("faixa", "a_vencer");
  }
  if (unidade) consulta = consulta.eq("unidade", unidade);
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

  const linhas: LinhaAkf[] = titulos.map((t) => {
    const cliente = nomes.get(t.contraparte_id) ?? "—";
    return {
      id: t.id,
      documento: `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`,
      cliente,
      unidade: t.unidade === "contagem" ? "contagem" : "matriz",
      vencimento: formatarData(t.vencimento),
      atraso: descreverAtraso(t.dias_atraso),
      vencido: t.dias_atraso > 0,
      valor: formatarValor(t.valor),
      portador: t.cod_portador ?? "—",
      naAkf: t.cedido || t.cod_portador === PORTADOR_AKF,
      semBoleto: visao === "disponiveis" && clienteSemBoleto(cliente, termosSemBoleto),
    };
  });

  const href = (extra: { visao?: Visao; unidade?: Unidade | null; pagina?: number }) => {
    const qs = new URLSearchParams();
    const v = extra.visao ?? visao;
    const u = extra.unidade === undefined ? unidade : extra.unidade;
    if (v !== "na_akf") qs.set("visao", v);
    if (u) qs.set("unidade", u);
    if (busca && extra.visao === undefined) qs.set("q", busca);
    if (extra.pagina && extra.pagina > 1) qs.set("pagina", String(extra.pagina));
    const texto = qs.toString();
    return `/financeiro/akf${texto ? `?${texto}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AKF</h1>
        <p className="text-sm text-muted-foreground">
          Títulos da Neo Formas cedidos à AKF Securitizadora (portador {PORTADOR_AKF} no Consistem) e títulos que ainda podem ser antecipados.
          A Carteira vem de Recebíveis: aqui só se separa o que está com a AKF.
        </p>
      </div>

      <nav aria-label="Unidade" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade sm:w-fit">
        {([
          { u: null as Unidade | null, rotulo: "Todas as unidades", quantidade: dasUnidades.matriz + dasUnidades.contagem },
          { u: "matriz" as Unidade | null, rotulo: ROTULO_UNIDADE.matriz, quantidade: dasUnidades.matriz },
          { u: "contagem" as Unidade | null, rotulo: ROTULO_UNIDADE.contagem, quantidade: dasUnidades.contagem },
        ]).map((o) => {
          const ativa = o.u === unidade;
          return (
            <Link key={o.u ?? "todas"} href={href({ unidade: o.u, pagina: 1 })} aria-current={ativa ? "page" : undefined} className={`min-w-44 px-4 py-2 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
              <span className={`flex items-center justify-between gap-3 text-[13px] ${ativa ? "font-bold" : ""}`}>
                {o.rotulo}
                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade" title="Títulos na AKF ou disponíveis para antecipar">{o.quantidade}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader><CardDescription>Na AKF{unidade ? ` — ${ROTULO_UNIDADE[unidade]}` : ""}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.na_akf.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.na_akf.quantidade} títulos em aberto</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencidos na AKF</CardDescription><CardTitle className="text-xl tabular-nums text-red-700">{formatarMoeda(totais.vencidos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.vencidos.quantidade} títulos · {totais.na_akf.centavos > 0 ? Math.round((totais.vencidos.centavos / totais.na_akf.centavos) * 100) : 0}% do que está na AKF</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Disponíveis para antecipar</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.disponiveis.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.disponiveis.quantidade} títulos a vencer, ainda com a Neo</CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <nav aria-label="Visão" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
          {VISOES.map((v) => {
            const ativa = v === visao;
            return (
              <Link key={v} href={href({ visao: v, pagina: 1 })} aria-current={ativa ? "page" : undefined} className={`min-w-44 flex-1 px-3 py-1.5 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
                <span className={`flex items-center justify-between gap-2 text-[12px] ${ativa ? "font-bold" : ""}`}>
                  {ROTULO_VISAO[v]}
                  <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade">{totais[v].quantidade}</span>
                </span>
                <span className="block text-[11px] tabular-nums text-muted-foreground">{formatarMoeda(totais[v].centavos)}</span>
              </Link>
            );
          })}
        </nav>
        <p className="text-[12px] text-muted-foreground">{EXPLICACAO[visao]}</p>

        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          {visao !== "na_akf" && <input type="hidden" name="visao" value={visao} />}
          {unidade && <input type="hidden" name="unidade" value={unidade} />}
          <Input name="q" defaultValue={busca} placeholder="Cliente, código ou documento" aria-label="Buscar" className="w-64" />
          <Button type="submit" variant="secondary">Filtrar</Button>
          {busca && <Button variant="ghost" render={<Link href={href({ pagina: 1 }).replace(/[?&]q=[^&]*/, "")} />}>Limpar</Button>}
        </form>

        {linhas.length === 0 ? (
          <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
            {busca ? "Nenhum título encontrado com essa busca." : visao === "disponiveis" ? "Nenhum título disponível para antecipar." : "Nenhum título da AKF em aberto nesta visão."}
          </p>
        ) : (
          <TabelaAkf key={`${visao}-${unidade}-${pagina}-${busca}-${linhas.map((l) => l.id).join(",")}`} linhas={linhas} podeOperar={podeOperar} acao={visao === "disponiveis" ? "marcar" : "retirar"} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{total} {total === 1 ? "título" : "títulos"}{busca ? " na busca" : ""}</span>
          {totalPaginas > 1 && (
            <span className="flex items-center gap-2">
              {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina - 1 })} />}>Anterior</Button>}
              Página {pagina} de {totalPaginas}
              {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina + 1 })} />}>Próxima</Button>}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
