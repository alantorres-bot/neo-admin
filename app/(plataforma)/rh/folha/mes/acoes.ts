"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FORMAS_PAGAMENTO } from "@/lib/modulos/rh/colaboradores/modulo";
import { inicioDoMes } from "@/lib/modulos/rh/calendario";
import { titulosALancar } from "@/lib/modulos/rh/folha/lancamento";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { codigosDoTitulo, montarTitulo, ROTULO_TIPO } from "@/lib/modulos/rh/lancamento";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { gerarRecorrentes } from "../recibos-acoes";
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

// ---------------------------------------------------------------- Consistem (0521)

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
 * Lança no Consistem os títulos da folha aprovada (um por pessoa × tipo com valor e ainda sem título). Monta tudo de novo aqui (não
 * confia na tela), confere com o que a pessoa viu (quantidade e total), reserva (rh_fp_reservar_lancamentos) e chama a Edge Function.
 */
export async function lancarNoConsistem(id: string, esperado: { quantidade: number; totalCentavos: number; chaves: string[] }): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Mês inválido." };
  const chaves = z.array(z.string().max(80)).max(5000).safeParse(esperado.chaves);
  if (!chaves.success) return { ok: false, erro: "Seleção inválida; recarregue a página." };
  const escolhidos = new Set(chaves.data);   // chave = "<item_id>:<tipo>", a mesma da linha do painel
  const supabase = await criarClienteServidor();
  const [mes, itens, lancamentos, parametros] = await Promise.all([lerMes(supabase, id), lerItens(supabase, id), lerLancamentos(supabase, id), lerParametrosRh(supabase)]);
  if (!mes) return { ok: false, erro: "Mês não encontrado." };
  if (!parametros.folhaLigado) return { ok: false, erro: "O lançamento da folha no Consistem está desligado (aba Parâmetros)." };
  const ativos = new Set(lancamentos.filter((l) => l.situacao !== "erro").map((l) => `${l.item_id}:${l.tipo}`));
  const alvo = titulosALancar(itens, mes.competencia, ativos).filter((t) => escolhidos.has(`${t.item_id}:${t.tipo}`));
  const total = alvo.reduce((s, t) => s + Math.round(t.valor * 100), 0);
  if (alvo.length !== esperado.quantidade || total !== esperado.totalCentavos) return { ok: false, erro: "Os títulos mudaram desde que a página abriu; recarregue e confira de novo." };
  if (!alvo.length) return { ok: false, erro: "Nenhum título a lançar." };
  const item = new Map(itens.map((i) => [i.id, i]));
  const hoje = hojeEmCuiaba();
  const titulos = [];
  for (const t of alvo) {
    const i = item.get(t.item_id)!;
    const codigos = codigosDoTitulo(parametros.parametros, t.tipo, i.empregador, i.forma_pagamento);
    if (!codigos) return { ok: false, erro: `Faltam nos Parâmetros os códigos de ${ROTULO_TIPO[t.tipo]} ou o portador de ${i.empregador} (${i.forma_pagamento === "fopag" ? "FOPAG" : "PIX"}).` };
    titulos.push({ item_id: t.item_id, tipo: t.tipo, payload: montarTitulo({ tipo: t.tipo, codFornecedor: i.cod_fornecedor, valor: t.valor, competencia: mes.competencia, dataPagamento: mes.data_pagamento, hoje, codigos }) });
  }
  const { data: lote, error } = await supabase.rpc("rh_fp_reservar_lancamentos", { p_competencia: id, p_titulos: titulos });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("rh-vt-lancar-no-consistem", { body: { lote, origem: "folha" } });
  revalidatePath(ROTA_FOLHA, "layout");
  if (erroFuncao) return { ok: false, erro: await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função de lançamento. Confira a situação dos títulos.") };
  const r = data as { ok: boolean; lancados: number; recusados: { mensagem: string }[] };
  if (r.ok) return { ok: true, aviso: `${r.lancados} título(s) lançado(s) no Consistem.` };
  return { ok: false, erro: `${r.lancados} lançado(s); ${r.recusados.length} recusado(s) pelo Consistem: ${r.recusados.map((x) => x.mensagem).slice(0, 3).join(" | ")}. Corrija e lance de novo.` };
}

export async function resolverLancamento(idLancamento: string, cod: string, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(idLancamento).success) return { ok: false, erro: "Lançamento inválido." };
  return chamar("rh_fp_resolver_lancamento", { p_id: idLancamento, p_cod: cod.trim() || null, p_motivo: motivo.trim() });
}
