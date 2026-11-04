"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PCTS, type Pct } from "@/lib/modulos/rh/bonificacoes/modulo";
import { enviarBonificacao } from "./acoes";
import type { PessoaDoLink } from "./page";

const SELECT = "h-8 rounded-[3px] border border-input bg-white px-1 text-sm disabled:opacity-50";

export function FormularioBonificacao({ chave, pessoas }: { chave: string; pessoas: PessoaDoLink[] }) {
  const router = useRouter();
  const [padrao, setPadrao] = useState<Pct>(10);
  // pct = null: sem direito; ao marcar, entra o "% padrão" (o líder troca o de cada um se quiser)
  const [pcts, setPcts] = useState<Record<string, Pct | null>>(() => Object.fromEntries(pessoas.map((p) => [p.id, p.pct])));
  const [nome, setNome] = useState("");
  const [pendente, iniciar] = useTransition();
  const marcados = Object.entries(pcts).filter((e): e is [string, Pct] => e[1] !== null);
  const mudar = (id: string, pct: Pct | null) => setPcts((a) => ({ ...a, [id]: pct }));

  const enviar = () => iniciar(async () => {
    const r = await enviarBonificacao({ chave, nome, itens: marcados.map(([colaborador_id, pct]) => ({ colaborador_id, pct })) });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="pct-padrao">% padrão ao marcar:</label>
        <select id="pct-padrao" value={padrao} onChange={(e) => setPadrao(Number(e.target.value) as Pct)} className={SELECT}>
          {PCTS.map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => setPcts(Object.fromEntries(pessoas.map((p) => [p.id, padrao])))}>Marcar todos</Button>
        <Button variant="outline" size="sm" onClick={() => setPcts(Object.fromEntries(pessoas.map((p) => [p.id, null])))}>Desmarcar todos</Button>
      </div>
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Tem direito</TableHead><TableHead>Funcionário</TableHead><TableHead>Função</TableHead><TableHead>Percentual</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {pessoas.map((p) => {
              const pct = pcts[p.id];
              return (
                <TableRow key={p.id}>
                  <TableCell><Checkbox aria-label={`${p.nome} tem direito`} checked={pct !== null} onCheckedChange={(v) => mudar(p.id, v === true ? padrao : null)} /></TableCell>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.funcao}</TableCell>
                  <TableCell>
                    <select aria-label={`Percentual de ${p.nome}`} value={pct ?? ""} disabled={pct === null} onChange={(e) => mudar(p.id, Number(e.target.value) as Pct)} className={SELECT}>
                      {pct === null && <option value="">—</option>}
                      {PCTS.map((x) => <option key={x} value={x}>{x}%</option>)}
                    </select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">{marcados.length} de {pessoas.length} com bonificação</span>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" aria-label="Seu nome" className="h-9 w-56" maxLength={120} />
        <Button onClick={enviar} disabled={pendente || nome.trim().length < 3}>{pendente ? "Enviando…" : "Enviar ao RH"}</Button>
      </div>
    </div>
  );
}
