import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MODULO_PORTAL_LIDER, ROTA_PORTAL_LIDER } from "@/lib/modulos/rh/portal-lider/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { meusSetores } from "../dados";
import { NovoPedido } from "../formulario";

export const metadata: Metadata = { title: "Portal do Líder — novo pedido" };

export default async function PaginaNovoPedido({ searchParams }: PageProps<"/lider/novo">) {
  const sessao = await exigirSessao();
  if (!sessao.modulos.some((m) => m.codigo === MODULO_PORTAL_LIDER && m.ativo)) notFound();
  const supabase = await criarClienteServidor();
  const setores = await meusSetores(supabase);
  const { setor: pedido } = await searchParams;
  const setor = setores.find((s) => s.id === pedido) ?? setores[0];
  if (!setor) notFound();
  const { data } = await supabase.rpc("rh_ld_equipe", { p_setor: setor.id });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm"><Link href={`${ROTA_PORTAL_LIDER}?setor=${setor.id}`} className="text-elo hover:underline">← Portal do Líder</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight">Novo pedido ao RH · {setor.nome}</h1>
        <p className="text-sm text-muted-foreground">O RH recebe na fila do dia e responde aqui. Saldo de férias e prazos o RH confere e informa na resposta.</p>
      </div>
      <NovoPedido setor={setor.id} equipe={(data ?? []) as { id: string; nome: string }[]} hoje={hojeEmCuiaba()} />
    </div>
  );
}
