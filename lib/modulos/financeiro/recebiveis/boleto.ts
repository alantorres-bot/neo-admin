// Boleto e mensagem de envio (regras puras). O boleto é gerado fora (Consistem/banco) e anexado por pessoa; aqui ficam
// a validação da linha digitável, a montagem da mensagem a partir do modelo e as regras do "marcar como enviado".
import { formatarData, formatarMoeda } from "./formatos";

export const TIPO_ANEXO_BOLETO = "boleto";
export const MODULO_RECEBIVEIS = "financeiro.recebiveis";
export const MODELO_BOLETO_EMAIL = "Envio de boleto — e-mail";
export const MODELO_BOLETO_WHATSAPP = "Envio de boleto — WhatsApp";

// ---------------------------------------------------------------- linha digitável

/** Só dígitos. */
export const soDigitos = (v: string): string => v.replace(/\D/g, "");

export type ResultadoLinha = { ok: true; valor: string | null } | { ok: false; erro: string };

/**
 * Linha digitável: vazia é permitida (o boleto é o PDF). Preenchida, precisa ter 47 dígitos (boleto de cobrança)
 * ou 48 (convênio/arrecadação). Não confere dígito verificador: quem digita copia do PDF.
 */
export function normalizarLinhaDigitavel(entrada: string | null | undefined): ResultadoLinha {
  const d = soDigitos(entrada ?? "");
  if (d === "") return { ok: true, valor: null };
  if (d.length !== 47 && d.length !== 48) return { ok: false, erro: "A linha digitável tem 47 dígitos (ou 48, em boleto de convênio)." };
  return { ok: true, valor: d };
}

// ---------------------------------------------------------------- mensagem

export type ParcelaMensagem = { documento: string; parcela: string; vencimento: string; valorCentavos: number; linhaDigitavel?: string | null };

export type DadosMensagem = {
  /** Nome de quem recebe (contato). Vazio vira "Prezados". */
  contato: string;
  cliente: string;
  /** "NF 1395" ou "título Z00031A". */
  referencia: string;
  parcelas: ParcelaMensagem[];
};

const nomeParcela = (p: ParcelaMensagem) => `${p.documento}${p.parcela !== "1" ? `/${p.parcela}` : ""}`;

/** Lista das parcelas, uma por linha: "• 1001395A — vencimento 15/10/2026 — R$ 52.500,00". */
export function listarParcelas(parcelas: readonly ParcelaMensagem[]): string {
  return [...parcelas]
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.documento.localeCompare(b.documento))
    .map((p) => `• ${nomeParcela(p)} — vencimento ${formatarData(p.vencimento)} — ${formatarMoeda(p.valorCentavos)}`)
    .join("\n");
}

/** Linha digitável de cada parcela que tiver, uma por linha ("1001395A: 3419...."). Vazio se nenhuma. */
export function listarLinhasDigitaveis(parcelas: readonly ParcelaMensagem[]): string {
  return parcelas.filter((p) => p.linhaDigitavel).map((p) => `${nomeParcela(p)}: ${p.linhaDigitavel}`).join("\n");
}

export function variaveisDaMensagem(d: DadosMensagem): Record<string, string> {
  const total = d.parcelas.reduce((s, p) => s + p.valorCentavos, 0);
  return {
    contato: d.contato.trim() || "Prezados",
    cliente: d.cliente.trim(),
    referencia: d.referencia,
    parcelas: listarParcelas(d.parcelas),
    linhas_digitaveis: listarLinhasDigitaveis(d.parcelas),
    total: formatarMoeda(total),
    qtd_parcelas: String(d.parcelas.length),
  };
}

/** Troca `{variavel}` pelo valor. Variável desconhecida fica como está (aparece na tela e dá para corrigir o modelo). */
export function preencherModelo(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{([a-z_]+)\}/g, (inteiro, nome: string) => (nome in variaveis ? variaveis[nome] : inteiro));
}

export type MensagemMontada = { assunto: string | null; corpo: string };

export function montarMensagem(modelo: { assunto: string | null; corpo: string }, dados: DadosMensagem): MensagemMontada {
  const v = variaveisDaMensagem(dados);
  // Sem linha digitável nenhuma, a linha do modelo que a cita não deve sobrar vazia.
  const corpo = preencherModelo(modelo.corpo, v).replace(/\n{3,}/g, "\n\n").trim();
  return { assunto: modelo.assunto ? preencherModelo(modelo.assunto, v).trim() : null, corpo };
}

// ---------------------------------------------------------------- marcar como enviado

export type ParcelaParaEnvio = { id: string; estagio: string; temBoleto: boolean };

export type AvaliacaoEnvio = { ok: true; ids: string[] } | { ok: false; erro: string };

/**
 * Só parcelas aguardando boleto e COM boleto anexado podem ser marcadas como enviadas: o registro de envio é prova,
 * e "enviado" sem arquivo não faria sentido.
 */
export function avaliarEnvio(selecionadas: readonly string[], parcelas: readonly ParcelaParaEnvio[]): AvaliacaoEnvio {
  const ids = [...new Set(selecionadas)];
  if (ids.length === 0) return { ok: false, erro: "Marque pelo menos uma parcela." };
  const porId = new Map(parcelas.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) return { ok: false, erro: "Parcela inválida para este envio." };
    if (p.estagio !== "aguardando_boleto") return { ok: false, erro: "Uma das parcelas já não está aguardando boleto." };
    if (!p.temBoleto) return { ok: false, erro: "Anexe o boleto de cada parcela marcada antes de marcar como enviado." };
  }
  return { ok: true, ids };
}

/** A pendência "Anexar boleto" acaba quando nenhuma parcela do grupo continua aguardando boleto. */
export function pendenciaConcluida(estagiosDoGrupo: readonly string[]): boolean {
  return !estagiosDoGrupo.includes("aguardando_boleto");
}
