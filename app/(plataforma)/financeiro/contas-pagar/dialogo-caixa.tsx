"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compararComCaixa, parseReais } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { comporCaixa, rotuloConta, validarAdicional, type Composicao, type ContaCaixa } from "@/lib/modulos/financeiro/contas-pagar/caixa";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";

type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/**
 * Botão + diálogo "Composição do caixa": marca as contas da empresa cujo saldo conciliado entra (último saldo registrado em
 * Saldos bancários) e inclui valores adicionais do dia (depósitos esperados, ainda sem registro), com descrição.
 * Usado na tela Autorizar pagamento (só ajusta a composição; grava junto com Salvar parcial/Extras/Gerar) e na página da
 * autorização em rascunho (grava na hora). Ao gravar, o banco lê os saldos de novo: a tela é só a prévia.
 */
export function BotaoComposicaoCaixa({ empresaId, contas, composicao, hoje, totalCentavos, rotulo = "Composição", desativado = false, aoConfirmar }: {
  empresaId: string;
  contas: ContaCaixa[];
  composicao: Composicao;
  hoje: string;
  /** Total que se compara com o caixa (marcados + rascunho, ou o total da autorização). */
  totalCentavos: number;
  rotulo?: string;
  desativado?: boolean;
  /** Sem retorno = só aplica na tela; com retorno = gravou no banco (fecha e recarrega se ok). */
  aoConfirmar: (c: Composicao) => void | Promise<Resultado>;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Composicao>(composicao);
  const [descricao, setDescricao] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const caixa = comporCaixa(contas, rascunho, hoje);
  const comparacao = compararComCaixa(totalCentavos, caixa.linhas.length + caixa.adicionais.length > 0 ? caixa.totalCentavos : null);
  const marcadas = new Set(rascunho.contas);

  function abrir() {
    setRascunho(composicao); setDescricao(""); setValorTexto(""); setErro(undefined); setAberto(true);
  }
  const alternarConta = (id: string) =>
    setRascunho((r) => ({ ...r, contas: marcadas.has(id) ? r.contas.filter((c) => c !== id) : [...r.contas, id] }));
  function adicionar() {
    const valorCentavos = parseReais(valorTexto);
    const problema = validarAdicional({ descricao, valorCentavos });
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(undefined);
    setRascunho((r) => ({ ...r, adicionais: [...r.adicionais, { descricao: descricao.trim(), valorCentavos: valorCentavos ?? 0 }] }));
    setDescricao(""); setValorTexto("");
  }
  const removerAdicional = (indice: number) => setRascunho((r) => ({ ...r, adicionais: r.adicionais.filter((_, i) => i !== indice) }));

  function confirmar() {
    if (descricao.trim() !== "" || valorTexto.trim() !== "") {
      setErro("Há um valor adicional digitado e não incluído: clique em “Adicionar” ou limpe os campos.");
      return;
    }
    const r = aoConfirmar(rascunho);
    if (!r) {
      setAberto(false);
      return;
    }
    iniciar(async () => {
      const res = await r;
      if (res.ok) {
        toast.success(res.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(res.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={abrir} disabled={desativado}>{rotulo}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Composição do caixa disponível</DialogTitle>
              <DialogDescription>
                Saldo conciliado das contas marcadas (último registrado em{" "}
                <Link href={`${ROTA_CONTAS_PAGAR}/saldos?empresa=${empresaId}`} className="text-elo hover:underline">Saldos bancários</Link>) mais os valores do dia
                que ainda não estão no sistema. Os saldos são lidos de novo ao gravar.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              {contas.length === 0 ? (
                <p className="rounded-[3px] border border-grade bg-marca-clara p-3 text-sm">
                  Nenhuma conta bancária desta empresa ainda. As contas vêm do Consistem na atualização do contas a pagar; depois registre os saldos em{" "}
                  <Link href={`${ROTA_CONTAS_PAGAR}/saldos?empresa=${empresaId}`} className="text-elo hover:underline">Saldos bancários</Link>.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-[3px] border border-grade">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Conta</TableHead>
                        <TableHead>Data do saldo</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contas.map((c) => (
                        <TableRow key={c.id} className={marcadas.has(c.id) ? undefined : "opacity-60"}>
                          <TableCell><input type="checkbox" className="size-4" aria-label={`Somar ${c.descricao}`} checked={marcadas.has(c.id)} onChange={() => alternarConta(c.id)} /></TableCell>
                          <TableCell>{rotuloConta(c)}</TableCell>
                          <TableCell className={`tabular-nums ${c.dataSaldo && c.dataSaldo < hoje ? "text-amber-800" : ""}`}>{c.dataSaldo ? formatarData(c.dataSaldo) : "sem saldo"}</TableCell>
                          <TableCell className={`text-right tabular-nums ${(c.saldoCentavos ?? 0) < 0 ? "text-red-700" : ""}`}>{c.saldoCentavos === null ? "—" : formatarMoeda(c.saldoCentavos)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {caixa.avisos.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                  {caixa.avisos.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}

              <div className="grid gap-2">
                <p className="text-sm font-medium">Valores adicionais do dia</p>
                {rascunho.adicionais.length > 0 && (
                  <ul className="divide-y divide-grade rounded-[3px] border border-grade text-sm">
                    {rascunho.adicionais.map((a, i) => (
                      <li key={`${a.descricao}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="flex-1">{a.descricao}</span>
                        <span className="tabular-nums">{formatarMoeda(a.valorCentavos)}</span>
                        <Button type="button" variant="ghost" size="xs" onClick={() => removerAdicional(i)}>Remover</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder="Ex.: depósito previsto cliente X" aria-label="Descrição do valor adicional" className="min-w-56 flex-1" />
                  <Input value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" aria-label="Valor adicional" className="w-36 text-right tabular-nums" />
                  <Button type="button" variant="outline" size="sm" onClick={adicionar}>Adicionar</Button>
                </div>
              </div>

              <div className="grid gap-0.5 rounded-[3px] border border-grade bg-marca-clara px-3 py-2 text-sm tabular-nums">
                <span>Saldos das contas: {formatarMoeda(caixa.saldosCentavos)}</span>
                <span>Adicionais do dia: {formatarMoeda(caixa.adicionaisCentavos)}</span>
                <strong>Caixa disponível: {formatarMoeda(caixa.totalCentavos)}</strong>
                {comparacao && (comparacao.ultrapassa
                  ? <span className="font-bold text-red-700">Total {formatarMoeda(totalCentavos)} ultrapassa o caixa em {formatarMoeda(comparacao.excedenteCentavos)}</span>
                  : <span className="font-bold text-emerald-700">Total {formatarMoeda(totalCentavos)} · sobra {formatarMoeda(comparacao.sobraCentavos)}</span>)}
              </div>

              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Salvando…" : "Confirmar composição"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
