import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import {
  abaInicial, aplicarFiltros, contarFilas, EXPLICACAO_FILA, ehFila, FILAS, nomeParcela, ROTULO_FILA, totalDeTarefas,
  type ContatoSugerido, type Fila, type ItemBase, type ItemParcela, type ParcelaItem,
} from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { descreverPrazo } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { nomeDoMarco, ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { AnexarBoleto } from "../[id]/componentes";
import { RecebiveisAbas } from "../abas-recebiveis";
import { MarcarEnviadoRapido, PagoPorTransferencia } from "./componentes";
import { carregarTarefas } from "./dados";

export const metadata: Metadata = { title: "Tarefas — Recebíveis" };

const MODULO = "financeiro.recebiveis";
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const resumoParcelas = (ps: readonly ParcelaItem[]) => {
  const nomes = ps.slice(0, 3).map(nomeParcela).join(", ");
  return ps.length > 3 ? `${nomes} e mais ${ps.length - 3}` : nomes;
};

export default async function PaginaTarefas({ searchParams }: PageProps<"/financeiro/recebiveis/tarefas">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;
  const abaPedida = primeiro(parametros.aba);

  const supabase = await criarClienteServidor();
  const todas = await carregarTarefas(supabase);
  const tarefas = aplicarFiltros(todas, { unidade, busca });
  const contagens = contarFilas(tarefas);
  const aba: Fila = ehFila(abaPedida) ? abaPedida : abaInicial(contagens);
  const hoje = tarefas.hoje;

  const href = (extra: { aba?: Fila; unidade?: Unidade | null }) => {
    const qs = new URLSearchParams();
    qs.set("aba", extra.aba ?? aba);
    const u = extra.unidade === undefined ? unidade : extra.unidade;
    if (u) qs.set("unidade", u);
    if (busca) qs.set("q", busca);
    return `/financeiro/recebiveis/tarefas?${qs.toString()}`;
  };
  // Total por unidade (com a busca, sem o filtro de unidade) para o seletor.
  const porUnidade = (u: Unidade | null) => totalDeTarefas(aplicarFiltros(todas, { unidade: u, busca }));

  const seloUnidade = (i: ItemBase) => (unidade === null ? <Badge variant={i.unidade === "contagem" ? "default" : "secondary"} className="ml-1.5 align-middle">{ROTULO_UNIDADE[i.unidade]}</Badge> : null);
  const nomeCliente = (i: ItemBase) => (
    <TableCell className="max-w-72 truncate font-medium" title={i.cliente}>
      <Link href={`/financeiro/recebiveis/clientes/${i.clienteId}`} className="hover:underline">{i.cliente}</Link>
      {seloUnidade(i)}
    </TableCell>
  );
  const textoContato = (c: ContatoSugerido, canais: "email" | "mensagem") => {
    if (!c) return <Badge variant="outline" className="border-marca text-marca">Sem contato</Badge>;
    const meio = canais === "email" ? c.email ?? (c.whatsapp ? formatarWhatsapp(c.whatsapp) : null) : c.whatsapp ? formatarWhatsapp(c.whatsapp) : c.email;
    return <span className="block leading-tight"><span className="block font-medium">{c.nome}</span><span className="block text-muted-foreground">{meio}</span></span>;
  };
  const andamento = (a: { texto: string; quando: string } | null) => (a ? <span className="text-[12px]">{a.texto} <span className="text-muted-foreground">em {a.quando}</span></span> : <span className="text-[12px] text-muted-foreground">Nada registrado</span>);
  const prazo = (iso: string) => <span className={iso < hoje ? "font-medium text-red-700" : ""}>{descreverPrazo(iso, hoje)}</span>;

  // Linhas por fila de parcelas (anexar, enviar, dados).
  const linhasParcela = (lista: ItemParcela[], tipo: Fila) => (
    <TableBody>
      {lista.map((i) => (
        <TableRow key={i.id}>
          {nomeCliente(i)}
          <TableCell className="tabular-nums">{nomeParcela(i)}</TableCell>
          <TableCell className="tabular-nums">{formatarData(i.vencimento)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatarMoeda(i.valorCentavos)}</TableCell>
          <TableCell className="text-[12px]">{prazo(i.prazo)}</TableCell>
          {tipo !== "anexar" && <TableCell className="text-[12px]">{textoContato(i.contato, "email")}</TableCell>}
          <TableCell>{andamento(i.andamento)}</TableCell>
          <TableCell className="text-right">
            <span className="inline-flex flex-wrap items-center justify-end gap-1">
              {tipo === "anexar" && podeOperar && <><AnexarBoleto tituloId={i.id} temBoleto={false} /><PagoPorTransferencia tituloId={i.id} /></>}
              {tipo === "enviar" && podeOperar && <MarcarEnviadoRapido tituloId={i.id} contatoId={i.contato?.id ?? null} tipo="boleto" canalSugerido={i.contato?.email ? "email" : "whatsapp"} />}
              {tipo === "dados" && podeOperar && <MarcarEnviadoRapido tituloId={i.id} contatoId={i.contato?.id ?? null} tipo="dados" canalSugerido={i.contato?.email ? "email" : "whatsapp"} />}
              <Button variant={tipo === "anexar" ? "ghost" : "default"} size="sm" render={<Link href={`/financeiro/recebiveis/${i.id}${tipo === "enviar" ? "#boleto" : tipo === "dados" ? "#dados" : ""}`} />}>
                {tipo === "enviar" ? "Mensagem e rascunho" : tipo === "dados" ? "Mensagem e rascunho" : "Abrir"}
              </Button>
            </span>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
  const cabecalhoParcela = (comContato: boolean) => (
    <TableHeader>
      <TableRow>
        <TableHead>Cliente</TableHead><TableHead>Título</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead>
        <TableHead>Prazo</TableHead>{comContato && <TableHead>Contato</TableHead>}<TableHead>Já feito</TableHead><TableHead />
      </TableRow>
    </TableHeader>
  );

  let tabela: React.ReactNode;
  if (aba === "anexar" || aba === "enviar" || aba === "dados") {
    const lista = tarefas[aba];
    tabela = lista.length === 0 ? null : <Table>{cabecalhoParcela(aba !== "anexar")}{linhasParcela(lista, aba)}</Table>;
  } else if (aba === "confirmar") {
    tabela = tarefas.confirmar.length === 0 ? null : (
      <Table>
        <TableHeader><TableRow>
          <TableHead>Cliente</TableHead><TableHead>Parcelas</TableHead><TableHead>Vence</TableHead><TableHead className="text-right">Total</TableHead>
          <TableHead>Contatar</TableHead><TableHead>Contato</TableHead><TableHead>Já feito</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {tarefas.confirmar.map((i) => (
            <TableRow key={`${i.clienteId}|${i.unidade}`}>
              {nomeCliente(i)}
              <TableCell className="text-[12px]">{i.parcelas.length} · {resumoParcelas(i.parcelas)}</TableCell>
              <TableCell className="tabular-nums">{formatarData(i.vencimentoMaisProximo)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatarMoeda(i.totalCentavos)}</TableCell>
              <TableCell className="text-[12px]">{i.ligar ? <Badge className="mr-1">Ligar</Badge> : null}{prazo(i.prazo)}</TableCell>
              <TableCell className="text-[12px]">{textoContato(i.contato, "mensagem")}</TableCell>
              <TableCell>{andamento(i.andamento)}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" render={<Link href={`/financeiro/recebiveis/confirmar/${i.clienteId}${i.unidade === "contagem" ? "?unidade=contagem" : ""}`} />}>{i.ligar ? "Ligar" : "Confirmar"}</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (aba === "cobrar") {
    tabela = tarefas.cobrar.length === 0 ? null : (
      <Table>
        <TableHeader><TableRow>
          <TableHead>Cliente</TableHead><TableHead>Marco</TableHead><TableHead>Parcelas</TableHead><TableHead>Vencido desde</TableHead><TableHead className="text-right">Total</TableHead>
          <TableHead>Contato</TableHead><TableHead>Já feito</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {tarefas.cobrar.map((i) => (
            <TableRow key={`${i.clienteId}|${i.unidade}|${i.marco}`}>
              {nomeCliente(i)}
              <TableCell><Badge variant={i.marco >= 10 ? "destructive" : "secondary"}>{nomeDoMarco(i.marco)}</Badge></TableCell>
              <TableCell className="text-[12px]">{i.parcelas.length} · {resumoParcelas(i.parcelas)}</TableCell>
              <TableCell className="tabular-nums">{formatarData(i.vencimentoMaisAntigo)}<span className="block text-[11px] text-red-700">{i.diasAtraso} {i.diasAtraso === 1 ? "dia" : "dias"} de atraso</span></TableCell>
              <TableCell className="text-right tabular-nums">{formatarMoeda(i.totalCentavos)}</TableCell>
              <TableCell className="text-[12px]">{textoContato(i.contato, "mensagem")}</TableCell>
              <TableCell>{andamento(i.andamento)}</TableCell>
              <TableCell className="text-right"><Button size="sm" render={<Link href={`/financeiro/recebiveis/cobrar/${i.clienteId}`} />}>Cobrar</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (aba === "baixa") {
    tabela = tarefas.baixa.length === 0 ? null : (
      <Table>
        <TableHeader><TableRow>
          <TableHead>Cliente</TableHead><TableHead>Título</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>O Consistem informa</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {tarefas.baixa.map((i) => (
            <TableRow key={i.id}>
              {nomeCliente(i)}
              <TableCell className="tabular-nums">{nomeParcela(i)}</TableCell>
              <TableCell className="tabular-nums">{formatarData(i.vencimento)}{i.diasAtraso > 0 && <span className="block text-[11px] text-red-700">{i.diasAtraso} dias de atraso</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{formatarMoeda(i.valorCentavos)}</TableCell>
              <TableCell className="text-[12px]">
                {i.pagoEm && i.valorPagoCentavos !== null ? <>Pago em {formatarData(i.pagoEm)}, {formatarMoeda(i.valorPagoCentavos)}</> : <span className="text-muted-foreground">Sem informação de pagamento</span>}
              </TableCell>
              <TableCell className="text-right"><Button size="sm" render={<Link href="/financeiro/recebiveis/baixas" />}>Conferir baixa</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else {
    tabela = tarefas.contato.length === 0 ? null : (
      <Table>
        <TableHeader><TableRow>
          <TableHead>Cliente</TableHead><TableHead>Código</TableHead><TableHead className="text-right">Títulos em aberto</TableHead><TableHead>Primeiro vencimento</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {tarefas.contato.map((i) => (
            <TableRow key={i.clienteId}>
              {nomeCliente(i)}
              <TableCell className="tabular-nums text-muted-foreground">{i.codigo ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{i.titulos} · {formatarMoeda(i.totalCentavos)}{i.maiorAtraso > 0 && <span className="block text-[11px] text-red-700">atraso máx. {i.maiorAtraso} dias</span>}</TableCell>
              <TableCell className="tabular-nums">{formatarData(i.menorVencimento)}</TableCell>
              <TableCell className="text-right"><Button size="sm" render={<Link href={`/financeiro/recebiveis/clientes/${i.clienteId}`} />}>Cadastrar contato</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recebíveis</h1>
        <p className="text-sm text-muted-foreground">Tarefas do contas a receber, por fila. As listas são calculadas na hora a partir da situação dos títulos: ao fazer a tarefa, o item sai da lista sozinho.</p>
      </div>

      <RecebiveisAbas ativa="tarefas" contagens={{ tarefas: totalDeTarefas(tarefas), baixas: contagens.baixa }} />

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
          <input type="hidden" name="aba" value={aba} />
          {unidade && <input type="hidden" name="unidade" value={unidade} />}
          <Input name="q" defaultValue={busca} placeholder="Cliente, código ou documento" aria-label="Buscar" className="w-72" />
          <Button type="submit" variant="secondary">Filtrar</Button>
          {busca && <Button variant="ghost" render={<Link href={`/financeiro/recebiveis/tarefas?aba=${aba}${unidade ? `&unidade=${unidade}` : ""}`} />}>Limpar</Button>}
        </form>
      </div>

      <nav aria-label="Filas de tarefas" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
        {FILAS.map((f) => {
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
      </nav>
      <p className="text-[12px] text-muted-foreground">{EXPLICACAO_FILA[aba]}</p>

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
