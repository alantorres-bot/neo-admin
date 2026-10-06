"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { marcarNaAkf } from "./acoes";

export type LinhaAkf = {
  id: string;
  documento: string;
  cliente: string;
  unidade: "matriz" | "contagem";
  vencimento: string; // já formatado
  atraso: string;
  vencido: boolean;
  valor: string; // já formatado
  portador: string;
  naAkf: boolean;
  semBoleto: boolean;
};

/**
 * Lista de títulos da AKF com seleção. "Disponíveis" oferece "Marcar como na AKF"; as listas de títulos na AKF oferecem
 * "Retirar da AKF". Só marca à mão quem é operador; o portador 998 do Consistem marca sozinho na sincronização.
 */
export function TabelaAkf({ linhas, podeOperar, acao }: { linhas: LinhaAkf[]; podeOperar: boolean; acao: "marcar" | "retirar" }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function aplicar() {
    iniciar(async () => {
      const r = await marcarNaAkf({ ids: [...marcadas], cedido: acao === "marcar", observacao });
      if (r.ok) {
        toast.success(r.aviso);
        setMarcadas(new Set());
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  const todas = linhas.length > 0 && marcadas.size === linhas.length;
  return (
    <div className="space-y-3">
      {podeOperar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pendente || marcadas.size === 0} onClick={aplicar}>
            {pendente ? "Salvando…" : acao === "marcar" ? `Marcar como na AKF (${marcadas.size})` : `Retirar da AKF (${marcadas.size})`}
          </Button>
          <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (opcional), ex.: operação de 06/10" aria-label="Observação" maxLength={300} className="h-8 w-80" />
          <span className="text-xs text-muted-foreground">
            {acao === "marcar" ? "Use quando o portador ainda não mudou para 998 no Consistem." : "Use quando o título voltou para a Neo (recompra ou liquidação)."}
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table>
          <TableHeader>
            <TableRow>
              {podeOperar && (
                <TableHead className="w-8">
                  <input type="checkbox" className="size-4" aria-label="Marcar todos" checked={todas} onChange={() => setMarcadas(todas ? new Set() : new Set(linhas.map((l) => l.id)))} />
                </TableHead>
              )}
              <TableHead>Documento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Atraso</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Portador</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id}>
                {podeOperar && (
                  <TableCell>
                    <input type="checkbox" className="size-4" aria-label={`Marcar ${l.documento}`} checked={marcadas.has(l.id)} onChange={() => alternar(l.id)} />
                  </TableCell>
                )}
                <TableCell className="font-medium tabular-nums">
                  <Link href={`/financeiro/recebiveis/${l.id}`} className="hover:underline">{l.documento}</Link>
                  {l.unidade === "contagem" && <Badge variant="outline" className="ml-1.5 align-middle">Contagem</Badge>}
                </TableCell>
                <TableCell className="max-w-72 truncate" title={l.cliente}>{l.cliente}</TableCell>
                <TableCell className="tabular-nums">{l.vencimento}</TableCell>
                <TableCell className={l.vencido ? "font-medium text-red-700" : "text-muted-foreground"}>{l.atraso}</TableCell>
                <TableCell className="text-right tabular-nums">{l.valor}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{l.portador}</TableCell>
                <TableCell className="space-x-1">
                  <Badge className={l.naAkf ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}>{l.naAkf ? "Na AKF" : "Disponível"}</Badge>
                  {l.semBoleto && <Badge variant="outline" title="Operar 1 dia após o vencimento, sem emitir boleto">Sem boleto</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
