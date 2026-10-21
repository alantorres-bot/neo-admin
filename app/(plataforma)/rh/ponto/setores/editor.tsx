"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { salvarSetor } from "../acoes";
import type { Pessoa, Setor } from "../dados";

const SELECAO = "h-8 w-full max-w-64 rounded-[3px] border border-input bg-white px-1 text-sm";
type Rascunho = { id: string | null; nome: string; lider: string; substituto: string; ativo: boolean };
const vazio: Rascunho = { id: null, nome: "", lider: "", substituto: "", ativo: true };

function LinhaSetor({ inicial, pessoas, aoSalvar }: { inicial: Rascunho; pessoas: Pessoa[]; aoSalvar: () => void }) {
  const [s, setS] = useState(inicial);
  const [pendente, iniciar] = useTransition();
  const mudou = JSON.stringify(s) !== JSON.stringify(inicial);
  const salvar = () => iniciar(async () => {
    const r = await salvarSetor({ id: s.id, nome: s.nome, lider: s.lider, substituto: s.substituto || null, ativo: s.ativo });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Salvo.");
    if (!s.id) setS(vazio);
    aoSalvar();
  });
  const opcoes = (excluir: string) => pessoas.filter((p) => p.id !== excluir).map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.email})</option>);
  return (
    <TableRow>
      <TableCell><Input value={s.nome} onChange={(e) => setS({ ...s, nome: e.target.value })} placeholder="Ex.: Fábrica" aria-label="Setor" className="h-8 max-w-48" maxLength={80} /></TableCell>
      <TableCell>
        <select aria-label="Líder" value={s.lider} onChange={(e) => setS({ ...s, lider: e.target.value })} className={SELECAO}>
          <option value="">Escolha…</option>{opcoes(s.substituto)}
        </select>
      </TableCell>
      <TableCell>
        <select aria-label="Substituto" value={s.substituto} onChange={(e) => setS({ ...s, substituto: e.target.value })} className={SELECAO}>
          <option value="">Nenhum</option>{opcoes(s.lider)}
        </select>
      </TableCell>
      <TableCell><input type="checkbox" className="size-4" aria-label="Ativo" checked={s.ativo} onChange={(e) => setS({ ...s, ativo: e.target.checked })} /></TableCell>
      <TableCell><Button size="sm" onClick={salvar} disabled={pendente || !mudou || !s.nome.trim() || !s.lider}>{pendente ? "Salvando…" : s.id ? "Salvar" : "Incluir"}</Button></TableCell>
    </TableRow>
  );
}

export function EditorSetores({ setores, pessoas, ehGestor }: { setores: Setor[]; pessoas: Pessoa[]; ehGestor: boolean }) {
  const router = useRouter();
  if (!ehGestor) {
    return (
      <Table>
        <TableHeader><TableRow><TableHead>Setor</TableHead><TableHead>Líder</TableHead><TableHead>Substituto</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
        <TableBody>
          {setores.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.nome}</TableCell><TableCell>{s.lider?.nome ?? "—"}</TableCell><TableCell>{s.substituto?.nome ?? ""}</TableCell><TableCell>{s.ativo ? "Ativo" : "Inativo"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <Table interativa={false}>
      <TableHeader><TableRow><TableHead>Setor</TableHead><TableHead>Líder</TableHead><TableHead>Substituto</TableHead><TableHead>Ativo</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>
        {setores.map((s) => (
          <LinhaSetor key={`${s.id}-${s.lider_id}-${s.substituto_id}-${s.nome}-${s.ativo}`} pessoas={pessoas} aoSalvar={() => router.refresh()}
            inicial={{ id: s.id, nome: s.nome, lider: s.lider_id, substituto: s.substituto_id ?? "", ativo: s.ativo }} />
        ))}
        <LinhaSetor key="novo" inicial={vazio} pessoas={pessoas} aoSalvar={() => router.refresh()} />
      </TableBody>
    </Table>
  );
}
