import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  aplicarCorteAntecipacoes, aplicarFiltrosPendentes, ATALHOS, ehAtalho, ehDataIso, ehFiltroMostrar, ehFiltroSituacao, ehFiltroTipo, estaPaga, estaPendente,
  ordenarPendentes, paginar, periodoDoAtalho, ROTA_CONTAS_PAGAR, totalizar, type FiltrosPendentes,
} from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { descreverRascunho } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { BotoesAtualizar } from "./componentes";
import { pendentesDaRequisicao } from "./dados";
import { TabelaPendentes } from "./tabela-pendentes";

export const metadata: Metadata = { title: "Contas a pagar" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Autorizar pagamento. A tela abre só com os filtros: a diretoria escolhe o período de vencimento (ou um atalho) e clica em
 * Consultar; só então vêm os cartões e a lista do recorte, de onde se monta a autorização.
 */
export default async function PaginaAutorizarPagamento({ searchParams }: PageProps<"/financeiro/contas-pagar">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const hoje = hojeEmCuiaba();

  const parametros = await searchParams;
  const atalhoPedido = primeiro(parametros.atalho);
  const atalho = ehAtalho(atalhoPedido) ? atalhoPedido : null;
  const periodoAtalho = atalho ? periodoDoAtalho(atalho, hoje) : null;
  const tipoPedido = primeiro(parametros.tipo);
  const situacaoPedida = primeiro(parametros.situacao);
  const mostrarPedido = primeiro(parametros.mostrar);
  const de = periodoAtalho ? (periodoAtalho.de ?? "") : primeiro(parametros.de);
  const ate = periodoAtalho ? periodoAtalho.ate : primeiro(parametros.ate);
  const filtros: FiltrosPendentes = {
    busca: sanitizarBusca(primeiro(parametros.q)),
    tipo: ehFiltroTipo(tipoPedido) ? tipoPedido : "todos",
    situacao: ehFiltroSituacao(situacaoPedida) ? situacaoPedida : "todos",
    mostrar: ehFiltroMostrar(mostrarPedido) ? mostrarPedido : "pendentes",
    vencDe: ehDataIso(de) ? de : null,
    vencAte: ehDataIso(ate) ? ate : null,
  };
  const consultou = primeiro(parametros.consultar) === "1" || atalho !== null;
  const paginaPedida = Number.parseInt(primeiro(parametros.pagina), 10) || 1;

  const { itens: todos, parametros: param, ultima, empresas, rascunhos } = await pendentesDaRequisicao();
  const avisoRascunhos = rascunhos.length > 0 && (
    <div className="space-y-1">
      {rascunhos.map((r) => (
        <p key={r.id} className="rounded-[3px] border border-grade bg-marca-clara px-3 py-2 text-sm">
          <strong>{descreverRascunho(r)}</strong>{empresas.length > 1 ? ` (${empresas.find((e) => e.id === r.empresaId)?.nome ?? "empresa"})` : ""}.
          Marque mais itens e use “Salvar parcial”, inclua “Extras” ou clique em “Gerar autorização”.{" "}
          <Link href={`${ROTA_CONTAS_PAGAR}/autorizacoes/${r.id}`} className="text-elo hover:underline">Abrir o rascunho</Link>
        </p>
      ))}
    </div>
  );
  const linhaAtualizacao = (
    <p className="text-sm text-muted-foreground">
      {ultima
        ? <>Atualizado do Consistem em {ultima.quando} ({ultima.novos} novos · {ultima.alterados} alterados · {ultima.baixados} saíram dos abertos).</>
        : "Ainda não foi atualizado do Consistem. Use “Atualizar do Consistem” para trazer a lista."}
      {param.corteAntecipacoes && <> Antecipações a partir de {formatarData(param.corteAntecipacoes)}.</>}
    </p>
  );

  const hrefAtalho = (codigo: string) => {
    const qs = new URLSearchParams({ atalho: codigo });
    if (filtros.tipo !== "todos") qs.set("tipo", filtros.tipo);
    return `${ROTA_CONTAS_PAGAR}?${qs}`;
  };

  const formulario = (
    <form method="get" className="space-y-3 rounded-[3px] border border-grade bg-cabecalho p-4" role="search">
      <input type="hidden" name="consultar" value="1" />
      <div>
        <h2 className="text-base font-bold">Consultar o que está em aberto</h2>
        <p className="text-xs text-muted-foreground">Escolha o período de vencimento (para antecipação vale o pagamento programado) e clique em Consultar. A lista e os totais vêm só do recorte escolhido.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">Vencimento</span>
        <label className="flex items-center gap-1 text-[13px]">de <Input type="date" name="de" defaultValue={filtros.vencDe ?? ""} aria-label="Vencimento de" className="w-36" /></label>
        <label className="flex items-center gap-1 text-[13px]">até <Input type="date" name="ate" defaultValue={filtros.vencAte ?? ""} aria-label="Vencimento até" className="w-36" /></label>
        <span className="text-xs text-muted-foreground">ou um atalho:</span>
        {ATALHOS.map((a) => (
          <Button key={a.codigo} type="button" size="sm" variant={atalho === a.codigo ? "default" : "outline"} render={<Link href={hrefAtalho(a.codigo)} />}>{a.rotulo}</Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={filtros.busca} placeholder="Fornecedor, CNPJ, documento ou histórico (opcional)" aria-label="Buscar" className="w-80" />
        <select name="tipo" defaultValue={filtros.tipo} aria-label="Tipo" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
          <option value="todos">Títulos e antecipações</option>
          <option value="titulos">Só títulos</option>
          <option value="antecipacoes">Só antecipações</option>
        </select>
        <select name="situacao" defaultValue={filtros.situacao} aria-label="Situação" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
          <option value="todos">Vencidos e a vencer</option>
          <option value="vencidos">Só vencidos</option>
          <option value="a_vencer">Só a vencer</option>
        </select>
        <select name="mostrar" defaultValue={filtros.mostrar} aria-label="Mostrar" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
          <option value="pendentes">Pendentes de autorização</option>
          <option value="todos">Incluir pagos e já autorizados</option>
        </select>
        <Button type="submit">Consultar</Button>
        {consultou && <Button variant="ghost" render={<Link href={ROTA_CONTAS_PAGAR} />}>Nova consulta</Button>}
      </div>
    </form>
  );

  if (!consultou) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {linhaAtualizacao}
          {podeOperar && <BotoesAtualizar />}
        </div>
        {avisoRascunhos}
        {formulario}
        <p className="text-xs text-muted-foreground">
          {todos.length > 0 ? `${todos.filter(estaPendente).length} itens pendentes de autorização no total; a consulta mostra só o período escolhido.` : "Nenhum lançamento em aberto ainda: atualize do Consistem."}
        </p>
      </div>
    );
  }

  const emAberto = aplicarCorteAntecipacoes(todos, param.corteAntecipacoes);
  const filtrados = ordenarPendentes(aplicarFiltrosPendentes(emAberto, filtros, hoje));
  const pendentesFiltrados = filtrados.filter(estaPendente);
  const totais = totalizar(pendentesFiltrados, hoje);
  const pagasNoRecorte = filtrados.filter(estaPaga).length;
  const { pagina, totalPaginas, itens } = paginar(filtrados, paginaPedida);
  const descricaoPeriodo = filtros.vencDe && filtros.vencAte ? `de ${formatarData(filtros.vencDe)} a ${formatarData(filtros.vencAte)}`
    : filtros.vencAte ? `vencidos até ${formatarData(filtros.vencAte)}` : filtros.vencDe ? `a partir de ${formatarData(filtros.vencDe)}` : "sem período";

  const link = (p: number) => {
    const qs = new URLSearchParams();
    qs.set("consultar", "1");
    if (atalho) qs.set("atalho", atalho);
    else {
      if (filtros.vencDe) qs.set("de", filtros.vencDe);
      if (filtros.vencAte) qs.set("ate", filtros.vencAte);
    }
    if (filtros.busca) qs.set("q", filtros.busca);
    if (filtros.tipo !== "todos") qs.set("tipo", filtros.tipo);
    if (filtros.situacao !== "todos") qs.set("situacao", filtros.situacao);
    if (filtros.mostrar !== "pendentes") qs.set("mostrar", filtros.mostrar);
    if (p > 1) qs.set("pagina", String(p));
    return `${ROTA_CONTAS_PAGAR}?${qs}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {linhaAtualizacao}
        {podeOperar && <BotoesAtualizar />}
      </div>

      {avisoRascunhos}
      {formulario}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Títulos no período</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.titulos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.titulos.quantidade} {totais.titulos.quantidade === 1 ? "título" : "títulos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Antecipações a pagar</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.antecipacoes.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.antecipacoes.quantidade} {totais.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"}{pagasNoRecorte > 0 ? ` · ${pagasNoRecorte} pagas (com borderô)` : ""}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencidos</CardDescription><CardTitle className="text-xl tabular-nums text-red-700">{formatarMoeda(totais.vencidos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.vencidos.quantidade} {totais.vencidos.quantidade === 1 ? "título vencido" : "títulos vencidos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Total pendente no período</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.geral.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.geral.quantidade} {totais.geral.quantidade === 1 ? "item" : "itens"} · {descricaoPeriodo}</CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold">Em aberto no Consistem · {descricaoPeriodo}</h2>
          <p className="text-xs text-muted-foreground">
            Marque os itens: a soma fica fixa no alto da lista. “Salvar parcial” grava no rascunho e você continua aqui; “Extras” inclui pagamentos fora do Consistem; “Gerar autorização” fecha o rascunho. Passar do caixa só avisa, não impede.
          </p>
        </div>

        {itens.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {todos.length === 0 ? "Nenhum lançamento em aberto. Use “Atualizar do Consistem” para trazer a lista." : "Nenhum item pendente nesse período e filtros."}
          </p>
        ) : (
          <TabelaPendentes itens={itens} podeOperar={podeOperar} ehGestor={ehGestor} hoje={hoje} empresas={empresas} rascunhos={rascunhos} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{filtrados.length} {filtrados.length === 1 ? "item" : "itens"} no período{totalPaginas > 1 ? " · a seleção vale para a página atual" : ""}</span>
          {totalPaginas > 1 && (
            <span className="flex items-center gap-2">
              {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={link(pagina - 1)} />}>Anterior</Button>}
              Página {pagina} de {totalPaginas}
              {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={link(pagina + 1)} />}>Próxima</Button>}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
