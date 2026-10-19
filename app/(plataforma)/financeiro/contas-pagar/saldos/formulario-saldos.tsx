"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseSaldo, rotuloConta, type ContaCaixa } from "@/lib/modulos/financeiro/contas-pagar/caixa";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { definirContaCaixa, registrarSaldos } from "./acoes";

const paraTexto = (centavos: number | null) => (centavos === null ? "" : (centavos / 100).toFixed(2).replace(".", ","));

/**
 * Grade das contas da empresa com o campo do saldo conciliado na data escolhida (já preenchido quando há registro dessa data).
 * "Salvar saldos" grava só as linhas preenchidas. O gestor marca quais contas entram no caixa da autorização.
 */
export function FormularioSaldos({ empresaId, data, hoje, contas, saldosDaData, podeOperar, ehGestor }: {
  empresaId: string;
  data: string;
  hoje: string;
  contas: ContaCaixa[];
  /** Saldo ativo na data escolhida, por conta (centavos). */
  saldosDaData: Record<string, number>;
  podeOperar: boolean;
  ehGestor: boolean;
}) {
  const router = useRouter();
  const [textos, setTextos] = useState<Record<string, string>>(() => Object.fromEntries(contas.map((c) => [c.id, paraTexto(saldosDaData[c.id] ?? null)])));
  const [erro, setErro] = useState<string>();
  const [salvando, iniciar] = useTransition();
  const [alterando, iniciarAlterar] = useTransition();

  const invalidas = contas.filter((c) => (textos[c.id] ?? "").trim() !== "" && parseSaldo(textos[c.id]) === null);
  const preenchidas = contas.filter((c) => (textos[c.id] ?? "").trim() !== "" && parseSaldo(textos[c.id]) !== null);
  const totalPreenchido = preenchidas.filter((c) => c.entraNoCaixa).reduce((s, c) => s + (parseSaldo(textos[c.id]) ?? 0), 0);

  function salvar() {
    if (invalidas.length > 0) {
      setErro(`Saldo inválido em ${invalidas.map((c) => c.descricao).join(", ")}: use números, ex.: 15.234,56 ou -1.200,00.`);
      return;
    }
    if (preenchidas.length === 0) {
      setErro("Preencha o saldo de pelo menos uma conta.");
      return;
    }
    setErro(undefined);
    iniciar(async () => {
      const r = await registrarSaldos({ empresaId, data, saldos: preenchidas.map((c) => ({ contaId: c.id, saldoCentavos: parseSaldo(textos[c.id]) ?? 0 })) });
      if (r.ok) {
        toast.success(r.aviso);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  const alternarCaixa = (c: ContaCaixa) => iniciarAlterar(async () => {
    const r = await definirContaCaixa({ contaId: c.id, entra: !c.entraNoCaixa });
    if (r.ok) { toast.success(r.aviso); router.refresh(); } else toast.error(r.erro);
  });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entra no caixa</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Último saldo</TableHead>
              <TableHead className="text-right">Saldo em {formatarData(data)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contas.map((c) => (
              <TableRow key={c.id} className={c.entraNoCaixa ? undefined : "opacity-70"}>
                <TableCell>
                  {ehGestor
                    ? <input type="checkbox" className="size-4" aria-label={`${c.descricao} entra no caixa`} checked={c.entraNoCaixa} disabled={alterando} onChange={() => alternarCaixa(c)} />
                    : c.entraNoCaixa ? "Sim" : "Não"}
                </TableCell>
                <TableCell>{rotuloConta(c)}</TableCell>
                <TableCell className={`tabular-nums ${c.dataSaldo && c.dataSaldo < hoje ? "text-amber-800" : ""}`}>
                  {c.saldoCentavos === null ? "—" : `${formatarMoeda(c.saldoCentavos)} em ${formatarData(c.dataSaldo)}`}
                </TableCell>
                <TableCell className="text-right">
                  {podeOperar
                    ? <Input value={textos[c.id] ?? ""} onChange={(e) => setTextos((t) => ({ ...t, [c.id]: e.target.value }))} inputMode="decimal" placeholder="R$ 0,00" aria-label={`Saldo de ${c.descricao}`} className="ml-auto h-8 w-40 text-right tabular-nums" />
                    : <span className="tabular-nums">{saldosDaData[c.id] === undefined ? "—" : formatarMoeda(saldosDaData[c.id])}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {podeOperar && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : `Salvar saldos de ${formatarData(data)}`}</Button>
          <span className="text-sm text-muted-foreground tabular-nums">Contas que entram no caixa, preenchidas: {formatarMoeda(totalPreenchido)}</span>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
