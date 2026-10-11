"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { compararComCaixa, mensagemSlack, resumirItens } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { gerarPdfAutorizacao, nomeArquivoAutorizacao } from "@/lib/modulos/financeiro/contas-pagar/pdf-autorizacao";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { lerAutorizacao, quandoEm } from "../../dados";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();

function revalidar(id: string) {
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  revalidatePath(`${ROTA_CONTAS_PAGAR}/autorizacoes/${id}`);
  revalidatePath("/financeiro/recebiveis/fila");
}

/** Gestor autoriza o rascunho (função de banco `cap_autorizar`): status muda e nasce a pendência de execução na Fila do dia. */
export async function autorizar(id: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode autorizar o pagamento." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Autorização inválida." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_autorizar", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(id);
  const r = (data ?? {}) as { numero?: number; itens?: number };
  return { ok: true, aviso: `Autorização nº ${r.numero} autorizada (${r.itens} ${r.itens === 1 ? "item" : "itens"}). A pendência de execução está na Fila do dia.` };
}

const esquemaMotivo = z.object({ id: uuid, motivo: z.string().trim().min(3, "Informe o motivo.").max(300, "O motivo pode ter até 300 caracteres.") });

/** Cancela (gestor; ou quem montou, enquanto rascunho). A pendência de execução é cancelada junto. Nada é apagado. */
export async function cancelar(entrada: z.input<typeof esquemaMotivo>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Sem permissão para cancelar." };
  const dados = esquemaMotivo.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_cancelar", { p_id: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(dados.data.id);
  const r = (data ?? {}) as { numero?: number };
  return { ok: true, aviso: `Autorização nº ${r.numero} cancelada. Os itens voltam à lista de pendentes.` };
}

const esquemaRemover = z.object({ autorizacaoId: uuid, itemId: uuid, motivo: z.string().trim().min(3, "Informe o motivo.").max(300) });

