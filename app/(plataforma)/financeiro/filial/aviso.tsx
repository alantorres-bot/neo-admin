"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { linkGmail, montarAviso, type ItemAviso } from "@/lib/modulos/financeiro/filial/remessa";
import { marcarAvisoAberto } from "./acoes";

/**
 * "Abrir e-mail para Cuiabá": abre o Gmail de quem clica (aba nova, tela de novo e-mail) com o aviso pronto — para,
 * assunto, relação e link da remessa. Nada é enviado pelo sistema; quem clica revisa e envia. Registra quando foi aberto.
 * "Copiar texto" é a alternativa (colar em qualquer e-mail).
 */
export function BotaoAvisoCuiaba({ remessaId, numero, data, itens, para, variante = "default" }: {
  remessaId: string; numero: number; data: string; itens: ItemAviso[]; para: string[]; variante?: "default" | "outline";
}) {
  const [resumido, setResumido] = useState(false);

  const montar = () => {
    const link = `${window.location.origin}${ROTA_FILIAL}/remessas/${numero}`;
    return { link, aviso: montarAviso({ numero, data, itens, link, para }) };
  };

  function abrir() {
    const { link, aviso } = montar();
    const r = linkGmail(aviso, link);
    setResumido(r.resumido);
    window.open(r.url, "_blank", "noopener");
    void marcarAvisoAberto(remessaId);
  }

  async function copiar() {
    const { aviso } = montar();
    await navigator.clipboard.writeText(`Para: ${aviso.para.join(", ")}\nAssunto: ${aviso.assunto}\n\n${aviso.corpo}`);
    toast.success("Texto do aviso copiado. Cole num novo e-mail.");
    void marcarAvisoAberto(remessaId);
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button variant={variante} onClick={abrir} disabled={para.length === 0} title={para.length === 0 ? "Configure os destinatários do aviso (financeiro.filial.aviso_destinatarios)" : "Abre o Gmail numa aba nova com o e-mail pronto; confira e envie"}>
          Abrir e-mail para Cuiabá
        </Button>
        <Button variant="ghost" onClick={copiar}>Copiar texto</Button>
      </div>
      {resumido && <p className="text-[13px] text-muted-foreground">A relação é longa para caber no link: o e-mail leva o resumo e o link da remessa, onde está a relação completa. Use &quot;Copiar texto&quot; para levar a relação inteira.</p>}
    </div>
  );
}
