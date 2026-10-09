"use server";

import { revalidatePath } from "next/cache";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { descreverMedicao, descreverSincronizacaoPagar, type ResultadoMedicao, type ResumoSincronizacaoPagar } from "@/lib/modulos/financeiro/contas-pagar/sincronizacao";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type ModoAtualizacao = "medir" | "simular" | "gravar";
export type ResultadoAtualizacao = { ok: true; modo: ModoAtualizacao; linhas: string[] } | { ok: false; erro: string };

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
