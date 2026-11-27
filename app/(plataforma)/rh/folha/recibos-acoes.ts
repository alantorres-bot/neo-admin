"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inicioDoMes } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA, rotuloFolha, type TipoFolha } from "@/lib/modulos/rh/folha/modulo";
import {
  calcularRecibo, dividirPorMes, linhasDeDias, mensagemDoPeriodo, parametrosVigentes, TIPOS_RECIBO,
  type DadosPessoa, type LinhaEntrada, type Rubrica,
} from "@/lib/modulos/rh/folha/recibos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerItens, lerMes, lerModelos, lerPessoasRecibo, lerRecibos, lerRubricas, lerVigencias } from "./dados";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível gravar o recibo.");
const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function exigir(nivel: "operador" | "gestor"): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "rh", nivel) ? null : `Somente ${nivel} do RH (ou acima) pode fazer isso.`;
}

const esquemaLinha = z.object({ rubrica: z.string().min(2).max(40), referencia: z.number().min(0).max(10000), valor: z.number().min(0).max(1_000_000).nullable().optional(), descricao: z.string().trim().max(60).nullable().optional() });
const esquemaRecibo = z.object({
  tipo: z.enum(TIPOS_RECIBO),
  colaboradorId: uuid,
  competencia: data.nullable(),
  inicio: data.nullable(), fim: data.nullable(),
  salario: z.number().positive("Informe o salário da pessoa.").max(1_000_000),
  funcao: z.string().trim().max(60).nullable(),
  insalubridade_pct: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(40)]),
  adicional_noturno_pct: z.number().int().min(0).max(100),
  atualizarCadastro: z.boolean(),
  linhas: z.array(esquemaLinha).max(30),
  mensagem: z.string().trim().max(200).nullable(),
  substitui: uuid.nullable(),
});
export type EntradaRecibo = z.input<typeof esquemaRecibo>;

async function gravarUm(supabase: Cliente, o: { competencia: string; colaboradorId: string; tipo: string; pessoa: DadosPessoa; funcao: string | null; inicio: string | null; fim: string | null; mensagem: string; linhas: LinhaEntrada[]; descricoes?: (string | null | undefined)[]; vigencias: Awaited<ReturnType<typeof lerVigencias>>; substitui?: string | null; folha?: TipoFolha }) {
  const calc = calcularRecibo(o.linhas, o.pessoa, parametrosVigentes(o.vigencias, o.competencia));
  const linhas = calc.linhas.map((l, i) => ({ rubrica: l.rubrica, descricao: o.descricoes?.[i] || l.descricao, referencia: l.referencia, valor: l.centavos / 100 }));
  const { error } = await supabase.rpc("rh_fp_gravar_recibo", {
    p_competencia: o.competencia, p_colaborador: o.colaboradorId, p_tipo: o.tipo, p_salario: o.pessoa.salario, p_insalubridade: o.pessoa.insalubridade_pct,
    p_noturno: o.pessoa.adicional_noturno_pct, p_funcao: o.funcao, p_inicio: o.inicio, p_fim: o.fim, p_mensagem: o.mensagem, p_linhas: linhas, p_substitui: o.substitui ?? null, p_folha: o.folha ?? "mensal",
  });
  return error ? { ok: false as const, erro: mensagemDeErro(error) } : { ok: true as const, liquido: calc.liquido };
}

/**
 * Grava recibo(s). Compra de férias e início antes do registro: o período é dividido por mês e cada mês vira um recibo com as linhas
 * padrão (dias + assiduidade + insalubridade/noturno de quem tem). Recorrente e eventual: um recibo com as linhas informadas.
 * O cálculo é refeito aqui (lib/modulos/rh/folha/recibos.ts), com os parâmetros vigentes de cada competência.
 */
