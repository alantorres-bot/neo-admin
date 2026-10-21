"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extrairPaginasDoPdf } from "@/lib/modulos/financeiro/cartao/fatura-pdf";
import { casarColaborador } from "@/lib/modulos/rh/ponto/casar-colaborador";
import { emailAoLider, type ModoEmail } from "@/lib/modulos/rh/ponto/email";
import { lerInconsistencias, type OcorrenciaLida } from "@/lib/modulos/rh/ponto/leitor-inconsistencias";
import { MODULO_PONTO, ROTA_JUSTIFICAR, ROTA_PONTO } from "@/lib/modulos/rh/ponto/modulo";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerColaboradores, lerLote, lerSetores } from "./dados";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };
const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

async function exigir(nivel: "operador" | "gestor"): Promise<string | null> {
  const sessao = await exigirSessao();
  return temAcesso(sessao.acesso, "rh", nivel) ? null : `Somente ${nivel} do RH (ou acima) pode fazer isso no ponto.`;
}

async function chamar(funcao: string, args: Record<string, unknown>, nivel: "operador" | "gestor" = "operador"): Promise<Resultado & { dados?: unknown }> {
  const negado = await exigir(nivel);
  if (negado) return { ok: false, erro: negado };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc(funcao, args);
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  revalidatePath(ROTA_PONTO, "layout");
  return { ok: true, dados: data };
}

// ---------------------------------------------------------------- importação

export type Previa = {
  arquivo: string; inicio: string; fim: string; ocorrencias: number; pessoas: number; semCadastro: string[]; avisos: string[];
};

type Lido = { ok: true; inicio: string; fim: string; ocorrencias: (OcorrenciaLida & { colaboradorId: string | null })[]; avisos: string[]; arquivo: File } | { ok: false; erro: string };

async function ler(dados: FormData): Promise<Lido> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o PDF de inconsistências do Control iD." };
  if (arquivo.size > TAMANHO_MAXIMO) return { ok: false, erro: "O arquivo passa de 10 MB." };
  const ext = await extrairPaginasDoPdf(await arquivo.arrayBuffer());
  if (!ext.ok) {
    // o "Microsoft Print to PDF" transforma o texto em desenho: o relatório tem de ser o arquivo salvo pelo próprio Control iD
    const semTexto = /não tem texto/.test(ext.erro);
    return { ok: false, erro: semTexto ? "Este PDF não tem texto (foi reimpresso, por exemplo pelo \"Microsoft Print to PDF\"). Use o arquivo salvo direto do Control iD (relatorio_….PDF)." : ext.erro };
  }
  const r = lerInconsistencias(ext.paginas);
  if (!r.inicio || !r.fim) return { ok: false, erro: r.avisos.join(" ") || "Não encontrei o período do relatório." };
  if (r.ocorrencias.length === 0) return { ok: false, erro: r.avisos.join(" ") || "O relatório não tem ocorrências." };
  const supabase = await criarClienteServidor();
  const cadastro = (await lerColaboradores(supabase)).filter((c) => c.ativo);
  const ocorrencias = r.ocorrencias.map((o) => ({ ...o, colaboradorId: casarColaborador(o.nome, cadastro) }));
  return { ok: true, inicio: r.inicio, fim: r.fim, ocorrencias, avisos: r.avisos, arquivo };
}

/** Lê o PDF e mostra o que vai ser gravado (não grava nada). */
export async function previaImportacao(dados: FormData): Promise<{ ok: true; previa: Previa } | { ok: false; erro: string }> {
  const l = await ler(dados);
  if (!l.ok) return l;
  return {
    ok: true,
    previa: {
      arquivo: l.arquivo.name, inicio: l.inicio, fim: l.fim, ocorrencias: l.ocorrencias.length, pessoas: new Set(l.ocorrencias.map((o) => o.nome)).size,
      semCadastro: [...new Set(l.ocorrencias.filter((o) => !o.colaboradorId).map((o) => o.nome))], avisos: l.avisos,
    },
  };
}

