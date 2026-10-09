"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { descreverMedicao, descreverSincronizacaoPagar, type ResultadoMedicao, type ResumoSincronizacaoPagar } from "@/lib/modulos/financeiro/contas-pagar/sincronizacao";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

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

// ---------------------------------------------------------------- autorização (Fase 2)

export type ResultadoCriar = { ok: true; id: string; numero: number; status: "rascunho" | "autorizada"; aviso: string } | { ok: false; erro: string };

const esquemaCriar = z.object({
  empresaId: z.string().uuid(),
  lancamentoIds: z.array(z.string().uuid()).min(1, "Marque pelo menos um item.").max(500, "Uma autorização aceita no máximo 500 itens."),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().default(null),
  observacao: z.string().trim().max(500, "A observação pode ter até 500 caracteres.").default(""),
  autorizar: z.boolean().default(false),
});

/**
 * Gera a autorização de pagamento (função de banco `cap_criar_autorizacao`, numa transação): cabeçalho numerado + cópia dos
 * itens marcados. Operador ou acima monta o rascunho; com `autorizar`, o gestor já autoriza na mesma transação (nasce a
 * pendência "Executar autorização" na Fila do dia).
 */
export async function criarAutorizacao(entrada: z.input<typeof esquemaCriar>): Promise<ResultadoCriar> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) pode montar uma autorização." };
  const dados = esquemaCriar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const { empresaId, lancamentoIds, data, observacao, autorizar } = dados.data;
  if (autorizar && !temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) pode autorizar o pagamento." };

  const supabase = await criarClienteServidor();
  const { data: r, error } = await supabase.rpc("cap_criar_autorizacao", {
    p_empresa: empresaId, p_lancamentos: lancamentoIds, p_observacao: observacao || null, p_data: data, p_autorizar: autorizar,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const resultado = r as { id: string; numero: number; itens: number; status: "rascunho" | "autorizada" };

  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  revalidatePath("/financeiro/recebiveis/fila");
  return {
    ok: true, id: resultado.id, numero: resultado.numero, status: resultado.status,
    aviso: resultado.status === "autorizada"
      ? `Autorização nº ${resultado.numero} gerada e autorizada (${resultado.itens} ${resultado.itens === 1 ? "item" : "itens"}). A pendência de execução está na Fila do dia.`
      : `Rascunho da autorização nº ${resultado.numero} gerado com ${resultado.itens} ${resultado.itens === 1 ? "item" : "itens"}.`,
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
