"use server";

// Sugestões de melhoria. Quem pode o quê é decidido no banco (RLS + gatilho da migration 0096); aqui só se valida o
// formato e se traduz o erro.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { SITUACOES_SUGESTAO } from "@/lib/nucleo/gestao/sugestoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const texto = (max: number, rotulo: string) => z.string().trim().max(max, `${rotulo}: até ${max.toLocaleString("pt-BR")} caracteres.`);
const campo = (dados: FormData, nome: string) => String(dados.get(nome) ?? "");
const vazioParaNulo = (v: string) => (v === "" ? null : v);

const esquemaSugestao = z.object({
  titulo: texto(150, "Título").min(1, "Dê um título à sugestão."),
  area: z.string().regex(/^[a-z_]+$/, "Escolha a área."),
  modulo: z.union([z.literal(""), z.string().regex(/^[a-z_]+\.[a-z_-]+$/)]),
  problema: texto(4000, "Problema"),
  como_hoje: texto(4000, "Como é feito hoje"),
  melhoria: texto(4000, "Melhoria").min(1, "Descreva a melhoria sugerida."),
  resultado_esperado: texto(4000, "Resultado esperado"),
});

export async function criarSugestao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = esquemaSugestao.safeParse(Object.fromEntries(
    ["titulo", "area", "modulo", "problema", "como_hoje", "melhoria", "resultado_esperado"].map((c) => [c, campo(dados, c)])));
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const d = entrada.data;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("sugestoes").insert({
    titulo: d.titulo, area: d.area, modulo: vazioParaNulo(d.modulo), problema: vazioParaNulo(d.problema),
    como_hoje: vazioParaNulo(d.como_hoje), melhoria: d.melhoria, resultado_esperado: vazioParaNulo(d.resultado_esperado),
  });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath("/gestao/sugestoes");
  return { ok: true, chave: Date.now() };
}

const esquemaAvaliacao = z.object({
  id: z.string().uuid(),
  status: z.enum(SITUACOES_SUGESTAO),
  prioridade: z.union([z.literal(""), z.enum(["alta", "normal", "baixa"])]),
  justificativa: texto(4000, "Justificativa"),
});

export async function avaliarSugestao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = esquemaAvaliacao.safeParse({ id: campo(dados, "id"), status: campo(dados, "status"), prioridade: campo(dados, "prioridade"), justificativa: campo(dados, "justificativa") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const { id, status, prioridade, justificativa } = entrada.data;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("sugestoes")
    .update({ status, prioridade: vazioParaNulo(prioridade), ...(justificativa ? { justificativa } : {}) })
    .eq("id", id).select("id");
  if (error) return { erro: mensagemDeErroBanco(error) };
  if (!data?.length) return { erro: "Você não tem permissão para avaliar esta sugestão." };
  revalidatePath("/gestao/sugestoes");
  revalidatePath(`/gestao/sugestoes/${id}`);
  return { ok: true, chave: Date.now() };
}

export async function comentarSugestao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = z.object({ id: z.string().uuid(), texto: texto(4000, "Comentário").min(1, "Escreva o comentário.") })
    .safeParse({ id: campo(dados, "id"), texto: campo(dados, "texto") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("sugestoes_comentarios").insert({ sugestao_id: entrada.data.id, texto: entrada.data.texto });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath(`/gestao/sugestoes/${entrada.data.id}`);
  return { ok: true, chave: Date.now() };
}

export async function criarTarefaSugestao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = z.object({
    id: z.string().uuid(),
    responsavel: z.union([z.literal(""), z.string().uuid()]),
    prazo: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")]),
  }).safeParse({ id: campo(dados, "id"), responsavel: campo(dados, "responsavel_id"), prazo: campo(dados, "prazo") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("sugestao_criar_tarefa", {
    p_id: entrada.data.id, p_responsavel: vazioParaNulo(entrada.data.responsavel), p_prazo: vazioParaNulo(entrada.data.prazo),
  });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath(`/gestao/sugestoes/${entrada.data.id}`);
  revalidatePath("/gestao");
  return { ok: true, chave: Date.now() };
}
