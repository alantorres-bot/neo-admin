"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { compararComCaixa, parseReais, ROTULO_STATUS } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { descreverSituacao, diasAtraso, estaPaga, estaPendente, ROTULO_TIPO, type ItemPendente } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { criarAutorizacao, desfazerAntecipacaoTratada, marcarAntecipacaoTratada } from "./acoes";

type Props = {
  itens: ItemPendente[];
  podeOperar: boolean;
  ehGestor: boolean;
  hoje: string;
  /** Nome da empresa por id (para a confirmação). */
  empresas: { id: string; nome: string }[];
};

/** Texto do resumo caixa × selecionado. */
function ResumoCaixa({ totalCentavos, caixaCentavos }: { totalCentavos: number; caixaCentavos: number | null }) {
  const c = compararComCaixa(totalCentavos, caixaCentavos);
  if (!c) return <span className="text-xs text-muted-foreground">Informe o caixa disponível para comparar.</span>;
  return c.ultrapassa
    ? <span className="rounded-[3px] bg-red-700 px-2 py-0.5 text-xs font-bold text-white" role="alert">Ultrapassa o caixa em {formatarMoeda(c.excedenteCentavos)}</span>
    : <span className="rounded-[3px] bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">Sobra {formatarMoeda(c.sobraCentavos)}</span>;
}

/**
 * Tabela unificada (títulos + antecipações) com caixas de marcação e a barra FIXA no alto da lista: soma do que está marcado,
 * caixa disponível e "Gerar autorização". Linhas que já estão numa autorização ativa, pagas (borderô) ou marcadas como pagas
 * fora aparecem apagadas e sem caixa. Antecipação a pagar tem "Já paga fora" para exceção.
 */
