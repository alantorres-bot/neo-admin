"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { horas, pendenciasDoFormulario, ROTULO_TIPO, TIPOS, type Tipo } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { salvarJustificativas } from "../acoes";
import type { OcorrenciaDoLider } from "../dados";

type Valor = { tipo: Tipo | null; horario: string; observacao: string };

/** O que o Control iD apontou, em palavras (o líder não vê saldo do banco nem extras). */
function oQueHouve(o: OcorrenciaDoLider): string {
  if (o.falta) return "Falta (sem marcação)";
  const feitas = o.marcacoes.filter(Boolean).length;
  const partes = [`${feitas} marcação(ões): ${o.marcacoes.filter(Boolean).join(" · ")}`];
  if (o.falta_atraso_min) partes.push(`falta/atraso de ${horas(o.falta_atraso_min)}`);
  return partes.join("; ");
}

export function FormularioJustificativas({ loteId, editavel, ocorrencias }: { loteId: string; editavel: boolean; ocorrencias: OcorrenciaDoLider[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, Valor>>(() =>
    Object.fromEntries(ocorrencias.map((o) => [o.id, { tipo: o.tipo, horario: o.horario ?? "", observacao: o.observacao ?? "" }])));
  const [erros, setErros] = useState<string[]>([]);
  const [pendente, iniciar] = useTransition();
  const mudar = (id: string, v: Partial<Valor>) => setValores((a) => ({ ...a, [id]: { ...a[id], ...v } }));

  const gravar = (enviar: boolean) => iniciar(async () => {
    const lista = Object.values(valores);
    if (enviar) {
      const faltas = pendenciasDoFormulario(lista.map((v) => ({ tipo: v.tipo, observacao: v.observacao, horario: v.horario })));
      setErros(faltas);
      if (faltas.length) return;
    }
    const r = await salvarJustificativas({
      lote: loteId,
      itens: Object.entries(valores).map(([id, v]) => ({ id, tipo: v.tipo, horario: v.horario.trim() || null, observacao: v.observacao.trim() || null })),
    }, enviar);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Salvo.");
    router.refresh();
  });

  const feitas = Object.values(valores).filter((v) => v.tipo).length;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Funcionário</TableHead><TableHead>Dia</TableHead><TableHead>Previsto</TableHead><TableHead>O que o ponto registrou</TableHead>
              <TableHead>Justificativa</TableHead><TableHead>Horário</TableHead><TableHead>Observação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ocorrencias.map((o) => {
              const v = valores[o.id];
              return (
                <TableRow key={o.id} className={editavel && !v.tipo ? "bg-amber-50" : ""}>
                  <TableCell><div className="font-medium">{o.nome}</div><div className="text-xs text-muted-foreground">{o.cargo}</div></TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">{formatarData(o.data)} {o.dia_semana}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{o.previsto}</TableCell>
                  <TableCell className="text-xs">{oQueHouve(o)}</TableCell>
                  <TableCell>
                    {editavel ? (
                      <select aria-label={`Justificativa de ${o.nome} em ${formatarData(o.data)}`} value={v.tipo ?? ""} onChange={(e) => mudar(o.id, { tipo: (e.target.value || null) as Tipo | null })}
                        className="h-8 w-64 rounded-[3px] border border-input bg-white px-1 text-sm">
                        <option value="">Escolha…</option>
                        {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                      </select>
                    ) : (v.tipo ? ROTULO_TIPO[v.tipo] : "—")}
                  </TableCell>
                  <TableCell>
                    {editavel && v.tipo === "esqueceu_bater" ? (
                      <Input value={v.horario} onChange={(e) => mudar(o.id, { horario: e.target.value })} placeholder="hh:mm" aria-label="Horário que faltou (opcional)" className="h-8 w-20" maxLength={5} />
                    ) : v.horario}
                  </TableCell>
                  <TableCell>
                    {editavel ? (
                      <Input value={v.observacao} onChange={(e) => mudar(o.id, { observacao: e.target.value })} placeholder={v.tipo === "outro" ? "Obrigatória" : "Opcional"}
                        aria-label="Observação" className="h-8 w-56" maxLength={500} />
                    ) : v.observacao}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {editavel && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {erros.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
          <span className="text-sm text-muted-foreground">{feitas} de {ocorrencias.length} justificada(s)</span>
          <Button variant="outline" onClick={() => gravar(false)} disabled={pendente}>Salvar e continuar depois</Button>
          <Button onClick={() => gravar(true)} disabled={pendente}>{pendente ? "Enviando…" : "Enviar justificativas"}</Button>
        </div>
      )}
      {editavel && <p className="text-xs text-muted-foreground">Em &quot;Esqueceu de bater&quot;, o horário é opcional: em branco, o RH usa o horário previsto.</p>}
    </div>
  );
}
