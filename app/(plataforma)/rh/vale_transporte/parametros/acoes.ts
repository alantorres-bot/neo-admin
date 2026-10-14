"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAMPOS_LANCAMENTO, codigosDoModelo, lerCodigosLancamento, type CodigosLancamento } from "@/lib/modulos/rh/vale-transporte/lancamento";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** "217,80" / "R$ 217,80" → 217.8; vazio ou inválido → null (sem filtro de valor). */
const valorDigitado = (t: string | undefined): number | null => {
  const n = Number((t ?? "").replace(/R\$|\s|\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const SEM_PERMISSAO = "Somente gestor do RH (ou acima) altera os parâmetros do vale-transporte.";

export async function salvarParametros(entrada: { codigos: Record<string, string>; ligado: boolean }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "gestor")) return { ok: false, erro: SEM_PERMISSAO };
  const vazios = CAMPOS_LANCAMENTO.every((k) => !(entrada.codigos[k] ?? "").trim());
  let codigos: CodigosLancamento | null = null;
  if (!vazios) {
    codigos = lerCodigosLancamento(Object.fromEntries(CAMPOS_LANCAMENTO.map((k) => [k, (entrada.codigos[k] ?? "").trim()])));
    if (!codigos) return { ok: false, erro: "Preencha todos os códigos com números inteiros (débito e crédito diferentes), ou deixe todos vazios." };
  }
  if (entrada.ligado && !codigos) return { ok: false, erro: "Preencha os códigos antes de ligar o lançamento no Consistem." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_vt_salvar_parametros", { p_codigos: codigos, p_ligado: entrada.ligado });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível salvar." };
  revalidatePath(ROTA_VT, "layout");
  return { ok: true };
}

export type Modelo = { codLancamento: string; codigos: Partial<CodigosLancamento>; resumo: string; outros: { codLancamento: string; emissao: string | null; complemento: string; valor: number }[] };

/** Lê (só leitura) um título de VT já lançado no Consistem e devolve os códigos dele para preencher o formulário. */
export async function buscarModelo(entrada: { empresaId: string; codLancamento?: string; codFornecedor?: string; valor?: string }): Promise<{ ok: true; modelo: Modelo } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "gestor")) return { ok: false, erro: SEM_PERMISSAO };
  if (!z.string().uuid().safeParse(entrada.empresaId).success) return { ok: false, erro: "Empresa inválida." };
  const supabase = await criarClienteServidor();
  const corpo = entrada.codLancamento?.trim()
    ? { acao: "modelo", empresa_id: entrada.empresaId, codLancamento: entrada.codLancamento.trim() }
    : { acao: "modelo", empresa_id: entrada.empresaId, codFornecedor: (entrada.codFornecedor ?? "").trim(), dias: 120, valor: valorDigitado(entrada.valor) };
  const { data, error } = await supabase.functions.invoke("rh-vt-consultar-fornecedor", { body: corpo });
  if (error) {
    const resposta = (error as { context?: Response }).context;
    let mensagem = "Não foi possível consultar o Consistem.";
    try { if (resposta && typeof resposta.json === "function") mensagem = ((await resposta.json()) as { erro?: string }).erro ?? mensagem; } catch { /* mantém */ }
    return { ok: false, erro: mensagem };
  }
  const r = data as { codLancamento: string; detalhe: Record<string, unknown>; outros: Modelo["outros"] };
  const d = r.detalhe;
  const resumo = [`Lançamento ${r.codLancamento}`, d.codFornecedor && `fornecedor ${String(d.codFornecedor)}`, d.dataEmissao && `emissão ${String(d.dataEmissao)}`,
    d.valorDocumento && `valor ${String(d.valorDocumento)}`, d.complementoHistorico && `“${String(d.complementoHistorico).trim()}”`].filter(Boolean).join(" · ");
  return { ok: true, modelo: { codLancamento: r.codLancamento, codigos: codigosDoModelo(d), resumo, outros: r.outros ?? [] } };
}
