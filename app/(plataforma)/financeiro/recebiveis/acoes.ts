"use server";

import { revalidatePath } from "next/cache";
import { descreverSincronizacao, type ResumoSincronizacao } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type ResultadoSincronizacao = { ok: true; simulacao: boolean; linhas: string[] } | { ok: false; erro: string };

/**
 * Sincroniza as contas a receber com o Consistem pela Edge Function `rec-sincronizar-consistem` (a única que
 * conhece o token da API e usa a service role). Só gestor do Financeiro; a função confere de novo no servidor.
 * Com `simular`, a função só informa o que faria, sem gravar nada.
 */
export async function sincronizarConsistem(simular: boolean): Promise<ResultadoSincronizacao> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) {
    return { ok: false, erro: "Somente o gestor do Financeiro pode sincronizar com o Consistem." };
  }

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("rec-sincronizar-consistem", {
    body: { acao: "sincronizar", simular },
  });

  if (error) {
    let mensagem = "Não foi possível sincronizar com o Consistem.";
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

  const resultados = ((data as { resultados?: ResumoSincronizacao[] } | null)?.resultados ?? []);
  if (resultados.length === 0) return { ok: false, erro: "A sincronização não devolveu resultado." };

  if (!simular) {
    revalidatePath("/financeiro/recebiveis");
    revalidatePath("/financeiro/cobranca", "layout");
    revalidatePath("/financeiro/recebiveis/fila");
  }
  return { ok: true, simulacao: simular, linhas: resultados.flatMap(descreverSincronizacao) };
}
