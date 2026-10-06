"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { definirFormaPagamento, marcarBoletoEnviado, marcarDadosEnviados } from "../[id]/acoes";

/** Troca a parcela para "paga por transferência": ela sai da fila de boleto e entra na de dados de pagamento. */
export function PagoPorTransferencia({ tituloId }: { tituloId: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  function trocar() {
    iniciar(async () => {
      const r = await definirFormaPagamento([tituloId], "transferencia");
      if (r.ok) {
        toast.success(r.aviso ?? "Forma de pagamento alterada.");
        router.refresh();
      } else toast.error(r.erro);
    });
  }
  return <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={trocar}>{pendente ? "Alterando…" : "Pago por transferência"}</Button>;
}

/**
 * Registra o envio sem sair da lista (o mesmo "Já enviei" da ficha): escolhe-se o canal e marca. O sistema nunca envia nada;
 * isto só diz que a pessoa já enviou (boleto ou dados de pagamento).
 */
export function MarcarEnviadoRapido({ tituloId, contatoId, tipo, canalSugerido }: { tituloId: string; contatoId: string | null; tipo: "boleto" | "dados"; canalSugerido: "email" | "whatsapp" }) {
  const router = useRouter();
  const [canal, setCanal] = useState<"email" | "whatsapp" | "telefone" | "interno">(canalSugerido);
  const [pendente, iniciar] = useTransition();
  function marcar() {
    iniciar(async () => {
      const entrada = { tituloIds: [tituloId], canal, contatoId, observacao: "" };
      const r = tipo === "boleto" ? await marcarBoletoEnviado(entrada) : await marcarDadosEnviados(entrada);
      if (r.ok) {
        toast.success(r.aviso ?? "Envio registrado.");
        router.refresh();
      } else toast.error(r.erro);
    });
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={canal}
        onChange={(e) => setCanal(e.target.value as typeof canal)}
        aria-label="Canal do envio"
        className="h-8 rounded-[3px] border border-input bg-background px-1.5 text-xs"
      >
        <option value="email">E-mail</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="telefone">Telefone</option>
        <option value="interno">Outro meio</option>
      </select>
      <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={marcar}>{pendente ? "Registrando…" : "Marcar enviado"}</Button>
    </span>
  );
}
