"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inicioDoMes } from "@/lib/modulos/rh/calendario";
import { codigosDoTitulo } from "@/lib/modulos/rh/lancamento";
import { itensALancar, montarTituloVt } from "@/lib/modulos/rh/vale-transporte/lancamento";
import { FORMAS_PAGAMENTO, ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametrosRh } from "../../_consistem/dados";
import { lerItens, lerLancamentos, lerMes } from "../dados";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();

async function exigir(nivel: "operador" | "gestor"): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "rh", nivel) ? null : `Somente ${nivel} do RH (ou acima) pode fazer isso no vale-transporte.`;
}

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor" = "operador"): Promise<Resultado> {
  const negado = await exigir(nivel);
  if (negado) return { ok: false, erro: negado };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_VT, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------- abrir e ajustar o mês

export async function abrirMes(entrada: { mes: string; diasUteis: number }): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!/^\d{4}-\d{2}$/.test(entrada.mes)) return { ok: false, erro: "Escolha o mês do VT." };
  if (!Number.isInteger(entrada.diasUteis) || entrada.diasUteis < 0 || entrada.diasUteis > 31) return { ok: false, erro: "Dias úteis: de 0 a 31." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_vt_abrir_competencia", { p_competencia: inicioDoMes(entrada.mes), p_dias_uteis: entrada.diasUteis });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_VT, "layout");
  return { ok: true, id: data as string };
}

export async function definirDiasUteis(id: string, dias: number): Promise<Resultado> {
  if (!uuid.safeParse(id).success || !Number.isInteger(dias) || dias < 0 || dias > 31) return { ok: false, erro: "Dias úteis: de 0 a 31." };
  return chamar("rh_vt_definir_dias_uteis", { p_id: id, p_dias: dias });
}

export async function atualizarDoCadastro(id: string): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_vt_atualizar_do_cadastro", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_VT, "layout");
  const r = data as { atualizados: number; incluidos: number; desativados: number };
  return { ok: true, aviso: `Cadastro aplicado: ${r.atualizados} atualizados, ${r.incluidos} incluídos, ${r.desativados} sem VT (desativados).` };
}

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const dias = z.number().int().min(0).max(31);
const esquemaItem = z.object({
  id: uuid,
  forma_pagamento: z.enum(FORMAS_PAGAMENTO),
  dias_uteis: dias, faltas: dias, atestados: dias, extras: dias, abat_dias: dias,
  ferias_inicio: data, ferias_fim: data, afastamento_inicio: data, afastamento_fim: data,
  abat_valor: z.number().min(0).max(100000),
  abat_motivo: z.string().trim().max(200).nullable(),
  sem_vt: z.boolean(),
  sem_vt_motivo: z.string().trim().max(200).nullable(),
  observacao: z.string().trim().max(300).nullable(),
});
export type ItemEditado = z.input<typeof esquemaItem>;

/** Grava a grade do mês (só as linhas alteradas). Confere as regras antes, com mensagem por pessoa. */
export async function salvarItens(id: string, itens: ItemEditado[], nomes: Record<string, string>): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  if (!itens.length) return { ok: true, aviso: "Nada mudou." };
  const lista = z.array(esquemaItem).max(500).safeParse(itens);
  if (!lista.success) return { ok: false, erro: "Há valores inválidos na grade (dias de 0 a 31, datas e valores)." };
  for (const i of lista.data) {
    const quem = nomes[i.id] ?? "uma pessoa";
    if ((i.ferias_inicio === null) !== (i.ferias_fim === null) || (i.ferias_inicio && i.ferias_fim && i.ferias_fim < i.ferias_inicio)) return { ok: false, erro: `Férias de ${quem}: informe início e fim (fim depois do início).` };
    if ((i.afastamento_inicio === null) !== (i.afastamento_fim === null) || (i.afastamento_inicio && i.afastamento_fim && i.afastamento_fim < i.afastamento_inicio)) return { ok: false, erro: `Afastamento de ${quem}: informe início e fim (fim depois do início).` };
    if ((i.abat_dias > 0 || i.abat_valor > 0) && !i.abat_motivo) return { ok: false, erro: `Abatimento de ${quem}: informe o motivo.` };
    if (i.sem_vt && !i.sem_vt_motivo) return { ok: false, erro: `Sem VT para ${quem}: informe o motivo.` };
  }
  const r = await chamar("rh_vt_salvar_itens", { p_id: id, p_itens: lista.data });
  return r.ok ? { ok: true, aviso: `${lista.data.length} linha(s) gravada(s).` } : r;
}

// ---------------------------------------------------------------- fluxo

