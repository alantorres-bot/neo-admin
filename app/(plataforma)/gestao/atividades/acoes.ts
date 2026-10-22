"use server";

import { revalidatePath } from "next/cache";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** Liga ou desliga o registro de acessos (só admin geral; a RLS de `configuracoes` também exige). */
export async function definirRegistroAcessos(ligar: boolean): Promise<{ ok: true } | { ok: false; erro: string }> {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("configuracoes").update({ valor: ligar })
    .eq("chave", "administrativo.gestao.registrar_acessos").select("chave");
  if (error) return { ok: false, erro: mensagemDeErroBanco(error) };
  if (!data?.length) return { ok: false, erro: "Parâmetro não encontrado: aplique a migration 0094." };
  revalidatePath("/gestao/atividades");
  return { ok: true };
}
