import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ROTA_JUSTIFICAR } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerLotesDoLider, lerOcorrenciasDoLider } from "../dados";
import { FormularioJustificativas } from "./formulario";

export const metadata: Metadata = { title: "Justificar ponto" };

export default async function PaginaJustificarPonto({ params }: PageProps<"/ponto/justificar/[lote]">) {
  await exigirSessao();
  const { lote: id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lote = (await lerLotesDoLider(supabase)).find((l) => l.id === id);
  const ocorrencias = lote ? await lerOcorrenciasDoLider(supabase, id) : null;
  if (!lote || !ocorrencias) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Este ponto não está disponível para você.</p>
        <p className="mt-1 text-sm text-muted-foreground">Só o líder (ou o substituto) do setor abre o formulário. Se for engano, fale com o RH.</p>
      </div>
    );
  }
  const editavel = lote.status === "enviado" || lote.status === "devolvido";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm"><Link href={ROTA_JUSTIFICAR} className="text-elo hover:underline">← Ponto do setor</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight">Ponto — {lote.setor}, {formatarData(lote.periodo_inicio)} a {formatarData(lote.periodo_fim)}</h1>
        {editavel ? (
          <p className="text-sm text-muted-foreground">
            Escolha a justificativa de cada ocorrência e clique em &quot;Enviar justificativas&quot;{lote.prazo ? ` até ${formatarData(lote.prazo)}` : ""}. Dá para salvar e
            terminar depois. Atestado ou declaração: entregue direto ao RH.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Justificativas enviadas{lote.justificado_em ? ` em ${new Date(lote.justificado_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" })}` : ""}. Se precisar mudar algo, fale com o RH.</p>
        )}
        {lote.status === "devolvido" && lote.devolvido_motivo && <p className="mt-2 rounded-[3px] border border-destructive/50 p-3 text-sm text-destructive">O RH devolveu para correção: {lote.devolvido_motivo}</p>}
      </div>
      <FormularioJustificativas loteId={lote.id} editavel={editavel} ocorrencias={ocorrencias} />
    </div>
  );
}
