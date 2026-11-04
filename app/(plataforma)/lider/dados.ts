// Leituras do Portal do Líder. Tudo pelas funções rh_ld_* (0526), que conferem se quem chama lidera o setor.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODULO_PORTAL_LIDER, type Status, type Tipo } from "@/lib/modulos/rh/portal-lider/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Setor = { id: string; nome: string };
export type Pessoa = { id: string; nome: string; funcao: string | null; data_admissao: string | null; saldo_min: number | null; vencido_min: number; proximo_vencimento: string | null };
export type LoteAberto = { tipo: "ponto" | "bonificacao"; id: string; rotulo: string; prazo: string | null; chave: string };
export type Pedido = {
  id: string; tipo: Tipo; status: Status; dados: Record<string, unknown>; resposta: string | null; pessoa: string | null;
  criado_em: string; atendido_em: string | null; anexos: number;
};

export async function meusSetores(supabase: SupabaseClient): Promise<Setor[]> {
  const { data } = await supabase.rpc("rh_ld_meus_setores");
  return (data ?? []) as Setor[];
}

export async function lerPortal(supabase: SupabaseClient, setor: string) {
  const [equipe, lotes, pedidos] = await Promise.all([
    supabase.rpc("rh_ld_equipe", { p_setor: setor }),
    supabase.rpc("rh_ld_lotes_abertos", { p_setor: setor }),
    supabase.rpc("rh_ld_pedidos", { p_setor: setor }),
  ]);
  return { equipe: (equipe.data ?? []) as Pessoa[], lotes: (lotes.data ?? []) as LoteAberto[], pedidos: (pedidos.data ?? []) as Pedido[] };
}

/** Menu e Início: o portal aparece só para quem lidera algum setor ativo (com o módulo ativo). */
export async function ehLider(sessao: { modulos: { codigo: string; ativo: boolean }[] }): Promise<boolean> {
  if (!sessao.modulos.some((m) => m.codigo === MODULO_PORTAL_LIDER && m.ativo)) return false;
  return (await meusSetores(await criarClienteServidor())).length > 0;
}
