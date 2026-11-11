"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MODULO_PARCELAMENTOS, ROTA_PARCELAMENTOS, SITUACOES } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Ações da Gestão de Parcelamentos (docs/modulos/financeiro-parcelamentos.md). Cada uma chama a função do banco (migration 0189),
// que confere de novo o nível. Nada aqui escreve no Consistem.

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();
const texto = (max: number) => z.string().trim().max(max).optional().default("");
const inteiro = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();

async function chamar(nivel: "operador" | "gestor", funcao: string, args: Record<string, unknown>, aviso: (dados: unknown) => string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, nivel)) return { ok: false, erro: `Somente ${nivel} do Financeiro (ou acima) faz isto.` };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc(funcao, args);
  revalidatePath(ROTA_PARCELAMENTOS, "layout");
  return error ? { ok: false, erro: mensagemDeErro(error) } : { ok: true, aviso: aviso(data) };
}

/** "Atualizar do Consistem" (operador): lista dos P + detalhes. Só leitura no ERP. */
export async function sincronizar(): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) atualiza." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("fin-parcelamentos-sincronizar", { body: { acao: "sincronizar" } });
  revalidatePath(ROTA_PARCELAMENTOS, "layout");
  type Resposta = { erro?: string; empresas?: { empresa: string; erro?: string; novos?: number; alterados?: number; detalhesPedidos?: number; detalhesAdiados?: number }[] };
  let r = (data ?? {}) as Resposta;
  if (error) {
    // Resposta não 2xx: o corpo (com o erro de cada empresa) vem em error.context.
    try { r = ((await (error as { context?: Response }).context?.json()) ?? {}) as Resposta; } catch { r = {}; }
    if (!r.empresas) return { ok: false, erro: r.erro ?? "Não foi possível falar com a função de sincronização." };
  }
  const erros = (r.empresas ?? []).filter((e) => e.erro);
  if (erros.length) return { ok: false, erro: erros.map((e) => `${e.empresa}: ${e.erro}`).join(" · ") };
  const partes = (r.empresas ?? []).map((e) => `${e.empresa}: ${e.novos ?? 0} novo(s), ${e.alterados ?? 0} alterado(s), ${e.detalhesPedidos ?? 0} detalhe(s)` +
    (e.detalhesAdiados ? ` (${e.detalhesAdiados} ficaram para a próxima)` : ""));
  return { ok: true, aviso: `Atualizado. ${partes.join(" · ")}` };
}

const esquemaParcelamento = z.object({
  id: uuid.nullable(),
  empresaId: uuid,
  descricao: z.string().trim().min(3, "Descrição muito curta.").max(200),
  natureza: z.string().regex(/^[a-z_]{2,30}$/, "Escolha a natureza."),
  chaveErp: texto(80),
  codFornecedor: z.string().trim().regex(/^\d{0,10}$/, "Código de fornecedor inválido.").optional().default(""),
  devedor: texto(120), credor: texto(120), numero: texto(60), processo: texto(60), cda: texto(60), inscricao: texto(60),
  referenciaDebito: texto(200), dataAdesao: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().default(""),
  valorOriginalCentavos: z.number().int().min(0).nullable().optional(),
  qtdParcelas: inteiro(1, 999), diaVencimento: inteiro(1, 31),
  situacao: z.enum(SITUACOES).optional().default("ativo"),
  observacoes: texto(2000),
});
export type DadosParcelamento = z.input<typeof esquemaParcelamento>;

export async function salvarParcelamento(dados: DadosParcelamento): Promise<Resultado> {
  const p = esquemaParcelamento.safeParse(dados);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, valorOriginalCentavos, ...resto } = p.data;
  const corpo = { ...resto, valorOriginal: valorOriginalCentavos == null ? "" : (valorOriginalCentavos / 100).toFixed(2), qtdParcelas: resto.qtdParcelas ?? "", diaVencimento: resto.diaVencimento ?? "" };
  return chamar("gestor", "par_salvar_parcelamento", { p_id: id, p: corpo }, () => (id ? "Parcelamento atualizado." : "Parcelamento criado; as parcelas do Consistem da mesma chave já entraram."));
}

