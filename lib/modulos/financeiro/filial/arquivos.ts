// Faturamento da Filial Contagem: leitura dos nomes dos arquivos enviados em lote.
// Os nomes seguem o que a filial e Cuiabá já usam nos e-mails:
//   "NF 02351 - QRTZ 39.pdf"                                   → NF 002351, cliente "QRTZ 39"
//   "NF 02354 - JANEIRO - CARBON (GUARDA-CORPO PARA PILARES).pdf" → NF 002354, cliente "JANEIRO - CARBON (GUARDA-CORPO PARA PILARES)"
//   "2353.PDF", "002331.pdf"                                    → NF 002353, NF 002331 (boleto devolvido por Cuiabá)
// O que o nome não resolver fica para a pessoa informar na prévia; nada é gravado sem a confirmação dela.

export const MODULO_FILIAL = "financeiro.filial";
export const ROTA_FILIAL = "/financeiro/filial";
/** Configuração com os e-mails de Cuiabá que recebem o aviso de remessa (migration 0148). */
export const CHAVE_DESTINATARIOS = "financeiro.filial.aviso_destinatarios";

export const TIPOS_DOCUMENTO_KIT = ["nota_fatura", "demonstrativo", "comodato", "carta_cessao"] as const;
export type TipoDocumentoKit = (typeof TIPOS_DOCUMENTO_KIT)[number];
export const ROTULO_DOCUMENTO_KIT: Record<TipoDocumentoKit, string> = {
  nota_fatura: "Nota fatura",
  demonstrativo: "Demonstrativo",
  comodato: "Comodato",
  carta_cessao: "Carta de cessão",
};
/** Documentos que a filial envia; a carta de cessão é de Cuiabá. */
export const DOCUMENTOS_DA_FILIAL: readonly TipoDocumentoKit[] = ["nota_fatura", "demonstrativo", "comodato"];

export const ESTAGIOS_KIT = ["recebida", "implantada", "pronta", "enviada", "cancelada"] as const;
export type EstagioKit = (typeof ESTAGIOS_KIT)[number];
export const ROTULO_ESTAGIO_KIT: Record<EstagioKit, string> = {
  recebida: "Aguardando implantação",
  implantada: "Aguardando boleto",
  pronta: "Pronta para envio",
  enviada: "Enviada ao cliente",
  cancelada: "Cancelada",
};
export const COR_ESTAGIO_KIT: Record<EstagioKit, "default" | "secondary" | "outline" | "destructive"> = {
  recebida: "outline", implantada: "outline", pronta: "default", enviada: "secondary", cancelada: "destructive",
};
export const ehEstagioKit = (v: string): v is EstagioKit => (ESTAGIOS_KIT as readonly string[]).includes(v);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** NF com 6 dígitos (como no Consistem: '4' + NF + parcela). Null se não for um número de NF plausível. */
export function normalizarNota(valor: string | null | undefined): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos === "" || digitos.length > 6 || /^0+$/.test(digitos)) return null;
  return digitos.padStart(6, "0");
}

/** NF do título da filial: '4002323U' → '002323'. Mesma regra de rec_nota_filial (migration 0146). */
export function notaDoDocumento(documento: string): string | null {
  return documento.startsWith("400") && /^4\d{6}/.test(documento) ? documento.slice(1, 7) : null;
}

export type ArquivoLido = {
  nota: string | null;
  cliente: string | null;
  tipo: TipoDocumentoKit | null;
};

/** Tipo pelo nome: palavras-chave explícitas; arquivo "NF <n> - <cliente>" sem outra pista é a nota fatura. */
export function tipoPeloNome(nome: string): TipoDocumentoKit | null {
  const n = semAcento(nome).toUpperCase();
  if (/DEMONSTRATIVO|DEMONST\b|\bDEMO\b/.test(n)) return "demonstrativo";
  if (/COMODATO/.test(n)) return "comodato";
  if (/CESSAO/.test(n)) return "carta_cessao";
  if (/^\s*(NF|NOTA)\b/.test(n)) return "nota_fatura";
  return null;
}