/** Lê o PDF de novo (não confia na tela), grava o lote e guarda o PDF como anexo do lote. */
export async function gravarImportacao(dados: FormData): Promise<{ ok: true; id: string; aviso: string } | { ok: false; erro: string }> {
  const setor = String(dados.get("setor") ?? "");
  if (!uuid.safeParse(setor).success) return { ok: false, erro: "Escolha o setor." };
  const l = await ler(dados);
  if (!l.ok) return l;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_pt_importar", {
    p_setor: setor, p_inicio: l.inicio, p_fim: l.fim, p_arquivo: l.arquivo.name,
    p_ocorrencias: l.ocorrencias.map((o) => ({
      ordem: o.ordem, colaborador_id: o.colaboradorId, nome: o.nome, matricula: o.matricula, cargo: o.cargo, data: o.data, dia_semana: o.diaSemana,
      previsto: o.previsto, marcacoes: o.marcacoes, falta: o.falta, falta_atraso_min: o.faltaAtrasoMin, total_normais_min: o.totalNormaisMin,
      extras_min: o.extrasMin, banco_saldo_min: o.bancoSaldoMin,
    })),
  });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const id = data as string;
  const anexo = await enviarAnexo(supabase, { modulo: MODULO_PONTO, referenciaTabela: "rh_pt_lotes", referenciaId: id }, l.arquivo, "relatorio_ponto");
  revalidatePath(ROTA_PONTO, "layout");
  const aviso = `${l.ocorrencias.length} ocorrência(s) importada(s).${anexo.ok ? "" : ` O PDF não foi guardado: ${anexo.erro}`}`;
  return { ok: true, id, aviso };
}

// ---------------------------------------------------------------- e-mail ao líder (rascunho no Gmail de quem clica)

export async function criarRascunhoLider(loteId: string, modo: ModoEmail): Promise<{ ok: true; url: string; aviso?: string } | { ok: false; erro: string }> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!uuid.safeParse(loteId).success || !["envio", "lembrete", "devolucao"].includes(modo)) return { ok: false, erro: "Lote inválido." };
  const supabase = await criarClienteServidor();
  const lote = await lerLote(supabase, loteId);
  if (!lote) return { ok: false, erro: "Lote não encontrado." };
  const setor = (await lerSetores(supabase)).find((s) => s.id === lote.setor_id);
  if (!setor?.lider?.email) return { ok: false, erro: "O setor não tem líder com e-mail. Confira em Ponto > Setores." };

  const cab = await headers();
  const host = cab.get("x-forwarded-host") ?? cab.get("host") ?? "localhost:3000";
  const protocolo = cab.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // envio: o prazo nasce quando o rascunho é registrado; mostra o mesmo cálculo do banco
  let prazo = lote.prazo;
  if (modo === "envio") {
    const { data } = await supabase.rpc("rh_somar_dias_uteis", { p_data: new Date().toLocaleDateString("en-CA", { timeZone: "America/Cuiaba" }), p_n: (await supabase.rpc("rh_pt_prazo_dias")).data ?? 1 });
    prazo = (data as string | null) ?? null;
  }
  const email = emailAoLider({
    modo, setor: setor.nome, inicio: lote.periodo_inicio, fim: lote.periodo_fim, prazo, ocorrencias: lote.ocorrencias,
    link: `${protocolo}://${host}${ROTA_JUSTIFICAR}/${lote.id}`, motivo: lote.devolvido_motivo,
  });

  const { data: mensagem, error: erroMensagem } = await supabase.from("mensagens").insert({
    modulo: MODULO_PONTO, canal: "email", destinatario: setor.lider.email, cc: setor.substituto?.email ?? null,
    assunto: email.assunto, corpo: email.corpo, status: "rascunho",
  }).select("id").single();
  if (erroMensagem || !mensagem) return { ok: false, erro: erroMensagem ? mensagemDeErro(erroMensagem) : "Não foi possível preparar a mensagem." };

  const { data, error } = await supabase.functions.invoke("rh-ponto-rascunho-gmail", { body: { mensagem_id: mensagem.id, lote_id: loteId, modo } });
  if (error || (data && typeof data === "object" && "erro" in data)) {
    let erro = "Não foi possível criar o rascunho no Gmail.";
    const resposta = error ? (error as { context?: Response }).context : undefined;
    if (resposta && typeof resposta.json === "function") {
      try {
        const detalhe = (await resposta.json()) as { erro?: string };
        if (detalhe.erro) erro = detalhe.erro;
      } catch {
        /* mantém a mensagem genérica */
      }
    } else if (data && typeof data === "object" && "erro" in data) {
      erro = String((data as { erro: unknown }).erro);
    }
    await supabase.from("mensagens").update({ status: "descartada" }).eq("id", mensagem.id);
    return { ok: false, erro };
  }
  revalidatePath(ROTA_PONTO, "layout");
  const r = data as { url?: string; aviso?: string } | null;
  return { ok: true, url: r?.url ?? "https://mail.google.com/mail/u/0/#drafts", aviso: r?.aviso };
}

// ---------------------------------------------------------------- RH: lote

