"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LIMITES_EXTRA } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { composicaoParaBanco } from "@/lib/modulos/financeiro/contas-pagar/caixa";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { descreverMedicao, descreverSincronizacaoPagar, type ResultadoMedicao, type ResumoSincronizacaoPagar } from "@/lib/modulos/financeiro/contas-pagar/sincronizacao";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { esquemaComposicao } from "./esquema-caixa";

export type ModoAtualizacao = "medir" | "simular" | "gravar";
export type ResultadoAtualizacao = { ok: true; modo: ModoAtualizacao; linhas: string[] } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

/**
 * Atualiza o espelho do contas a pagar pela Edge Function `cap-sincronizar-consistem` (a única que conhece o token da API
 * e usa a service role). Operador do Financeiro ou acima; a função confere de novo no servidor.
 *   medir   só lê a API e devolve tempo e contagens (nada gravado)
 *   simular lê a API e diz o que faria (nada gravado)
 *   gravar  lê a API e grava
 */
export async function atualizarDoConsistem(modo: ModoAtualizacao): Promise<ResultadoAtualizacao> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) {
    return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode atualizar o contas a pagar." };
  }

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("cap-sincronizar-consistem", {
    body: modo === "medir" ? { acao: "medir" } : { acao: "sincronizar", simular: modo === "simular" },
  });

  if (error) {
    let mensagem = "Não foi possível atualizar do Consistem.";
    const resposta = (error as { context?: Response }).context;
    if (resposta && typeof resposta.json === "function") {
      try {
        const detalhe = (await resposta.json()) as { erro?: string };
        if (detalhe.erro) mensagem = detalhe.erro;
      } catch {
        /* mantém a mensagem genérica */
      }
    }
    return { ok: false, erro: mensagem };
  }
  if (data && typeof data === "object" && "erro" in data) return { ok: false, erro: String((data as { erro: unknown }).erro) };

  if (modo === "medir") {
    const m = data as ResultadoMedicao | null;
    if (!m || typeof m.segundosApi !== "number") return { ok: false, erro: "A medição não devolveu resultado." };
    return { ok: true, modo, linhas: descreverMedicao(m) };
  }

  const resultados = (data as { resultados?: ResumoSincronizacaoPagar[] } | null)?.resultados ?? [];
  if (resultados.length === 0) return { ok: false, erro: "A atualização não devolveu resultado." };
  if (modo === "gravar") revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  return { ok: true, modo, linhas: resultados.flatMap(descreverSincronizacaoPagar) };
}

// ---------------------------------------------------------------- montagem do rascunho (tela de seleção)

const uuid = z.string().uuid();
const centavos = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100));
const esquemaExtra = z.object({
  descricao: z.string().trim().min(LIMITES_EXTRA.descricaoMin, "Informe a descrição do pagamento (3 a 200 caracteres).").max(LIMITES_EXTRA.descricaoMax, "A descrição pode ter até 200 caracteres."),
  favorecido: z.string().trim().min(LIMITES_EXTRA.favorecidoMin, "Informe o favorecido (quem recebe).").max(LIMITES_EXTRA.favorecidoMax, "O favorecido pode ter até 120 caracteres."),
  valorCentavos: z.number().int().min(1, "Valor inválido: informe um valor maior que zero.").max(LIMITES_EXTRA.valorMaxCentavos, "Valor acima do limite."),
});
const esquemaMontar = z.object({
  empresaId: uuid,
  lancamentoIds: z.array(uuid).max(500, "Uma autorização aceita no máximo 500 itens.").default([]),
  /** Data do pagamento; só vale quando o rascunho é criado agora (define o código DDMMAA). */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().default(null),
  /** Caixa disponível em centavos; nulo = não mexer no que já está no rascunho. */
  caixaCentavos: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
  /** Composição do caixa (saldos das contas + adicionais); nula = não mexer. Substitui o caixa digitado. */
  composicao: esquemaComposicao.nullable().default(null),
  /** Observação; nula = não mexer. */
  observacao: z.string().trim().max(500, "A observação pode ter até 500 caracteres.").nullable().default(null),
  /** Pagamento extra (fora do Consistem) a incluir na mesma gravação. */
  extra: esquemaExtra.nullable().default(null),
});

export type RascunhoMontado = { id: string; codigo: string; criado: boolean; itens: number; extras: number; totalCentavos: number; totalExtrasCentavos: number; caixaCentavos: number | null };
export type ResultadoMontar = ({ ok: true; aviso: string } & RascunhoMontado) | { ok: false; erro: string };

type LinhaMontada = { id: string; codigo: string; criado: boolean; itens: number; extras: number; total: number | string; total_extras: number | string; caixa_disponivel: number | string | null };
const lerMontado = (r: LinhaMontada): RascunhoMontado => ({
  id: r.id, codigo: r.codigo, criado: r.criado, itens: r.itens, extras: r.extras, totalCentavos: centavos(r.total), totalExtrasCentavos: centavos(r.total_extras),
  caixaCentavos: r.caixa_disponivel === null ? null : centavos(r.caixa_disponivel),
});
const descreverMontado = (m: RascunhoMontado) =>
  `${m.itens} ${m.itens === 1 ? "item" : "itens"} · ${formatarMoeda(m.totalCentavos - m.totalExtrasCentavos)}${m.extras > 0 ? ` + ${m.extras} ${m.extras === 1 ? "extra" : "extras"} · ${formatarMoeda(m.totalExtrasCentavos)}` : ""}`;