export async function enviarMes(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_vt_enviar", { p_id: id }) : { ok: false, erro: "Mês inválido." };
}
export async function aprovarMes(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_vt_aprovar", { p_id: id }, "gestor") : { ok: false, erro: "Mês inválido." };
}
export async function marcarPaga(id: string): Promise<Resultado> {
  return uuid.safeParse(id).success ? chamar("rh_vt_marcar_paga", { p_id: id }) : { ok: false, erro: "Mês inválido." };
}

export async function reabrirMes(id: string, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  if (motivo.trim().length < 3) return { ok: false, erro: "Informe o motivo para reabrir." };
  return chamar("rh_vt_reabrir", { p_id: id, p_motivo: motivo.trim().slice(0, 300) }, "gestor");
}

export async function marcarPix(id: string, itens: string[], pago: boolean): Promise<Resultado> {
  if (!uuid.safeParse(id).success || !z.array(uuid).min(1).max(500).safeParse(itens).success) return { ok: false, erro: "Escolha as linhas." };
  return chamar("rh_vt_marcar_pix", { p_id: id, p_itens: itens, p_pago: pago });
}

// ---------------------------------------------------------------- Consistem

async function mensagemDaFuncao(error: unknown, padrao: string): Promise<string> {
  const resposta = (error as { context?: Response }).context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const j = (await resposta.json()) as { erro?: string; mensagem?: string };
      return j.mensagem ?? j.erro ?? padrao;
    } catch { /* mantém */ }
  }
  return padrao;
}

/**
 * Lança no Consistem os títulos do mês aprovado (um por pessoa com valor e ainda sem título). Monta tudo de novo aqui (não confia
 * na tela), confere com o que a pessoa viu (quantidade e total), reserva (rh_vt_reservar_lancamentos) e chama a Edge Function.
 */
export async function lancarNoConsistem(id: string, esperado: { quantidade: number; totalCentavos: number; chaves: string[] }): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  const chaves = z.array(uuid).max(1000).safeParse(esperado.chaves);
  if (!chaves.success) return { ok: false, erro: "Seleção inválida; recarregue a página." };
  const escolhidos = new Set(chaves.data);
  const supabase = await criarClienteServidor();
  const [mes, itens, lancamentos, parametros] = await Promise.all([lerMes(supabase, id), lerItens(supabase, id), lerLancamentos(supabase, id), lerParametrosRh(supabase)]);
  if (!mes) return { ok: false, erro: "Mês não encontrado." };
  if (!parametros.vtLigado) return { ok: false, erro: "O lançamento no Consistem está desligado (aba Parâmetros)." };
  const ativos = new Set(lancamentos.filter((l) => l.situacao !== "erro").map((l) => l.item_id));
  const alvo = itensALancar(itens, ativos).filter((i) => escolhidos.has(i.id));
  const total = alvo.reduce((s, i) => s + Math.round(i.valor * 100), 0);
  if (alvo.length !== esperado.quantidade || total !== esperado.totalCentavos) return { ok: false, erro: "Os títulos mudaram desde que a página abriu; recarregue e confira de novo." };
  if (!alvo.length) return { ok: false, erro: "Nenhum título a lançar." };
  const hoje = hojeEmCuiaba();
  const titulos = [];
  for (const i of alvo) {
    const codigos = codigosDoTitulo(parametros.parametros, "vt", i.empregador, i.forma_pagamento);
    if (!codigos) return { ok: false, erro: `Faltam nos Parâmetros os códigos do VT ou o portador de ${i.empregador} (${i.forma_pagamento === "fopag" ? "FOPAG" : "PIX"}).` };
    titulos.push({ item_id: i.id, payload: montarTituloVt({ item: i, competencia: mes.competencia, dataPagamento: mes.data_pagamento, hoje, codigos }) });
  }
  const { data: lote, error } = await supabase.rpc("rh_vt_reservar_lancamentos", { p_competencia: id, p_titulos: titulos });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("rh-vt-lancar-no-consistem", { body: { lote, origem: "vt" } });
  revalidatePath(ROTA_VT, "layout");
  if (erroFuncao) return { ok: false, erro: await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de lançamento. Confira a situação dos títulos.") };
  const r = data as { ok: boolean; lancados: number; recusados: { mensagem: string }[] };
  if (r.ok) return { ok: true, aviso: `${r.lancados} título(s) lançado(s) no Consistem.` };
  return { ok: false, erro: `${r.lancados} lançado(s); ${r.recusados.length} recusado(s) pelo Consistem: ${r.recusados.map((x) => x.mensagem).slice(0, 3).join(" | ")}. Corrija e lance de novo.` };
}

export async function resolverLancamento(idLancamento: string, cod: string, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(idLancamento).success) return { ok: false, erro: "Lançamento inválido." };
  return chamar("rh_vt_resolver_lancamento", { p_id: idLancamento, p_cod: cod.trim() || null, p_motivo: motivo.trim() });
}
