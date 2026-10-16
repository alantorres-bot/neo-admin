"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  filtrarConferencia, filtrarPorSituacao, interpretarBusca, podeMarcarNaoPago, resumirConferencia, ROTULO_TIPO_CONFERENCIA,
  type FiltroConferencia, type LinhaConferencia, type SituacaoConferencia,
} from "@/lib/modulos/financeiro/contas-pagar/conferencia";
import { alternarOrdem, ordenar, type Ordem } from "@/lib/modulos/financeiro/contas-pagar/ordenacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { CabecalhoOrdenavel } from "../../../cabecalho-ordenavel";
import { conferir } from "../acoes";

type Coluna = "tipo" | "nome" | "documento" | "data" | "valor";
type Marca = Pick<LinhaConferencia, "situacao" | "valorBancoCentavos" | "observacao" | "conferidoPorNome" | "conferidoEm">;

const FILTROS: { valor: FiltroConferencia; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" }, { valor: "faltam", rotulo: "Faltam" }, { valor: "conferidos", rotulo: "Conferidos" }, { valor: "divergentes", rotulo: "Divergentes" },
  { valor: "nao_pagos", rotulo: "Não pagos" },
];

const FUNDO: Record<SituacaoConferencia, string> = { conferido: "bg-emerald-50", divergente: "bg-amber-50", nao_pago: "bg-muted" };
const COR_TEXTO: Record<SituacaoConferencia, string> = { conferido: "text-emerald-700", divergente: "text-amber-800", nao_pago: "text-muted-foreground" };
const ROTULO_SITUACAO: Record<SituacaoConferencia, string> = { conferido: "conferido", divergente: "divergente", nao_pago: "não pago · voltou para a lista Autorizar pagamento" };

/**
 * Lista da conferência com o banco. Cada caixa marcada grava na hora (otimista: desfaz e avisa se o banco recusar). Busca por valor
 * ("150", "1.234,56") ou por fornecedor/documento; com uma linha só na busca, Enter marca essa linha. "Divergente" abre na própria
 * linha o valor que está no banco e uma observação. "Não pago" (só título/antecipação) pede o motivo: o item fica na autorização e o
 * lançamento volta à lista Autorizar pagamento enquanto estiver em aberto no Consistem.
 */
