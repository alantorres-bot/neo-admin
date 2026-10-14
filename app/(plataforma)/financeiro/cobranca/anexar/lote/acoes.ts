"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { normalizarLinhaDigitavel, soDigitos } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { ALTURA_LINHA_OCR, ocrDoPdf } from "@/lib/modulos/financeiro/recebiveis/boleto-ocr";
import { BOLETO_SEM_LEITURA, lerBoleto, type BoletoLido, type TituloCandidato } from "@/lib/modulos/financeiro/recebiveis/boleto-pdf";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { lerParametrosAkf } from "@/app/(plataforma)/financeiro/akf/solicitacoes/dados";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { clienteSemBoleto } from "@/supabase/functions/_shared/akf";
import type { Unidade } from "@/supabase/functions/_shared/cobranca";

/** Anexar boleto é tarefa de Cuiabá: operador do Financeiro (o usuário restrito à unidade não tem a área). */
async function exigirCuiaba(): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "financeiro", "operador") ? null : "Somente operador do Financeiro (Cuiabá) anexa boletos.";
}

/**
 * Lê o boleto (linha digitável, nº do documento, pagador, beneficiário AKF). PDF com texto é lido direto; PDF que é só imagem
 * (Bradesco Net Empresa) passa pelo OCR. SÓ LÊ.
 */
export async function lerArquivoBoleto(formData: FormData): Promise<{ ok: true; boleto: BoletoLido } | { ok: false; erro: string }> {
  const negado = await exigirCuiaba();
  if (negado) return { ok: false, erro: negado };
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Arquivo vazio." };
  if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") {
    return { ok: true, boleto: { ...BOLETO_SEM_LEITURA, avisos: ["Imagem: informe a NF ou escolha o título."] } };
  }
  // Cada leitura com a sua cópia dos bytes: o pdf.js desliga o buffer que recebe.
  const ext = await extrairPaginasDoPdf(await arquivo.arrayBuffer());
  if (ext.ok) return { ok: true, boleto: lerBoleto(ext.paginas) };
  if (ext.precisaSenha) return { ok: true, boleto: { ...BOLETO_SEM_LEITURA, avisos: [ext.erro] } };
  const ocr = await ocrDoPdf(await arquivo.arrayBuffer());
  if (!ocr.ok) return { ok: true, boleto: { ...BOLETO_SEM_LEITURA, porOcr: true, avisos: [ocr.erro] } };
  return { ok: true, boleto: lerBoleto(ocr.paginas, { porOcr: true, alturaLinha: ALTURA_LINHA_OCR }) };
}

export type TituloDoLote = TituloCandidato & { cliente: string; unidade: Unidade };

const esquemaBusca = z.object({
  notas: z.array(z.string().regex(/^\d{1,9}$/)).max(200),
  pares: z.array(z.object({ vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valorCentavos: z.number().int().positive() })).max(200),
  unidade: z.enum(["matriz", "contagem"]).nullable(),
});

/**
 * Títulos em aberto que podem ser de algum boleto do lote: os das NFs lidas (sem zeros à esquerda) e os de mesmo vencimento +
 * valor das linhas digitáveis. Com o que já tem boleto, o CPF/CNPJ do cliente e, na filial, o aceite de boleto de factoring.
 */
