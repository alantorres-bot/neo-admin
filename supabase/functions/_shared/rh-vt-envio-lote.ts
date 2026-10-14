// Envio de um lote de títulos do vale-transporte reservados em rh_vt_lancamentos_erp (um por colaborador). Usado pela Edge
// Function rh-vt-lancar-no-consistem. Os payloads foram montados e conferidos pelo painel e pela reserva; aqui vão tal como
// estão, EM ORDEM, um PUT cada, sem repetir. Diferente do cartão, os títulos são independentes: um recusado (4xx, nada criado)
// vira "erro" e o envio segue. Uma resposta INCERTA (sem código, 5xx, rede) para o lote: fica "enviando" para conferir no
// Consistem, e os seguintes viram "erro: envio interrompido" (podem ser lançados de novo pelo painel).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { incluirLancamento } from "./consistem-inclusao.ts";

type Cfg = { baseUrl: string; token: string; empresa: string };
export type ResultadoLoteVt = {
  status: number;
  corpo: { ok: boolean; tipo: "lancado" | "parcial" | "incerto" | "erro"; lancados: number; recusados: { id: string; mensagem: string }[]; mensagem?: string };
};

export async function enviarLoteVt(banco: SupabaseClient, cfgDe: (id: string) => Cfg, lote: string, itens: { id: string; payload: unknown }[]): Promise<ResultadoLoteVt> {
  let lancados = 0;
  const recusados: { id: string; mensagem: string }[] = [];
  for (const item of itens) {
    const { error: erroInicio } = await banco.rpc("rh_vt_iniciar_envio_erp", { p_id: item.id });
    if (erroInicio) {
      await banco.rpc("rh_vt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: não foi possível iniciar o envio." });
      return { status: 409, corpo: { ok: false, tipo: "erro", lancados, recusados, mensagem: erroInicio.message } };
    }
    const r = await incluirLancamento((u, init) => fetch(u, init), cfgDe(item.id), item.payload);
    if (r.tipo === "incerto") {
      await banco.from("rh_vt_lancamentos_erp").update({ erro: r.mensagem, resposta: r.resposta ?? null }).eq("id", item.id);
      await banco.rpc("rh_vt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido: um título anterior ficou sem resposta do Consistem." });
      return { status: 502, corpo: { ok: false, tipo: "incerto", lancados, recusados, mensagem: r.mensagem } };
    }
    const { error: erroConcluir } = await banco.rpc("rh_vt_concluir_lancamento_erp", {
      p_id: item.id, p_cod: r.tipo === "lancado" ? r.codLancamento : null, p_resposta: r.resposta ?? null, p_erro: r.tipo === "erro" ? r.mensagem : null,
    });
    if (erroConcluir) {
      const mensagem = r.tipo === "lancado"
        ? `O Consistem criou o lançamento ${r.codLancamento}, mas o registro no Neo Admin falhou (${erroConcluir.message}). Resolva à mão com esse código.`
        : `Erro do Consistem não registrado: ${r.mensagem}`;
      await banco.from("rh_vt_lancamentos_erp").update({ erro: mensagem }).eq("id", item.id);
      await banco.rpc("rh_vt_interromper_lote", { p_lote: lote, p_motivo: "Envio interrompido." });
      return { status: 500, corpo: { ok: false, tipo: "incerto", lancados, recusados, mensagem } };
    }
    if (r.tipo === "erro") recusados.push({ id: item.id, mensagem: r.mensagem });
    else lancados++;
  }
  const tipo = recusados.length === 0 ? "lancado" : lancados === 0 ? "erro" : "parcial";
  return { status: 200, corpo: { ok: recusados.length === 0, tipo, lancados, recusados } };
}
