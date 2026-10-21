"use server";

// Ações do líder do setor. Ele não tem a área RH: tudo passa pelas funções rh_pt_* do banco, que conferem se ele é
// titular ou substituto do setor do lote.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_JUSTIFICAR, TIPOS } from "@/lib/modulos/rh/ponto/modulo";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");

const esquema = z.object({
  lote: z.string().uuid(),
  itens: z.array(z.object({
    id: z.string().uuid(),
    tipo: z.enum(TIPOS).nullable(),
    horario: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Horário inválido (use hh:mm).").nullable(),
    observacao: z.string().trim().max(500).nullable(),
  })).max(500),
});

export async function salvarJustificativas(entrada: z.input<typeof esquema>, enviar: boolean): Promise<Resultado> {
  await exigirSessao();
  const d = esquema.safeParse(entrada);
  if (!d.success) return { ok: false, erro: d.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_pt_justificar", { p_lote: d.data.lote, p_itens: d.data.itens });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  if (enviar) {
    const { error: e2 } = await supabase.rpc("rh_pt_enviar_justificativas", { p_lote: d.data.lote });
    if (e2) return { ok: false, erro: `Salvo, mas não enviado: ${mensagemDeErro(e2)}` };
  }
  revalidatePath(ROTA_JUSTIFICAR, "layout");
  return { ok: true, aviso: enviar ? "Justificativas enviadas ao RH. Obrigado!" : "Salvo. Falta enviar." };
}
