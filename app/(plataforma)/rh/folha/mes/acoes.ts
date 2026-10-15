"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FORMAS_PAGAMENTO } from "@/lib/modulos/rh/colaboradores/modulo";
import { inicioDoMes } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { gerarRecorrentes } from "../recibos-acoes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();

async function exigir(nivel: "operador" | "gestor"): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "rh", nivel) ? null : `Somente ${nivel} do RH (ou acima) pode fazer isso na folha de pagamento.`;
}

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor" = "operador"): Promise<Resultado> {
  const negado = await exigir(nivel);
  if (negado) return { ok: false, erro: negado };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true };
}

export async function abrirMes(mes: string): Promise<{ ok: true; id: string; aviso?: string } | { ok: false; erro: string }> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!/^\d{4}-\d{2}$/.test(mes)) return { ok: false, erro: "Escolha o mês da folha." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_fp_abrir_competencia", { p_competencia: inicioDoMes(mes) });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  // Os recibos recorrentes nascem com o mês (modelos ativos de quem está na folha).
  const rec = await gerarRecorrentes(data as string);
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, id: data as string, aviso: rec.ok ? rec.aviso : rec.erro };
}

export async function atualizarDoCadastro(id: string): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_fp_atualizar_do_cadastro", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  const r = data as { atualizados: number; incluidos: number };
  return { ok: true, aviso: `Cadastro aplicado: ${r.atualizados} atualizados, ${r.incluidos} incluídos.` };
}

const valor = z.number().min(0).max(1_000_000);
const esquemaItem = z.object({
  id: uuid,
  forma_pagamento: z.enum(FORMAS_PAGAMENTO),
  liquido: valor, ferias_acrescimos: valor, decimo_terceiro: valor, avulso: valor,
  avulso_motivo: z.string().trim().max(200).nullable(),
  observacao: z.string().trim().max(300).nullable(),
});
export type ItemEditado = z.input<typeof esquemaItem>;

/** Grava a grade do mês (só as linhas alteradas). */
export async function salvarItens(id: string, itens: ItemEditado[]): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  if (!itens.length) return { ok: true, aviso: "Nada mudou." };
  const lista = z.array(esquemaItem).max(1000).safeParse(itens);
  if (!lista.success) return { ok: false, erro: "Há valores inválidos na grade (valores em reais, não negativos)." };
  const r = await chamar("rh_fp_salvar_itens", { p_id: id, p_itens: lista.data });
  return r.ok ? { ok: true, aviso: `${lista.data.length} linha(s) gravada(s).` } : r;
}

export async function conferirMes(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_fp_conferir", { p_id: id }) : { ok: false, erro: "Mês inválido." };
}
export async function aprovarMes(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_fp_aprovar", { p_id: id }, "gestor") : { ok: false, erro: "Mês inválido." };
}
export async function marcarPaga(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_fp_marcar_paga", { p_id: id }) : { ok: false, erro: "Mês inválido." };
}
export async function reabrirMes(id: string, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  if (motivo.trim().length < 3) return { ok: false, erro: "Informe o motivo para reabrir." };
  return chamar("rh_fp_reabrir", { p_id: id, p_motivo: motivo.trim().slice(0, 300) }, "gestor");
}
export async function marcarPix(id: string, itens: string[], pago: boolean): Promise<Resultado> {
  if (!uuid.safeParse(id).success || !z.array(uuid).min(1).max(1000).safeParse(itens).success) return { ok: false, erro: "Escolha as linhas." };
  return chamar("rh_fp_marcar_pix", { p_id: id, p_itens: itens, p_pago: pago });
}
