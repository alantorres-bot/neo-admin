"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarConfirmacao } from "./acoes";

export type ParcelaConfirmacao = { id: string; rotulo: string };

/** Resultado do contato com o cliente: "Cliente confirmou" ou "Sem resposta". O sistema não envia a mensagem. */
export function RegistrarConfirmacao({ parcelas }: { parcelas: ParcelaConfirmacao[] }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(parcelas.map((p) => p.id)));
  const [canal, setCanal] = useState<"whatsapp" | "telefone" | "email" | "interno">("whatsapp");
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function registrar(resultado: "confirmou" | "sem_resposta") {
    iniciar(async () => {
      const r = await registrarConfirmacao({ tituloIds: [...marcadas], resultado, canal, observacao });
      if (r.ok) {
        toast.success(r.aviso);
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  if (parcelas.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma parcela aguardando confirmação.</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {parcelas.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={marcadas.has(p.id)} onChange={() => alternar(p.id)} />
              <span>{p.rotulo}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select value={canal} onChange={(e) => setCanal(e.target.value as typeof canal)} aria-label="Meio do contato" className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="whatsapp">Por WhatsApp</option>
          <option value="telefone">Por telefone</option>
          <option value="email">Por e-mail</option>
          <option value="interno">Outro meio</option>
        </select>
        <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação, ex.: pagará dia 22 (opcional)" aria-label="Observação" maxLength={500} className="h-8 w-80" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pendente || marcadas.size === 0} onClick={() => registrar("confirmou")}>
          {pendente ? "Registrando…" : "Cliente confirmou"}
        </Button>
        <Button type="button" variant="outline" disabled={pendente || marcadas.size === 0} onClick={() => registrar("sem_resposta")}>
          Sem resposta
        </Button>
      </div>
    </div>
  );
}
