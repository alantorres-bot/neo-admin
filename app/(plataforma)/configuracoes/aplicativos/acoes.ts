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
