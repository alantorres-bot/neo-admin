import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lerParametrosRegra, lerUltimaAlteracaoRegra, TODAS_AS_CHAVES_REGRA, type ParametrosRegra,
} from "../../../../supabase/functions/_shared/parametros-regra";

/**
 * Parâmetros da regra de cobrança (Cobrança > Regra de cobrança), lidos de `configuracoes` com a RLS de quem chama.
 * Nunca quebra a tela: se a leitura falhar, vale o padrão (o comportamento de antes de a regra ser editável).
 */
export async function carregarRegra(supabase: SupabaseClient): Promise<{ parametros: ParametrosRegra; ultimaAlteracao: { por: string; em: string } | null }> {
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", [...TODAS_AS_CHAVES_REGRA]);
  return { parametros: lerParametrosRegra(data), ultimaAlteracao: lerUltimaAlteracaoRegra(data) };
}