export async function titulosParaBoletos(entrada: z.input<typeof esquemaBusca>): Promise<{ ok: true; titulos: TituloDoLote[] } | { ok: false; erro: string }> {
  const negado = await exigirCuiaba();
  if (negado) return { ok: false, erro: negado };
  const dados = esquemaBusca.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: "Dados inválidos." };
  const notas = [...new Set(dados.data.notas.map((n) => n.replace(/^0+/, "")).filter(Boolean))];
  const pares = dados.data.pares;
  if (notas.length === 0 && pares.length === 0) return { ok: true, titulos: [] };

  const supabase = await criarClienteServidor();
  const consulta = () => {
    let q = supabase.from("rec_titulos")
      .select("id, documento, nota_fiscal, vencimento, valor, cedido, unidade, contrapartes(nome, documento)")
      .not("estagio", "in", "(pago,cancelado,renegociado)");
    if (dados.data.unidade) q = q.eq("unidade", dados.data.unidade);
    return q;
  };
  const [porNota, porPar] = await Promise.all([
    notas.length ? consulta().in("nota_fiscal", notas) : Promise.resolve({ data: [], error: null }),
    pares.length
      ? consulta().or(pares.map((p) => `and(vencimento.eq.${p.vencimento},valor.eq.${(p.valorCentavos / 100).toFixed(2)})`).join(","))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (porNota.error || porPar.error) return { ok: false, erro: "Não foi possível ler os títulos." };
  const linhas = [...new Map([...(porNota.data ?? []), ...(porPar.data ?? [])].map((t) => [t.id as string, t])).values()];

  const ids = linhas.map((t) => t.id as string);
  const [{ data: boletos }, { data: kits }, { data: solicitados }, parametrosAkf] = await Promise.all([
    ids.length ? supabase.from("anexos").select("referencia_id").eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("rec_kit_titulos").select("titulo_id, rec_kits(aceita_boleto_factoring)").in("titulo_id", ids) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("akf_operacao_titulos").select("titulo_id, sem_boleto, akf_operacoes!inner(numero, status)").in("titulo_id", ids).neq("akf_operacoes.status", "cancelada")
      : Promise.resolve({ data: [] }),
    lerParametrosAkf(supabase).catch(() => null),
  ]);
  const comBoleto = new Set((boletos ?? []).map((b) => b.referencia_id as string));
  const aceitaDoKit = new Map((kits ?? []).map((k) => {
    const kit = (Array.isArray(k.rec_kits) ? k.rec_kits[0] : k.rec_kits) as { aceita_boleto_factoring?: boolean } | null;
    return [k.titulo_id as string, kit?.aceita_boleto_factoring];
  }));
  // "Sem boleto" marcado na solicitação de antecipação à AKF (a mais recente não cancelada vale).
  const semBoletoNaSolicitacao = new Map<string, { numero: number; semBoleto: boolean }>();
  for (const s of solicitados ?? []) {
    const op = (Array.isArray(s.akf_operacoes) ? s.akf_operacoes[0] : s.akf_operacoes) as { numero: number } | null;
    const atual = semBoletoNaSolicitacao.get(s.titulo_id as string);
    if (op && (!atual || op.numero > atual.numero)) semBoletoNaSolicitacao.set(s.titulo_id as string, { numero: op.numero, semBoleto: !!s.sem_boleto });
  }

  const titulos = linhas.map((t): TituloDoLote => {
    const cp = (Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes) as { nome?: string; documento?: string | null } | null;
    // Cliente que não aceita pagar à AKF: o boleto é emitido pela Neo, que recebe e repassa à AKF. Vale a marcação do título na
    // solicitação de antecipação; sem solicitação, o kit da filial; por fim a lista "clientes sem boleto de factoring" da AKF.
    const naSolicitacao = semBoletoNaSolicitacao.get(t.id as string);
    const doKit = aceitaDoKit.get(t.id as string);
    const aceitaBoletoFactoring = naSolicitacao ? !naSolicitacao.semBoleto
      : doKit === false ? false
      : !(parametrosAkf && clienteSemBoleto(cp?.nome ?? "", parametrosAkf.termosSemBoleto));
    return {
      id: t.id as string, documento: t.documento as string, nota: t.nota_fiscal ? String(t.nota_fiscal).replace(/^0+/, "") : null,
      vencimento: t.vencimento as string, valorCentavos: emCentavos(t.valor as number | string), cedido: !!t.cedido,
      temBoleto: comBoleto.has(t.id as string), clienteDocumento: cp?.documento ? soDigitos(cp.documento) : null,
      aceitaBoletoFactoring, cliente: cp?.nome ?? "", unidade: t.unidade as Unidade,
    };
  });
  titulos.sort((a, b) => a.documento.localeCompare(b.documento));
  return { ok: true, titulos };
}

const esquemaLinha = z.object({ tituloId: z.string().uuid(), linha: z.string().max(80) });

/** Grava no título a linha digitável lida do boleto anexado. */
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
