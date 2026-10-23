"use server";

// Ações da Central de Gestão. Quem pode cada uma é decidido no banco (RLS + gatilho de pendências + funções da
// migration 0093); aqui só se valida o formato do que veio do formulário e se traduz o erro.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { ACOES_PENDENCIA, CATEGORIAS } from "@/lib/nucleo/gestao/tarefas";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";


const uuidOuVazio = z.union([z.literal(""), z.string().uuid("Escolha uma opção válida.")]);
const dataOuVazia = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")]);
const texto = (max: number, rotulo: string) => z.string().trim().max(max, `${rotulo}: até ${max.toLocaleString("pt-BR")} caracteres.`);

const esquemaTarefa = z.object({
  modulo: z.string().trim().min(1, "Escolha o módulo da tarefa."),
  titulo: texto(200, "Título").min(1, "Informe o título da tarefa."),
  descricao: texto(4000, "Descrição"),
  responsavel_id: uuidOuVazio,
  prazo: dataOuVazia,
  prioridade: z.enum(["critica", "alta", "normal"]),
  categoria: z.union([z.literal(""), z.enum(CATEGORIAS)]),
  observacoes: texto(4000, "Observações"),
});

const esquemaAcao = z.object({
  id: z.string().uuid("Pendência inválida."),
  acao: z.enum(ACOES_PENDENCIA),
  texto: texto(4000, "Texto").optional(),
  responsavel_id: uuidOuVazio.optional(),
  dependencia_id: uuidOuVazio.optional(),
  nivel: z.union([z.literal(""), z.enum(["intervir", "acompanhar", "normal"])]).optional(),
  titulo: texto(200, "Título").optional(),
  descricao: texto(4000, "Descrição").optional(),
  prazo: dataOuVazia.optional(),
  prioridade: z.enum(["critica", "alta", "normal"]).optional(),
  categoria: z.union([z.literal(""), z.enum(CATEGORIAS)]).optional(),
  impacto: z.union([z.literal(""), z.enum(["financeiro", "fiscal", "operacional"])]).optional(),
  impacto_fundamento: texto(1000, "Fundamento do impacto").optional(),
});

const campo = (dados: FormData, nome: string) => (dados.has(nome) ? String(dados.get(nome) ?? "") : undefined);

export async function criarTarefa(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = esquemaTarefa.safeParse({
    modulo: campo(dados, "modulo") ?? "", titulo: campo(dados, "titulo") ?? "", descricao: campo(dados, "descricao") ?? "",
    responsavel_id: campo(dados, "responsavel_id") ?? "", prazo: campo(dados, "prazo") ?? "",
    prioridade: campo(dados, "prioridade") || "normal", categoria: campo(dados, "categoria") ?? "",
    observacoes: campo(dados, "observacoes") ?? "",
  });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("pendencia_criar", { p_dados: entrada.data });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath("/gestao");
  return { ok: true, chave: Date.now() };
}

export async function executarAcao(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirSessao();
  const entrada = esquemaAcao.safeParse({
    id: campo(dados, "id"), acao: campo(dados, "acao"), texto: campo(dados, "texto"),
    responsavel_id: campo(dados, "responsavel_id"), dependencia_id: campo(dados, "dependencia_id"), nivel: campo(dados, "nivel"),
    titulo: campo(dados, "titulo"), descricao: campo(dados, "descricao"), prazo: campo(dados, "prazo"),
    prioridade: campo(dados, "prioridade"), categoria: campo(dados, "categoria"),
    impacto: campo(dados, "impacto"), impacto_fundamento: campo(dados, "impacto_fundamento"),
  });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const { id, acao, ...resto } = entrada.data;

  // Só o que veio do formulário vai ao banco ("alterar" muda apenas os campos enviados).
  const p_dados: Record<string, string | boolean> = {};
  for (const [chave, valor] of Object.entries(resto)) if (valor !== undefined) p_dados[chave] = valor;
  if (acao === "alterar") p_dados.precisa_distribuir = dados.get("precisa_distribuir") === "on";

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("pendencia_acao", { p_id: id, p_acao: acao, p_dados });
  if (error) return { erro: mensagemDeErroBanco(error) };
  revalidatePath("/gestao");
  revalidatePath(`/gestao/${id}`);
  return { ok: true, chave: Date.now() };
}
