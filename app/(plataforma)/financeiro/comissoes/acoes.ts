"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lerBuffer } from "@/lib/integracoes/importador/ler-arquivo";
import {
  lerPlanilhaCreditos, montarProposta, MODULO_COMISSOES, ROTA_COMISSOES, type Credito, type Representante, type TituloPago,
} from "@/lib/modulos/financeiro/comissoes/regras";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; mensagem?: string; id?: string } | { ok: false; erro: string };

const uuid = z.string().uuid();
const erro = (e: { code?: string; message: string }): Resultado => ({ ok: false, erro: mensagemDeErroBanco(e) });

async function exigir(nivel: "operador" | "gestor") {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, nivel)) {
    return { ok: false as const, erro: `Somente ${nivel} do Financeiro (ou acima) pode fazer isso nas comissões.` };
  }
  return { ok: true as const };
}

/** Abre (ou reabre a tela de) o fechamento do mês 'aaaa-mm'. */
export async function abrirFechamento(mes: string): Promise<Resultado> {
  const p = await exigir("operador");
  if (!p.ok) return p;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { ok: false, erro: "Escolha o mês." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("fin_com_abrir", { p_competencia: `${mes}-01` });
  if (error) return erro(error);
  revalidatePath(ROTA_COMISSOES);
  return { ok: true, id: data as string };
}

/** Passo 1: planilha de créditos da CCCCI010 (data, código do cliente, nome, valor). Substitui a anterior do mês. */
export async function importarCreditos(fechamentoId: string, dados: FormData): Promise<Resultado> {
  const p = await exigir("operador");
  if (!p.ok) return p;
  if (!uuid.safeParse(fechamentoId).success) return { ok: false, erro: "Fechamento inválido." };
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha a planilha da CCCCI010." };
  const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
  if (!lido.ok) return { ok: false, erro: lido.erro };
  // Usa a primeira aba que tiver créditos reconhecíveis.
  let melhor: ReturnType<typeof lerPlanilhaCreditos> | null = null;
  for (const planilha of lido.planilhas) {
    const r = lerPlanilhaCreditos(planilha.matriz);
    if (r.creditos.length > 0) { melhor = r; break; }
    melhor ??= r;
  }
  if (!melhor || melhor.creditos.length === 0) return { ok: false, erro: melhor?.erros[0] ?? "A planilha não tem créditos." };
  if (melhor.erros.length > 0) return { ok: false, erro: `Corrija a planilha antes de importar: ${melhor.erros.slice(0, 5).join(" ")}` };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("fin_com_importar_creditos", {
    p_id: fechamentoId, p_arquivo: arquivo.name,
    p_creditos: melhor.creditos.map((c) => ({ linha: c.linha, data: c.data, cod_cliente: c.cod_cliente, nome_cliente: c.nome_cliente, valor: c.valor_centavos / 100 })),
  });
  if (error) return erro(error);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  return { ok: true, mensagem: `${data} créditos importados. Agora busque os títulos pagos do mês.` };
}

type RespostaFuncao = {
  titulos?: TituloPago[]; porCliente?: Record<string, { cod_representante: string | null; data_emissao: string | null }[]>; falhas?: string[]; erro?: string;
};

/** Passo 2: títulos pagos do mês (Consistem) + créditos → proposta por representante. Refazer mantém as decisões. */
export async function buscarTitulosPagos(fechamentoId: string): Promise<Resultado> {
  const p = await exigir("operador");
  if (!p.ok) return p;
  if (!uuid.safeParse(fechamentoId).success) return { ok: false, erro: "Fechamento inválido." };
  const supabase = await criarClienteServidor();
  const [{ data: f }, { data: reps }, { data: creds }, { data: pagas }] = await Promise.all([
    supabase.from("fin_com_fechamentos").select("id, competencia, status").eq("id", fechamentoId).maybeSingle(),
    supabase.from("fin_com_representantes").select("cod_representante, nome, perc_venda, perc_locacao, recebe_de, ativo"),
    supabase.from("fin_com_creditos").select("id, data, cod_cliente, nome_cliente, valor").eq("fechamento_id", fechamentoId),
    supabase.from("fin_com_linhas").select("cod_representante, chave").eq("fechada", true).eq("incluida", true).in("origem", ["titulo", "credito"]),
  ]);
  if (!f) return { ok: false, erro: "Fechamento não encontrado." };
  if (f.status !== "em_conferencia") return { ok: false, erro: "Este fechamento já foi fechado." };
  const creditos: Credito[] = (creds ?? []).map((c) => ({ id: c.id, data: c.data, cod_cliente: c.cod_cliente, nome_cliente: c.nome_cliente, valor_centavos: Math.round(Number(c.valor) * 100) }));
  if (creditos.length === 0) return { ok: false, erro: "Importe antes a planilha de créditos da CCCCI010 do mês (passo 1)." };
  const representantes: Representante[] = (reps ?? []).map((r) => ({ ...r, perc_venda: Number(r.perc_venda), perc_locacao: Number(r.perc_locacao) }));

  const { data, error } = await supabase.functions.invoke("fin-comissoes-titulos-pagos", {
    body: { mes: String(f.competencia).slice(0, 7), clientes: [...new Set(creditos.map((c) => c.cod_cliente))] },
  });
  const resposta = (data ?? {}) as RespostaFuncao;
  if (error || !resposta.titulos) {
    let mensagem = resposta.erro ?? "Não foi possível buscar os títulos pagos no Consistem.";
    const ctx = (error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === "function") {
      try { mensagem = ((await ctx.json()) as { erro?: string }).erro ?? mensagem; } catch { /* mantém */ }
    }
    return { ok: false, erro: mensagem };
  }
  const jaPagas = new Set((pagas ?? []).map((x) => `${x.cod_representante}|${x.chave}`));
  const proposta = montarProposta(representantes, resposta.titulos, creditos, resposta.porCliente ?? {}, jaPagas);
  const { error: erroGravar } = await supabase.rpc("fin_com_gravar_proposta", {
    p_id: fechamentoId,
    p_linhas: proposta.linhas.map((l) => ({
      cod_representante: l.cod_representante, cod_representante_venda: l.cod_representante_venda, chave: l.chave, origem: l.origem,
      cod_titulo: l.cod_titulo, cod_cliente: l.cod_cliente, nome_cliente: l.nome_cliente, nota_fiscal: l.nota_fiscal, data_pagamento: l.data_pagamento,
      tipo_baixa: l.tipo_baixa, tipo: l.tipo, valor_base: l.valor_base_centavos / 100, percentual: l.percentual,
      valor_comissao: l.valor_comissao_centavos / 100, valor_consistem: l.comissao_consistem_centavos === null ? null : l.comissao_consistem_centavos / 100,
      observacao: l.observacao,
    })),
    p_creditos: proposta.creditosMarcados,
    p_z_sem_credito: proposta.zSemCredito.map((z) => ({ ...z, valor: z.valor_centavos / 100 })),
  });
  if (erroGravar) return erro(erroGravar);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  const avisos = [
    `${resposta.titulos.length} títulos pagos lidos; ${proposta.linhas.length} linhas propostas.`,
    proposta.zSemCredito.length > 0 ? `${proposta.zSemCredito.length} título(s) Z sem crédito na CCCCI010.` : "",
    (resposta.falhas ?? []).length > 0 ? `Sem detalhe no Consistem: ${(resposta.falhas ?? []).join(", ")}.` : "",
  ].filter(Boolean);
  return { ok: true, mensagem: avisos.join(" ") };
}

/** Incluir/excluir (motivo obrigatório ao excluir) e trocar Venda/Locação. */
export async function ajustarLinha(linhaId: string, incluida: boolean, motivo: string, tipo: "venda" | "locacao", fechamentoId: string): Promise<Resultado> {
  const p = await exigir("operador");
  if (!p.ok) return p;
  if (!uuid.safeParse(linhaId).success) return { ok: false, erro: "Linha inválida." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_com_ajustar_linha", { p_linha: linhaId, p_incluida: incluida, p_motivo: motivo, p_tipo: tipo });
  if (error) return erro(error);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  return { ok: true };
}

const esquemaLancamento = z.object({
  representante: z.string().trim().min(1, "Escolha o representante."),
  origem: z.enum(["manual", "antecipacao"]),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
  descricao: z.string().trim().min(3, "Informe a descrição.").max(200),
  valor: z.string().trim().min(1, "Informe o valor."),
  tipo: z.enum(["venda", "locacao"]).default("venda"),
  titulo: z.string().trim().max(30).optional(),
});

/** Lançamento manual (comissão sobre um valor-base) ou antecipação de comissão já paga (abate do total). */
export async function lancar(fechamentoId: string, dados: FormData): Promise<Resultado> {
  const p = await exigir("operador");
  if (!p.ok) return p;
  if (!uuid.safeParse(fechamentoId).success) return { ok: false, erro: "Fechamento inválido." };
  const e = esquemaLancamento.safeParse(Object.fromEntries(dados));
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Dados inválidos." };
  const valor = Number(e.data.valor.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Valor inválido." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_com_lancar", {
    p_id: fechamentoId, p_representante: e.data.representante, p_origem: e.data.origem, p_data: e.data.data, p_descricao: e.data.descricao,
    p_valor: valor, p_tipo: e.data.tipo, p_cod_titulo: e.data.titulo || null,
  });
  if (error) return erro(error);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  return { ok: true };
}

/** Fecha o mês (gestor): congela o fechamento. */
export async function fecharMes(fechamentoId: string): Promise<Resultado> {
  const p = await exigir("gestor");
  if (!p.ok) return p;
  if (!uuid.safeParse(fechamentoId).success) return { ok: false, erro: "Fechamento inválido." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_com_fechar", { p_id: fechamentoId });
  if (error) return erro(error);
  revalidatePath(ROTA_COMISSOES, "layout");
  return { ok: true, mensagem: "Fechamento concluído." };
}

const esquemaRep = z.object({
  cod: z.string().trim().min(1, "Informe o código do representante no Consistem.").max(10),
  nome: z.string().trim().min(2, "Informe o nome.").max(120),
  perc_venda: z.string().trim(),
  perc_locacao: z.string().trim(),
  recebe_de: z.string().trim().default(""),
  ativo: z.string().optional(),
});

/** Cadastro do representante comissionado (gestor). */
export async function salvarRepresentante(dados: FormData): Promise<Resultado> {
  const p = await exigir("gestor");
  if (!p.ok) return p;
  const e = esquemaRep.safeParse(Object.fromEntries(dados));
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Dados inválidos." };
  const perc = (v: string) => Number(v.replace(",", "."));
  const pv = perc(e.data.perc_venda), pl = perc(e.data.perc_locacao);
  if (![pv, pl].every((x) => Number.isFinite(x) && x >= 0 && x <= 100)) return { ok: false, erro: "Percentual inválido (0 a 100)." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_com_salvar_representante", {
    p_cod: e.data.cod, p_nome: e.data.nome, p_perc_venda: pv, p_perc_locacao: pl,
    p_recebe_de: e.data.recebe_de.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), p_ativo: e.data.ativo === "on",
  });
  if (error) return erro(error);
  revalidatePath(ROTA_COMISSOES, "layout");
  return { ok: true, mensagem: "Representante salvo." };
}
