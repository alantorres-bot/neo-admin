// Leitura do boleto em PDF (Fase B do Faturamento Filial): a LINHA DIGITÁVEL é a fonte segura — tem o banco, o fator de
// vencimento e o valor embutidos (padrão FEBRABAN), independente do layout de cada emissor. Do texto também saem o nº do
// documento (a NF) e se o beneficiário é a AKF (boleto de título cedido).
// Calibrado com os boletos da AKF/Bradesco (002342–002349). Boleto escaneado (imagem) não tem texto: fica sem leitura e a
// pessoa liga pelo nº do nome do arquivo. Regra pura.
import type { PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";

export type LinhaDecodificada = {
  /** 47 dígitos (cobrança bancária). */
  linha: string;
  banco: string;
  vencimento: string | null;
  valorCentavos: number;
};

/** Módulo 10 do campo da linha digitável (pesos 2,1 da direita para a esquerda). */
function dvModulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    const p = Number(numero[i]) * peso;
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Fator de vencimento → data. Desde 22/02/2025 o fator recomeçou em 1000 (FEBRABAN): 1000 = 22/02/2025.
 * Fator 0 = sem vencimento.
 */
export function vencimentoDoFator(fator: number): string | null {
  if (fator === 0) return null;
  const base = Date.UTC(2025, 1, 22);
  return new Date(base + (fator - 1000) * 86_400_000).toISOString().slice(0, 10);
}

/** Decodifica a linha digitável de 47 dígitos (com ou sem pontos/espaços). Null se o tamanho ou os DVs dos campos não batem. */
export function decodificarLinhaDigitavel(texto: string): LinhaDecodificada | null {
  const d = texto.replace(/\D/g, "");
  if (d.length !== 47) return null;
  const campos = [d.slice(0, 9), d.slice(10, 20), d.slice(21, 31)];
  const dvs = [d[9], d[20], d[31]].map(Number);
  if (campos.some((c, i) => dvModulo10(c) !== dvs[i])) return null;
  const fator = Number(d.slice(33, 37));
  const valorCentavos = Number(d.slice(37, 47));
  return { linha: d, banco: d.slice(0, 3), vencimento: vencimentoDoFator(fator), valorCentavos };
}

export type BoletoLido = {
  linha: LinhaDecodificada | null;
  /** Nº do documento impresso (a NF, 6 dígitos), quando encontrado. */
  documento: string | null;
  /** Beneficiário é a AKF Securitizadora (título cedido). */
  beneficiarioAkf: boolean;
  avisos: string[];
};

export function lerBoletoPdf(paginas: readonly PaginaTexto[]): BoletoLido {
  const textos = paginas.flatMap((p) => p.itens.map((i) => i.texto.trim()));
  if (textos.length === 0) return { linha: null, documento: null, beneficiarioAkf: false, avisos: ["Boleto sem texto (escaneado): ligado pelo nº do arquivo."] };

  // Linha digitável: item com 5 grupos (aaaaa.aaaaa bbbbb.bbbbbb ccccc.cccccc d eeee…) ou 47 dígitos seguidos.
  let linha: LinhaDecodificada | null = null;
  for (const t of textos) {
    if (/^[\d.\s]{47,60}$/.test(t)) {
      linha = decodificarLinhaDigitavel(t);
      if (linha) break;
    }
  }

  // Nº do documento: 6 dígitos sozinhos (como "002345") — o primeiro que aparece no recibo.
  const documento = textos.find((t) => /^\d{6}$/.test(t)) ?? null;
  const beneficiarioAkf = textos.some((t) => /AKF SECURITIZADORA/i.test(t));

  const avisos: string[] = [];
  if (!linha) avisos.push("Não encontrei a linha digitável no boleto.");
  return { linha, documento, beneficiarioAkf, avisos };
}

export type TituloCandidato = {
  id: string; documento: string; vencimento: string; valorCentavos: number; cedido: boolean; temBoleto: boolean;
  /** Do kit da filial: false = cliente não aceita boleto de factoring (AKF). */
  aceitaBoletoFactoring?: boolean;
};

export type Escolha = {
  /** Título escolhido sozinho (único da NF, ou o que bate em vencimento e valor); null = a pessoa escolhe. */
  tituloId: string | null;
  avisos: string[];
};

/**
 * Liga o boleto à parcela da NF: única parcela → ela; várias → a que bate em vencimento e valor da linha digitável.
 * Avisa divergência, boleto já anexado (vai substituir) e boleto da AKF em título não cedido (ou o contrário).
 */
export function escolherTitulo(boleto: Pick<BoletoLido, "linha" | "beneficiarioAkf"> | null, titulos: readonly TituloCandidato[]): Escolha {
  const avisos: string[] = [];
  if (titulos.length === 0) return { tituloId: null, avisos: ["Nenhuma parcela em aberto desta NF no Consistem (ainda não implantada?)."] };
  const linha = boleto?.linha ?? null;
  let escolhido: TituloCandidato | null = null;
  if (titulos.length === 1) escolhido = titulos[0];
  else if (linha) {
    const iguais = titulos.filter((t) => t.vencimento === linha.vencimento && t.valorCentavos === linha.valorCentavos);
    if (iguais.length === 1) escolhido = iguais[0];
  }
  if (!escolhido) {
    avisos.push(`A NF tem ${titulos.length} parcelas: escolha a parcela deste boleto.`);
    return { tituloId: null, avisos };
  }
  if (linha && linha.vencimento !== escolhido.vencimento) avisos.push(`Vencimento do boleto ${linha.vencimento?.split("-").reverse().join("/") ?? "—"} × título ${escolhido.vencimento.split("-").reverse().join("/")}.`);
  if (linha && linha.valorCentavos !== escolhido.valorCentavos) avisos.push(`Valor do boleto diferente do título (${(linha.valorCentavos / 100).toFixed(2).replace(".", ",")} × ${(escolhido.valorCentavos / 100).toFixed(2).replace(".", ",")}).`);
  if (boleto?.beneficiarioAkf && !escolhido.cedido) avisos.push("Boleto da AKF, mas o título não está marcado como cedido.");
  if (boleto?.beneficiarioAkf && escolhido.aceitaBoletoFactoring === false) avisos.push("Cliente NÃO aceita boleto de factoring: este boleto é da AKF.");
  if (escolhido.temBoleto) avisos.push("O título já tem boleto: este passa a valer (o anterior fica guardado).");
  return { tituloId: escolhido.id, avisos };
}
