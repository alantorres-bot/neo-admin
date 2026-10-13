"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { MODULO_FILIAL, ROTA_FILIAL, TIPOS_DOCUMENTO_KIT } from "@/lib/modulos/financeiro/filial/arquivos";
import { lerNotaSyslock, type NotaLida } from "@/lib/modulos/financeiro/filial/leitor-nota";
import { BUCKET_ANEXOS, enviarAnexo } from "@/lib/nucleo/anexos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/** Mensagens levantadas pelo banco (P0001) são nossas e em português; o resto é genérico. */
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const DATA = /^\d{4}-\d{2}-\d{2}$/;

async function exigirOperador(): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "financeiro", "operador") ? null : "Somente operador do Financeiro ou acima pode registrar faturas da filial.";
}

const esquemaKit = z.object({
  nota: z.string().trim().regex(/^\d{1,6}$/, "Informe o número da NF (até 6 dígitos)."),
  cliente: z.string().trim().min(1, "Informe o cliente.").max(200),
  aceitaBoletoFactoring: z.boolean(),
  obra: z.string().trim().max(200).default(""),
  periodoInicio: z.string().regex(DATA).nullable().default(null),
  periodoFim: z.string().regex(DATA).nullable().default(null),
  remessaId: z.string().uuid().nullable().default(null),
  emissao: z.string().regex(DATA).nullable().default(null),
  clienteDocumento: z.string().trim().max(18).nullable().default(null),
  parcelas: z.array(z.object({ vencimento: z.string().regex(DATA, "Vencimento inválido."), valorCentavos: z.number().int().positive("Valor inválido.") })).max(24).default([]),
});

/** Registra o kit da NF (ou devolve o já existente, para completar documentos). Abre a pendência de implantação para Cuiabá. */
export async function registrarKit(entrada: z.input<typeof esquemaKit>): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const dados = esquemaKit.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const d = dados.data;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rec_kit_registrar", {
    p_nota: d.nota, p_cliente: d.cliente, p_aceita_boleto_factoring: d.aceitaBoletoFactoring,
    p_obra: d.obra || null, p_periodo_inicio: d.periodoInicio, p_periodo_fim: d.periodoFim, p_empresa: null,
    p_remessa: d.remessaId, p_parcelas: d.parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valorCentavos / 100 })),
    p_emissao: d.emissao, p_cliente_documento: d.clienteDocumento || null,
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  return { ok: true, id: data as string };
}

/** Anexa um documento ao kit (um arquivo por chamada, por causa do limite de tamanho das server actions). */
export async function anexarDocumentoKit(formData: FormData): Promise<Resultado> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const kitId = String(formData.get("kitId") ?? "");
  const tipo = String(formData.get("tipo") ?? "");
  const arquivo = formData.get("arquivo");
  if (!z.string().uuid().safeParse(kitId).success) return { ok: false, erro: "Kit inválido." };
  if (!(TIPOS_DOCUMENTO_KIT as readonly string[]).includes(tipo)) return { ok: false, erro: "Escolha o tipo do documento." };
  if (!(arquivo instanceof File)) return { ok: false, erro: "Escolha o arquivo." };

  const supabase = await criarClienteServidor();
  const { data: kit } = await supabase.from("rec_kits").select("estagio").eq("id", kitId).maybeSingle();
  if (!kit) return { ok: false, erro: "Kit não encontrado." };
  if (kit.estagio === "enviada" || kit.estagio === "cancelada") return { ok: false, erro: "O kit já foi enviado ou cancelado; não recebe documentos." };

  const r = await enviarAnexo(supabase, { modulo: MODULO_FILIAL, referenciaTabela: "rec_kits", referenciaId: kitId }, arquivo, tipo);
  if (!r.ok) return { ok: false, erro: r.erro };
  revalidatePath(ROTA_FILIAL, "layout");
  return { ok: true, aviso: `${arquivo.name} anexado.` };
}

/** Abre a remessa (envio em lote): nº sequencial; os kits são registrados nela em seguida. */
export async function criarRemessa(): Promise<{ ok: true; id: string; numero: number } | { ok: false; erro: string }> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rec_remessa_criar", { p_observacao: null, p_empresa: null });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const r = data as { id: string; numero: number };
  return { ok: true, id: r.id, numero: r.numero };
}

