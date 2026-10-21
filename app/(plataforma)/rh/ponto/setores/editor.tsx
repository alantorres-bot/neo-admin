"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { salvarSetor } from "../acoes";
import type { Setor } from "../dados";

type Rascunho = { id: string | null; nome: string; responsavel: string; email: string; copia: string; ativo: boolean };
const vazio: Rascunho = { id: null, nome: "", responsavel: "", email: "", copia: "", ativo: true };

function LinhaSetor({ inicial, aoSalvar }: { inicial: Rascunho; aoSalvar: () => void }) {
  const [s, setS] = useState(inicial);
  const [pendente, iniciar] = useTransition();
  const mudou = JSON.stringify(s) !== JSON.stringify(inicial);
  const salvar = () => iniciar(async () => {
    const r = await salvarSetor({ id: s.id, nome: s.nome, responsavel: s.responsavel, email: s.email, copia: s.copia, ativo: s.ativo });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Salvo.");
    if (!s.id) setS(vazio);
    aoSalvar();
  });
  return (
    <TableRow>
      <TableCell><Input value={s.nome} onChange={(e) => setS({ ...s, nome: e.target.value })} placeholder="Ex.: Fábrica" aria-label="Setor" className="h-8 w-40" maxLength={80} /></TableCell>
      <TableCell><Input value={s.responsavel} onChange={(e) => setS({ ...s, responsavel: e.target.value })} placeholder="Ex.: Guilherme" aria-label="Responsável" className="h-8 w-40" maxLength={120} /></TableCell>
      <TableCell><Input type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} placeholder="quem recebe o link" aria-label="E-mail" className="h-8 w-60" maxLength={200} /></TableCell>
      <TableCell><Input value={s.copia} onChange={(e) => setS({ ...s, copia: e.target.value })} placeholder="opcional; vários com vírgula" aria-label="E-mail em cópia" className="h-8 w-60" maxLength={300} /></TableCell>
      <TableCell><input type="checkbox" className="size-4" aria-label="Ativo" checked={s.ativo} onChange={(e) => setS({ ...s, ativo: e.target.checked })} /></TableCell>
      <TableCell><Button size="sm" onClick={salvar} disabled={pendente || !mudou || !s.nome.trim() || !s.email.trim()}>{pendente ? "Salvando…" : s.id ? "Salvar" : "Incluir"}</Button></TableCell>
    </TableRow>
  );
}

export function EditorSetores({ setores, ehGestor }: { setores: Setor[]; ehGestor: boolean }) {
  const router = useRouter();
  if (!ehGestor) {
    return (
      <Table>
        <TableHeader><TableRow><TableHead>Setor</TableHead><TableHead>Responsável</TableHead><TableHead>E-mail</TableHead><TableHead>Cópia</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
        <TableBody>
          {setores.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.nome}</TableCell><TableCell>{s.responsavel_nome ?? ""}</TableCell><TableCell>{s.email}</TableCell><TableCell>{s.email_copia ?? ""}</TableCell><TableCell>{s.ativo ? "Ativo" : "Inativo"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <Table interativa={false}>
      <TableHeader><TableRow><TableHead>Setor</TableHead><TableHead>Responsável</TableHead><TableHead>E-mail</TableHead><TableHead>Cópia</TableHead><TableHead>Ativo</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>
        {setores.map((s) => (
          <LinhaSetor key={`${s.id}-${s.nome}-${s.responsavel_nome}-${s.email}-${s.email_copia}-${s.ativo}`} aoSalvar={() => router.refresh()}
            inicial={{ id: s.id, nome: s.nome, responsavel: s.responsavel_nome ?? "", email: s.email, copia: s.email_copia ?? "", ativo: s.ativo }} />
        ))}
        <LinhaSetor key="novo" inicial={vazio} aoSalvar={() => router.refresh()} />
      </TableBody>
    </Table>
  );
}
