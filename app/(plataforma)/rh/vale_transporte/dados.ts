// Leituras do módulo Vale-transporte (RLS de quem chama; nada é gravado aqui).
import type { FormaPagamento } from "@/lib/modulos/rh/vale-transporte/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export type ColaboradorLinha = {
  id: string; empresa_id: string; empregador: string; cod_fornecedor: string; nome: string; cpf: string | null;
  agencia: string | null; conta: string | null; forma_pagamento: FormaPagamento; tarifa: number | null; valor_fixo: number | null; passagens_dia: number;
  ativo: boolean; observacao: string | null;
};
export const COLUNAS_COLABORADOR = "id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, tarifa, valor_fixo, passagens_dia, ativo, observacao";

/** numeric chega como texto do PostgREST. */
type ColaboradorBruto = Omit<ColaboradorLinha, "tarifa" | "valor_fixo"> & { tarifa: number | string | null; valor_fixo: number | string | null };
export const paraColaborador = (c: ColaboradorBruto): ColaboradorLinha => ({
  ...c, tarifa: c.tarifa === null ? null : Number(c.tarifa), valor_fixo: c.valor_fixo === null ? null : Number(c.valor_fixo),
});

export async function lerColaboradores(supabase: Cliente): Promise<ColaboradorLinha[]> {
  const { data } = await supabase.from("rh_vt_colaboradores").select(COLUNAS_COLABORADOR).order("ativo", { ascending: false }).order("nome");
  return ((data ?? []) as ColaboradorBruto[]).map(paraColaborador);
}

/** Empresas com código no Consistem (onde estão os fornecedores). */
export async function lerEmpresas(supabase: Cliente): Promise<{ id: string; nome: string }[]> {
  const { data } = await supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string }));
}
