"use client";

// Compra parcelada cuja NF foi lançada pelo valor cheio (regras 61 a 64): o par linha "1/N" × título, a prévia das parcelas e o
// botão "Desdobrar no Consistem" (o título vira a parcela 1 e o painel cria as parcelas 2 a N). Também o registro, pelo gestor,
// de um título lançado pelo painel que foi excluído no Consistem (duplicidade).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHead, TableHeader } from "@/components/ui/table";
import type { ADesdobrar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { previaDesdobramento } from "@/lib/modulos/financeiro/cartao/desdobramento";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { desdobrarNoConsistem, registrarExclusaoErp, resolverDesdobramento } from "../acoes";
import type { DesdobramentoLinha, LancamentoErpLinha, QuadroDesdobrar as DadosDesdobrar } from "../dados";

const centavos = (v: number | string) => Math.round(Number(v) * 100);
const cod = (p: ADesdobrar) => p.titulo.codLancamento ?? p.titulo.id.replace(/^api:/, "");

export function QuadroDesdobrar({ pares, dados, faturaId, podeOperar }: { pares: ADesdobrar[]; dados: DadosDesdobrar; faturaId: string | null; podeOperar: boolean }) {
  const comErro = dados.desdobramentos.filter((d) => d.situacao === "erro"
    && !dados.desdobramentos.some((x) => x.linha_id === d.linha_id && x.situacao !== "erro"));
  const feitos = dados.desdobramentos.filter((d) => d.situacao === "alterado");
  if (pares.length === 0 && comErro.length === 0 && feitos.length === 0) return null;
  const pode = podeOperar && faturaId !== null && dados.ligado && dados.mesAberto;
  const ultimoErro = (linha: string) => comErro.find((d) => d.linha_id === linha);
  return (
    <section className={`space-y-3 rounded-[3px] border p-3 ${pares.length ? "border-amber-300 bg-amber-50/60" : "border-grade bg-card"}`}>
      <h3 className="text-sm font-bold">Compras parceladas lançadas pelo total no Consistem</h3>
      {pares.length > 0 && (
        <p className="text-sm">
          A fatura cobra uma parcela, mas a NF está no Consistem pelo valor da compra inteira. Não lance de novo: <strong>desdobre</strong>.
          Parcela 1: o título vira a parcela 1 e o painel cria as seguintes. Parcela 2 em diante (NF lançada em outro mês): o título fica com as
          parcelas já pagas, para baixar à mão, e o painel cria da parcela desta fatura em diante. A última parcela fica com o arredondamento.
          {!dados.ligado && " O desdobramento no Consistem está desligado (Configurações): desdobre à mão no Consistem."}
        </p>
      )}
      {pares.map((p) => {
        const previa = previaDesdobramento({ par: p, cartao: dados.cartao, competencia: dados.competencia, vencimentoFatura: dados.vencimentoFatura });
        const k = Math.max(1, p.parcelaInicial ?? 1);
        const erro = ultimoErro(p.linha.id);
        return (
          <div key={p.linha.id} className="space-y-2 rounded-[3px] border border-grade bg-card p-3">
            <p className="text-sm">
              <strong>{p.linha.descricao}</strong> · {formatarData(p.linha.dataCompra)} · parcela {k}/{p.parcelas} de {formatarMoeda(p.parcelaCentavos)}
              {" "}× título <strong>{cod(p)}</strong> (documento {p.titulo.numeroTitulo}, {p.titulo.fornecedor}, vencimento {formatarData(p.titulo.vencimento)}) de {formatarMoeda(p.titulo.valorCentavos)}
              {p.diferencaCentavos !== 0 && <span className="text-muted-foreground"> · arredondamento de {formatarMoeda(p.diferencaCentavos)} na última parcela</span>}
              {p.titulo.emBordero && <Badge variant="outline" className="ml-1 border-red-300 text-red-800">em borderô: desdobre à mão</Badge>}
              {p.foraDaJanela && <Badge variant="outline" className="ml-1 border-amber-400 text-amber-800">NF lançada em {formatarData(p.titulo.vencimento)} (fora da janela)</Badge>}
            </p>
            <Table className="w-full text-sm [&_td]:px-2 [&_td]:py-0.5 [&_th]:px-2">
              <TableHeader><tr className="text-left text-xs text-muted-foreground"><TableHead>Parcela</TableHead><TableHead>Vencimento</TableHead><TableHead>Documento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Complemento</TableHead><TableHead /></tr></TableHeader>
              <TableBody>
                {previa.map((x) => (
                  <tr key={x.documento}>
                    <td className="tabular-nums">{x.parcela === 0 ? `1-${k - 1}` : x.parcela}/{p.parcelas}</td><td className="tabular-nums">{x.vencimento ? formatarData(x.vencimento) : "—"}</td>
                    <td className="tabular-nums">{x.documento}</td><td className="text-right tabular-nums">{formatarMoeda(x.valorCentavos)}</td>
                    <td className="font-mono text-xs">{x.complemento}</td>
                    <td className="text-xs text-muted-foreground">{x === previa[0] ? (k > 1 ? `altera o título ${cod(p)} (já pagas: baixar à mão)` : `altera o título ${cod(p)}`) : "título novo"}</td>
                  </tr>
                ))}
              </TableBody>
            </Table>
            {erro && <ErroDesdobramento d={erro} pode={pode} />}
            {pode && !p.titulo.emBordero && <BotaoDesdobrar faturaId={faturaId!} par={p} />}
          </div>
        );
      })}
      {comErro.filter((d) => !pares.some((p) => p.linha.id === d.linha_id)).map((d) => <ErroDesdobramento key={d.id} d={d} pode={pode} />)}
      {feitos.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {feitos.map((d) => (
            <li key={d.id}>
              Título {d.cod_lancamento}{d.num_documento ? ` (documento ${d.num_documento})` : ""}{d.fornecedor ? `, ${d.fornecedor}` : ""}: {formatarMoeda(centavos(d.valor_original))} desdobrado em {d.parcelas} parcelas de {formatarMoeda(centavos(d.valor_parcela))} em {new Date(d.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })}
              {d.motivo_resolucao ? ` (conferido à mão: ${d.motivo_resolucao})` : ""}. As parcelas estão em “Compras lançadas no Consistem pelo painel”.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BotaoDesdobrar({ faturaId, par }: { faturaId: string; par: ADesdobrar }) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState(false);
  const [pendente, iniciar] = useTransition();
  function enviar() {
    iniciar(async () => {
      const r = await desdobrarNoConsistem({ faturaId, linhaId: par.linha.id, codLancamento: cod(par) });
      if (r.ok) toast.success(r.aviso); else toast.error(r.erro, { duration: 15_000 });
      setConfirmar(false);
      router.refresh();
    });
  }
  return confirmar ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Alterar o título {cod(par)} para {formatarMoeda(par.parcelaCentavos)} e criar {par.parcelas - 1} títulos no Consistem?</span>
      <Button size="sm" onClick={enviar} disabled={pendente}>{pendente ? "Desdobrando…" : "Confirmar o desdobramento"}</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)} disabled={pendente}>Voltar</Button>
    </div>
  ) : (
    <Button size="sm" onClick={() => setConfirmar(true)}>Desdobrar no Consistem</Button>
  );
}

function ErroDesdobramento({ d, pode }: { d: DesdobramentoLinha; pode: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function enviar() {
    iniciar(async () => {
      const r = await resolverDesdobramento({ id: d.id, motivo });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
    });
  }
  return (
    <div className="space-y-1 rounded-[3px] border border-red-300 bg-red-50 p-2 text-sm">
      <p><strong>O desdobramento do título {d.cod_lancamento} não foi concluído:</strong> {d.erro}</p>
      {pode && (
        <Button size="sm" variant="outline" onClick={() => { setMotivo(""); setErro(undefined); setAberto(true); }}>Já está alterado no Consistem</Button>
      )}
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>O título já está com a parcela 1?</DialogTitle>
              <DialogDescription>
                Confira no Consistem o título {d.cod_lancamento}: se ele já está com {formatarMoeda(centavos(d.valor_parcela))} (e o documento terminado em /1), registre aqui.
                Depois use “Reenviar o que faltou” para criar as parcelas 2 a {d.parcelas}. Se ainda está com o valor cheio, feche e use “Desdobrar no Consistem” de novo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="O que foi conferido (ex.: título com R$ 499,13 no CCFFB010)" autoComplete="off" />
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button onClick={enviar} disabled={pendente || motivo.trim().length < 3}>{pendente ? "Registrando…" : "Já está alterado"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Gestor: registra que o título lançado pelo painel foi excluído no Consistem (ex.: duplicava a NF). */
export function BotaoExcluidoNoConsistem({ l }: { l: LancamentoErpLinha }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function enviar() {
    iniciar(async () => {
      const r = await registrarExclusaoErp({ id: l.id, motivo });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
    });
  }
  return (
    <>
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setMotivo(""); setErro(undefined); setAberto(true); }}>Excluído no Consistem</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Registrar a exclusão do título {l.cod_lancamento_erp} no Consistem</DialogTitle>
              <DialogDescription>
                Use só depois de excluir o título no Consistem. O painel não exclui nada no ERP: aqui fica registrado quem, quando e por quê, e o título deixa de contar como lançado pelo painel.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Motivo (ex.: duplicava a NF 3615152)" autoComplete="off" />
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button onClick={enviar} disabled={pendente || motivo.trim().length < 10}>{pendente ? "Registrando…" : "Registrar a exclusão"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