/** Fecha a remessa depois que todos os arquivos subiram: abre a pendência de implantação para Cuiabá e atualiza as telas. */
export async function concluirRemessa(remessaId: string): Promise<Resultado> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  if (!z.string().uuid().safeParse(remessaId).success) return { ok: false, erro: "Remessa inválida." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_remessa_concluir", { p_remessa: remessaId });
  revalidatePath(ROTA_FILIAL, "layout");
  revalidatePath("/inicio");
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  return { ok: true, aviso: "Remessa registrada." };
}

/** Registra que o aviso a Cuiabá foi aberto no programa de e-mail (quem e quando). */
export async function marcarAvisoAberto(remessaId: string): Promise<void> {
  if (await exigirOperador()) return;
  if (!z.string().uuid().safeParse(remessaId).success) return;
  const supabase = await criarClienteServidor();
  await supabase.rpc("rec_remessa_marcar_aviso", { p_remessa: remessaId });
  revalidatePath(ROTA_FILIAL, "layout");
}

/** Links de download (15 min, com o nome original) de todos os documentos da filial nos kits da remessa. */
export async function linksDaRemessa(remessaId: string): Promise<{ ok: true; links: { nome: string; url: string }[] } | { ok: false; erro: string }> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro")) return { ok: false, erro: "Sem acesso." };
  if (!z.string().uuid().safeParse(remessaId).success) return { ok: false, erro: "Remessa inválida." };
  const supabase = await criarClienteServidor();
  const { data: kits } = await supabase.from("rec_remessa_kits").select("kit_id").eq("remessa_id", remessaId);
  const ids = (kits ?? []).map((k) => k.kit_id as string);
  if (ids.length === 0) return { ok: true, links: [] };
  const { data: anexos, error } = await supabase.from("anexos").select("nome_arquivo, arquivo_path")
    .eq("referencia_tabela", "rec_kits").in("referencia_id", ids).in("tipo", ["nota_fatura", "demonstrativo", "comodato"]).order("enviado_em");
  if (error) return { ok: false, erro: "Não foi possível ler os arquivos da remessa." };
  const links: { nome: string; url: string }[] = [];
  for (const a of anexos ?? []) {
    const r = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(a.arquivo_path as string, 900, { download: a.nome_arquivo as string });
    if (r.data) links.push({ nome: a.nome_arquivo as string, url: r.data.signedUrl });
  }
  return { ok: true, links };
}

const esquemaCancelar = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(3, "Informe o motivo do cancelamento.").max(300) });

export async function cancelarKit(entrada: z.input<typeof esquemaCancelar>): Promise<Resultado> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const dados = esquemaCancelar.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: dados.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("rec_kit_cancelar", { p_kit: dados.data.id, p_motivo: dados.data.motivo });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_FILIAL, "layout");
  return { ok: true, aviso: "Kit cancelado." };
}

/**
 * Lê a nota fatura do Syslock (PDF) e devolve nº, cliente, obra, período e as parcelas (vencimento e valor). SÓ LÊ: nada é
 * gravado; a prévia do envio mostra o que foi lido para a pessoa conferir.
 */
export async function lerNotaFatura(formData: FormData): Promise<{ ok: true; nota: NotaLida } | { ok: false; erro: string }> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Arquivo vazio." };
  if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") return { ok: false, erro: "Não é PDF." };
  const ext = await extrairPaginasDoPdf(await arquivo.arrayBuffer());
  if (!ext.ok) return { ok: false, erro: ext.erro };
  return { ok: true, nota: lerNotaSyslock(ext.paginas) };
}

/**
 * Confere no Consistem o código do cliente de cada kit pelo CNPJ/CPF lido da nota (Edge Function rec-filial-cliente-erp).
 * Devolve quantos foram encontrados e quantos não estão cadastrados no Consistem.
 */
export async function conferirClientesErp(kitIds: string[]): Promise<{ ok: true; encontrados: number; naoCadastrados: number } | { ok: false; erro: string }> {
  const negado = await exigirOperador();
  if (negado) return { ok: false, erro: negado };
  const ids = kitIds.filter((i) => z.string().uuid().safeParse(i).success);
  if (ids.length === 0) return { ok: true, encontrados: 0, naoCadastrados: 0 };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("rec-filial-cliente-erp", { body: { kit_ids: ids } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, erro: (corpo as { erro?: string } | null)?.erro ?? "Não foi possível consultar o Consistem agora." };
  }
  const resultados = ((data as { resultados?: { codigo: string | null }[] })?.resultados ?? []);
  revalidatePath(ROTA_FILIAL, "layout");
  return { ok: true, encontrados: resultados.filter((r) => r.codigo).length, naoCadastrados: resultados.filter((r) => !r.codigo).length };
}
