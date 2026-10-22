// Parâmetros dos títulos do RH no Consistem (folha e VT; migration 0521). Leitura com o RLS de quem chama.
import { lerParametrosLancamento, type ParametrosLancamento } from "@/lib/modulos/rh/lancamento";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export const CHAVE_PARAMETROS = "rh.lancamento";
export const CHAVE_VT_LIGADO = "rh.vale_transporte.lancar_no_erp";
export const CHAVE_FOLHA_LIGADO = "rh.folha.lancar_no_erp";

export type ParametrosRh = { parametros: ParametrosLancamento; bruto: unknown; vtLigado: boolean; folhaLigado: boolean };

export async function lerParametrosRh(supabase: Cliente): Promise<ParametrosRh> {
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", [CHAVE_PARAMETROS, CHAVE_VT_LIGADO, CHAVE_FOLHA_LIGADO]);
  const valor = (k: string) => (data ?? []).find((c) => c.chave === k)?.valor;
  const bruto = valor(CHAVE_PARAMETROS);
  return { parametros: lerParametrosLancamento(bruto), bruto, vtLigado: valor(CHAVE_VT_LIGADO) === true, folhaLigado: valor(CHAVE_FOLHA_LIGADO) === true };
}

/** Empregadores do cadastro (ativos), para as linhas da tabela de portadores. */
export async function lerEmpregadores(supabase: Cliente): Promise<string[]> {
  const { data } = await supabase.from("rh_colaboradores").select("empregador").eq("ativo", true);
  return [...new Set((data ?? []).map((c) => (c.empregador as string).trim().toUpperCase()))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