export async function gravarRecibos(entrada: EntradaRecibo): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  const v = esquemaRecibo.safeParse(entrada);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const e = v.data;
  const supabase = await criarClienteServidor();
  const [rubricas, vigencias] = await Promise.all([lerRubricas(supabase), lerVigencias(supabase)]);
  const catalogo = new Map<string, Rubrica>(rubricas.map((r) => [r.codigo, r]));
  const pessoa: DadosPessoa = { salario: e.salario, insalubridade_pct: e.insalubridade_pct, adicional_noturno_pct: e.adicional_noturno_pct };
  if (e.atualizarCadastro) {
    const { error } = await supabase.rpc("rh_salvar_dados_recibo", { p_colaborador: e.colaboradorId, p_salario: e.salario, p_funcao: e.funcao, p_insalubridade: e.insalubridade_pct, p_noturno: e.adicional_noturno_pct });
    if (error) return { ok: false, erro: mensagemDeErro(error) };
  }
  let gravados = 0, total = 0;
  // Edição (substitui): grava as linhas como foram editadas, no mesmo mês, mesmo para compra de férias/início antes do registro.
  if (!e.substitui && (e.tipo === "compra_ferias" || e.tipo === "inicio_antes_registro")) {
    if (!e.inicio || !e.fim) return { ok: false, erro: "Informe o período (início e fim)." };
    const trechos = dividirPorMes(e.inicio, e.fim);
    if (!trechos.length) return { ok: false, erro: "Período inválido: o fim tem de ser depois do início." };
    if (trechos.length > 3) return { ok: false, erro: "Período longo demais (mais de 3 meses)." };
    for (const t of trechos) {
      const r = await gravarUm(supabase, {
        competencia: t.competencia, colaboradorId: e.colaboradorId, tipo: e.tipo, pessoa, funcao: e.funcao, inicio: t.inicio, fim: t.fim,
        mensagem: [mensagemDoPeriodo(e.tipo, t.inicio, t.fim, { inicio: e.inicio, fim: e.fim }), e.mensagem].filter(Boolean).join(" · "),
        linhas: linhasDeDias(e.tipo, t.dias, pessoa, catalogo), vigencias, substitui: gravados === 0 ? e.substitui : null,
      });
      if (!r.ok) return { ok: false, erro: gravados ? `${r.erro} (${gravados} recibo(s) já gravado(s) antes deste)` : r.erro };
      gravados++; total += r.liquido;
    }
  } else {
    if (!e.competencia) return { ok: false, erro: "Informe o mês do recibo." };
    const linhas: LinhaEntrada[] = [];
    for (const l of e.linhas) {
      const rubrica = catalogo.get(l.rubrica);
      if (!rubrica) return { ok: false, erro: `Rubrica ${l.rubrica} desconhecida ou inativa.` };
      linhas.push({ rubrica, referencia: l.referencia, valor: l.valor ?? null });
    }
    if (!linhas.length) return { ok: false, erro: "O recibo não tem linhas." };
    const r = await gravarUm(supabase, {
      competencia: inicioDoMes(e.competencia), colaboradorId: e.colaboradorId, tipo: e.tipo, pessoa, funcao: e.funcao, inicio: e.inicio, fim: e.fim,
      mensagem: e.mensagem ?? "", linhas, descricoes: e.linhas.map((l) => (catalogo.get(l.rubrica)?.forma === "valor" ? l.descricao : null)), vigencias, substitui: e.substitui,
    });
    if (!r.ok) return r;
    gravados = 1; total = r.liquido;
  }
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: e.substitui
    ? `Recibo alterado, novo líquido ${reais(total)}. O anterior ficou guardado como cancelado e o avulso da folha foi refeito.`
    : `${gravados} recibo(s) gravado(s), total ${reais(total)}. O valor entrou no avulso da folha do mês.` };
}

export async function cancelarRecibo(id: string, motivo: string): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Recibo inválido." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_fp_cancelar_recibo", { p_id: id, p_motivo: motivo.trim().slice(0, 200) });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: "Recibo cancelado; o avulso da folha foi refeito." };
}

