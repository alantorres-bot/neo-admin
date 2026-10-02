"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lerModelo } from "@/lib/integracoes/importador/tabela";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type ResultadoImportador = { ok: true } | { ok: false; erro: string };

const base = z.object({
  modulo: z.string().min(3).max(80),
  tipo: z.string().trim().min(2, "Informe o tipo da importação.").max(60).regex(/^[a-z0-9_]+$/, "O tipo usa só letras minúsculas, números e _ (ex.: titulos_abertos)."),
});

const esquemaModelo = base.extend({ nome: z.string().trim().min(2, "Dê um nome ao modelo.").max(80), modelo: z.unknown() });
const esquemaRegistro = base.extend({ arquivo: z.string().trim().min(1).max(255), modelo: z.unknown() });

/** Guarda (ou atualiza) o mapeamento de colunas para reaproveitar nas próximas importações do mesmo tipo. */
export async function salvarModeloImportacao(entrada: z.input<typeof esquemaModelo>): Promise<ResultadoImportador> {
  await exigirSessao();
  const dados = esquemaModelo.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const modelo = lerModelo(dados.data.modelo);
  if (!modelo) return { ok: false, erro: "Mapeamento inválido." };

  const supabase = await criarClienteServidor();
  const r = await supabase
    .from("importacao_modelos")
    .upsert({ modulo: dados.data.modulo, tipo: dados.data.tipo, nome: dados.data.nome, mapeamento: modelo }, { onConflict: "modulo,tipo,nome" })
    .select("id");
  if (r.error) return { ok: false, erro: mensagemDeErroBanco(r.error) };
  if (!r.data?.length) return { ok: false, erro: "Você não tem permissão para salvar modelos neste módulo." };

  revalidatePath("/configuracoes/importador");
  return { ok: true };
}

/**
 * Registra a importação com a cópia do mapeamento usado. Na Fase 0 não há regra de módulo:
 * nada é gravado nas tabelas dos módulos, só o registro (tabela `importacoes`).
 */
export async function registrarImportacao(entrada: z.input<typeof esquemaRegistro>): Promise<ResultadoImportador> {
  const sessao = await exigirSessao();
  const dados = esquemaRegistro.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const modelo = lerModelo(dados.data.modelo);
  if (!modelo) return { ok: false, erro: "Mapeamento inválido." };

  const supabase = await criarClienteServidor();
  const r = await supabase
    .from("importacoes")
    .insert({ modulo: dados.data.modulo, tipo: dados.data.tipo, arquivo: dados.data.arquivo, mapeamento: modelo, usuario_id: sessao.userId })
    .select("id");
  if (r.error) return { ok: false, erro: mensagemDeErroBanco(r.error) };
  if (!r.data?.length) return { ok: false, erro: "Não foi possível registrar a importação." };

  revalidatePath("/configuracoes/importador");
  return { ok: true };
}
