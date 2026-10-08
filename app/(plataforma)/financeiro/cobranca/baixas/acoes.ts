"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

async function exigirOperador(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode dar baixa." };
  return { ok: true };
}

const plural = (n: number, singular: string, pluralTxt: string) => `${n} ${n === 1 ? singular : pluralTxt}`;

/**
 * Dá a baixa nos títulos marcados com a EVIDÊNCIA que o Consistem informou (data e valor do pagamento guardados pela
 * sincronização). Os dados vêm do banco, não da tela. Tudo ou nada, numa transação (`rec_baixar_titulos`). Quem confirma é
 * uma pessoa: o sistema nunca dá baixa sozinho.
 */
export async function baixarComEvidencia(ids: string[]): Promise<Resultado> {
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const lista = z.array(z.string().uuid()).min(1, "Marque pelo menos um título.").max(100, "No máximo 100 baixas de uma vez.").safeParse(ids);
  if (!lista.success) return { ok: false, erro: lista.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { data: titulos, error } = await supabase.from("rec_titulos").select("id, documento, valor, consistem_pago_em, consistem_valor_pago").in("id", lista.data);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  if (!titulos || titulos.length !== lista.data.length) return { ok: false, erro: "Algum título não foi encontrado." };

  const itens = [];
  for (const t of titulos) {
    if (!t.consistem_pago_em || t.consistem_valor_pago === null) return { ok: false, erro: `O título ${t.documento} não tem evidência do Consistem: resolva-o manualmente.` };
    const diferente = Math.round(Number(t.consistem_valor_pago) * 100) !== Math.round(Number(t.valor) * 100);
    itens.push({
      id: t.id,
      resultado: "pago",
      data: t.consistem_pago_em,
      valor: Number(t.consistem_valor_pago),
      descricao: diferente
        ? "Baixa confirmada com a evidência do Consistem (valor informado por ele: título + juros − desconto)."
        : "Baixa confirmada com a evidência do Consistem.",
    });
  }

  const { data, error: erroBaixa } = await supabase.rpc("rec_baixar_titulos", { p_itens: itens });
  if (erroBaixa) return { ok: false, erro: mensagemDeErro(erroBaixa) };

  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/inicio");
  const baixados = Number((data as { baixados?: number } | null)?.baixados ?? itens.length);
  return { ok: true, aviso: `${plural(baixados, "título baixado", "títulos baixados")}.` };
}

const esquemaManual = z.object({
  id: z.string().uuid(),
  resultado: z.enum(["pago", "cancelado"]),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do pagamento.").nullable(),
  valor: z.number().positive("Informe o valor pago.").nullable(),
  observacao: z.string().trim().max(500).default(""),
});

/** Baixa de UM título sem evidência (ou cancelamento): data e valor digitados por quem confere. */
export async function baixarManual(entrada: z.input<typeof esquemaManual>): Promise<Resultado> {
  const permissao = await exigirOperador();
  if (!permissao.ok) return permissao;
  const dados = esquemaManual.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { id, resultado, data, valor, observacao } = dados.data;
  if (resultado === "cancelado" && observacao.length < 5) return { ok: false, erro: "Informe o motivo do cancelamento." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_registrar_baixa", {
    p_titulo: id, p_resultado: resultado, p_data_pagamento: resultado === "pago" ? data : null, p_valor_pago: resultado === "pago" ? valor : null, p_descricao: observacao || null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };

  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/inicio");
  return { ok: true, aviso: resultado === "pago" ? "Baixa registrada." : "Título cancelado." };
}