/** Remove um item do rascunho (registro com motivo; nunca delete). */
export async function removerItem(entrada: z.input<typeof esquemaRemover>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode remover itens." };
  const dados = esquemaRemover.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("cap_remover_item", { p_item: dados.data.itemId, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(dados.data.autorizacaoId);
  const r = (data ?? {}) as { restantes?: number };
  return { ok: true, aviso: r.restantes === 0 ? "Item removido. A autorização ficou sem itens: cancele-a ou volte à lista para gerar outra." : "Item removido do rascunho." };
}

const esquemaCaixa = z.object({ id: uuid, caixaCentavos: z.number().int().min(0).max(100_000_000_000).nullable() });

/** Ajusta o caixa disponível de um rascunho (função de banco `cap_definir_caixa`). Ultrapassar o caixa é só aviso. */
export async function definirCaixa(entrada: z.input<typeof esquemaCaixa>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode alterar o caixa." };
  const dados = esquemaCaixa.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("cap_definir_caixa", { p_id: dados.data.id, p_caixa: dados.data.caixaCentavos === null ? null : dados.data.caixaCentavos / 100 });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidar(dados.data.id);
  return { ok: true, aviso: dados.data.caixaCentavos === null ? "Caixa disponível removido." : "Caixa disponível atualizado." };
}

export type ResultadoSlack = { ok: true; permalink: string | null; aviso: string } | { ok: false; erro: string; naoConfigurado?: boolean };

const centavos = (v: number | string | null) => (v === null ? 0 : Math.round(Number(v) * 100));

/**
 * Publica a autorização no canal do financeiro no Slack (mensagem + PDF) pela Edge Function `cap-enviar-slack`, que tem o
 * token do aplicativo. Só gestor, só no clique com confirmação. O PDF é gerado aqui no servidor.
 */
export async function enviarNoSlack(entrada: { id: string; link: string }): Promise<ResultadoSlack> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode enviar a autorização no Slack." };
  if (!uuid.safeParse(entrada.id).success) return { ok: false, erro: "Autorização inválida." };
  const link = typeof entrada.link === "string" && /^https?:\/\//.test(entrada.link) ? entrada.link.slice(0, 500) : "";

  const supabase = await criarClienteServidor();
  const lido = await lerAutorizacao(supabase, entrada.id);
  if (!lido) return { ok: false, erro: "Autorização não encontrada." };
  const { autorizacao: a, itens } = lido;
  if (a.status === "cancelada") return { ok: false, erro: "Autorização cancelada não é enviada." };
  const ativos = itens.filter((i) => i.removido_em === null);
  const resumo = resumirItens(ativos.map((i) => ({ tipo: i.tipo, valorCentavos: centavos(i.valor), removido: false, baixadoConsistemEm: i.baixado_consistem_em })));
  const caixa = compararComCaixa(resumo.geral.centavos, a.caixa_disponivel === null ? null : centavos(a.caixa_disponivel));

  const pdf = await gerarPdfAutorizacao({
    numero: a.numero, data: a.data, status: a.status, empresaRazaoSocial: a.empresa_razao_social, empresaCnpj: a.empresa_cnpj,
    observacao: a.observacao, motivoCancelamento: a.motivo_cancelamento, caixaCentavos: a.caixa_disponivel === null ? null : centavos(a.caixa_disponivel),
    criadoPor: a.criado_por_nome, criadoEm: quandoEm(a.criado_em), autorizadaPor: a.autorizada_por_nome, autorizadaEm: a.autorizada_em ? quandoEm(a.autorizada_em) : null,
    canceladaEm: a.cancelada_em ? formatarData(a.cancelada_em) : null, emitidoEm: quandoEm(new Date().toISOString()),
    itens: ativos.map((i) => ({
      tipo: i.tipo, fornecedorNome: i.fornecedor_nome, fornecedorDocumento: i.fornecedor_documento, codFornecedor: i.cod_fornecedor, numDocumento: i.num_documento,
      codLancamento: i.cod_lancamento, dataVencimento: i.data_vencimento, dataPagamento: i.data_pagamento, complemento: i.complemento_historico, valorCentavos: centavos(i.valor),
    })),
  });
  const mensagem = mensagemSlack({
    numero: a.numero, data: formatarData(a.data), empresa: a.empresa_nome, status: a.status, titulos: resumo.titulos, antecipacoes: resumo.antecipacoes,
    totalCentavos: resumo.geral.centavos, caixa, autorizadaPor: a.autorizada_por_nome, observacao: a.observacao, link: link || `${ROTA_CONTAS_PAGAR}/autorizacoes/${a.id}`,
  });

  const { data, error } = await supabase.functions.invoke("cap-enviar-slack", {
    body: { autorizacaoId: a.id, mensagem, pdfBase64: Buffer.from(pdf).toString("base64"), nomeArquivo: nomeArquivoAutorizacao(a.numero, a.data) },
  });
  if (error) {
    let detalhe: { erro?: string; detalhe?: string } = {};
    const resposta = (error as { context?: Response }).context;
    if (resposta && typeof resposta.json === "function") {
      try { detalhe = (await resposta.json()) as { erro?: string; detalhe?: string }; } catch { /* genérico */ }
    }
    if (detalhe.erro === "nao_configurado") return { ok: false, erro: detalhe.detalhe ?? "Envio pelo Slack ainda não configurado.", naoConfigurado: true };
    return { ok: false, erro: detalhe.erro ?? "Não foi possível enviar no Slack." };
  }
  const r = (data ?? {}) as { ok?: boolean; erro?: string; permalink?: string | null; aviso?: string };
  if (!r.ok) return { ok: false, erro: r.erro ?? "Não foi possível enviar no Slack." };
  revalidar(a.id);
  return { ok: true, permalink: r.permalink ?? null, aviso: r.aviso ?? `Autorização nº ${a.numero} publicada no canal do financeiro com o PDF.` };
}
