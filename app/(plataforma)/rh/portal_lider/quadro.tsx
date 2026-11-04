"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Status } from "@/lib/modulos/rh/portal-lider/modulo";
import { Input } from "@/components/ui/input";
import { atender, definirLideres, salvarEmailRh, type Resultado } from "./acoes";
import type { Usuario } from "./dados";

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const rodar = (f: () => Promise<Resultado>, sucesso: string, depois?: () => void) => iniciar(async () => {
    const r = await f();
    if (r.ok) { toast.success(sucesso); depois?.(); router.refresh(); } else toast.error(r.erro);
  });
  return { pendente, rodar };
}

/** Atender o pedido: a resposta vai para o líder (obrigatória na recusa). */
export function AtenderPedido({ id, status }: { id: string; status: Status }) {
  const { pendente, rodar } = useAcao();
  const [resposta, setResposta] = useState("");
  if (status !== "enviada" && status !== "em_andamento") return null;
  const ir = (s: "em_andamento" | "concluida" | "recusada", aviso: string) => rodar(() => atender({ id, status: s, resposta }), aviso, () => setResposta(""));
  return (
    <div className="max-w-xl space-y-2">
      <Textarea value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={2000} aria-label="Resposta ao líder"
        placeholder="Resposta ao líder (ex.: férias programadas de 01/12 a 30/12; aviso enviado para assinatura)" />
      <div className="flex flex-wrap justify-end gap-2">
        {status === "enviada" && <Button variant="outline" size="sm" disabled={pendente} onClick={() => ir("em_andamento", "Pedido em andamento.")}>Em andamento</Button>}
        <Button variant="destructive" size="sm" disabled={pendente || resposta.trim().length < 5} onClick={() => ir("recusada", "Pedido recusado.")}>Recusar</Button>
        <Button size="sm" disabled={pendente} onClick={() => ir("concluida", "Pedido concluído.")}>Concluir</Button>
      </div>
    </div>
  );
}

/** Líderes do setor no portal (gestor do RH). O usuário precisa existir em Configurações > Usuários; não precisa de área. */
export function EditorLideres({ setor, lideres, usuarios, podeEditar }: { setor: string; lideres: string[]; usuarios: Usuario[]; podeEditar: boolean }) {
  const { pendente, rodar } = useAcao();
  const nome = (id: string) => usuarios.find((u) => u.id === id)?.nome ?? "usuário inativo";
  const salvar = (lista: string[]) => rodar(() => definirLideres(setor, lista), "Líderes salvos.");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lideres.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-grade px-2 py-0.5 text-sm">
          {nome(id)}
          {podeEditar && (
            <button type="button" aria-label={`Tirar ${nome(id)}`} disabled={pendente} onClick={() => salvar(lideres.filter((x) => x !== id))}>
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {!lideres.length && <span className="text-sm text-muted-foreground">Sem líder no portal</span>}
      {podeEditar && (
        <select aria-label="Acrescentar líder" disabled={pendente} value="" onChange={(e) => { if (e.target.value) salvar([...lideres, e.target.value]); }}
          className="h-8 rounded-[3px] border border-input bg-white px-1 text-sm">
          <option value="">+ líder…</option>
          {usuarios.filter((u) => !lideres.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.nome} ({u.email})</option>)}
        </select>
      )}
    </div>
  );
}

/** Para quem vai, por e-mail, cada pedido do portal (só @neoformas.com.br; o gestor do RH troca). */
export function EditorEmailRh({ emails, podeEditar }: { emails: string[]; podeEditar: boolean }) {
  const { pendente, rodar } = useAcao();
  const [texto, setTexto] = useState(emails.join(", "));
  if (!podeEditar) return <p className="text-sm">{emails.join(", ") || "—"}</p>;
  return (
    <div className="flex max-w-xl gap-2">
      <Input value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="E-mail do RH" placeholder="rh@neoformas.com.br" />
      <Button size="sm" disabled={pendente} onClick={() => rodar(() => salvarEmailRh(texto), "E-mail do RH salvo.")}>Salvar</Button>
    </div>
  );
}
