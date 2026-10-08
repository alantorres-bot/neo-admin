"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { CHAVES_REGRA, FAIXAS_REGRA } from "@/supabase/functions/_shared/parametros-regra";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/** Data aaaa-mm-dd ou vazio (sem data a esteira/régua fica desligada). */
const data = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data válida.").nullable();
const inteiro = (rotulo: string, faixa: { min: number; max: number }) =>
  z.number({ error: `Informe ${rotulo}.` }).int(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser um número inteiro.`)
    .min(faixa.min, `${rotulo[0].toUpperCase()}${rotulo.slice(1)}: mínimo ${faixa.min}.`).max(faixa.max, `${rotulo[0].toUpperCase()}${rotulo.slice(1)}: máximo ${faixa.max}.`);

const esquema = z.object({
  esteiraAPartirDe: data,
  reguaAPartirDe: data,
  minimoConfirmacaoReais: z.number({ error: "Informe o valor mínimo da confirmação." }).gt(FAIXAS_REGRA.minimoConfirmacaoReais.min, "O valor mínimo deve ser maior que zero.").max(FAIXAS_REGRA.minimoConfirmacaoReais.max, "Valor alto demais."),
  janelaBoletoDias: inteiro("a janela do boleto (dias)", FAIXAS_REGRA.janelaBoletoDias),
  janelaConfirmacaoDias: inteiro("a janela da confirmação (dias)", FAIXAS_REGRA.janelaConfirmacaoDias),
  prazoContatoAntesDias: inteiro("o prazo do contato (dias)", FAIXAS_REGRA.prazoContatoAntesDias),
  travaPendenciasCobranca: inteiro("a trava de cobranças", FAIXAS_REGRA.travaPendenciasCobranca),
});
export type ValoresRegra = z.infer<typeof esquema>;

/**
 * Grava os parâmetros da regra de cobrança. Só gestor do Financeiro ou acima; a função de banco `rec_salvar_regua` confere de novo,
 * valida as faixas, grava tudo numa transação e registra quem alterou (a tabela de configurações também é auditada). A alteração
 * vale na próxima sincronização e na próxima abertura de tela. O sistema continua sem enviar nada ao cliente.
 */
export async function salvarRegra(valores: ValoresRegra): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro ou acima pode alterar a regra de cobrança." };
  const entrada = esquema.safeParse(valores);
  if (!entrada.success) return { ok: false, erro: entrada.error.issues[0].message };
  const v = entrada.data;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_salvar_regua", {
    p_parametros: {
      [CHAVES_REGRA.esteira]: v.esteiraAPartirDe,
      [CHAVES_REGRA.regua]: v.reguaAPartirDe,
      [CHAVES_REGRA.minimo]: v.minimoConfirmacaoReais,
      [CHAVES_REGRA.janelaBoleto]: v.janelaBoletoDias,
      [CHAVES_REGRA.janelaConfirmacao]: v.janelaConfirmacaoDias,
      [CHAVES_REGRA.prazoContato]: v.prazoContatoAntesDias,
      [CHAVES_REGRA.trava]: v.travaPendenciasCobranca,
    },
  });
  if (error) return { ok: false, erro: mensagemDeErroBanco(error) };

  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/inicio");
  return { ok: true, aviso: "Regra de cobrança salva. Vale a partir da próxima sincronização e da próxima abertura de tela." };
}
