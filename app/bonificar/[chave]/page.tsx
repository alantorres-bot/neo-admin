import type { Metadata } from "next";
import type { Pct } from "@/lib/modulos/rh/bonificacoes/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { FormularioBonificacao } from "./formulario";

// Página pública (sem login; liberada no proxy.ts): o link da bonificação mandado ao líder. Não deve ser indexada.
export const metadata: Metadata = { title: "Bonificação", robots: { index: false, follow: false } };

export type PessoaDoLink = { id: string; nome: string; funcao: string | null; pct: Pct | null };
type LoteDoLink = {
  setor: string; competencia: string; status: string; devolvido_motivo: string | null; preenchido_em: string | null; preenchido_nome: string | null; pessoas: PessoaDoLink[];
};

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-svh bg-cabecalho p-3 sm:p-6">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-[3px] border border-grade bg-white shadow">
        <div className="bg-marca px-5 py-3 text-white">
          <p className="font-condensada text-lg font-bold leading-tight">Neo Formas — Bonificação</p>
          <p className="text-xs text-white/85">Lançamento da bonificação do mês pelo líder do setor</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">{children}</div>
      </div>
    </main>
  );
}

const mes = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default async function PaginaBonificarPeloLink({ params }: PageProps<"/bonificar/[chave]">) {
  const { chave } = await params;
  const supabase = await criarClienteServidor();
  const { data } = /^[0-9a-f]{64}$/.test(chave) ? await supabase.rpc("rh_bo_link_lote", { p_chave: chave }) : { data: null };
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
        <h1 className="text-xl font-semibold">{lote.setor} — bonificação de {mes(lote.competencia)}</h1>
        {editavel ? (
          <p className="text-sm text-muted-foreground">
            Marque quem tem direito à bonificação, escolha o percentual de cada um (sobre o salário), informe o seu nome e clique em &quot;Enviar ao RH&quot;.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bonificação enviada ao RH{lote.preenchido_nome ? ` por ${lote.preenchido_nome}` : ""}
            {lote.preenchido_em ? ` em ${new Date(lote.preenchido_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" })}` : ""}.
            Se precisar mudar algo, fale com o RH.
          </p>
        )}
        {lote.status === "devolvido" && lote.devolvido_motivo && (
          <p className="mt-2 rounded-[3px] border border-destructive/50 p-3 text-sm text-destructive">O RH devolveu para correção: {lote.devolvido_motivo}</p>
        )}
      </div>
      {editavel && (lote.pessoas.length
        ? <FormularioBonificacao chave={chave} pessoas={lote.pessoas} />
        : <p className="text-sm text-muted-foreground">Nenhum funcionário ativo cadastrado neste setor. Fale com o RH.</p>)}
    </Moldura>
  );
}
