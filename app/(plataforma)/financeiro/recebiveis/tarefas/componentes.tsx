"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { definirFormaPagamento, marcarBoletoEnviado, marcarDadosEnviados } from "../[id]/acoes";

export type CanalEnvio = "email" | "whatsapp" | "telefone" | "interno";

/** Seletor do canal por onde o envio foi feito (o sistema só registra; nunca envia). */
export function SeletorCanal({ valor, aoMudar }: { valor: CanalEnvio; aoMudar: (c: CanalEnvio) => void }) {
  return (
    <select
      value={valor}
      onChange={(e) => aoMudar(e.target.value as CanalEnvio)}
      aria-label="Canal do envio"
      className="h-8 rounded-[3px] border border-input bg-background px-1.5 text-xs"
    >
      <option value="email">E-mail</option>
      <option value="whatsapp">WhatsApp</option>
      <option value="telefone">Telefone</option>
      <option value="interno">Outro meio</option>
    </select>
  );
}

/** Troca as parcelas para "pagas por transferência": saem da fila de boleto e entram na de dados de pagamento. */
export function PagoPorTransferencia({ tituloIds, rotulo = "Pago por transferência" }: { tituloIds: string[]; rotulo?: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  function trocar() {
    iniciar(async () => {
      const r = await definirFormaPagamento(tituloIds, "transferencia");
      if (r.ok) {
        toast.success(r.aviso ?? "Forma de pagamento alterada.");
        router.refresh();
      } else toast.error(r.erro);
    });
  }
  return <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={trocar}>{pendente ? "Alterando…" : rotulo}</Button>;
}

/**
 * Registra o envio sem sair da lista (o mesmo "Já enviei" da ficha): escolhe-se o canal e marca. O sistema nunca envia nada;
 * isto só diz que a pessoa já enviou (boleto ou dados de pagamento). As parcelas têm de ser do mesmo cliente.
 */
export function MarcarEnviadoRapido({ tituloIds, contatoId, tipo, canalSugerido }: { tituloIds: string[]; contatoId: string | null; tipo: "boleto" | "dados"; canalSugerido: "email" | "whatsapp" }) {
  const router = useRouter();
  const [canal, setCanal] = useState<CanalEnvio>(canalSugerido);
  const [pendente, iniciar] = useTransition();
  function marcar() {
    iniciar(async () => {
      const entrada = { tituloIds, canal, contatoId, observacao: "" };
      const r = tipo === "boleto" ? await marcarBoletoEnviado(entrada) : await marcarDadosEnviados(entrada);
      if (r.ok) {
        toast.success(r.aviso ?? "Envio registrado.");
        router.refresh();
      } else toast.error(r.erro);
    });
  }
  return (
    <span className="inline-flex items-center gap-1">
      <SeletorCanal valor={canal} aoMudar={setCanal} />
      <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={marcar}>{pendente ? "Registrando…" : tituloIds.length > 1 ? `Marcar enviado (${tituloIds.length})` : "Marcar enviado"}</Button>
    </span>
  );
}