export async function vincularColaborador(ocorrenciaId: string, colaboradorId: string | null): Promise<Resultado> {
  if (!uuid.safeParse(ocorrenciaId).success || (colaboradorId !== null && !uuid.safeParse(colaboradorId).success)) return { ok: false, erro: "Dados inválidos." };
  return chamar("rh_pt_vincular_colaborador", { p_ocorrencia: ocorrenciaId, p_colaborador: colaboradorId });
}

export async function devolverAoLider(loteId: string, motivo: string): Promise<Resultado> {
  const m = z.string().trim().min(5, "Informe o motivo da devolução.").max(500).safeParse(motivo);
  if (!m.success) return { ok: false, erro: m.error.issues[0].message };
  if (!uuid.safeParse(loteId).success) return { ok: false, erro: "Lote inválido." };
  return chamar("rh_pt_devolver", { p_lote: loteId, p_motivo: m.data });
}

export async function marcarAjustado(loteId: string, ocorrencias: string[], ajustado: boolean): Promise<Resultado> {
  if (!uuid.safeParse(loteId).success || !z.array(uuid).min(1).safeParse(ocorrencias).success) return { ok: false, erro: "Selecione as ocorrências." };
  const r = await chamar("rh_pt_marcar_ajustado", { p_lote: loteId, p_ocorrencias: ocorrencias, p_ajustado: ajustado });
  return r.ok ? { ok: true, aviso: `${r.dados as number} ocorrência(s) ${ajustado ? "marcada(s)" : "desmarcada(s)"}.` } : r;
}

export async function cancelarLote(loteId: string, motivo: string): Promise<Resultado> {
  const m = z.string().trim().min(5, "Informe o motivo do cancelamento.").max(500).safeParse(motivo);
  if (!m.success) return { ok: false, erro: m.error.issues[0].message };
  if (!uuid.safeParse(loteId).success) return { ok: false, erro: "Lote inválido." };
  return chamar("rh_pt_cancelar", { p_lote: loteId, p_motivo: m.data }, "gestor");
}

/** Atestado/declaração da ocorrência: vai direto ao RH (o líder não anexa nem vê). */
export async function anexarAtestado(dados: FormData): Promise<Resultado> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  const id = String(dados.get("ocorrencia") ?? "");
  const arquivo = dados.get("arquivo");
  if (!uuid.safeParse(id).success || !(arquivo instanceof File)) return { ok: false, erro: "Escolha o arquivo." };
  const supabase = await criarClienteServidor();
  const r = await enviarAnexo(supabase, { modulo: MODULO_PONTO, referenciaTabela: "rh_pt_ocorrencias", referenciaId: id }, arquivo, "atestado");
  if (!r.ok) return r;
  revalidatePath(ROTA_PONTO, "layout");
  return { ok: true, aviso: "Documento anexado." };
}

export async function linkDoAnexo(caminho: string): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const negado = await exigir("operador");
  if (negado) return { ok: false, erro: negado };
  if (!caminho.startsWith(`${MODULO_PONTO}/`)) return { ok: false, erro: "Anexo inválido." };
  const supabase = await criarClienteServidor();
  const r = await supabase.storage.from("anexos").createSignedUrl(caminho, 300);
  return r.error || !r.data ? { ok: false, erro: "Não foi possível abrir o arquivo." } : { ok: true, url: r.data.signedUrl };
}

// ---------------------------------------------------------------- gestor: setores e prazo

const esquemaSetor = z.object({
  id: uuid.nullable(), nome: z.string().trim().min(2, "Informe o nome do setor.").max(80),
  lider: uuid, substituto: uuid.nullable(), ativo: z.boolean(),
});

export async function salvarSetor(entrada: z.input<typeof esquemaSetor>): Promise<Resultado> {
  const d = esquemaSetor.safeParse(entrada);
  if (!d.success) return { ok: false, erro: d.error.issues[0].message };
  const r = await chamar("rh_pt_salvar_setor", { p_id: d.data.id, p_nome: d.data.nome, p_lider: d.data.lider, p_substituto: d.data.substituto, p_ativo: d.data.ativo }, "gestor");
  return r.ok ? { ok: true, aviso: "Setor salvo." } : r;
}

export async function salvarPrazo(dias: number): Promise<Resultado> {
  if (!Number.isInteger(dias) || dias < 1 || dias > 10) return { ok: false, erro: "O prazo do líder vai de 1 a 10 dias úteis." };
  const r = await chamar("rh_pt_salvar_prazo", { p_dias: dias }, "gestor");
  return r.ok ? { ok: true, aviso: "Prazo salvo." } : r;
}
