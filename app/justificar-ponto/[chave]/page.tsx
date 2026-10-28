import type { Metadata } from "next";
import type { Tipo } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { FormularioJustificativas, type OcorrenciaDoLink } from "./formulario";

// Página pública (sem login; liberada no proxy.ts): o link do e-mail ao líder. Não deve ser indexada.
export const metadata: Metadata = { title: "Justificar ponto", robots: { index: false, follow: false } };

type LoteDoLink = {
  setor: string; periodo_inicio: string; periodo_fim: string; status: string; prazo: string | null; devolvido_motivo: string | null;
  justificado_em: string | null; justificado_nome: string | null; ocorrencias: (Omit<OcorrenciaDoLink, "tipo"> & { tipo: Tipo | null })[];
};

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-svh bg-cabecalho p-3 sm:p-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[3px] border border-grade bg-white shadow">
        <div className="bg-marca px-5 py-3 text-white">
          <p className="font-condensada text-lg font-bold leading-tight">Neo Formas — Ponto</p>
          <p className="text-xs text-white/85">Justificativa das inconsistências do ponto</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">{children}</div>
      </div>
    </main>
  );
}

export default async function PaginaJustificarPeloLink({ params }: PageProps<"/justificar-ponto/[chave]">) {
  const { chave } = await params;
  const supabase = await criarClienteServidor();
  const { data } = /^[0-9a-f]{64}$/.test(chave) ? await supabase.rpc("rh_pt_link_lote", { p_chave: chave }) : { data: null };
  const lote = data as LoteDoLink | null;
  if (!lote) {
    return (
      <Moldura>
        <p className="font-medium">Link inválido ou expirado.</p>
        <p className="text-sm text-muted-foreground">Confira se o endereço foi copiado inteiro ou fale com o RH.</p>
      </Moldura>
    );
  }
  const editavel = lote.status === "enviado" || lote.status === "devolvido";
  return (
    <Moldura>
      <div>
        <h1 className="text-xl font-semibold">{lote.setor} — {formatarData(lote.periodo_inicio)} a {formatarData(lote.periodo_fim)}</h1>
        {editavel ? (
          <p className="text-sm text-muted-foreground">
            Escolha a justificativa de cada ocorrência, descreva o que aconteceu, informe o seu nome e clique em &quot;Enviar justificativas&quot;{lote.prazo ? ` até ${formatarData(lote.prazo)}` : ""}.
            Dá para salvar e terminar depois pelo mesmo link. Atestado ou declaração: entregue direto ao RH.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Justificativas enviadas ao RH{lote.justificado_nome ? ` por ${lote.justificado_nome}` : ""}
            {lote.justificado_em ? ` em ${new Date(lote.justificado_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" })}` : ""}.
            Se precisar mudar algo, fale com o RH.
          </p>
        )}
        {lote.status === "devolvido" && lote.devolvido_motivo && (
          <p className="mt-2 rounded-[3px] border border-destructive/50 p-3 text-sm text-destructive">O RH devolveu para correção: {lote.devolvido_motivo}</p>
        )}
      </div>
      {editavel && <FormularioJustificativas chave={chave} ocorrencias={lote.ocorrencias} />}
    </Moldura>
  );
}