/** Gera no mês os recibos recorrentes dos modelos ativos (quem ainda não tem recibo recorrente no mês). */
export async function gerarRecorrentes(mesId: string): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(mesId).success) return { ok: false, erro: "Mês inválido." };
  const supabase = await criarClienteServidor();
  const [mes, itens, modelos, pessoas, rubricas, vigencias] = await Promise.all([
    lerMes(supabase, mesId), lerItens(supabase, mesId), lerModelos(supabase), lerPessoasRecibo(supabase), lerRubricas(supabase), lerVigencias(supabase),
  ]);
  if (!mes) return { ok: false, erro: "Mês não encontrado." };
  if (mes.status !== "aberta") return { ok: false, erro: "A folha deste mês não está aberta." };
  if (mes.tipo !== "mensal") return { ok: false, erro: "Recibos recorrentes são da folha do mês." };
  const existentes = await lerRecibos(supabase, { competencia: mes.competencia, folha: "mensal" });
  const jaTem = new Set(existentes.filter((r) => r.tipo === "recorrente").map((r) => r.colaborador_id));
  const naFolha = new Set(itens.map((i) => i.colaborador_id));
  const pessoa = new Map(pessoas.map((p) => [p.id, p]));
  const catalogo = new Map<string, Rubrica>(rubricas.map((r) => [r.codigo, r]));
  let gerados = 0;
  const pulados: string[] = [];
  for (const m of modelos.filter((x) => x.ativo)) {
    const p = pessoa.get(m.colaborador_id);
    if (!p || jaTem.has(m.colaborador_id)) continue;
    if (!naFolha.has(m.colaborador_id)) { pulados.push(`${p.nome} (fora da folha do mês)`); continue; }
    if (!p.salario) { pulados.push(`${p.nome} (sem salário no cadastro)`); continue; }
    const linhas = m.linhas.flatMap((l) => (catalogo.get(l.rubrica) ? [{ rubrica: catalogo.get(l.rubrica)!, referencia: Number(l.referencia), valor: l.valor ?? null }] : []));
    const r = await gravarUm(supabase, {
      competencia: mes.competencia, colaboradorId: p.id, tipo: "recorrente", pessoa: { salario: p.salario, insalubridade_pct: p.insalubridade_pct, adicional_noturno_pct: p.adicional_noturno_pct },
      funcao: p.funcao, inicio: null, fim: null, mensagem: "", linhas, vigencias,
    });
    if (r.ok) gerados++; else pulados.push(`${p.nome} (${r.erro})`);
  }
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: `${gerados} recibo(s) recorrente(s) gerado(s).${pulados.length ? ` Ficaram de fora: ${pulados.join("; ")}.` : ""}` };
}

const esquemaDecimo = z.array(z.object({ colaboradorId: uuid, avos: z.number().int().min(1).max(12), valor: z.number().positive("Valor do 13º zerado.").max(1_000_000) })).min(1, "Marque quem recebe o 13º por fora.").max(200);

/**
 * Folha do 13º: gera o recibo do 13º por fora de quem o RH marcou (decisão de 27/11/2026). O valor vem da tela
 * (decimoDoRecorrente, que o RH pode ajustar); a referência do recibo são os avos. Entra no avulso da folha do 13º (0531).
 */
