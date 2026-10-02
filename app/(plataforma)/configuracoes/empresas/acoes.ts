"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { normalizarCnpj } from "@/lib/nucleo/documentos";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const esquema = z.object({
  id: z.string().uuid().optional(),
  razao_social: z.string().trim().min(2, "Informe a razão social."),
  nome_curto: z.string().trim().min(2, "Informe o nome curto."),
});

export async function salvarEmpresa(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  await exigirAdminGeral(); // só admin_geral altera empresas (a RLS também exige)
  const id = String(dados.get("id") ?? "");
  const entrada = esquema.safeParse({ id: id || undefined, razao_social: dados.get("razao_social"), nome_curto: dados.get("nome_curto") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const cnpj = normalizarCnpj(String(dados.get("cnpj") ?? ""));
  if (!cnpj.ok) return { erro: cnpj.erro };

  const registro = {
    razao_social: entrada.data.razao_social,
    nome_curto: entrada.data.nome_curto,
    cnpj: cnpj.valor,
    ativa: dados.get("ativa") === "on",
  };

  const supabase = await criarClienteServidor();
  const r = entrada.data.id
    ? await supabase.from("empresas").update(registro).eq("id", entrada.data.id).select("id")
    : await supabase.from("empresas").insert(registro).select("id");
  if (r.error) return { erro: mensagemDeErroBanco(r.error, "Já existe uma empresa com este CNPJ.") };
  if (!r.data?.length) return { erro: "Empresa não encontrada." };

  revalidatePath("/configuracoes/empresas");
  return { ok: true, chave: Date.now() };
}
