"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { CAMPOS_TIPO, codigosDoModelo, lerCodigosTipo, TIPOS_TITULO, ROTULO_TIPO, type CodigosLancamento } from "@/lib/modulos/rh/lancamento";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const SEM_PERMISSAO = "Somente gestor do RH (ou acima) altera os parâmetros de lançamento no Consistem.";

/** "217,80" / "R$ 217,80" → 217.8; vazio ou inválido → null (sem filtro de valor). */
const valorDigitado = (t: string | undefined): number | null => {
  const n = Number((t ?? "").replace(/R\$|\s|\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const inteiro = (t: string) => (/^\d{1,9}$/.test(t.trim()) && Number(t) > 0 ? Number(t) : null);

export type EntradaParametros = {
  categoria: string;
  tipos: Record<string, Record<string, string>>;
  portadores: { empregador: string; forma: "fopag" | "pix"; codPortador: string; conta: string }[];
  vtLigado: boolean;
  folhaLigado: boolean;
};

export async function salvarParametrosLancamento(e: EntradaParametros): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "gestor")) return { ok: false, erro: SEM_PERMISSAO };
  const categoria = e.categoria.trim() ? inteiro(e.categoria) : null;
  if (e.categoria.trim() && !categoria) return { ok: false, erro: "A categoria do documento tem de ser um número inteiro." };
  const tipos: Record<string, unknown> = {};
  for (const t of TIPOS_TITULO) {
    const linha = e.tipos[t] ?? {};
    if (CAMPOS_TIPO.every((k) => !(linha[k] ?? "").trim())) continue;
    const c = lerCodigosTipo(Object.fromEntries(CAMPOS_TIPO.map((k) => [k, (linha[k] ?? "").trim()])));
    if (!c) return { ok: false, erro: `${ROTULO_TIPO[t]}: preencha todos os códigos com números inteiros (débito e crédito diferentes), ou deixe a linha vazia.` };
    tipos[t] = c;
  }
  const portadores = [];
  for (const p of e.portadores) {
    if (!p.codPortador.trim()) continue;
    const cod = inteiro(p.codPortador);
    if (!cod) return { ok: false, erro: `Portador de ${p.empregador} (${p.forma === "fopag" ? "FOPAG" : "PIX"}): informe um número inteiro.` };
    portadores.push({ empregador: p.empregador, forma: p.forma, codPortador: cod, conta: p.conta.trim().slice(0, 60) || null });
  }
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_salvar_parametros_lancamento", {
    p_parametros: { categoriaDoc: categoria, tipos, portadores }, p_vt_ligado: e.vtLigado, p_folha_ligado: e.folhaLigado,
  });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível salvar." };
  revalidatePath(ROTA_VT, "layout");
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true };
}

export type Modelo = { codLancamento: string; codigos: Partial<CodigosLancamento>; resumo: string; outros: { codLancamento: string; emissao: string | null; complemento: string; valor: number }[] };

/** Lê (só leitura) um título já lançado no Consistem e devolve os códigos dele para preencher o formulário. */
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
