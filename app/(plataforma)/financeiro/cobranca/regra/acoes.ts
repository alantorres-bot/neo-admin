"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { validarMarcos } from "@/supabase/functions/_shared/cobranca";
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

const esquemaMarco = z.object({
  dias: z.number({ error: "Informe os dias de atraso de cada marco." }),
  canais: z.array(z.enum(["email", "whatsapp"])),
  descricao: z.string(),
  textoWhatsapp: z.string().nullable(),
  assuntoEmail: z.string().nullable(),
  corpoEmail: z.string().nullable(),
});
const esquemaMarcos = z.array(esquemaMarco).max(6, "No máximo 6 marcos.");
export type MarcoEntrada = z.infer<typeof esquemaMarco>;

/**
 * Grava a regra de cobrança (parâmetros e marcos). Só gestor do Financeiro ou acima; a função de banco `rec_salvar_regua` confere de
 * novo, valida tudo com as mesmas regras, grava numa transação e registra quem alterou (as tabelas também são auditadas). Marco
 * removido ou com outros dias cancela as pendências abertas dele. Vale na próxima sincronização e na próxima abertura de tela. O
 * sistema continua sem enviar nada ao cliente.
 */
export async function salvarRegra(valores: ValoresRegra, marcos?: MarcoEntrada[]): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro ou acima pode alterar a regra de cobrança." };
  const entrada = esquema.safeParse(valores);
  if (!entrada.success) return { ok: false, erro: entrada.error.issues[0].message };
  const v = entrada.data;

  let marcosJson: unknown[] | null = null;
  if (marcos !== undefined) {
    const lista = esquemaMarcos.safeParse(marcos);
    if (!lista.success) return { ok: false, erro: lista.error.issues[0].message };
    const erro = validarMarcos(lista.data);
    if (erro) return { ok: false, erro };
    marcosJson = lista.data.map((m) => ({
      dias: m.dias, canais: m.canais, descricao: m.descricao.trim(),
      texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail,
    }));
  }

  const supabase = await criarClienteServidor();
  const { data: resultado, error } = await supabase.rpc("rec_salvar_regua", {
    p_parametros: {
      [CHAVES_REGRA.esteira]: v.esteiraAPartirDe,
      [CHAVES_REGRA.regua]: v.reguaAPartirDe,
      [CHAVES_REGRA.minimo]: v.minimoConfirmacaoReais,
      [CHAVES_REGRA.janelaBoleto]: v.janelaBoletoDias,
      [CHAVES_REGRA.janelaConfirmacao]: v.janelaConfirmacaoDias,
      [CHAVES_REGRA.prazoContato]: v.prazoContatoAntesDias,
      [CHAVES_REGRA.trava]: v.travaPendenciasCobranca,
    },
    p_marcos: marcosJson,
  });
  if (error) return { ok: false, erro: mensagemDeErroBanco(error) };

  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  const canceladas = Number((resultado as { pendencias_canceladas?: number } | null)?.pendencias_canceladas ?? 0);
  const aviso = "Regra de cobrança salva. Vale a partir da próxima sincronização e da próxima abertura de tela.";
  return { ok: true, aviso: canceladas > 0 ? `${aviso} ${canceladas} ${canceladas === 1 ? "pendência de um marco removido foi cancelada" : "pendências de marcos removidos foram canceladas"}.` : aviso };
}
