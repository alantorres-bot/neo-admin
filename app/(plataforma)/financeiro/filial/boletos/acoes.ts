"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { lerBoletoPdf, type BoletoLido, type TituloCandidato } from "@/lib/modulos/financeiro/filial/boleto-pdf";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { normalizarLinhaDigitavel } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** Anexar boleto é tarefa de Cuiabá: operador do Financeiro (o usuário restrito à unidade não tem a área). */
async function exigirCuiaba(): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "financeiro", "operador") ? null : "Somente operador do Financeiro (Cuiabá) anexa boletos.";
}

/** Lê o boleto em PDF (linha digitável, nº do documento, beneficiário AKF). SÓ LÊ. */
export async function lerBoleto(formData: FormData): Promise<{ ok: true; boleto: BoletoLido } | { ok: false; erro: string }> {
  const negado = await exigirCuiaba();
  if (negado) return { ok: false, erro: negado };
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Arquivo vazio." };
  if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") {
    return { ok: true, boleto: { linha: null, documento: null, beneficiarioAkf: false, avisos: ["Imagem: ligada pelo nº do arquivo."] } };
  }
  const ext = await extrairPaginasDoPdf(await arquivo.arrayBuffer());
  if (!ext.ok) return { ok: true, boleto: { linha: null, documento: null, beneficiarioAkf: false, avisos: [ext.erro] } };
  return { ok: true, boleto: lerBoletoPdf(ext.paginas) };
}

export type TituloDaNota = TituloCandidato & { cliente: string; kitId: string | null };

/** Parcelas em aberto da Filial para as NFs informadas (6 dígitos), com o que já tem boleto e o kit, se houver. */
export async function titulosDasNotas(notas: string[]): Promise<{ ok: true; porNota: Record<string, TituloDaNota[]> } | { ok: false; erro: string }> {
  const negado = await exigirCuiaba();
  if (negado) return { ok: false, erro: negado };
  const validas = [...new Set(notas.filter((n) => /^\d{6}$/.test(n)))];
  if (validas.length === 0) return { ok: true, porNota: {} };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("rec_titulos")
    .select("id, documento, nota_fiscal, vencimento, valor, cedido, contrapartes(nome)")
    .eq("unidade", "contagem").in("nota_fiscal", validas.map((n) => String(Number(n))))
    .not("estagio", "in", "(pago,cancelado,renegociado)").order("vencimento");
  if (error) return { ok: false, erro: "Não foi possível ler os títulos." };
  const ids = (data ?? []).map((t) => t.id as string);
  const [{ data: boletos }, { data: kits }] = await Promise.all([
    ids.length ? supabase.from("anexos").select("referencia_id").eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("rec_kit_titulos").select("titulo_id, kit_id, rec_kits(aceita_boleto_factoring)").in("titulo_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const comBoleto = new Set((boletos ?? []).map((b) => b.referencia_id as string));
  const kitDe = new Map((kits ?? []).map((k) => [k.titulo_id as string, k.kit_id as string]));
  const aceitaDe = new Map((kits ?? []).map((k) => {
    const kit = (Array.isArray(k.rec_kits) ? k.rec_kits[0] : k.rec_kits) as { aceita_boleto_factoring?: boolean } | null;
    return [k.titulo_id as string, kit?.aceita_boleto_factoring];
  }));

  const porNota: Record<string, TituloDaNota[]> = {};
  for (const t of data ?? []) {
    const nota = String(t.nota_fiscal ?? "").padStart(6, "0");
    const cp = Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes;
    (porNota[nota] ??= []).push({
      id: t.id as string, documento: t.documento as string, vencimento: t.vencimento as string, valorCentavos: emCentavos(t.valor as number | string),
      cedido: !!t.cedido, temBoleto: comBoleto.has(t.id as string), cliente: (cp as { nome?: string } | null)?.nome ?? "", kitId: kitDe.get(t.id as string) ?? null,
      aceitaBoletoFactoring: aceitaDe.get(t.id as string),
    });
  }
  return { ok: true, porNota };
}

const esquemaLinha = z.object({ tituloId: z.string().uuid(), linha: z.string().max(80) });

/** Grava a linha digitável lida do boleto (só se o título ainda não tiver uma diferente). */
export async function gravarLinhaDigitavel(entrada: z.input<typeof esquemaLinha>): Promise<{ ok: true } | { ok: false; erro: string }> {
  const negado = await exigirCuiaba();
  if (negado) return { ok: false, erro: negado };
  const dados = esquemaLinha.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: "Dados inválidos." };
  const linha = normalizarLinhaDigitavel(dados.data.linha);
  if (!linha.ok || !linha.valor) return { ok: false, erro: "Linha digitável inválida." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("rec_titulos").update({ linha_digitavel: linha.valor }).eq("id", dados.data.tituloId);
  if (error) return { ok: false, erro: "Não foi possível gravar a linha digitável." };
  return { ok: true };
}

/** Atualiza as telas depois do lote. */
export async function concluirLoteBoletos(): Promise<void> {
  revalidatePath(ROTA_FILIAL, "layout");
  revalidatePath("/financeiro/cobranca", "layout");
  revalidatePath("/financeiro/recebiveis", "layout");
  revalidatePath("/inicio");
}