export function TabelaPendentes({ itens, podeOperar, ehGestor, hoje, empresas }: Props) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [caixaTexto, setCaixaTexto] = useState("");
  const [dialogo, setDialogo] = useState(false);

  const selecionaveis = useMemo(() => itens.filter(estaPendente), [itens]);
  const idsSelecionaveis = useMemo(() => selecionaveis.map((i) => i.id), [selecionaveis]);
  const porId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const selecionados = useMemo(() => [...marcadas].map((id) => porId.get(id)).filter((i): i is ItemPendente => Boolean(i)), [marcadas, porId]);
  const totalMarcado = selecionados.reduce((s, i) => s + i.saldoCentavos, 0);
  const empresasMarcadas = new Set(selecionados.map((i) => i.empresaId));
  const caixaCentavos = parseReais(caixaTexto);

  const alternar = (ids: string[]) => setMarcadas((atual) => {
    const novo = new Set(atual);
    const todas = ids.every((id) => novo.has(id));
    for (const id of ids) {
      if (todas) novo.delete(id);
      else novo.add(id);
    }
    return novo;
  });
  const todasMarcadas = idsSelecionaveis.length > 0 && idsSelecionaveis.every((id) => marcadas.has(id));

  return (
    <div>
      {podeOperar && (
        <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[3px] border border-grade bg-marca-clara px-3 py-2 text-sm shadow-sm">
          <strong className="tabular-nums">{marcadas.size} {marcadas.size === 1 ? "item marcado" : "itens marcados"} · {formatarMoeda(totalMarcado)}</strong>
          <label className="flex items-center gap-1 text-[13px]">
            Caixa disponível
            <Input value={caixaTexto} onChange={(e) => setCaixaTexto(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" aria-label="Caixa disponível" className="h-7 w-36 bg-white text-right tabular-nums" />
          </label>
          <ResumoCaixa totalCentavos={totalMarcado} caixaCentavos={caixaCentavos} />
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => setDialogo(true)} disabled={marcadas.size === 0 || empresasMarcadas.size !== 1}>Gerar autorização ({marcadas.size})</Button>
            {marcadas.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setMarcadas(new Set())}>Limpar seleção</Button>}
          </span>
          {empresasMarcadas.size > 1 && <span className="basis-full text-xs text-destructive">Marque itens de uma empresa só por autorização.</span>}
          {caixaTexto !== "" && caixaCentavos === null && <span className="basis-full text-xs text-destructive">Caixa inválido: use números, ex.: 150.000,00.</span>}
        </div>
      )}
      {dialogo && selecionados.length > 0 && (
        <DialogoGerarAutorizacao
          itens={selecionados}
          empresaNome={empresas.find((e) => e.id === selecionados[0].empresaId)?.nome ?? "empresa"}
          ehGestor={ehGestor}
          hoje={hoje}
          caixaInicial={caixaTexto}
          aoFechar={() => setDialogo(false)}
          aoGerar={(id) => { setMarcadas(new Set()); setDialogo(false); router.push(`/financeiro/contas-pagar/autorizacoes/${id}`); }}
        />
      )}
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table className="cartoes">
          <TableHeader>
            <TableRow>
              {podeOperar && (
                <TableHead className="w-8">
                  <input type="checkbox" className="size-4" aria-label="Marcar todos desta página" checked={todasMarcadas} onChange={() => alternar(idsSelecionaveis)} disabled={idsSelecionaveis.length === 0} />
                </TableHead>
              )}
              <TableHead>Tipo</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Histórico</TableHead>
              {podeOperar && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((i) => {
              const atraso = diasAtraso(i, hoje);
              const pendente = estaPendente(i);
              return (
                <TableRow key={i.id} className={pendente ? undefined : "opacity-60"}>
                  {podeOperar && (
                    <TableCell>
                      {pendente && <input type="checkbox" className="size-4" aria-label={`Marcar ${i.fornecedor} ${i.numDocumento}`} checked={marcadas.has(i.id)} onChange={() => alternar([i.id])} />}
                    </TableCell>
                  )}
                  <TableCell><Badge variant={i.tipo === "antecipacao" ? "default" : "outline"}>{ROTULO_TIPO[i.tipo]}</Badge></TableCell>
                  <TableCell className="max-w-72">
                    <span className="block truncate" title={i.fornecedor}>{i.fornecedor}</span>
                    <span className="block text-[11px] text-muted-foreground">{i.documentoFornecedor ?? `cód. ${i.codFornecedor || "—"}`}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {i.numDocumento || "—"}
                    <span className="block text-[11px] text-muted-foreground">lanç. {i.codLancamento}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatarData(i.emissao) || "—"}</TableCell>
                  <TableCell className="tabular-nums">{i.tipo === "titulo" ? formatarData(i.vencimento) || "—" : (i.dataPagamento ? formatarData(i.dataPagamento) : "—")}</TableCell>
                  <TableCell className={atraso > 0 && pendente ? "font-medium text-red-700" : estaPaga(i) ? "text-emerald-700" : "text-muted-foreground"}>
                    {i.autorizacao ? (
                      <Link href={`/financeiro/contas-pagar/autorizacoes/${i.autorizacao.id}`} className="hover:underline">
                        Na autorização nº {i.autorizacao.numero} ({ROTULO_STATUS[i.autorizacao.status].toLowerCase()})
                      </Link>
                    ) : i.tratada ? (
                      <span title={i.tratada.motivo}>Paga fora do Neo Admin</span>
                    ) : descreverSituacao(i, hoje)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatarMoeda(i.valorDocumentoCentavos)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(i.saldoCentavos)}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={i.complemento}>{i.complemento || "—"}</TableCell>
                  {podeOperar && (
                    <TableCell className="text-right">
                      {i.tipo === "antecipacao" && pendente && <DialogoTratar item={i} />}
                      {i.tratada && <BotaoDesfazerTratada item={i} />}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DialogoGerarAutorizacao({ itens, empresaNome, ehGestor, hoje, caixaInicial, aoFechar, aoGerar }: {
  itens: ItemPendente[]; empresaNome: string; ehGestor: boolean; hoje: string; caixaInicial: string; aoFechar: () => void; aoGerar: (id: string) => void;
}) {
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [caixaTexto, setCaixaTexto] = useState(caixaInicial);
  const [autorizar, setAutorizar] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const titulos = itens.filter((i) => i.tipo === "titulo");
  const antecipacoes = itens.filter((i) => i.tipo === "antecipacao");
  const soma = (lista: ItemPendente[]) => lista.reduce((s, i) => s + i.saldoCentavos, 0);
  const total = soma(itens);
  const caixaCentavos = parseReais(caixaTexto);
  const comparacao = compararComCaixa(total, caixaCentavos);

  function gerar() {
    if (caixaTexto !== "" && caixaCentavos === null) {
      setErro("Caixa disponível inválido: use números, ex.: 150.000,00 (ou deixe em branco).");
      return;
    }
    iniciar(async () => {
      const r = await criarAutorizacao({ empresaId: itens[0].empresaId, lancamentoIds: itens.map((i) => i.id), data, observacao, autorizar, caixaCentavos });
      if (r.ok) {
        toast.success(r.aviso);
        aoGerar(r.id);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) aoFechar(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar autorização de pagamento</DialogTitle>
          <DialogDescription>
            {empresaNome}: {titulos.length} {titulos.length === 1 ? "título" : "títulos"} ({formatarMoeda(soma(titulos))}) e {antecipacoes.length} {antecipacoes.length === 1 ? "antecipação" : "antecipações"} ({formatarMoeda(soma(antecipacoes))}). Total {formatarMoeda(total)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="cap-data" className="text-sm font-medium">Data da autorização</label>
            <Input id="cap-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="cap-caixa" className="text-sm font-medium">Caixa disponível (opcional)</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="cap-caixa" value={caixaTexto} onChange={(e) => setCaixaTexto(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" className="w-44 text-right tabular-nums" />
              {comparacao && (comparacao.ultrapassa
                ? <span className="text-sm font-bold text-red-700">Ultrapassa o caixa em {formatarMoeda(comparacao.excedenteCentavos)}</span>
                : <span className="text-sm font-bold text-emerald-700">Sobra {formatarMoeda(comparacao.sobraCentavos)}</span>)}
            </div>
            {comparacao?.ultrapassa && <p className="text-xs text-muted-foreground">Pode autorizar mesmo assim: o relatório mostra o excedente para decidir o que deixar de pagar.</p>}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="cap-obs" className="text-sm font-medium">Observação (opcional)</label>
            <Textarea id="cap-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} rows={3} placeholder="Ex.: pagamentos da semana de 13/10" />
          </div>
          {ehGestor ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={autorizar} onChange={(e) => setAutorizar(e.target.checked)} />
              Autorizar agora (abre a pendência de execução na Fila do dia)
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">Fica como rascunho até um gestor do Financeiro autorizar.</p>
          )}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={aoFechar} disabled={pendente}>Voltar</Button>
            <Button type="button" onClick={gerar} disabled={pendente}>{pendente ? "Gerando…" : autorizar ? "Gerar e autorizar" : "Gerar rascunho"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DialogoTratar({ item }: { item: ItemPendente }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function marcar() {
    iniciar(async () => {
      const r = await marcarAntecipacaoTratada({ lancamentoId: item.id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="xs" onClick={() => { setErro(undefined); setAberto(true); }} title="Exceção: a antecipação foi paga sem borderô no Consistem">Já paga fora</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Antecipação já paga fora do Neo Admin</DialogTitle>
              <DialogDescription>{item.fornecedor} · lançamento {item.codLancamento} · {formatarMoeda(item.saldoCentavos)}. Use só como exceção (pagamento sem borderô). Ela sai da lista de pendentes; a marcação fica registrada e pode ser desfeita.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={`motivo-${item.id}`} className="text-sm font-medium">Motivo</label>
                <Input id={`motivo-${item.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: paga em 02/10 por Pix fora do borderô" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={marcar} disabled={pendente}>{pendente ? "Salvando…" : "Marcar como paga"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function BotaoDesfazerTratada({ item }: { item: ItemPendente }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  if (!item.tratada) return null;
  const tratadaId = item.tratada.id;
  return (
    <Button type="button" variant="ghost" size="xs" disabled={pendente} title="Volta a antecipação para a lista de pendentes" onClick={() => iniciar(async () => {
      const r = await desfazerAntecipacaoTratada({ tratadaId, motivo: "Desfeito na lista de pendentes" });
      if (r.ok) { toast.success(r.aviso); router.refresh(); } else toast.error(r.erro);
    })}>{pendente ? "…" : "Desfazer"}</Button>
  );
}
