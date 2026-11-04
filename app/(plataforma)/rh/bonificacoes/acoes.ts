"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RUBRICA_BONIFICACAO, ROTA_BONIFICACOES } from "@/lib/modulos/rh/bonificacoes/modulo";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { calcularRecibo, parametrosVigentes } from "@/lib/modulos/rh/folha/recibos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerRubricas, lerVigencias } from "../folha/dados";
import { lerItens, lerLote } from "./dados";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();
const motivo = z.string().trim().min(5, "Informe o motivo.").max(500);

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor" = "operador"): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", nivel)) return { ok: false, erro: `Somente ${nivel} do RH (ou acima) pode fazer isso.` };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_BONIFICACOES, "layout");
  return { ok: true };
}

export async function abrirLote(setorId: string, competencia: string): Promise<Resultado> {
  if (!uuid.safeParse(setorId).success || !/^\d{4}-\d{2}-01$/.test(competencia)) return { ok: false, erro: "Setor ou mês inválido." };
  return chamar("rh_bo_abrir_lote", { p_setor: setorId, p_competencia: competencia });
}

export async function devolverAoLider(loteId: string, m: string): Promise<Resultado> {
  const v = motivo.safeParse(m);
  if (!v.success || !uuid.safeParse(loteId).success) return { ok: false, erro: v.error?.issues[0].message ?? "Lote inválido." };
  return chamar("rh_bo_devolver", { p_lote: loteId, p_motivo: v.data });
}

export async function cancelarLote(loteId: string, m: string): Promise<Resultado> {
  const v = motivo.safeParse(m);
  if (!v.success || !uuid.safeParse(loteId).success) return { ok: false, erro: v.error?.issues[0].message ?? "Lote inválido." };
  return chamar("rh_bo_cancelar", { p_lote: loteId, p_motivo: v.data }, "gestor");
}

/**
 * Aprova (se ainda não aprovado) e grava um recibo Eventual por pessoa ainda sem recibo, com a linha bonificacao_producao
 * (salário × pct/100, o mesmo cálculo da Folha). Pode ser repetido: quem já tem recibo é pulado (ex.: pessoa que faltava na folha).
 */
export async function aprovarELancar(loteId: string): Promise<Resultado> {
  if (!uuid.safeParse(loteId).success) return { ok: false, erro: "Lote inválido." };
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: "Somente operador do RH (ou acima) pode fazer isso." };
  const supabase = await criarClienteServidor();
  let lote = await lerLote(supabase, loteId);
  if (!lote) return { ok: false, erro: "Lote não encontrado." };
  if (lote.status === "preenchido") {
    const { error } = await supabase.rpc("rh_bo_aprovar", { p_lote: loteId });
    if (error) return { ok: false, erro: mensagemDeErro(error) };
    lote = { ...lote, status: "aprovado" };
  }
  if (lote.status !== "aprovado") return { ok: false, erro: "Só lote aguardando aprovação pode ser aprovado." };
  const [itens, rubricas, vigencias] = await Promise.all([lerItens(supabase, loteId), lerRubricas(supabase), lerVigencias(supabase)]);
  const rubrica = rubricas.find((r) => r.codigo === RUBRICA_BONIFICACAO);
  if (!rubrica) return { ok: false, erro: `Rubrica ${RUBRICA_BONIFICACAO} inativa no catálogo da Folha.` };
  const parametros = parametrosVigentes(vigencias, lote.competencia);
  let gravados = 0;
  const erros: string[] = [];
  for (const i of itens.filter((x) => !x.recibo_id)) {
    const pessoa = { salario: i.salario ?? 0, insalubridade_pct: i.insalubridade_pct, adicional_noturno_pct: i.adicional_noturno_pct };
    const calc = calcularRecibo([{ rubrica, referencia: i.pct / 100 }], pessoa, parametros);
    const { data: recibo, error } = await supabase.rpc("rh_fp_gravar_recibo", {
      p_competencia: lote.competencia, p_colaborador: i.colaborador_id, p_tipo: "eventual", p_salario: pessoa.salario, p_insalubridade: pessoa.insalubridade_pct,
      p_noturno: pessoa.adicional_noturno_pct, p_funcao: i.funcao, p_inicio: null, p_fim: null, p_mensagem: `Bonificação ${i.pct}% — ${lote.setor}`,
      p_linhas: calc.linhas.map((l) => ({ rubrica: l.rubrica, descricao: l.descricao, referencia: l.referencia, valor: l.centavos / 100 })), p_substitui: null,
    });
    const marcar = error ? null : await supabase.rpc("rh_bo_marcar_recibo", { p_item: i.id, p_recibo: recibo });
    const falha = error ?? marcar?.error;
    if (falha) erros.push(`${i.nome}: ${mensagemDeErro(falha)}`); else gravados++;
  }
  revalidatePath(ROTA_BONIFICACOES, "layout");
  revalidatePath(ROTA_FOLHA, "layout");
  if (erros.length) return { ok: false, erro: `${gravados} recibo(s) gravado(s); faltaram ${erros.length}: ${erros.join(" · ")}. Corrija e clique de novo em "Lançar na folha".` };
  return { ok: true, aviso: `Aprovado: ${gravados} recibo(s) Eventual(is) gravado(s) na folha.` };
}
