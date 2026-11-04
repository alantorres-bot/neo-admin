// Leituras do RH > Bonificações (RLS de quem chama: só a área RH lê as tabelas rh_bo_*).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pct, StatusLote } from "@/lib/modulos/rh/bonificacoes/modulo";

export type Lote = {
  id: string; setor_id: string; setor: string; competencia: string; status: StatusLote; chave: string; aberto_em: string;
  preenchido_nome: string | null; preenchido_em: string | null; devolvido_motivo: string | null; aprovado_em: string | null; cancelado_motivo: string | null;
};
export type Item = {
  id: string; colaborador_id: string; pct: Pct; recibo_id: string | null;
  nome: string; funcao: string | null; salario: number | null; insalubridade_pct: number; adicional_noturno_pct: number;
};

const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const COLUNAS = "id, setor_id, competencia, status, chave, aberto_em, preenchido_nome, preenchido_em, devolvido_motivo, aprovado_em, cancelado_motivo, setor:rh_pt_setores(nome)";
type LinhaLote = Omit<Lote, "setor"> & { setor: { nome: string } | { nome: string }[] | null };
const comSetor = ({ setor, ...l }: LinhaLote): Lote => ({ ...l, setor: um(setor)?.nome ?? "" });

export async function lerLotesDoMes(supabase: SupabaseClient, competencia: string): Promise<Lote[]> {
  const { data } = await supabase.from("rh_bo_lotes").select(COLUNAS).eq("competencia", competencia).order("aberto_em");
  return ((data ?? []) as LinhaLote[]).map(comSetor);
}

export async function lerLote(supabase: SupabaseClient, id: string): Promise<Lote | null> {
  const { data } = await supabase.from("rh_bo_lotes").select(COLUNAS).eq("id", id).maybeSingle();
  return data ? comSetor(data as LinhaLote) : null;
}

type Pessoa = { nome: string; funcao: string | null; salario: string | number | null; insalubridade_pct: number; adicional_noturno_pct: number };
type LinhaItem = Pick<Item, "id" | "colaborador_id" | "pct" | "recibo_id"> & { c: Pessoa | Pessoa[] | null };

export async function lerItens(supabase: SupabaseClient, loteId: string): Promise<Item[]> {
  const { data } = await supabase.from("rh_bo_itens")
    .select("id, colaborador_id, pct, recibo_id, c:rh_colaboradores(nome, funcao, salario, insalubridade_pct, adicional_noturno_pct)").eq("lote_id", loteId);
  return ((data ?? []) as LinhaItem[]).map(({ c, ...i }) => {
    const p = um(c);
    return { ...i, nome: p?.nome ?? "", funcao: p?.funcao ?? null, salario: p?.salario == null ? null : Number(p.salario), insalubridade_pct: p?.insalubridade_pct ?? 0, adicional_noturno_pct: p?.adicional_noturno_pct ?? 0 };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
