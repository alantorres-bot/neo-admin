"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { validarAplicativo } from "@/lib/nucleo/aplicativos";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const texto = (dados: FormData, campo: string) => String(dados.get(campo) ?? "");

/** Cria ou altera um aplicativo externo do super painel. Só admin_geral (a RLS também exige). */
export async function salvarAplicativo(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirAdminGeral();
  const id = texto(dados, "id");
  if (id && !z.string().uuid().safeParse(id).success) return { erro: "Aplicativo inválido." };

  const validado = validarAplicativo(
    {
      codigo: texto(dados, "codigo"), nome: texto(dados, "nome"), descricao: texto(dados, "descricao"), area: texto(dados, "area"),
      url: texto(dados, "url"), abrir: texto(dados, "abrir"), icone: texto(dados, "icone"), ordem: texto(dados, "ordem"),
      ativo: dados.get("ativo") === "on",
    },
    sessao.areas.map((a) => a.codigo),
  );
  if (!validado.ok) return { erro: validado.erro };

  const supabase = await criarClienteServidor();
  const r = id
    ? await supabase.from("aplicativos").update(validado.valor).eq("id", id).select("id")
    : await supabase.from("aplicativos").insert(validado.valor).select("id");
  if (r.error) return { erro: mensagemDeErroBanco(r.error, "Já existe um aplicativo com este código.") };
  if (!r.data?.length) return { erro: "Aplicativo não encontrado." };

  revalidatePath("/configuracoes/aplicativos");
  revalidatePath("/", "layout"); // menu lateral e cartões do Início refletem na hora
  return { ok: true, chave: Date.now() };
}

const esquemaPendencias = z.object({
  id: z.string().uuid("Aplicativo inválido."),
  url: z.union([z.literal(""), z.string().trim().regex(/^https:\/\/\S+$/, "O endereço da função precisa começar com https://.")]),
  segredo: z.union([z.literal(""), z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,60}$/, "Nome do segredo: letras maiúsculas, números e _ (ex.: NEOCONTROL_SEGREDO).")]),
});

/**
 * Pendências na Central (docs/modulos/administrativo-gestao-aplicativos.md): liga/desliga a leitura, endereço da função
 * neo-admin-pendencias do aplicativo, NOME do segredo e o responsável padrão de cada tipo (campos resp_<tipo>).
 */
export async function salvarPendenciasApp(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral();
  const entrada = esquemaPendencias.safeParse({ id: texto(dados, "id"), url: texto(dados, "url"), segredo: texto(dados, "segredo") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };
  const ligado = dados.get("ligado") === "on";
  if (ligado && (!entrada.data.url || !entrada.data.segredo)) return { erro: "Para ligar, informe o endereço da função e o nome do segredo." };

  const responsaveis: Record<string, string> = {};
  for (const [campo, valor] of dados.entries()) {
    const tipo = /^resp_([a-z0-9_]{2,60})$/.exec(campo)?.[1];
    if (!tipo || valor === "") continue;
    if (!z.string().uuid().safeParse(valor).success) return { erro: "Responsável inválido." };
    responsaveis[tipo] = String(valor);
  }

  const supabase = await criarClienteServidor();
  const r = await supabase.from("aplicativos").update({
    pendencias_ligado: ligado, pendencias_url: entrada.data.url || null, pendencias_segredo: entrada.data.segredo || null,
    pendencias_responsaveis: responsaveis,
  }).eq("id", entrada.data.id).select("id");
  if (r.error) return { erro: mensagemDeErroBanco(r.error) };
  if (!r.data?.length) return { erro: "Aplicativo não encontrado." };
  revalidatePath("/configuracoes/aplicativos");
  return { ok: true, chave: Date.now() };
}

/** "Ler agora": chama a Edge Function nucleo-apps-pendencias para um aplicativo (desligado = só lê e registra). */
export async function lerPendenciasAgora(codigo: string): Promise<{ ok: true; aviso: string } | { ok: false; erro: string }> {
  await exigirAdminGeral();
  if (!/^[a-z0-9_]{2,40}$/.test(codigo)) return { ok: false, erro: "Aplicativo inválido." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("nucleo-apps-pendencias", { body: { acao: "ler", aplicativo: codigo } });
  revalidatePath("/configuracoes/aplicativos");
  if (error) {
    const resposta = (error as { context?: Response }).context;
    try {
      const detalhe = resposta && typeof resposta.json === "function" ? ((await resposta.json()) as { erro?: string }) : null;
      return { ok: false, erro: detalhe?.erro ?? "Não foi possível ler o aplicativo." };
    } catch {
      return { ok: false, erro: "Não foi possível ler o aplicativo." };
    }
  }
  const r = (data as { resultados?: { ok?: boolean; erro?: string; publicadas?: number; encerradas?: number }[] })?.resultados?.[0];
  if (!r) return { ok: false, erro: "O aplicativo não está configurado para a leitura." };
  if (r.ok === false) return { ok: false, erro: r.erro ?? "Falha na leitura." };
  return { ok: true, aviso: r.erro ?? `Leitura feita: ${r.publicadas ?? 0} na Central, ${r.encerradas ?? 0} encerradas.` };
}
