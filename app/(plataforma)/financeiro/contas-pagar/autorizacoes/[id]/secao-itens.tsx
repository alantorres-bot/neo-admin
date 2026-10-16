"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { situacaoDoItem } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { alternarOrdem, ordenar, type ColunaItens, type Ordem } from "@/lib/modulos/financeiro/contas-pagar/ordenacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import type { LinhaItemAutorizacao } from "../../dados";
import { CabecalhoOrdenavel } from "../../cabecalho-ordenavel";
import { BotaoRemoverItem } from "./componentes";

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));

/**
 * Tabela de Títulos ou de Antecipações da autorização: Fornecedor · Documento · Vencimento/Pagamento programado · Histórico
 * · Valor (· Remover em rascunho). Clicar no título da coluna ordena (estado local). Sob o valor, uma linha pequena só quando
 * há algo a dizer: "baixado no Consistem em dd/mm" ou "já paga (tem borderô)". (A confirmação CCFFB014 saiu em 13/10/2026: o
 * Consistem passou a "Sem Controle" na CCFFB000.)
 */
export function SecaoItens({ titulo, lista, total, autorizacaoId, podeRemover }: { titulo: string; lista: LinhaItemAutorizacao[]; total: number; autorizacaoId: string; podeRemover: boolean }) {
  const [ordem, setOrdem] = useState<Ordem<ColunaItens> | null>(null);
  const antecipacoes = titulo === "Antecipações";
  const dataDe = (i: LinhaItemAutorizacao) => (i.tipo === "titulo" ? i.data_vencimento : i.data_pagamento);
  const ordenados = ordenar(lista, ordem, (i, coluna) => {
    switch (coluna) {
      case "fornecedor": return i.fornecedor_nome;
      case "documento": return i.num_documento || null;
      case "data": return dataDe(i);
      case "historico": return i.complemento_historico || null;
      case "valor": return centavos(i.valor);
    }
  });
  const cabecalho = (coluna: ColunaItens, rotulo: string, alinharDireita = false) => (
    <CabecalhoOrdenavel rotulo={rotulo} direcao={ordem?.coluna === coluna ? ordem.direcao : null} aoClicar={() => setOrdem(alternarOrdem(ordem, coluna))} alinharDireita={alinharDireita} />
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold">{titulo}</h3>
        <span className="text-sm tabular-nums">{lista.length} {lista.length === 1 ? "item" : "itens"} · <strong>{formatarMoeda(total)}</strong></span>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>{cabecalho("fornecedor", "Fornecedor")}</TableHead>
                <TableHead>{cabecalho("documento", "Documento")}</TableHead>
                <TableHead>{cabecalho("data", antecipacoes ? "Pagamento programado" : "Vencimento")}</TableHead>
                <TableHead>{cabecalho("historico", "Histórico")}</TableHead>
                <TableHead className="text-right">{cabecalho("valor", "Valor", true)}</TableHead>
                {podeRemover && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenados.map((i) => {
                const naoPago = i.conferencia_banco === "nao_pago";
                const jaPaga = !naoPago && i.tipo === "antecipacao" && i.tem_bordero === true && !i.baixado_consistem_em;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="max-w-80"><span className="block truncate" title={i.fornecedor_nome}>{i.fornecedor_nome}</span></TableCell>
                    <TableCell className="tabular-nums">{i.num_documento || "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(dataDe(i)) || "—"}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={i.complemento_historico ?? ""}>{i.complemento_historico || "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatarMoeda(centavos(i.valor))}
                      {jaPaga && <span className="block text-[11px] font-normal text-red-700">já paga (tem borderô)</span>}
                      {naoPago && <span className="block text-[11px] font-normal text-muted-foreground" title={i.observacao_conferencia ?? ""}>não pago no banco · voltou para a lista</span>}
                      {!jaPaga && !naoPago && i.baixado_consistem_em && <span className="block text-[11px] font-normal text-emerald-700">{situacaoDoItem({ removido: false, baixadoConsistemEm: i.baixado_consistem_em, tipo: i.tipo })} em {formatarData(i.baixado_consistem_em)}</span>}
                    </TableCell>
                    {podeRemover && (
                      <TableCell className="text-right"><BotaoRemoverItem autorizacaoId={autorizacaoId} itemId={i.id} descricao={`${i.fornecedor_nome} · ${i.num_documento || i.cod_lancamento} · ${formatarMoeda(centavos(i.valor))}`} /></TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