/**
 * "Salvar parcial" e "Extras" da tela Autorizar pagamento (função de banco `cap_montar_rascunho`, numa transação): grava os
 * itens marcados (e o extra, se vier) no rascunho em montagem da empresa — o mais recente em rascunho — ou cria um. A pessoa
 * continua na tela. Operador ou acima.
 */
export async function montarRascunho(entrada: z.input<typeof esquemaMontar>): Promise<ResultadoMontar> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode montar uma autorização." };
  const dados = esquemaMontar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { empresaId, lancamentoIds, data, caixaCentavos, composicao, observacao, extra } = dados.data;
  if (lancamentoIds.length === 0 && !extra && caixaCentavos === null && composicao === null && observacao === null) return { ok: false, erro: "Marque itens ou inclua um pagamento extra." };

  const supabase = await criarClienteServidor();
  const { data: r, error } = await supabase.rpc("cap_montar_rascunho", {
    p_empresa: empresaId, p_lancamentos: lancamentoIds, p_caixa: caixaCentavos === null ? null : caixaCentavos / 100, p_observacao: observacao,
    p_extra: extra ? { descricao: extra.descricao, favorecido: extra.favorecido, valor: extra.valorCentavos / 100 } : null, p_data: data,
    p_composicao: composicao ? composicaoParaBanco(composicao) : null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const m = lerMontado(r as LinhaMontada);
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  const aviso = extra
    ? `Pagamento extra incluído no rascunho ${m.codigo}: ${descreverMontado(m)}.`
    : `Rascunho ${m.codigo} ${m.criado ? "criado" : "salvo"}: ${descreverMontado(m)}. Continue marcando, inclua extras ou gere a autorização.`;
  return { ok: true, aviso, ...m };
}

export type ResultadoGerar = { ok: true; id: string; codigo: string; status: "rascunho" | "autorizada"; aviso: string } | { ok: false; erro: string };
const esquemaGerar = esquemaMontar.omit({ extra: true }).extend({ autorizar: z.boolean().default(false) });

/**
 * "Gerar autorização": grava o que estiver marcado no rascunho em montagem (ou cria) e, se o gestor pediu, autoriza na
 * mesma hora (`cap_autorizar`: nasce a pendência na Fila do dia). Devolve o id para abrir a página da autorização.
 */
export async function gerarAutorizacao(entrada: z.input<typeof esquemaGerar>): Promise<ResultadoGerar> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode montar uma autorização." };
  const dados = esquemaGerar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { empresaId, lancamentoIds, data, caixaCentavos, composicao, observacao, autorizar } = dados.data;
  if (autorizar && !temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode autorizar o pagamento." };

  const supabase = await criarClienteServidor();
  const { data: r, error } = await supabase.rpc("cap_montar_rascunho", {
    p_empresa: empresaId, p_lancamentos: lancamentoIds, p_caixa: caixaCentavos === null ? null : caixaCentavos / 100, p_observacao: observacao, p_extra: null, p_data: data,
    p_composicao: composicao ? composicaoParaBanco(composicao) : null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const m = lerMontado(r as LinhaMontada);
  if (m.itens + m.extras === 0) {
    revalidatePath(ROTA_CONTAS_PAGAR, "layout");
    return { ok: false, erro: `O rascunho ${m.codigo} está vazio: marque itens ou inclua um pagamento extra.` };
  }
  let status: "rascunho" | "autorizada" = "rascunho";
  if (autorizar) {
    const { error: erroAut } = await supabase.rpc("cap_autorizar", { p_id: m.id });
    if (erroAut) {
      revalidatePath(ROTA_CONTAS_PAGAR, "layout");
      return { ok: false, erro: `O rascunho ${m.codigo} foi salvo, mas não foi autorizado: ${mensagemDeErro(erroAut)}` };
    }
    status = "autorizada";
  }
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  return {
    ok: true, id: m.id, codigo: m.codigo, status,
    aviso: status === "autorizada"
      ? `Autorização ${m.codigo} autorizada: ${descreverMontado(m)}. A pendência de execução está na Fila do dia.`
      : `Autorização ${m.codigo} gerada como rascunho: ${descreverMontado(m)}.`,
  };
}

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const esquemaTratar = z.object({
  lancamentoId: z.string().uuid(),
  motivo: z.string().trim().min(3, "Informe o motivo (ex.: paga em 02/10 pelo borderô 123).").max(300),
});

/** Marca a antecipação como já paga fora do Neo Admin (registro com motivo e quem; a lista deixa de mostrá-la). */
export async function marcarAntecipacaoTratada(entrada: z.input<typeof esquemaTratar>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode marcar a antecipação." };
  const dados = esquemaTratar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("cap_marcar_antecipacao_tratada", { p_lancamento: dados.data.lancamentoId, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  return { ok: true, aviso: "Antecipação marcada como paga fora do Neo Admin. Ela sai da lista de pendentes." };
}

const esquemaDesfazer = z.object({
  tratadaId: z.string().uuid(),
  motivo: z.string().trim().min(3, "Informe o motivo.").max(300),
});

export async function desfazerAntecipacaoTratada(entrada: z.input<typeof esquemaDesfazer>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode desfazer a marcação." };
  const dados = esquemaDesfazer.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("cap_desfazer_antecipacao_tratada", { p_id: dados.data.tratadaId, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  return { ok: true, aviso: "Marcação desfeita. A antecipação volta à lista de pendentes." };
}
