// Leituras do cadastro único do RH (RLS de quem chama; nada é gravado aqui).
import type { FormaPagamento } from "@/lib/modulos/rh/colaboradores/modulo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const numero = (v: number | string | null) => (v === null ? null : Number(v));

export type ColaboradorLinha = {
  /** cod_fornecedor vazio = incluído pelo Control iD, cadastro a completar (fora da folha e do VT). */
  id: string; empresa_id: string; empregador: string; cod_fornecedor: string | null; matricula_escritorio: string | null; nome: string; cpf: string | null;
  agencia: string | null; conta: string | null; forma_pagamento: FormaPagamento; ativo: boolean; observacao: string | null;
  recebe_vt: boolean; tarifa: number | null; valor_fixo: number | null; passagens_dia: number;
  id_rhid: string | null; departamento: string | null; data_admissao: string | null; funcao: string | null; salario: number | null;
} & DadosPessoais;
/** Dados pessoais da ficha de registro do escritório (0532). */
export type DadosPessoais = {
  data_nascimento: string | null; telefone: string | null; endereco: string | null; pis: string | null; rg: string | null; rg_orgao: string | null;
  rg_emissao: string | null; ctps: string | null; ctps_serie: string | null; ctps_uf: string | null; nome_pai: string | null; nome_mae: string | null;
};
/** Colaborador novo vindo da ficha (sem id), para abrir o formulário preenchido. */
export type RascunhoColaborador = Partial<Omit<ColaboradorLinha, "id">>;
export const COLUNAS_COLABORADOR = "id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta, forma_pagamento, ativo, observacao, recebe_vt, tarifa, valor_fixo, passagens_dia, id_rhid, departamento, data_admissao, funcao, salario, data_nascimento, telefone, endereco, pis, rg, rg_orgao, rg_emissao, ctps, ctps_serie, ctps_uf, nome_pai, nome_mae";

/** numeric chega como texto do PostgREST. */
type ColaboradorBruto = Omit<ColaboradorLinha, "tarifa" | "valor_fixo" | "salario"> & { tarifa: number | string | null; valor_fixo: number | string | null; salario: number | string | null };
export const paraColaborador = (c: ColaboradorBruto): ColaboradorLinha => ({ ...c, tarifa: numero(c.tarifa), valor_fixo: numero(c.valor_fixo), salario: numero(c.salario) });

export async function lerColaboradores(supabase: Cliente): Promise<ColaboradorLinha[]> {
  const { data } = await supabase.from("rh_colaboradores").select(COLUNAS_COLABORADOR).order("ativo", { ascending: false }).order("nome");
  return ((data ?? []) as ColaboradorBruto[]).map(paraColaborador);
}

/** Empresas com código no Consistem (onde estão os fornecedores). */
export async function lerEmpresas(supabase: Cliente): Promise<{ id: string; nome: string }[]> {
  const { data } = await supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string }));
}