const esquemaParcela = z.object({
  parcelamentoId: uuid,
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (mm/aaaa)."),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimento inválido."),
  valorCentavos: z.number().int().positive("Informe o valor."),
  numero: inteiro(1, 999),
  observacoes: texto(500),
});
export async function adicionarParcela(dados: z.input<typeof esquemaParcela>): Promise<Resultado> {
  const p = esquemaParcela.safeParse(dados);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? "Dados inválidos." };
  const d = p.data;
  return chamar("gestor", "par_adicionar_parcela", {
    p_parcelamento: d.parcelamentoId, p_competencia: d.competencia, p_vencimento: d.vencimento, p_valor: (d.valorCentavos / 100).toFixed(2),
    p_numero: d.numero ?? null, p_observacoes: d.observacoes,
  }, () => "Parcela manual incluída.");
}

const esquemaRegra = z.object({
  id: uuid.nullable(),
  nome: z.string().trim().min(3, "Nome muito curto.").max(120),
  empresaId: z.string().optional().default(""),
  tipos: z.array(z.enum(["P", "C"])).optional().default([]),
  fornecedores: z.array(z.string().trim().regex(/^\d{1,10}$/, "Fornecedor: só o código numérico.")).optional().default([]),
  grupo: inteiro(1, 9999), conta: inteiro(1, 9999),
  complementoContem: texto(80),
  natureza: z.string().optional().default(""),
  excecao: z.boolean(), prioridade: z.number().int().min(1).max(999), ativa: z.boolean(),
  observacoes: texto(500),
});
export async function salvarRegra(dados: z.input<typeof esquemaRegra>): Promise<Resultado> {
  const p = esquemaRegra.safeParse(dados);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, ...r } = p.data;
  if ((r.grupo == null) !== (r.conta == null)) return { ok: false, erro: "Conta de fluxo: informe grupo e conta (ex.: 20 e 17) ou nenhum." };
  if (!r.excecao && !r.natureza) return { ok: false, erro: "Escolha a natureza (ou marque como exceção)." };
  if (!r.fornecedores.length && r.grupo == null && !r.complementoContem) return { ok: false, erro: "Informe fornecedor, conta de fluxo ou texto do histórico." };
  // listas vazias viram nulo no banco (array_agg de nada) = "não importa"
  const corpo = { ...r, grupo: r.grupo ?? "", conta: r.conta ?? "", natureza: r.excecao ? "" : r.natureza };
  return chamar("gestor", "par_salvar_regra", { p_id: id, p: corpo }, () => "Regra salva; os lançamentos foram reclassificados.");
}

export async function classificarManual(id: string, natureza: string | null, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Pedido inválido." };
  return chamar("operador", "par_classificar_manual", { p_id: id, p_natureza: natureza, p_motivo: motivo.trim().slice(0, 300) },
    () => (natureza ? "Classificado como parcelamento." : "Marcado como não parcelamento."));
}

export async function devolverAsRegras(id: string): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Pedido inválido." };
  return chamar("operador", "par_devolver_as_regras", { p_id: id }, () => "Voltou para as regras.");
}

export async function vincularLancamento(lancamentoId: string, parcelamentoId: string): Promise<Resultado> {
  if (!uuid.safeParse(lancamentoId).success || !uuid.safeParse(parcelamentoId).success) return { ok: false, erro: "Escolha o parcelamento." };
  return chamar("operador", "par_vincular_lancamento", { p_lancamento: lancamentoId, p_parcelamento: parcelamentoId }, () => "Lançamento vinculado.");
}

export async function vincularChave(empresaId: string, chave: string, parcelamentoId: string): Promise<Resultado> {
  if (!uuid.safeParse(empresaId).success || !uuid.safeParse(parcelamentoId).success) return { ok: false, erro: "Escolha o parcelamento." };
  return chamar("operador", "par_vincular_chave", { p_empresa: empresaId, p_chave: chave, p_parcelamento: parcelamentoId }, (n) => `${n} lançamento(s) vinculado(s).`);
}

export async function desvincularLancamento(lancamentoId: string, motivo: string): Promise<Resultado> {
  if (!uuid.safeParse(lancamentoId).success) return { ok: false, erro: "Pedido inválido." };
  return chamar("operador", "par_desvincular_lancamento", { p_lancamento: lancamentoId, p_motivo: motivo.trim().slice(0, 300) }, () => "Lançamento desvinculado.");
}

export async function reprocessar(): Promise<Resultado> {
  return chamar("operador", "par_reprocessar", {}, (n) => `${n} lançamento(s) reavaliado(s) pelas regras.`);
}
