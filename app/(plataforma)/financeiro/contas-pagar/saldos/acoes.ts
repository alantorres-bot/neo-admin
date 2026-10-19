"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();

const esquemaSaldos = z.object({
  empresaId: uuid,
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  saldos: z.array(z.object({ contaId: uuid, saldoCentavos: z.number().int().min(-100_000_000_000).max(100_000_000_000) }))
    .min(1, "Informe pelo menos um saldo.").max(100, "No máximo 100 contas por vez."),
});

/**
 * Registra os saldos conciliados do dia (função de banco `fin_registrar_saldos`, numa transação). Saldo igual ao já
 * registrado é ignorado; diferente substitui (o anterior fica como prova). Com os saldos de hoje completos, a pendência
 * "Registrar saldos bancários" do dia é concluída. Operador ou acima.
 */
export async function registrarSaldos(entrada: z.input<typeof esquemaSaldos>): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) registra saldos bancários." };
  const dados = esquemaSaldos.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("fin_registrar_saldos", {
    p_empresa: dados.data.empresaId, p_data: dados.data.data,
    p_saldos: dados.data.saldos.map((s) => ({ conta_id: s.contaId, saldo: s.saldoCentavos / 100 })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  revalidatePath("/inicio");
  const r = (data ?? {}) as { gravados?: number; iguais?: number };
  const gravados = r.gravados ?? 0;
  return { ok: true, aviso: gravados === 0 ? "Nada mudou: os saldos já estavam registrados com esses valores." : `${gravados} ${gravados === 1 ? "saldo registrado" : "saldos registrados"}.` };
}

/** Gestor decide se a conta soma no caixa disponível da autorização (`fin_definir_conta_caixa`). */
export async function definirContaCaixa(entrada: { contaId: string; entra: boolean }): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) define quais contas entram no caixa." };
  if (!uuid.safeParse(entrada.contaId).success) return { ok: false, erro: "Conta inválida." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fin_definir_conta_caixa", { p_conta: entrada.contaId, p_entra: entrada.entra === true });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_CONTAS_PAGAR, "layout");
  return { ok: true, aviso: entrada.entra ? "A conta passa a somar no caixa." : "A conta deixa de somar no caixa." };
}
