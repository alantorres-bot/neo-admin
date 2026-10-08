import type { SupabaseClient } from "@supabase/supabase-js";
import { marcosDeLinhas, MARCOS_PADRAO, type LinhaMarcoBanco, type MarcoRegua } from "../../../../supabase/functions/_shared/cobranca";
import {
  lerParametrosRegra, lerUltimaAlteracaoRegra, TODAS_AS_CHAVES_REGRA, type ParametrosRegra,
} from "../../../../supabase/functions/_shared/parametros-regra";

export type RegraDeCobranca = {
  parametros: ParametrosRegra;
  /** Marcos da régua (dias, canais e textos), do menor para o maior número de dias. */
  marcos: MarcoRegua[];
  ultimaAlteracao: { por: string; em: string } | null;
};

/** Colunas lidas de `rec_regua_marcos` (os marcos de cobrança ativos da régua padrão). */
export const COLUNAS_MARCO = "dia_relativo, canais, descricao, texto_whatsapp, assunto_email, corpo_email";

/**
 * Regra de cobrança (Cobrança > Regra de cobrança) lida do banco com a RLS de quem chama: parâmetros de `configuracoes` e marcos
 * de `rec_regua_marcos`. Nunca quebra a tela: se a leitura falhar, valem os padrões (o comportamento de antes de a regra ser
 * editável). Régua sem nenhum marco ativo é uma escolha (a régua não cobra), não um erro.
 */
export async function carregarRegra(supabase: SupabaseClient): Promise<RegraDeCobranca> {
  const [{ data: configs }, { data: linhas, error }] = await Promise.all([
    supabase.from("configuracoes").select("chave, valor").in("chave", [...TODAS_AS_CHAVES_REGRA]),
    supabase.from("rec_regua_marcos").select(`${COLUNAS_MARCO}, rec_reguas!inner(nome, ativa)`)
      .eq("acao", "cobranca").eq("ativo", true).eq("rec_reguas.nome", "Padrao").eq("rec_reguas.ativa", true),
  ]);
  return {
    parametros: lerParametrosRegra(configs),
    marcos: error || !linhas ? [...MARCOS_PADRAO] : marcosDeLinhas(linhas as unknown as LinhaMarcoBanco[]),
    ultimaAlteracao: lerUltimaAlteracaoRegra(configs),
  };
}
