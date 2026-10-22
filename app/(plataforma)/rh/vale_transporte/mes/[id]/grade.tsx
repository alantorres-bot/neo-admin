"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { calcularItem } from "@/lib/modulos/rh/vale-transporte/calculo";
import { FORMAS_PAGAMENTO, ROTULO_FORMA, type FormaPagamento } from "@/lib/modulos/rh/vale-transporte/modulo";
import { atualizarDoCadastro, definirDiasUteis, salvarItens, type ItemEditado } from "../acoes";
import type { ItemLinha } from "../../dados";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const lerReais = (t: string) => {
  const n = Number(t.replace(/R\$|\s|\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const NUM = "h-7 w-12 px-1 text-right tabular-nums";
const SELECAO = "h-7 rounded-[3px] border border-input bg-white px-1 text-[12px]";
const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/").slice(0, 5) : "");

type Editavel = Pick<ItemLinha, "forma_pagamento" | "dias_uteis" | "faltas" | "atestados" | "extras" | "abat_dias" | "ferias_inicio" | "ferias_fim" |
  "afastamento_inicio" | "afastamento_fim" | "abat_motivo" | "sem_vt" | "sem_vt_motivo" | "observacao"> & { abat_valor_texto: string };

const editavelDe = (i: ItemLinha): Editavel => ({
  forma_pagamento: i.forma_pagamento, dias_uteis: i.dias_uteis, faltas: i.faltas, atestados: i.atestados, extras: i.extras, abat_dias: i.abat_dias,
  ferias_inicio: i.ferias_inicio, ferias_fim: i.ferias_fim, afastamento_inicio: i.afastamento_inicio, afastamento_fim: i.afastamento_fim,
  abat_motivo: i.abat_motivo, sem_vt: i.sem_vt, sem_vt_motivo: i.sem_vt_motivo, observacao: i.observacao,
  abat_valor_texto: i.abat_valor ? i.abat_valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "",
});
const paraEnvio = (id: string, e: Editavel): ItemEditado => ({
  id, forma_pagamento: e.forma_pagamento === "fopag" ? "fopag" : "pix", dias_uteis: e.dias_uteis, faltas: e.faltas, atestados: e.atestados, extras: e.extras, abat_dias: e.abat_dias,
  ferias_inicio: e.ferias_inicio || null, ferias_fim: e.ferias_fim || null, afastamento_inicio: e.afastamento_inicio || null, afastamento_fim: e.afastamento_fim || null,
  abat_valor: e.abat_valor_texto ? lerReais(e.abat_valor_texto) : 0, abat_motivo: e.abat_motivo?.trim() || null,
  sem_vt: e.sem_vt, sem_vt_motivo: e.sem_vt_motivo?.trim() || null, observacao: e.observacao?.trim() || null,
});

/** Grade do mês: uma linha por pessoa; recalcula na tela (mesma conta do banco) e grava as linhas alteradas de uma vez. */
export function GradeMes({ mesId, competencia, editavel, diasPadrao, itens }: { mesId: string; competencia: string; editavel: boolean; diasPadrao: number; itens: ItemLinha[] }) {
  const router = useRouter();
  const [mudancas, setMudancas] = useState<Record<string, Editavel>>({});
  const [ocorrencias, setOcorrencias] = useState<string | null>(null);
  const [dias, setDias] = useState(String(diasPadrao));
  const [pendente, iniciar] = useTransition();

  const alterar = (i: ItemLinha, m: Partial<Editavel>) => setMudancas((x) => ({ ...x, [i.id]: { ...(x[i.id] ?? editavelDe(i)), ...m } }));
  const numero = (i: ItemLinha, campo: "dias_uteis" | "faltas" | "atestados" | "extras" | "abat_dias", texto: string) => {
    const n = Number(texto);
    alterar(i, { [campo]: Number.isInteger(n) && n >= 0 && n <= 31 ? n : 0 });
  };

  const linhas = useMemo(() => itens.map((i) => {
    const e = mudancas[i.id] ?? editavelDe(i);
    const abat = e.abat_valor_texto ? lerReais(e.abat_valor_texto) : 0;
    const r = calcularItem({ competencia, tarifa: i.tarifa, valor_fixo: i.valor_fixo, passagens_dia: i.passagens_dia, ...e, abat_valor: Number.isNaN(abat) ? 0 : abat });
    return { i, e, r, alterado: !!mudancas[i.id], abatInvalido: Number.isNaN(abat) };
  }), [itens, mudancas, competencia]);

  const totais = useMemo(() => {
    const porGrupo = new Map<string, number>();
    let total = 0;
    for (const { i, e, r } of linhas) {
      const c = Math.round(r.valor * 100);
      total += c;
      for (const g of [`Empresa: ${i.empregador}`, `Pagamento: ${ROTULO_FORMA[e.forma_pagamento]}`]) porGrupo.set(g, (porGrupo.get(g) ?? 0) + c);
    }
    return { total, grupos: [...porGrupo.entries()].sort() };
  }, [linhas]);

  const alteradas = linhas.filter((l) => l.alterado);
  const salvar = () => iniciar(async () => {
    if (alteradas.some((l) => l.abatInvalido)) { toast.error("Abatimento em R$ inválido em alguma linha."); return; }
    const r = await salvarItens(mesId, alteradas.map((l) => paraEnvio(l.i.id, l.e)), Object.fromEntries(alteradas.map((l) => [l.i.id, l.i.nome])));
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Gravado.");
    setMudancas({});
    router.refresh();
  });
  const aplicarDias = () => iniciar(async () => {
    if (alteradas.length) { toast.error("Salve as alterações da grade antes de mudar os dias úteis do mês."); return; }
    const r = await definirDiasUteis(mesId, Number(dias));
    if (!r.ok) toast.error(r.erro); else { toast.success("Dias úteis do mês atualizados."); router.refresh(); }
  });
  const doCadastro = () => iniciar(async () => {
    if (alteradas.length) { toast.error("Salve as alterações da grade antes de atualizar do cadastro."); return; }
    const r = await atualizarDoCadastro(mesId);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Atualizado."); router.refresh(); }
  });

  const emEdicao = ocorrencias ? linhas.find((l) => l.i.id === ocorrencias) : undefined;

  return (
    <div className="space-y-3">
      {editavel && (
        <div className="flex flex-wrap items-end gap-3 rounded-[3px] border border-grade bg-cabecalho p-3">
          <div className="grid gap-1">
            <Label htmlFor="diasMes" className="text-xs">Dias úteis do mês</Label>
            <div className="flex gap-2">
              <Input id="diasMes" type="number" min={0} max={31} value={dias} onChange={(e) => setDias(e.target.value)} className="h-8 w-16" />
              <Button variant="outline" size="sm" onClick={aplicarDias} disabled={pendente || Number(dias) === diasPadrao}>Aplicar a todos</Button>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={doCadastro} disabled={pendente}><RefreshCw /> Atualizar do cadastro</Button>
          <div className="ml-auto flex items-center gap-3">
            {alteradas.length > 0 && <span className="text-sm text-amber-700">{alteradas.length} linha(s) alterada(s) sem salvar</span>}
            <Button onClick={salvar} disabled={pendente || alteradas.length === 0}><Save /> {pendente ? "Salvando…" : "Salvar"}</Button>
          </div>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead>Empresa</TableHead><TableHead>Pagamento</TableHead>
            <TableHead className="text-right">Dias úteis</TableHead><TableHead className="text-right">Faltas</TableHead><TableHead className="text-right">Atestados</TableHead>
            <TableHead className="text-right">Extras</TableHead><TableHead className="text-right">Abat. dias</TableHead><TableHead className="text-right">Abat. R$</TableHead>
            <TableHead>Ocorrências</TableHead><TableHead className="text-right">Dias pagos</TableHead><TableHead className="text-right">Passagem</TableHead><TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map(({ i, e, r, alterado, abatInvalido }) => (
            <TableRow key={i.id} className={e.sem_vt ? "text-muted-foreground" : alterado ? "bg-amber-50" : ""}>
              <TableCell className="tabular-nums">{i.cod_fornecedor}</TableCell>
              <TableCell className="font-medium">{i.nome}</TableCell>
              <TableCell className="text-xs">{i.empregador}</TableCell>
              <TableCell>
                {editavel ? (
                  <select aria-label={`Pagamento de ${i.nome}`} value={e.forma_pagamento} onChange={(x) => alterar(i, { forma_pagamento: x.target.value as FormaPagamento })} className={SELECAO}>
                    {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
                  </select>
                ) : ROTULO_FORMA[e.forma_pagamento]}
              </TableCell>
              {(["dias_uteis", "faltas", "atestados", "extras", "abat_dias"] as const).map((campo) => (
                <TableCell key={campo} className="text-right tabular-nums">
                  {editavel ? (
                    <Input aria-label={`${campo} de ${i.nome}`} type="number" min={0} max={31} value={e[campo] || (campo === "dias_uteis" ? 0 : "")}
                      onChange={(x) => numero(i, campo, x.target.value)} className={`${NUM} ml-auto`} />
                  ) : (e[campo] || "")}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                {editavel ? (
                  <Input aria-label={`Abatimento em R$ de ${i.nome}`} inputMode="decimal" value={e.abat_valor_texto} onChange={(x) => alterar(i, { abat_valor_texto: x.target.value })}
                    aria-invalid={abatInvalido} className="ml-auto h-7 w-20 px-1 text-right tabular-nums" />
                ) : (i.abat_valor ? reais(i.abat_valor) : "")}
              </TableCell>
              <TableCell>
                <button type="button" onClick={() => setOcorrencias(i.id)} className="flex items-center gap-1 text-left text-xs text-elo hover:underline">
                  <ClipboardList className="size-3.5 shrink-0" />
                  <span>{[
                    e.ferias_inicio && `Férias ${dataBr(e.ferias_inicio)}–${dataBr(e.ferias_fim)} (${r.dias_ferias}d)`,
                    e.afastamento_inicio && `Afast. ${dataBr(e.afastamento_inicio)}–${dataBr(e.afastamento_fim)} (${r.dias_afastamento}d)`,
                    e.sem_vt && `Sem VT: ${e.sem_vt_motivo ?? ""}`,
                    e.abat_motivo && `Abat.: ${e.abat_motivo}`,
                    e.observacao && "Obs.",
                  ].filter(Boolean).join(" · ") || (editavel ? "Lançar" : "—")}</span>
                </button>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.dias_pagos}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{i.valor_fixo !== null ? `fixo ${reais(i.valor_fixo)}` : `${i.passagens_dia} × ${reais(i.tarifa ?? 0)}`}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{reais(r.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table interativa={false}>
        <TableBody>
          {totais.grupos.map(([g, c]) => (
            <TableRow key={g}><TableCell>{g}</TableCell><TableCell className="w-40 text-right tabular-nums">{reais(c / 100)}</TableCell></TableRow>
          ))}
          <TableRow className="font-bold"><TableCell>Total do mês</TableCell><TableCell className="text-right tabular-nums">{reais(totais.total / 100)}</TableCell></TableRow>
        </TableBody>
      </Table>

      <Dialog open={!!emEdicao} onOpenChange={(v) => { if (!v) setOcorrencias(null); }}>
        <DialogContent className="sm:max-w-lg">
          {emEdicao && (
            <>
              <DialogHeader>
                <DialogTitle>Ocorrências — {emEdicao.i.nome}</DialogTitle>
                <DialogDescription>
                  Férias e afastamento por período: descontam os dias úteis que caem no mês do VT. Abatimento sempre com motivo. {editavel ? "Feche e clique em Salvar na grade." : "Mês fechado: só consulta."}
                </DialogDescription>
              </DialogHeader>
              <fieldset disabled={!editavel} className="grid gap-4">
                <Periodo rotulo="Férias" inicio={emEdicao.e.ferias_inicio} fim={emEdicao.e.ferias_fim} dias={emEdicao.r.dias_ferias}
                  mudar={(inicio, fim) => alterar(emEdicao.i, { ferias_inicio: inicio, ferias_fim: fim })} />
                <Periodo rotulo="Afastamento (INSS, licença…)" inicio={emEdicao.e.afastamento_inicio} fim={emEdicao.e.afastamento_fim} dias={emEdicao.r.dias_afastamento}
                  mudar={(inicio, fim) => alterar(emEdicao.i, { afastamento_inicio: inicio, afastamento_fim: fim })} />
                <div className="grid gap-1.5">
                  <Label htmlFor="abatMotivo">Motivo do abatimento (dias ou R$)</Label>
                  <Input id="abatMotivo" value={emEdicao.e.abat_motivo ?? ""} maxLength={200} onChange={(x) => alterar(emEdicao.i, { abat_motivo: x.target.value })} placeholder="Ex.: saldo no cartão, VT pago a mais" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={emEdicao.e.sem_vt} onChange={(x) => alterar(emEdicao.i, { sem_vt: x.target.checked })} className="size-4" />
                  Sem VT neste mês
                </label>
                {emEdicao.e.sem_vt && (
                  <Input aria-label="Motivo de não receber VT" value={emEdicao.e.sem_vt_motivo ?? ""} maxLength={200} onChange={(x) => alterar(emEdicao.i, { sem_vt_motivo: x.target.value })} placeholder="Motivo (ex.: desligado, afastado o mês todo)" />
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="obs">Observação</Label>
                  <Textarea id="obs" rows={2} maxLength={300} value={emEdicao.e.observacao ?? ""} onChange={(x) => alterar(emEdicao.i, { observacao: x.target.value })} />
                </div>
              </fieldset>
              <p className="text-sm">Dias pagos: <strong>{emEdicao.r.dias_pagos}</strong> · Valor: <strong>{reais(emEdicao.r.valor)}</strong></p>
              <div className="flex justify-end"><Button onClick={() => setOcorrencias(null)}>Fechar</Button></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Periodo({ rotulo, inicio, fim, dias, mudar }: { rotulo: string; inicio: string | null; fim: string | null; dias: number; mudar: (inicio: string | null, fim: string | null) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>{rotulo}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={`${rotulo}: início`} value={inicio ?? ""} onChange={(x) => mudar(x.target.value || null, fim)} className="h-8 w-40" />
        <span className="text-sm">a</span>
        <Input type="date" aria-label={`${rotulo}: fim`} value={fim ?? ""} onChange={(x) => mudar(inicio, x.target.value || null)} className="h-8 w-40" />
        {(inicio || fim) && <Button type="button" variant="ghost" size="sm" onClick={() => mudar(null, null)}>Limpar</Button>}
        <span className="text-xs text-muted-foreground">{dias} dia(s) útil(eis) no mês</span>
      </div>
    </div>
  );
}
