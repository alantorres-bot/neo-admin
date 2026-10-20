"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lerBuffer } from "@/lib/integracoes/importador/ler-arquivo";
import { anoDoArquivo, lerPlanilhaHistorico } from "@/lib/modulos/financeiro/comissoes/historico";
import {
  lerPlanilhaCreditos, montarProposta, MODULO_COMISSOES, ROTA_COMISSOES, type Credito, type LinhaAnterior, type Representante, type TituloPago,
  type UnidadeTeto,
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
    p_creditos: melhor.creditos.map((c) => ({
      linha: c.linha, data: c.data, cod_cliente: c.cod_cliente, nome_cliente: c.nome_cliente, valor: c.valor_centavos / 100, cod_pedido: c.cod_pedido,
    })),
  });
  if (error) return erro(error);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  return { ok: true, mensagem: `${data} créditos importados. Agora busque os títulos pagos do mês.` };
}

type RespostaFuncao = {
  titulos?: TituloPago[]; porCliente?: Record<string, { cod_representante: string | null; data_emissao: string | null }[]>;
  unidades?: Record<string, UnidadeTeto>; falhas?: string[]; avisos?: string[]; erro?: string;
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
    supabase.from("fin_com_creditos").select("id, data, cod_cliente, nome_cliente, valor, cod_pedido").eq("fechamento_id", fechamentoId),
    // Tudo o que já foi pago (fechados, inclusive o histórico das planilhas): trava por título e base do teto por pedido.
    supabase.from("fin_com_linhas").select("cod_representante, chave, origem, cod_titulo, teto_chave, valor_base")
      .eq("fechada", true).eq("incluida", true).in("origem", ["titulo", "credito", "manual"]).range(0, 19_999),
  ]);
  if (!f) return { ok: false, erro: "Fechamento não encontrado." };
  if (f.status !== "em_conferencia") return { ok: false, erro: "Este fechamento já foi fechado." };
  const creditos: Credito[] = (creds ?? []).map((c) => ({
    id: c.id, data: c.data, cod_cliente: c.cod_cliente, nome_cliente: c.nome_cliente, valor_centavos: Math.round(Number(c.valor) * 100), cod_pedido: c.cod_pedido,
  }));
  if (creditos.length === 0) return { ok: false, erro: "Importe antes a planilha de créditos da CCCCI010 do mês (passo 1)." };
  const representantes: Representante[] = (reps ?? []).map((r) => ({ ...r, perc_venda: Number(r.perc_venda), perc_locacao: Number(r.perc_locacao) }));

  const { data, error } = await supabase.functions.invoke("fin-comissoes-titulos-pagos", {
    body: {
      mes: String(f.competencia).slice(0, 7), clientes: [...new Set(creditos.map((c) => c.cod_cliente))],
      pedidos: [...new Set(creditos.map((c) => c.cod_pedido).filter((x): x is string => !!x))],
    },
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
  const jaPagas = new Set((pagas ?? []).filter((x) => x.origem !== "manual").map((x) => `${x.cod_representante}|${x.chave}`));
  const anteriores: LinhaAnterior[] = (pagas ?? []).map((x) => ({
    cod_representante: x.cod_representante, cod_titulo: x.cod_titulo, teto_chave: x.teto_chave, valor_base_centavos: Math.round(Number(x.valor_base) * 100),
  }));
  const proposta = montarProposta(representantes, resposta.titulos, creditos, resposta.porCliente ?? {}, jaPagas, resposta.unidades ?? {}, anteriores);
  const { error: erroGravar } = await supabase.rpc("fin_com_gravar_proposta", {
    p_id: fechamentoId,
    p_linhas: proposta.linhas.map((l) => ({
      cod_representante: l.cod_representante, cod_representante_venda: l.cod_representante_venda, chave: l.chave, origem: l.origem,
      cod_titulo: l.cod_titulo, cod_cliente: l.cod_cliente, nome_cliente: l.nome_cliente, nota_fiscal: l.nota_fiscal, data_pagamento: l.data_pagamento,
      tipo_baixa: l.tipo_baixa, tipo: l.tipo, valor_base: l.valor_base_centavos / 100, percentual: l.percentual,
      valor_comissao: l.valor_comissao_centavos / 100, valor_consistem: l.comissao_consistem_centavos === null ? null : l.comissao_consistem_centavos / 100,
      observacao: l.observacao, cod_pedido: l.cod_pedido, teto_chave: l.teto_chave,
      teto_valor: l.teto_valor_centavos === null ? null : l.teto_valor_centavos / 100, incluida: l.incluida, motivo: l.motivo,
    })),
    p_creditos: proposta.creditosMarcados,
    p_z_sem_credito: proposta.zSemCredito.map((z) => ({ ...z, valor: z.valor_centavos / 100 })),
  });
  if (erroGravar) return erro(erroGravar);
  revalidatePath(`${ROTA_COMISSOES}/${fechamentoId}`);
  const avisos = [
    `${resposta.titulos.length} títulos pagos lidos; ${proposta.linhas.length} linhas propostas.`,
    proposta.zSemCredito.length > 0 ? `${proposta.zSemCredito.length} título(s) Z sem crédito na CCCCI010.` : "",
    proposta.linhas.some((l) => !l.incluida) ? `${proposta.linhas.filter((l) => !l.incluida).length} linha(s) barrada(s) pelo teto do pedido: confira.` : "",
    (resposta.falhas ?? []).length > 0 ? `Sem detalhe no Consistem: ${(resposta.falhas ?? []).join(", ")}.` : "",
    ...(resposta.avisos ?? []),
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

/** Reabre o último mês fechado (gestor), com motivo: volta para conferência; a reabertura fica registrada. */
export async function reabrirFechamento(fechamentoId: string, motivo: string): Promise<Resultado> {
  const p = await exigir("gestor");
  if (!p.ok) return p;
  if (!uuid.safeParse(fechamentoId).success) return { ok: false, erro: "Fechamento inválido." };
  if (motivo.trim().length < 5) return { ok: false, erro: "Informe o motivo da reabertura." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_com_reabrir", { p_id: fechamentoId, p_motivo: motivo.trim().slice(0, 500) });
  if (error) return erro(error);
  revalidatePath(ROTA_COMISSOES, "layout");
  return { ok: true, mensagem: "Fechamento reaberto: corrija, confira e feche de novo." };
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

/**
 * Histórico (gestor, regra 13): a planilha anual "Comissões <Nome> - <ano>.xlsx" de um representante. Cada aba de mês vira
 * um mês já pago (fechamento de histórico). Mês que já tem fechamento no sistema fica de fora. Reimportar substitui.
 */
export async function importarHistorico(dados: FormData): Promise<Resultado> {
  const p = await exigir("gestor");
  if (!p.ok) return p;
  const arquivo = dados.get("arquivo");
  const cod = String(dados.get("representante") ?? "").trim();
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha a planilha anual de comissões." };
  const ano = anoDoArquivo(arquivo.name);
  if (ano === null) return { ok: false, erro: "Não achei o ano no nome do arquivo (ex.: \"Comissões Fernando - 2026.xlsx\")." };
  const supabase = await criarClienteServidor();
  const { data: rep } = await supabase.from("fin_com_representantes").select("cod_representante, nome").eq("cod_representante", cod).maybeSingle();
  if (!rep) return { ok: false, erro: "Escolha o representante." };
  const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
  if (!lido.ok) return { ok: false, erro: lido.erro };
  const { meses, erros } = lerPlanilhaHistorico(lido.planilhas, ano, rep.nome);
  if (erros.length > 0) return { ok: false, erro: `Nada foi importado. ${erros.slice(0, 4).join(" ")}` };
  if (meses.length === 0) return { ok: false, erro: "A planilha não tem abas de mês com linhas." };
  const importados: string[] = [], pulados: string[] = [];
  let repetidos = 0;
  for (const m of meses) {
    const { data, error } = await supabase.rpc("fin_com_importar_historico", {
      p_competencia: m.competencia, p_representante: rep.cod_representante, p_arquivo: arquivo.name,
      p_linhas: m.linhas.map((l) => ({
        origem: l.origem, cod_titulo: l.cod_titulo, nome_cliente: l.nome_cliente, data_pagamento: l.data_pagamento, tipo: l.tipo,
        valor_base: l.valor_base_centavos / 100, percentual: l.percentual, valor_comissao: l.valor_comissao_centavos / 100, observacao: l.observacao,
      })),
    });
    if (error) {
      if (/já tem fechamento no sistema/.test(error.message)) { pulados.push(m.aba); continue; }
      return { ok: false, erro: `${m.aba}: ${mensagemDeErroBanco(error)}${importados.length ? ` (já importados: ${importados.join(", ")})` : ""}` };
    }
    importados.push(m.aba);
    repetidos += Number(data ?? 0);
  }
  revalidatePath(ROTA_COMISSOES, "layout");
  return {
    ok: true,
    mensagem: [
      `Histórico de ${rep.nome}: ${importados.length ? importados.join(", ") : "nenhum mês"} importado(s).`,
      pulados.length ? `Já têm fechamento no sistema (ficaram de fora): ${pulados.join(", ")}.` : "",
      repetidos ? `${repetidos} título(s) aparecem pagos em mais de um mês na planilha: veja os marcados "Repetido".` : "",
    ].filter(Boolean).join(" "),
  };
}
