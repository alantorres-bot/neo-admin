// Envio de um lote de títulos reservados em crt_lancamentos_erp (cartão de crédito): encargos, compras, agrupados, provisório
// e as parcelas do desdobramento. Usado pelas Edge Functions crt-lancar-no-consistem e crt-desdobrar-no-consistem.
// Os títulos (payload) foram montados e conferidos pelo painel e gravados na reserva; aqui são enviados tal como estão, EM ORDEM,
// um PUT cada, sem repetir. Para no primeiro que não voltar lançado: erro (4xx, nada criado) ou incerto (fica "enviando":
// conferir no Consistem). Os seguintes viram "erro: envio interrompido" e podem ser reenviados pelo painel.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { incluirLancamento } from "./consistem-inclusao.ts";

type Cfg = { baseUrl: string; token: string; empresa: string };
export type Lancado = { parcela: number | null; codLancamento: string };
export type ResultadoLote = { status: number; corpo: { ok: boolean; tipo: "lancado" | "erro" | "incerto"; lancados: Lancado[]; mensagem?: string; codLancamento?: string } };

/** Envia os títulos ainda reservados do lote. Quem chama já conferiu a pessoa (operador e autora da reserva). */
export async function enviarLoteErp(banco: SupabaseClient, cfg: Cfg, lote: string, itens: { id: string; parcela: number | null; payload: unknown }[]): Promise<ResultadoLote> {
  const lancados: Lancado[] = [];
  for (const item of itens) {
    const { error: erroInicio } = await banco.rpc("crt_iniciar_envio_erp", { p_id: item.id });
    if (erroInicio) {
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: não foi possível iniciar o envio." });
      return { status: 409, corpo: { ok: false, tipo: "erro", lancados, mensagem: erroInicio.message } };
    }
    const r = await incluirLancamento((u, init) => fetch(u, init), cfg, item.payload);
    if (r.tipo === "incerto") {
      await banco.from("crt_lancamentos_erp").update({ erro: r.mensagem, resposta: r.resposta ?? null }).eq("id", item.id);
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: o título anterior ficou sem resposta do Consistem." });
      return { status: 502, corpo: { ok: false, tipo: "incerto", lancados, mensagem: r.mensagem } };
    }
    const { error: erroConcluir } = await banco.rpc("crt_concluir_lancamento_erp", {
      p_id: item.id, p_cod: r.tipo === "lancado" ? r.codLancamento : null, p_resposta: r.resposta ?? null, p_erro: r.tipo === "erro" ? r.mensagem : null,
    });
    if (erroConcluir) {
      const mensagem = r.tipo === "lancado"
        ? `O Consistem criou o lançamento ${r.codLancamento}, mas o registro no Neo Admin falhou (${erroConcluir.message}). Resolva à mão com esse código.`
        : `Erro do Consistem não registrado: ${r.mensagem}`;
      await banco.from("crt_lancamentos_erp").update({ erro: mensagem }).eq("id", item.id);
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido." });
      return { status: 500, corpo: { ok: false, tipo: "incerto", lancados, mensagem } };
    }
    if (r.tipo === "erro") {
      await banco.rpc("crt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: o título anterior foi recusado pelo Consistem." });
      return { status: 422, corpo: { ok: false, tipo: "erro", lancados, mensagem: r.mensagem } };
    }
    lancados.push({ parcela: item.parcela, codLancamento: r.codLancamento });
  }
  return { status: 200, corpo: { ok: true, tipo: "lancado", lancados, codLancamento: lancados[0]?.codLancamento } };
}