export function lerNomeArquivo(nome: string): ArquivoLido {
  const base = nome.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  const tipo = tipoPeloNome(base);

  // "NF 02351 - QRTZ 39", "NF02351-QRTZ 39", "NF Nº 2351 - QRTZ 39", "DEMONSTRATIVO NF 2351 - QRTZ 39"
  const comNf = /\b(?:NF|NOTA(?:\s+FISCAL)?)\s*(?:N[º°o.]?\s*)?(\d{1,6})\b\s*(?:[-–—_]\s*(.+))?$/i.exec(base);
  if (comNf) {
    const cliente = (comNf[2] ?? "").trim();
    return { nota: normalizarNota(comNf[1]), cliente: cliente === "" ? null : cliente, tipo };
  }
  // Só o número: "2353", "002331"
  const soNumero = /^0*(\d{1,6})$/.exec(base);
  if (soNumero) return { nota: normalizarNota(soNumero[1]), cliente: null, tipo };
  // Documento identificado pela palavra-chave e um único número solto: "DEMONSTRATIVO 2352", "Comodato 002352 - HERMES"
  if (tipo) {
    const numeros = [...base.matchAll(/(?:^|[^\d])(\d{3,6})(?![\d])/g)].map((m) => m[1]);
    if (numeros.length === 1) {
      const depois = /\d{3,6}\s*[-–—_]\s*(.+)$/.exec(base)?.[1]?.trim();
      return { nota: normalizarNota(numeros[0]), cliente: depois || null, tipo };
    }
  }
  return { nota: null, cliente: null, tipo };
}

export type ItemLote = { indice: number; nome: string; nota: string | null; cliente: string | null; tipo: TipoDocumentoKit | null };
export type GrupoLote<T extends ItemLote = ItemLote> = { nota: string; cliente: string; itens: T[] };

/**
 * Agrupa o lote por NF. O cliente do grupo é o primeiro que algum arquivo trouxe no nome.
 * Arquivo sem NF fica em `semNota` para a pessoa informar.
 */
export function agruparLote<T extends ItemLote>(itens: readonly T[]): { grupos: GrupoLote<T>[]; semNota: T[] } {
  const por = new Map<string, GrupoLote<T>>();
  const semNota: T[] = [];
  for (const item of itens) {
    if (!item.nota) {
      semNota.push(item);
      continue;
    }
    const g: GrupoLote<T> = por.get(item.nota) ?? { nota: item.nota, cliente: "", itens: [] };
    if (!g.cliente && item.cliente) g.cliente = item.cliente;
    g.itens.push(item);
    por.set(item.nota, g);
  }
  return { grupos: [...por.values()].sort((a, b) => a.nota.localeCompare(b.nota)), semNota };
}

/**
 * O que falta no kit, do ponto de vista de quem confere (filial sobe NF/demonstrativo/comodato; Cuiabá, boleto e carta).
 * A carta de cessão só falta quando há parcela cedida de cliente que a pede (`exige_carta` da view; migration 0147).
 */
export function pendenciasDoKit(k: {
  estagio: EstagioKit; notas: number; demonstrativos: number; comodatos: number; cartas: number;
  parcelas: number; boletos: number; exigeCarta: boolean; parcelasTransferencia?: number;
}): string[] {
  if (k.estagio === "enviada" || k.estagio === "cancelada") return [];
  const faltas: string[] = [];
  if (k.notas === 0) faltas.push("nota fatura");
  if (k.demonstrativos === 0) faltas.push("demonstrativo");
  if (k.comodatos === 0) faltas.push("comodato");
  if (k.parcelas === 0) faltas.push("implantação no Consistem");
  else if (k.boletos + (k.parcelasTransferencia ?? 0) < k.parcelas) faltas.push(k.parcelas === 1 ? "boleto" : `boleto (${k.boletos}/${k.parcelas})`);
  if (k.exigeCarta && k.cartas === 0) faltas.push("carta de cessão");
  return faltas;
}