export function TabelaConferencia({ autorizacaoId, linhas, podeMarcar, nomeUsuario }: { autorizacaoId: string; linhas: LinhaConferencia[]; podeMarcar: boolean; nomeUsuario: string }) {
  const [marcas, setMarcas] = useState<Map<string, Marca>>(new Map());
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());
  const [, iniciar] = useTransition();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroConferencia>("todos");
  const [ordem, setOrdem] = useState<Ordem<Coluna> | null>(null);
  const [editando, setEditando] = useState<{ id: string; modo: "divergente" | "nao_pago" } | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);

  // Linhas com as marcas desta sessão por cima (o servidor também revalida a página).
  const atuais = useMemo(() => linhas.map((l) => ({ ...l, ...marcas.get(l.id) })), [linhas, marcas]);
  const resumo = resumirConferencia(atuais);
  const contagem: Record<FiltroConferencia, number> = { todos: resumo.total.quantidade, faltam: resumo.faltam.quantidade, conferidos: resumo.conferidos.quantidade, divergentes: resumo.divergentes.quantidade, nao_pagos: resumo.naoPagos.quantidade };
  const visiveis = ordenar(filtrarPorSituacao(filtrarConferencia(atuais, interpretarBusca(busca)), filtro), ordem, (l, c) => {
    switch (c) {
      case "tipo": return ROTULO_TIPO_CONFERENCIA[l.tipo];
      case "nome": return l.nome;
      case "documento": return l.documento || null;
      case "data": return l.data;
      case "valor": return l.valorCentavos;
    }
  });

  function gravar(l: LinhaConferencia, situacao: SituacaoConferencia | null, valorBancoCentavos: number | null = null, observacao: string | null = null) {
    const anterior = marcas.get(l.id);
    const otimista: Marca = situacao
      ? { situacao, valorBancoCentavos: situacao === "divergente" ? valorBancoCentavos : null, observacao, conferidoPorNome: nomeUsuario, conferidoEm: "agora" }
      : { situacao: null, valorBancoCentavos: null, observacao: null, conferidoPorNome: null, conferidoEm: null };
    const trocar = (m: Marca | undefined) => setMarcas((atual) => {
      const novo = new Map(atual);
      if (m) novo.set(l.id, m); else novo.delete(l.id);
      return novo;
    });
    trocar(otimista);
    setPendentes((p) => new Set(p).add(l.id));
    iniciar(async () => {
      const r = await conferir({
        autorizacaoId, origem: l.origem, id: l.id, situacao,
        valorBanco: valorBancoCentavos === null ? null : valorBancoCentavos / 100, observacao,
      });
      setPendentes((p) => { const n = new Set(p); n.delete(l.id); return n; });
      if (!r.ok) {
        trocar(anterior);
        return void toast.error(r.erro);
      }
      trocar({ ...otimista, situacao: r.situacao, valorBancoCentavos: r.valorBanco === null ? null : Math.round(r.valorBanco * 100), observacao: r.observacao, conferidoEm: r.conferidoEm });
      if (situacao === "divergente" || situacao === "nao_pago") setEditando(null);
      if (situacao === "nao_pago") toast.success(`${l.nome} · ${formatarMoeda(l.valorCentavos)} voltou para a lista Autorizar pagamento.`);
    });
  }

  const alternarEdicao = (id: string, modo: "divergente" | "nao_pago") =>
    setEditando(editando?.id === id && editando.modo === modo ? null : { id, modo });

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") setBusca("");
    if (e.key === "Enter" && visiveis.length === 1 && podeMarcar && visiveis[0].situacao === null) {
      gravar(visiveis[0], "conferido");
      setBusca("");
    }
  }

  const cabecalho = (c: Coluna, rotulo: string, direita = false) => (
    <CabecalhoOrdenavel rotulo={rotulo} direcao={ordem?.coluna === c ? ordem.direcao : null} aoClicar={() => setOrdem(alternarOrdem(ordem, c))} alinharDireita={direita} />
  );

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 space-y-3 bg-background pb-2 pt-1">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Resumo titulo="Conferidos" valor={`${resumo.conferidos.quantidade} de ${resumo.total.quantidade}`} detalhe={`${formatarMoeda(resumo.conferidos.centavos)} de ${formatarMoeda(resumo.total.centavos)}`} cor={resumo.concluida && resumo.divergentes.quantidade === 0 ? "verde" : undefined} />
          <Resumo titulo="Divergentes" valor={String(resumo.divergentes.quantidade)} detalhe={resumo.divergentes.quantidade === 0 ? "nenhum" : `${formatarMoeda(resumo.divergentes.centavos)} autorizados${resumo.diferencaCentavos !== 0 ? ` · diferença no banco ${resumo.diferencaCentavos > 0 ? "+" : "−"}${formatarMoeda(Math.abs(resumo.diferencaCentavos))}` : ""}`} cor={resumo.divergentes.quantidade > 0 ? "ambar" : undefined} />
          <Resumo titulo="Faltam conferir" valor={String(resumo.faltam.quantidade)} detalhe={resumo.faltam.quantidade === 0 ? "tudo conferido" : formatarMoeda(resumo.faltam.centavos)} />
          <Resumo titulo="Não pagos" valor={String(resumo.naoPagos.quantidade)} detalhe={resumo.naoPagos.quantidade === 0 ? "nenhum" : `${formatarMoeda(resumo.naoPagos.centavos)} · de volta à lista`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={campoBusca} autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={aoTeclar}
            placeholder="Buscar por valor (150 ou 1.234,56) ou fornecedor" aria-label="Buscar por valor ou fornecedor" className="max-w-sm" autoComplete="off"
          />
          {busca && <Button variant="ghost" size="sm" onClick={() => { setBusca(""); campoBusca.current?.focus(); }}>Limpar</Button>}
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por situação">
            {FILTROS.map((f) => (
              <Button key={f.valor} size="sm" variant={filtro === f.valor ? "default" : "outline"} onClick={() => setFiltro(f.valor)}>
                {f.rotulo} ({contagem[f.valor]})
              </Button>
            ))}
          </div>
        </div>
        {busca && visiveis.length === 1 && visiveis[0].situacao === null && podeMarcar && (
          <p className="text-xs text-muted-foreground">Enter marca “{visiveis[0].nome} · {formatarMoeda(visiveis[0].valorCentavos)}” como conferido.</p>
        )}
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {busca ? `Nada na autorização com “${busca}”. Se o pagamento está no banco e não aqui, ele não foi autorizado.` : "Nenhum item neste filtro."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Conferido</TableHead>
                <TableHead>{cabecalho("tipo", "Tipo")}</TableHead>
                <TableHead>{cabecalho("nome", "Fornecedor / favorecido")}</TableHead>
                <TableHead>{cabecalho("documento", "Documento")}</TableHead>
                <TableHead>{cabecalho("data", "Vencimento")}</TableHead>
                <TableHead className="text-right">{cabecalho("valor", "Valor", true)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const pendente = pendentes.has(l.id);
                const fundo = l.situacao ? FUNDO[l.situacao] : "";
                return [
                  <TableRow key={l.id} className={fundo}>
                    <TableCell>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox" className="size-5 accent-emerald-700" checked={l.situacao === "conferido"} disabled={!podeMarcar || pendente || l.situacao === "nao_pago"}
                          onChange={(e) => gravar(l, e.target.checked ? "conferido" : null)}
                          aria-label={`Conferido: ${l.nome} · ${formatarMoeda(l.valorCentavos)}`}
                        />
                        {pendente && <span className="text-[11px] text-muted-foreground">salvando…</span>}
                      </label>
                    </TableCell>
                    <TableCell className="text-xs">{ROTULO_TIPO_CONFERENCIA[l.tipo]}</TableCell>
                    <TableCell className="max-w-80">
                      <span className="block truncate" title={l.nome}>{l.nome}</span>
                      {l.situacao && (
                        <span className={`block text-[11px] ${COR_TEXTO[l.situacao]}`}>
                          {ROTULO_SITUACAO[l.situacao]}
                          {l.situacao === "divergente" && l.valorBancoCentavos !== null && ` · no banco ${formatarMoeda(l.valorBancoCentavos)}`}
                          {l.observacao && ` · ${l.observacao}`}
                          {l.conferidoPorNome && ` · por ${l.conferidoPorNome}`}{l.conferidoEm && l.conferidoEm !== "agora" && ` em ${l.conferidoEm}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64 truncate tabular-nums" title={l.documento}>{l.documento || "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(l.data) || "—"}</TableCell>
                    <TableCell className="text-right text-base font-semibold tabular-nums">{formatarMoeda(l.valorCentavos)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {podeMarcar && (l.situacao === "divergente" || l.situacao === "nao_pago"
                        ? <Button size="sm" variant="ghost" disabled={pendente} onClick={() => gravar(l, null)}>Desfazer</Button>
                        : (
                          <span className="inline-flex gap-1">
                            <Button size="sm" variant="outline" disabled={pendente} onClick={() => alternarEdicao(l.id, "divergente")}>Divergente</Button>
                            {podeMarcarNaoPago(l) && <Button size="sm" variant="outline" disabled={pendente} onClick={() => alternarEdicao(l.id, "nao_pago")}>Não pago</Button>}
                          </span>
                        ))}
                    </TableCell>
                  </TableRow>,
                  editando?.id === l.id && (
                    <TableRow key={`${l.id}-${editando.modo}`} className={FUNDO[editando.modo]}>
                      <TableCell colSpan={7}>
                        {editando.modo === "divergente" ? (
                          <FormDivergente
                            valorAutorizado={l.valorCentavos} pendente={pendente}
                            aoSalvar={(valor, obs) => gravar(l, "divergente", valor, obs)} aoCancelar={() => setEditando(null)}
                          />
                        ) : (
                          <FormNaoPago pendente={pendente} aoSalvar={(motivo) => gravar(l, "nao_pago", null, motivo)} aoCancelar={() => setEditando(null)} />
                        )}
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Resumo({ titulo, valor, detalhe, cor }: { titulo: string; valor: string; detalhe: string; cor?: "verde" | "ambar" }) {
  const borda = cor === "verde" ? "border-emerald-300 bg-emerald-50" : cor === "ambar" ? "border-amber-300 bg-amber-50" : "border-grade";
  return (
    <div className={`rounded-lg border p-3 ${borda}`}>
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-xl font-bold tabular-nums">{valor}</div>
      <div className="text-xs text-muted-foreground tabular-nums">{detalhe}</div>
    </div>
  );
}

function FormDivergente({ valorAutorizado, pendente, aoSalvar, aoCancelar }: { valorAutorizado: number; pendente: boolean; aoSalvar: (valorBancoCentavos: number | null, observacao: string | null) => void; aoCancelar: () => void }) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const lido = valor.trim() ? interpretarBusca(valor).centavos : null;
  const valorInvalido = valor.trim() !== "" && (lido === null || lido <= 0);
  const vazio = !valor.trim() && !obs.trim();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); if (!valorInvalido && !vazio) aoSalvar(lido, obs.trim() || null); }}
    >
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Valor no banco (autorizado {formatarMoeda(valorAutorizado)})</span>
        <Input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 152,30" inputMode="decimal" className="w-40" autoComplete="off" aria-invalid={valorInvalido} />
      </label>
      <label className="min-w-64 flex-1 space-y-1 text-xs">
        <span className="block text-muted-foreground">Observação</span>
        <Input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} placeholder="ex.: juros de atraso; boleto com desconto" autoComplete="off" />
      </label>
      <Button type="submit" size="sm" disabled={pendente || valorInvalido || vazio}>Marcar divergente</Button>
      <Button type="button" size="sm" variant="ghost" onClick={aoCancelar}>Cancelar</Button>
      {valorInvalido && <span className="w-full text-xs text-destructive">Valor inválido. Use o formato 1.234,56.</span>}
      {lido !== null && !valorInvalido && <span className="w-full text-xs text-muted-foreground">Diferença: {lido - valorAutorizado >= 0 ? "+" : "−"}{formatarMoeda(Math.abs(lido - valorAutorizado))}</span>}
    </form>
  );
}

function FormNaoPago({ pendente, aoSalvar, aoCancelar }: { pendente: boolean; aoSalvar: (motivo: string) => void; aoCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (motivo.trim()) aoSalvar(motivo.trim()); }}>
      <label className="min-w-64 flex-1 space-y-1 text-xs">
        <span className="block text-muted-foreground">Motivo de não ter sido pago</span>
        <Input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="ex.: sem saldo, fica para amanhã" autoComplete="off" />
      </label>
      <Button type="submit" size="sm" disabled={pendente || !motivo.trim()}>Marcar não pago</Button>
      <Button type="button" size="sm" variant="ghost" onClick={aoCancelar}>Cancelar</Button>
      <span className="w-full text-xs text-muted-foreground">
        O item continua nesta autorização como não pago e o título volta para a lista Autorizar pagamento (vencidos), enquanto estiver em aberto no Consistem.
      </span>
    </form>
  );
}
