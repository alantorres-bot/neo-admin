"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoForm } from "@/components/formularios/dialogo-formulario";
import { normalizarDocumento, normalizarWhatsapp } from "@/lib/nucleo/documentos";
import { mensagemDeErroBanco } from "@/lib/nucleo/erros";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { TIPOS_CONTRAPARTE, CANAIS_DE_CONTATO } from "@/lib/nucleo/rotulos";
import { FINALIDADES, normalizarFinalidade } from "@/supabase/functions/_shared/contatos";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const vazioParaNulo = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

const esquemaContraparte = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(2, "Informe o nome."),
  tipos: z.array(z.enum(TIPOS_CONTRAPARTE as [string, ...string[]])),
});

export async function salvarContraparte(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador")) return { erro: "Você não tem permissão para cadastrar contrapartes." };

  const id = String(dados.get("id") ?? "");
  const entrada = esquemaContraparte.safeParse({ id: id || undefined, nome: dados.get("nome"), tipos: dados.getAll("tipos") });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const documento = normalizarDocumento(String(dados.get("documento") ?? ""));
  if (!documento.ok) return { erro: documento.erro };

  const registro = {
    nome: entrada.data.nome,
    documento: documento.valor,
    tipos: entrada.data.tipos.length > 0 ? entrada.data.tipos : ["outro"],
    codigo_erp: vazioParaNulo(dados.get("codigo_erp")),
    observacoes: vazioParaNulo(dados.get("observacoes")),
    ativo: dados.get("ativo") === "on",
  };

  const supabase = await criarClienteServidor();
  const r = entrada.data.id
    ? await supabase.from("contrapartes").update(registro).eq("id", entrada.data.id).select("id")
    : await supabase.from("contrapartes").insert(registro).select("id");
  if (r.error) return { erro: mensagemDeErroBanco(r.error, "Já existe uma contraparte com este CPF/CNPJ.") };
  if (!r.data?.length) return { erro: "Contraparte não encontrada ou sem permissão para alterá-la." };

  revalidatePath("/configuracoes/contrapartes");
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/akf");
  return { ok: true, chave: Date.now() };
}

const esquemaContato = z.object({
  id: z.string().uuid().optional(),
  contraparte_id: z.string().uuid(),
  nome: z.string().trim().min(2, "Informe o nome do contato."),
  email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.")]),
  canal_preferido: z.enum(CANAIS_DE_CONTATO as [string, ...string[]]),
});

export async function salvarContato(_anterior: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const sessao = await exigirSessao();
  if (!temAcessoAlgumaArea(sessao.acesso, sessao.areas, "operador")) return { erro: "Você não tem permissão para cadastrar contatos." };

  const id = String(dados.get("id") ?? "");
  const entrada = esquemaContato.safeParse({
    id: id || undefined,
    contraparte_id: dados.get("contraparte_id"),
    nome: dados.get("nome"),
    email: String(dados.get("email") ?? "").trim(),
    canal_preferido: dados.get("canal_preferido"),
  });
  if (!entrada.success) return { erro: entrada.error.issues[0].message };

  const whatsappInformado = String(dados.get("whatsapp") ?? "").trim();
  const whatsapp = whatsappInformado === "" ? null : normalizarWhatsapp(whatsappInformado);
  if (whatsappInformado !== "" && whatsapp === null) return { erro: "WhatsApp inválido. Informe DDD + número, ex.: (65) 99999-9999." };

  const telefoneInformado = String(dados.get("telefone") ?? "").trim();
  const telefone = telefoneInformado === "" ? null : normalizarWhatsapp(telefoneInformado);
  if (telefoneInformado !== "" && telefone === null) return { erro: "Telefone inválido. Informe DDD + número, ex.: (65) 3222-0000." };

  if (entrada.data.canal_preferido === "email" && entrada.data.email === "" ) return { erro: "Informe o e-mail ou escolha outro canal preferido." };
  if (entrada.data.canal_preferido === "whatsapp" && whatsapp === null) return { erro: "Informe o WhatsApp ou escolha outro canal preferido." };
  if (entrada.data.canal_preferido === "telefone" && telefone === null && whatsapp === null) return { erro: "Informe o telefone ou escolha outro canal preferido." };
  if (entrada.data.email === "" && whatsapp === null && telefone === null) return { erro: "Informe pelo menos um meio de contato: e-mail, WhatsApp ou telefone." };

  // Lista fechada (caixas de marcação): só entra o que o sistema reconhece, na grafia certa.
  const finalidades = [...new Set(dados.getAll("finalidades").map((f) => normalizarFinalidade(String(f))))].filter((f) => (FINALIDADES as readonly string[]).includes(f));

  const registro = {
    contraparte_id: entrada.data.contraparte_id,
    nome: entrada.data.nome,
    funcao: vazioParaNulo(dados.get("funcao")),
    email: entrada.data.email === "" ? null : entrada.data.email.toLowerCase(),
    whatsapp,
    telefone,
    canal_preferido: entrada.data.canal_preferido,
    finalidades,
    ativo: dados.get("ativo") === "on",
  };

  const supabase = await criarClienteServidor();
  const r = entrada.data.id
    ? await supabase.from("contatos").update(registro).eq("id", entrada.data.id).select("id")
    : await supabase.from("contatos").insert(registro).select("id");
  if (r.error) return { erro: mensagemDeErroBanco(r.error) };
  if (!r.data?.length) return { erro: "Contato não encontrado ou sem permissão para alterá-lo." };

  revalidatePath(`/configuracoes/contrapartes/${entrada.data.contraparte_id}`);
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/financeiro/akf");
  return { ok: true, chave: Date.now() };
}