export async function gerarDecimoRecorrentes(mesId: string, entrada: z.input<typeof esquemaDecimo>): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(mesId).success) return { ok: false, erro: "Folha inválida." };
  const v = esquemaDecimo.safeParse(entrada);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const [mes, pessoas, rubricas, vigencias] = await Promise.all([lerMes(supabase, mesId), lerPessoasRecibo(supabase), lerRubricas(supabase), lerVigencias(supabase)]);
  if (!mes) return { ok: false, erro: "Folha não encontrada." };
  if (mes.tipo === "mensal") return { ok: false, erro: "O 13º por fora vai na folha do 13º." };
  if (mes.status !== "aberta") return { ok: false, erro: "A folha do 13º não está aberta." };
  const rubrica = rubricas.find((r) => r.codigo === "decimo_por_fora");
  if (!rubrica) return { ok: false, erro: "Rubrica 13º SALÁRIO - POR FORA não cadastrada ou inativa." };
  const pessoa = new Map(pessoas.map((p) => [p.id, p]));
  let gerados = 0, total = 0;
  const falhas: string[] = [];
  for (const l of v.data) {
    const p = pessoa.get(l.colaboradorId);
    if (!p) { falhas.push("pessoa não encontrada"); continue; }
    const r = await gravarUm(supabase, {
      competencia: mes.competencia, colaboradorId: p.id, tipo: "decimo_recorrente", folha: mes.tipo, funcao: p.funcao, inicio: null, fim: null,
      pessoa: { salario: p.salario ?? 0, insalubridade_pct: p.insalubridade_pct, adicional_noturno_pct: p.adicional_noturno_pct },
      mensagem: `${rotuloFolha(mes.competencia, mes.tipo)} · ${l.avos}/12 avos`, linhas: [{ rubrica, referencia: l.avos, valor: l.valor }], vigencias,
    });
    if (r.ok) { gerados++; total += r.liquido; } else falhas.push(`${p.nome} (${r.erro})`);
  }
  revalidatePath(ROTA_FOLHA, "layout");
  if (!gerados) return { ok: false, erro: `Nenhum recibo gerado: ${falhas.join("; ")}.` };
  return { ok: true, aviso: `${gerados} recibo(s) do 13º por fora, total ${reais(total)}. O valor entrou no avulso da folha.${falhas.length ? ` Ficaram de fora: ${falhas.join("; ")}.` : ""}` };
}

const esquemaModelo = z.object({ colaboradorId: uuid, ativo: z.boolean(), linhas: z.array(esquemaLinha.omit({ descricao: true })).min(1, "O modelo precisa de pelo menos uma linha.").max(20) });
export async function salvarModelo(entrada: z.input<typeof esquemaModelo>): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  const v = esquemaModelo.safeParse(entrada);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_fp_salvar_modelo", { p_colaborador: v.data.colaboradorId, p_linhas: v.data.linhas, p_ativo: v.data.ativo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: "Modelo recorrente salvo." };
}

export async function salvarParametro(entrada: { chave: string; desde: string; valor: number }): Promise<Resultado> {
  const negado = await exigir("gestor");
  if (negado) return { ok: false, erro: negado };
  if (!["assiduidade_mensal", "salario_minimo"].includes(entrada.chave) || !/^\d{4}-\d{2}$/.test(entrada.desde) || !(entrada.valor > 0)) return { ok: false, erro: "Dados inválidos." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_salvar_parametro", { p_chave: entrada.chave, p_vigente_desde: `${entrada.desde}-01`, p_valor: entrada.valor });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: "Parâmetro salvo." };
}

const esquemaRubrica = z.object({
  codigo: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "Código: letras minúsculas, números e _ (ex.: ajuda_custo)."),
  descricao: z.string().trim().min(2).max(60), natureza: z.enum(["provento", "desconto"]),
  forma: z.enum(["dias", "horas", "fracao_salario", "valor"]), ordem: z.number().int().min(1).max(999), ativo: z.boolean(),
});
export async function salvarRubrica(entrada: z.input<typeof esquemaRubrica>): Promise<Resultado> {
  const negado = await exigir("gestor");
  if (negado) return { ok: false, erro: negado };
  const v = esquemaRubrica.safeParse(entrada);
  if (!v.success) return { ok: false, erro: v.error.issues[0].message };
  const d = v.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rh_fp_salvar_rubrica", { p_codigo: d.codigo, p_descricao: d.descricao, p_natureza: d.natureza, p_forma: d.forma, p_parametro: "", p_pct_campo: "", p_ordem: d.ordem, p_ativo: d.ativo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FOLHA, "layout");
  return { ok: true, aviso: "Rubrica salva." };
}
