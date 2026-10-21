"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { horas, pendenciasDoFormulario, ROTULO_TIPO, TIPOS, type Tipo } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { salvarPeloLink } from "./acoes";

export type OcorrenciaDoLink = {
  id: string; nome: string; cargo: string | null; data: string; dia_semana: string; previsto: string; marcacoes: string[]; falta: boolean;
  falta_atraso_min: number; tipo: Tipo | null; horario: string | null; observacao: string | null;
};

type Valor = { tipo: Tipo | null; horario: string; observacao: string };

/** O que o Control iD apontou, em palavras (sem saldo do banco nem extras). */
function oQueHouve(o: OcorrenciaDoLink): string {
  if (o.falta) return "Falta (sem marcação)";
  const feitas = o.marcacoes.filter(Boolean);
  const partes = [`${feitas.length} marcação(ões): ${feitas.join(" · ")}`];
  if (o.falta_atraso_min) partes.push(`falta/atraso de ${horas(o.falta_atraso_min)}`);
  return partes.join("; ");
}

export function FormularioJustificativas({ chave, ocorrencias }: { chave: string; ocorrencias: OcorrenciaDoLink[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, Valor>>(() =>
    Object.fromEntries(ocorrencias.map((o) => [o.id, { tipo: o.tipo, horario: o.horario ?? "", observacao: o.observacao ?? "" }])));
  const [nome, setNome] = useState("");
  const [erros, setErros] = useState<string[]>([]);
  const [pendente, iniciar] = useTransition();
  const mudar = (id: string, v: Partial<Valor>) => setValores((a) => ({ ...a, [id]: { ...a[id], ...v } }));

  const gravar = (enviar: boolean) => iniciar(async () => {
    if (enviar) {
      const faltas = pendenciasDoFormulario(Object.values(valores));
      if (nome.trim().length < 3) faltas.push("Informe o seu nome.");
      setErros(faltas);
      if (faltas.length) return;
    }
    const r = await salvarPeloLink({
      chave, nome,
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
                <TableRow key={o.id} className={!v.tipo ? "bg-amber-50" : ""}>
                  <TableCell><div className="font-medium">{o.nome}</div><div className="text-xs text-muted-foreground">{o.cargo}</div></TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">{formatarData(o.data)} {o.dia_semana}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{o.previsto}</TableCell>
                  <TableCell className="text-xs">{oQueHouve(o)}</TableCell>
                  <TableCell>
                    <select aria-label={`Justificativa de ${o.nome} em ${formatarData(o.data)}`} value={v.tipo ?? ""} onChange={(e) => mudar(o.id, { tipo: (e.target.value || null) as Tipo | null })}
                      className="h-8 w-64 rounded-[3px] border border-input bg-white px-1 text-sm">
                      <option value="">Escolha…</option>
                      {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    {v.tipo === "esqueceu_bater" && (
                      <Input value={v.horario} onChange={(e) => mudar(o.id, { horario: e.target.value })} placeholder="hh:mm" aria-label="Horário que faltou (opcional)" className="h-8 w-20" maxLength={5} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input value={v.observacao} onChange={(e) => mudar(o.id, { observacao: e.target.value })} placeholder={v.tipo === "outro" ? "Obrigatória" : "Opcional"}
                      aria-label="Observação" className="h-8 w-56" maxLength={500} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Em &quot;Esqueceu de bater&quot;, o horário é opcional: em branco, o RH usa o horário previsto.</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {erros.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
        <span className="text-sm text-muted-foreground">{feitas} de {ocorrencias.length} justificada(s)</span>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome (para enviar)" aria-label="Seu nome" className="h-9 w-56" maxLength={120} />
        <Button variant="outline" onClick={() => gravar(false)} disabled={pendente}>Salvar e continuar depois</Button>
        <Button onClick={() => gravar(true)} disabled={pendente}>{pendente ? "Enviando…" : "Enviar justificativas"}</Button>
      </div>
    </div>
  );
}
