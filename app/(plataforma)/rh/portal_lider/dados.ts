// Leituras do RH > Portal do Líder (RLS: a área RH lê tudo).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Status, Tipo } from "@/lib/modulos/rh/portal-lider/modulo";

export type PedidoRh = {
  id: string; setor: string; tipo: Tipo; status: Status; dados: Record<string, unknown>; resposta: string | null;
  pessoa: string | null; autor: string | null; criado_em: string; atendido_em: string | null;
  email_enviado_em: string | null; email_erro: string | null;
};
export type Lider = { setor_id: string; perfil_id: string };
export type Usuario = { id: string; nome: string; email: string };

const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
type Nome = { nome: string } | { nome: string }[] | null;
type Linha = Omit<PedidoRh, "setor" | "pessoa" | "autor"> & { s: Nome; c: Nome; a: Nome };
const COLUNAS = "id, tipo, status, dados, resposta, criado_em, atendido_em, email_enviado_em, email_erro, s:rh_pt_setores(nome), c:rh_colaboradores(nome), a:perfis!rh_ld_solicitacoes_criado_por_fkey(nome)";
const montar = ({ s, c, a, ...l }: Linha): PedidoRh => ({ ...l, setor: um(s)?.nome ?? "", pessoa: um(c)?.nome ?? (l.dados.nome as string | undefined) ?? null, autor: um(a)?.nome ?? null });

export async function lerPedidos(supabase: SupabaseClient): Promise<PedidoRh[]> {
  const { data } = await supabase.from("rh_ld_solicitacoes").select(COLUNAS).order("criado_em", { ascending: false }).limit(500);
  return ((data ?? []) as Linha[]).map(montar);
}

export async function lerPedido(supabase: SupabaseClient, id: string): Promise<PedidoRh | null> {
  const { data } = await supabase.from("rh_ld_solicitacoes").select(COLUNAS).eq("id", id).maybeSingle();
  return data ? montar(data as Linha) : null;
}

export async function lerLideres(supabase: SupabaseClient): Promise<{ lideres: Lider[]; usuarios: Usuario[] }> {
  const [l, u] = await Promise.all([
    supabase.from("rh_ld_lideres").select("setor_id, perfil_id"),
    supabase.from("perfis").select("id, nome, email").eq("ativo", true).order("nome"),
  ]);
  return { lideres: (l.data ?? []) as Lider[], usuarios: (u.data ?? []) as Usuario[] };
}
