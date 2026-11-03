"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROTA_BONIFICAR, type StatusLote } from "@/lib/modulos/rh/bonificacoes/modulo";
import { ComMotivo } from "../ponto/lote/[id]/quadro";
import { abrirLote, aprovarELancar, cancelarLote, devolverAoLider, type Resultado } from "./acoes";

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const rodar = (f: () => Promise<Resultado>, sucesso: string) => iniciar(async () => {
    const r = await f();
    if (r.ok) { toast.success(r.aviso ?? sucesso); router.refresh(); } else toast.error(r.erro);
  });
  return { pendente, rodar };
}

/** O link vai ao líder por e-mail, WhatsApp ou outro canal; quem tiver o link lança. */
export function CopiarLink({ chave }: { chave: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${ROTA_BONIFICAR}/${chave}`).then(() => toast.success("Link copiado."), () => toast.error("Não foi possível copiar."))}>
      <Link2 /> Copiar link
    </Button>
  );
}

export function AbrirLote({ setorId, competencia }: { setorId: string; competencia: string }) {
  const { pendente, rodar } = useAcao();
  return <Button size="sm" disabled={pendente} onClick={() => rodar(() => abrirLote(setorId, competencia), "Lote aberto: copie o link e mande ao líder.")}>Abrir lote</Button>;
}

export function AcoesLote({ loteId, chave, status, faltamRecibos, podeOperar, ehGestor }: {
  loteId: string; chave: string; status: StatusLote; faltamRecibos: number; podeOperar: boolean; ehGestor: boolean;
}) {
  const { pendente, rodar } = useAcao();
  const router = useRouter();
  const comMotivo = (f: (id: string, m: string) => Promise<Resultado>, aviso: string) => async (m: string) => {
    const r = await f(loteId, m);
    if (r.ok) { toast.success(aviso); router.refresh(); }
    return r;
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {podeOperar && (status === "enviado" || status === "devolvido") && <CopiarLink chave={chave} />}
      {podeOperar && (status === "preenchido" || (status === "aprovado" && faltamRecibos > 0)) && (
        <Button size="sm" disabled={pendente} onClick={() => rodar(() => aprovarELancar(loteId), "Lançado na folha.")}>
          {pendente ? "Lançando…" : status === "preenchido" ? "Aprovar e lançar na folha" : `Lançar na folha (${faltamRecibos} faltando)`}
        </Button>
      )}
      {podeOperar && status === "preenchido" && (
        <ComMotivo rotulo="Devolver ao líder" titulo="Devolver ao líder" descricao="O link reabre para o líder corrigir e enviar de novo. Avise o líder pelo canal de sempre."
          aoConfirmar={comMotivo(devolverAoLider, "Devolvido ao líder.")} />
      )}
      {ehGestor && ["enviado", "devolvido", "preenchido"].includes(status) && (
        <ComMotivo rotulo="Cancelar" variante="destructive" titulo="Cancelar o lote" descricao="Nada é apagado: o lote fica cancelado com o motivo e as pendências são encerradas. Depois dá para abrir outro."
          aoConfirmar={comMotivo(cancelarLote, "Lote cancelado.")} />
      )}
    </div>
  );
}
