"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const inteiro = (rotulo: string) => z.coerce.number({ message: `${rotulo}: informe um número.` }).int(`${rotulo}: número inteiro.`);
const esquema = z.object({
  dias_prazo_proximo: inteiro("Prazo próximo").min(0).max(30),
  dias_atraso_relevante: inteiro("Atraso relevante").min(1).max(90),
  dias_bloqueio_relevante: inteiro("Bloqueio relevante").min(0).max(30),
  dias_sem_movimentacao: inteiro("Sem movimentação").min(1).max(90),
});

/** Salva os limites e registra a aprovação (só admin geral; a função do banco também exige e valida as faixas). */
export async function salvarLimites(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral();
  const entrada = esquema.safeParse(Object.fromEntries(["dias_prazo_proximo", "dias_atraso_relevante", "dias_bloqueio_relevante", "dias_sem_movimentacao"]
    .map((c) => [c, dados.get(c)])));
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("central_salvar_parametros", { p_valores: entrada.data, p_aprovar: true });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath("/gestao");
  revalidatePath("/gestao/regras");
  return { ok: true, chave: Date.now() };
}
