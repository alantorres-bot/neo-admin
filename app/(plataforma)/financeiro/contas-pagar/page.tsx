import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  aplicarCorteAntecipacoes, aplicarFiltrosPendentes, ehDataIso, ehFiltroMostrar, ehFiltroSituacao, ehFiltroTipo, estaPendente, ordenarPendentes, paginar,
  ROTA_CONTAS_PAGAR, totalizar, type FiltrosPendentes,
} from "@/lib/modulos/financeiro/contas-pagar/pendentes";
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

export default async function PaginaAutorizarPagamento({ searchParams }: PageProps<"/financeiro/contas-pagar">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const hoje = hojeEmCuiaba();

  const parametros = await searchParams;
  const tipoPedido = primeiro(parametros.tipo);
  const situacaoPedida = primeiro(parametros.situacao);
  const mostrarPedido = primeiro(parametros.mostrar);
  const de = primeiro(parametros.de);
  const ate = primeiro(parametros.ate);
  const filtros: FiltrosPendentes = {
    busca: sanitizarBusca(primeiro(parametros.q)),
    tipo: ehFiltroTipo(tipoPedido) ? tipoPedido : "todos",
    situacao: ehFiltroSituacao(situacaoPedida) ? situacaoPedida : "todos",
    mostrar: ehFiltroMostrar(mostrarPedido) ? mostrarPedido : "pendentes",
    vencDe: ehDataIso(de) ? de : null,
    vencAte: ehDataIso(ate) ? ate : null,
  };
  const paginaPedida = Number.parseInt(primeiro(parametros.pagina), 10) || 1;
  const temFiltro = Boolean(filtros.busca || filtros.tipo !== "todos" || filtros.situacao !== "todos" || filtros.vencDe || filtros.vencAte || filtros.mostrar !== "pendentes");

  const { itens: todos, parametros: param, ultima, empresas } = await pendentesDaRequisicao();
  const emAberto = aplicarCorteAntecipacoes(todos, param.corteAntecipacoes);
  const foraDoCorte = todos.length - emAberto.length;
  const pendentes = emAberto.filter(estaPendente);
  const jaTratados = emAberto.length - pendentes.length;
  const totalGeral = totalizar(pendentes, hoje);
  const filtrados = ordenarPendentes(aplicarFiltrosPendentes(emAberto, filtros, hoje));
  const totais = totalizar(filtrados.filter(estaPendente), hoje);
  const { pagina, totalPaginas, itens } = paginar(filtrados, paginaPedida);

  const link = (p: number) => {
    const qs = new URLSearchParams();
    if (filtros.busca) qs.set("q", filtros.busca);
    if (filtros.tipo !== "todos") qs.set("tipo", filtros.tipo);
    if (filtros.situacao !== "todos") qs.set("situacao", filtros.situacao);
    if (filtros.mostrar !== "pendentes") qs.set("mostrar", filtros.mostrar);
    if (filtros.vencDe) qs.set("de", filtros.vencDe);
    if (filtros.vencAte) qs.set("ate", filtros.vencAte);
    if (p > 1) qs.set("pagina", String(p));
    const texto = qs.toString();
    return `${ROTA_CONTAS_PAGAR}${texto ? `?${texto}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {ultima
            ? <>Atualizado do Consistem em {ultima.quando} ({ultima.novos} novos · {ultima.alterados} alterados · {ultima.baixados} saíram dos abertos).</>
            : "Ainda não foi atualizado do Consistem. Use “Atualizar do Consistem” para trazer a lista."}
          {param.corteAntecipacoes && <> Antecipações a partir de {formatarData(param.corteAntecipacoes)}{foraDoCorte > 0 ? ` (${foraDoCorte} anteriores ficam fora)` : ""}.</>}
        </p>
        {podeOperar && <BotoesAtualizar />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Títulos{temFiltro ? " no filtro" : " pendentes"}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.titulos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.titulos.quantidade} {totais.titulos.quantidade === 1 ? "título" : "títulos"}{temFiltro ? ` · ${totalGeral.titulos.quantidade} pendentes no total` : ""}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Antecipações{temFiltro ? " no filtro" : " pendentes"}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.antecipacoes.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.antecipacoes.quantidade} {totais.antecipacoes.quantidade === 1 ? "antecipação" : "antecipações"} com saldo{temFiltro ? ` · ${totalGeral.antecipacoes.quantidade} pendentes no total` : ""}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Vencidos</CardDescription><CardTitle className="text-xl tabular-nums text-red-700">{formatarMoeda(totais.vencidos.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.vencidos.quantidade} {totais.vencidos.quantidade === 1 ? "título vencido" : "títulos vencidos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Total{temFiltro ? " no filtro" : " pendente de autorização"}</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(totais.geral.centavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{totais.geral.quantidade} {totais.geral.quantidade === 1 ? "item" : "itens"}{temFiltro ? ` · ${formatarMoeda(totalGeral.geral.centavos)} pendentes no total` : jaTratados > 0 ? ` · ${jaTratados} já em autorização ou pagos fora` : ""}</CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold">Em aberto no Consistem</h2>
          <p className="text-xs text-muted-foreground">
            Título = saldo a pagar. Antecipação = valor adiantado ao fornecedor ainda não abatido por nota fiscal. Marque os itens e clique em “Gerar autorização”; o item sai da lista de pendentes ao entrar numa autorização.
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-2" role="search">
          <Input name="q" defaultValue={filtros.busca} placeholder="Fornecedor, CNPJ, documento ou histórico" aria-label="Buscar" className="w-72" />
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
            <option value="todos">Incluir já autorizados e pagos fora</option>
          </select>
          <label className="flex items-center gap-1 text-[13px]">de <Input type="date" name="de" defaultValue={filtros.vencDe ?? ""} aria-label="Vencimento de" className="w-36" /></label>
          <label className="flex items-center gap-1 text-[13px]">até <Input type="date" name="ate" defaultValue={filtros.vencAte ?? ""} aria-label="Vencimento até" className="w-36" /></label>
          <Button type="submit" variant="secondary">Filtrar</Button>
          {temFiltro && <Button variant="ghost" render={<Link href={ROTA_CONTAS_PAGAR} />}>Limpar</Button>}
        </form>

        {itens.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {todos.length === 0 ? "Nenhum lançamento em aberto. Use “Atualizar do Consistem” para trazer a lista." : "Nenhum item encontrado com esse filtro."}
          </p>
        ) : (
          <TabelaPendentes itens={itens} podeOperar={podeOperar} ehGestor={ehGestor} hoje={hoje} empresas={empresas} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{filtrados.length} {filtrados.length === 1 ? "item" : "itens"}{temFiltro ? " no filtro" : ""}{totalPaginas > 1 ? " · a seleção vale para a página atual" : ""}</span>
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
