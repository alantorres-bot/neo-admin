"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { definirCartaCessao } from "./acoes";

/** Marca "exige carta de cessão": o kit da filial só fica pronto com a carta quando há parcela cedida deste cliente. */
export function MarcaCartaCessao({ contraparteId, exige, podeOperar }: { contraparteId: string; exige: boolean; podeOperar: boolean }) {
  const router = useRouter();
  const [marcado, setMarcado] = useState(exige);
  const [pendente, iniciar] = useTransition();

  function alterar(valor: boolean) {
    setMarcado(valor);
    iniciar(async () => {
      const r = await definirCartaCessao({ contraparteId, exige: valor });
      if (!r.ok) {
        setMarcado(!valor);
        return void toast.error(r.erro);
      }
      toast.success(r.aviso);
      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 text-[13px]" title="A carta é opcional; só vai a quem pede. Cliente que não aceita boleto de factoring não deve recebê-la.">
      <input type="checkbox" className="size-4" checked={marcado} disabled={!podeOperar || pendente} onChange={(e) => alterar(e.target.checked)} />
      Exige carta de cessão de crédito quando o título for cedido à AKF
    </label>
  );
}
