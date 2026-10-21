"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { definirSetor } from "../acoes";

/** Setor da pessoa (o CSV do Control iD não traz): escolhido uma vez pelo RH; vale para o e-mail ao líder. */
export function SetorDaPessoa({ pessoa, setor, setores, nome }: { pessoa: string; setor: string | null; setores: { id: string; nome: string }[]; nome: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <select aria-label={`Setor de ${nome}`} value={setor ?? ""} disabled={pendente}
      onChange={(e) => iniciar(async () => { const r = await definirSetor(pessoa, e.target.value || null); if (!r.ok) toast.error(r.erro); else router.refresh(); })}
      className={`h-7 max-w-40 rounded-[3px] border bg-white px-1 text-[12px] ${setor ? "border-input" : "border-amber-600 text-amber-800"}`}>
      <option value="">Sem setor</option>
      {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
    </select>
  );
}
