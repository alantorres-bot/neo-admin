import Link from "next/link";
import { notFound } from "next/navigation";
import { DialogoContato } from "@/app/(plataforma)/configuracoes/contrapartes/dialogos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import {
  agruparPorNota, aplicarFiltros, contarFilas, explicacaoDaFila, ehFila, nomeParcela, paginar, ROTULO_FILA, totalDaFila,
  type ContatoSugerido, type Fila, type ItemBase, type ParcelaItem,
} from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { descreverPrazo } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { carregarRegra } from "@/lib/modulos/financeiro/recebiveis/regra";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { nomeDoMarco, ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { BotaoCopiar } from "@/app/(plataforma)/financeiro/recebiveis/[id]/componentes";
import { TabelaParcelas } from "./tabela-parcelas";
import { tarefasDaRequisicao } from "./dados";

export const MODULO_COBRANCA = "financeiro.cobranca";
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const resumoParcelas = (ps: readonly ParcelaItem[]) => {
  const nomes = ps.slice(0, 3).map(nomeParcela).join(", ");
  return ps.length > 3 ? `${nomes} e mais ${ps.length - 3}` : nomes;
};

type ParametrosBusca = Promise<Record<string, string | string[] | undefined>>;

/**
 * Tela de uma (ou duas) filas da Cobrança: `filas` são as filas desta aba (a aba "A enviar" junta boletos e dados de pagamento) e
 * `caminho` é a rota da aba, usada nos links de unidade, busca e página. O cabeçalho e a barra de abas vêm do layout.
 */
export async function PaginaFila({ filas, caminho, searchParams }: { filas: readonly Fila[]; caminho: string; searchParams: ParametrosBusca }) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COBRANCA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;
  const abaPedida = primeiro(parametros.aba);
  const paginaPedida = Number.parseInt(primeiro(parametros.pagina), 10) || 1;

  const [todas, { parametros: regra }] = await Promise.all([tarefasDaRequisicao(), carregarRegra(await criarClienteServidor())]);
  const tarefas = aplicarFiltros(todas, { unidade, busca });
  const contagens = contarFilas(tarefas);
  const aba: Fila = ehFila(abaPedida) && filas.includes(abaPedida) ? abaPedida : (filas.find((f) => contagens[f] > 0) ?? filas[0]);
  const hoje = tarefas.hoje;

  const href = (extra: { aba?: Fila; unidade?: Unidade | null; pagina?: number; q?: null }) => {
    const qs = new URLSearchParams();
    if (filas.length > 1) qs.set("aba", extra.aba ?? aba);
    const u = extra.unidade === undefined ? unidade : extra.unidade;
    if (u) qs.set("unidade", u);
    if (busca && extra.q !== null) qs.set("q", busca);
    if (extra.pagina && extra.pagina > 1) qs.set("pagina", String(extra.pagina));
    return qs.size > 0 ? `${caminho}?${qs.toString()}` : caminho;
  };
  // Total por unidade (com a busca, sem o filtro de unidade) para o seletor.
  const porUnidade = (u: Unidade | null) => { const c = contarFilas(aplicarFiltros(todas, { unidade: u, busca })); return filas.reduce((soma, f) => soma + c[f], 0); };

  const seloUnidade = (i: ItemBase) => (unidade === null ? <Badge variant={i.unidade === "contagem" ? "default" : "secondary"} className="ml-1.5 align-middle">{ROTULO_UNIDADE[i.unidade]}</Badge> : null);
  const nomeCliente = (i: ItemBase) => (
    <TableCell className="max-w-72 truncate font-medium" title={i.cliente}>
      <Link href={`/financeiro/recebiveis/clientes/${i.clienteId}`} className="hover:underline">{i.cliente}</Link>
      {seloUnidade(i)}
    </TableCell>
  );
  const textoContato = (c: ContatoSugerido, clienteId: string) => {
    if (!c) {
      return (
        <span className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="border-marca text-marca">Sem contato</Badge>
          {podeOperar && <DialogoContato contraparteId={clienteId} finalidadesIniciais={["confirmacao", "cobranca"]} rotuloBotao="Cadastrar" />}
        </span>
      );
    }
    const meio = c.whatsapp ? formatarWhatsapp(c.whatsapp) : c.email;
    return <span className="block leading-tight"><span className="block font-medium">{c.nome}</span><span className="block text-muted-foreground">{meio}</span></span>;
  };
  const andamento = (a: { texto: string; quando: string } | null) => (a ? <span className="text-[12px]">{a.texto} <span className="text-muted-foreground">em {a.quando}</span></span> : <span className="text-[12px] text-muted-foreground">Nada registrado</span>);
  const prazo = (iso: string) => <span className={iso < hoje ? "font-medium text-red-700" : ""}>{descreverPrazo(iso, hoje)}</span>;
  /** Atalhos de WhatsApp: abre a conversa com o texto pronto (quem envia é a pessoa) e copia a mensagem. */
  const atalhosMensagem = (i: { mensagem: string | null; linkWhatsApp: string | null }) => (
    <>
      {i.linkWhatsApp && <Button variant="outline" size="sm" render={<a href={i.linkWhatsApp} target="_blank" rel="noopener noreferrer" />}>WhatsApp</Button>}
      {i.mensagem && <BotaoCopiar texto={i.mensagem} rotulo="Mensagem" />}
    </>
  );

  // Fatia da página da fila aberta (as outras filas nem são montadas).
  const pager = (total: number, pagina: number, totalPaginas: number) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grade px-3 py-2 text-sm text-muted-foreground">
      <span>{total} {total === 1 ? "linha" : "linhas"}</span>
      {totalPaginas > 1 && (
        <span className="flex items-center gap-2">
          {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina - 1 })} />}>Anterior</Button>}
          Página {pagina} de {totalPaginas}
          {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina + 1 })} />}>Próxima</Button>}
        </span>
      )}
    </div>
  );

  let tabela: React.ReactNode = null;
  if (aba === "anexar" || aba === "enviar" || aba === "dados") {
    const grupos = agruparPorNota(tarefas[aba]);
    const p = paginar(grupos, paginaPedida);
    tabela = grupos.length === 0 ? null : (
      <>
        <TabelaParcelas grupos={p.itens} tipo={aba} podeOperar={podeOperar} hoje={hoje} mostrarUnidade={unidade === null} />
        {pager(p.total, p.pagina, p.totalPaginas)}
      </>
    );
  } else if (aba === "confirmar") {
    const p = paginar(tarefas.confirmar, paginaPedida);
    tabela = p.total === 0 ? null : (
      <>
        <Table className="cartoes">
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>Parcelas</TableHead><TableHead>Vence</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead>Contatar</TableHead><TableHead>Contato</TableHead><TableHead>Já feito</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {p.itens.map((i) => (
              <TableRow key={`${i.clienteId}|${i.unidade}`}>
                {nomeCliente(i)}
                <TableCell className="text-[12px]">{i.parcelas.length} · {resumoParcelas(i.parcelas)}</TableCell>
                <TableCell className="tabular-nums">{formatarData(i.vencimentoMaisProximo)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatarMoeda(i.totalCentavos)}</TableCell>
                <TableCell className="text-[12px]">{i.ligar ? <Badge className="mr-1">Ligar</Badge> : null}{prazo(i.prazo)}</TableCell>
                <TableCell className="text-[12px]">{textoContato(i.contato, i.clienteId)}</TableCell>
                <TableCell>{andamento(i.andamento)}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    {atalhosMensagem(i)}
                    <Button size="sm" render={<Link href={`/financeiro/cobranca/confirmar/${i.clienteId}${i.unidade === "contagem" ? "?unidade=contagem" : ""}`} />}>{i.ligar ? "Ligar" : "Confirmar"}</Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pager(p.total, p.pagina, p.totalPaginas)}
      </>
    );
  } else if (aba === "cobrar") {
    const p = paginar(tarefas.cobrar, paginaPedida);
    tabela = p.total === 0 ? null : (
      <>
        <Table className="cartoes">
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>Marco</TableHead><TableHead>Parcelas</TableHead><TableHead>Vencido desde</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead>Contato</TableHead><TableHead>Já feito</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {p.itens.map((i) => (
              <TableRow key={`${i.clienteId}|${i.unidade}|${i.marco}`}>
                {nomeCliente(i)}
                <TableCell><Badge variant={i.marco >= 10 ? "destructive" : "secondary"}>{nomeDoMarco(i.marco)}</Badge></TableCell>
                <TableCell className="text-[12px]">{i.parcelas.length} · {resumoParcelas(i.parcelas)}</TableCell>
                <TableCell className="tabular-nums">{formatarData(i.vencimentoMaisAntigo)}<span className="block text-[11px] text-red-700">{i.diasAtraso} {i.diasAtraso === 1 ? "dia" : "dias"} de atraso</span></TableCell>
                <TableCell className="text-right tabular-nums">{formatarMoeda(i.totalCentavos)}</TableCell>
                <TableCell className="text-[12px]">{textoContato(i.contato, i.clienteId)}</TableCell>
                <TableCell>{andamento(i.andamento)}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    {atalhosMensagem(i)}
                    <Button size="sm" render={<Link href={`/financeiro/cobranca/cobrar/${i.clienteId}`} />}>Cobrar</Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pager(p.total, p.pagina, p.totalPaginas)}
      </>
    );
  }

  const totalDaAba = totalDaFila(tarefas, aba);
  const unidadeDoItem = aba === "anexar" || aba === "enviar" || aba === "dados" ? (contagens[aba] === 1 ? "parcela" : "parcelas") : contagens[aba] === 1 ? "item" : "itens";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <nav aria-label="Unidade" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade sm:w-fit">
          {([{ u: null, rotulo: "Todas as unidades" }, { u: "matriz", rotulo: ROTULO_UNIDADE.matriz }, { u: "contagem", rotulo: ROTULO_UNIDADE.contagem }] as { u: Unidade | null; rotulo: string }[]).map((o) => {
            const ativa = o.u === unidade;
            return (
              <Link key={o.u ?? "todas"} href={href({ unidade: o.u })} aria-current={ativa ? "page" : undefined} className={`min-w-40 px-4 py-1.5 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
                <span className={`flex items-center justify-between gap-3 text-[13px] ${ativa ? "font-bold" : ""}`}>
                  {o.rotulo}
                  <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade">{porUnidade(o.u)}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          {filas.length > 1 && <input type="hidden" name="aba" value={aba} />}
          {unidade && <input type="hidden" name="unidade" value={unidade} />}
          <Input name="q" defaultValue={busca} placeholder="Cliente, código ou documento" aria-label="Buscar" className="w-72" />
          <Button type="submit" variant="secondary">Filtrar</Button>
          {busca && <Button variant="ghost" render={<Link href={href({ q: null })} />}>Limpar</Button>}
        </form>
      </div>

      {filas.length > 1 && <nav aria-label="Filas desta aba" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
        {filas.map((f) => {
          const ativa = f === aba;
          return (
            <Link key={f} href={href({ aba: f })} aria-current={ativa ? "page" : undefined} className={`min-w-44 flex-1 px-3 py-1.5 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
              <span className={`flex items-center justify-between gap-2 text-[12px] ${ativa ? "font-bold" : ""}`}>
                {ROTULO_FILA[f]}
                <span className={`rounded-[3px] px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade ${contagens[f] > 0 ? "bg-marca-clara" : "bg-white text-muted-foreground"}`}>{contagens[f]}</span>
              </span>
            </Link>
          );
        })}
      </nav>}
      <p className="text-[12px] text-muted-foreground">
        {explicacaoDaFila(aba, regra)}
        {contagens[aba] > 0 && <> <strong className="text-foreground">{contagens[aba]} {unidadeDoItem} · {formatarMoeda(totalDaAba)}</strong>.</>}
      </p>

      {tabela === null ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          {busca || unidade ? "Nenhum item nesta fila com os filtros escolhidos." : "Nada a fazer nesta fila. Tudo em dia."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">{tabela}</div>
      )}
    </div>
  );
}
