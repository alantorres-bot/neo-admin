// Leitura do boleto (PDF com texto ou imagem lida por OCR) e ligação com o título — regra pura, comum à Matriz e à Filial.
// A LINHA DIGITÁVEL é a fonte segura: tem o banco, o fator de vencimento e o valor embutidos (padrão FEBRABAN) e se confere
// sozinha pelos dígitos verificadores (3 de campo + o geral) — leitura errada (inclusive de OCR) nunca passa.
// Do texto também saem o "Nº do documento" (a NF; na Matriz vem "NF/parcela", ex.: "1237/8"), o CNPJ do pagador e se o
// beneficiário é a AKF. Calibrado com boletos da AKF (Matriz e Filial, PDF com texto) e do Bradesco Net Empresa (PDF-imagem).
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";

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

/** DV geral do código de barras (módulo 11, pesos 2 a 9 da direita para a esquerda; 0, 10 e 11 viram 1). */
function dvGeral(barrasSemDv: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = barrasSemDv.length - 1; i >= 0; i--) {
    soma += Number(barrasSemDv[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
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

/** Decodifica a linha digitável de 47 dígitos (com ou sem pontos/espaços). Null se o tamanho ou algum DV não bate. */
export function decodificarLinhaDigitavel(texto: string): LinhaDecodificada | null {
  const d = texto.replace(/\D/g, "");
  if (d.length !== 47) return null;
  const campos = [d.slice(0, 9), d.slice(10, 20), d.slice(21, 31)];
  const dvs = [d[9], d[20], d[31]].map(Number);
  if (campos.some((c, i) => dvModulo10(c) !== dvs[i])) return null;
  // Código de barras: banco+moeda (4), DV geral, fator+valor (14), campo livre (25).
  const campoLivre = d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  if (dvGeral(d.slice(0, 4) + d.slice(33, 47) + campoLivre) !== Number(d[32])) return null;
  const fator = Number(d.slice(33, 37));
  const valorCentavos = Number(d.slice(37, 47));
  return { linha: d, banco: d.slice(0, 3), vencimento: vencimentoDoFator(fator), valorCentavos };
}

/** Linha digitável dentro de um texto qualquer (item do PDF ou linha do OCR): "aaaaa.aaaaa bbbbb.bbbbbb ccccc.cccccc d eeee…". */
export function procurarLinhaDigitavel(texto: string): LinhaDecodificada | null {
  const padrao = /\d{5}[.,]?\d{5}\s*\d{5}[.,]?\d{6}\s*\d{5}[.,]?\d{6}\s*\d\s*\d{14}/g;
  for (const m of texto.matchAll(padrao)) {
    const linha = decodificarLinhaDigitavel(m[0]);
    if (linha) return linha;
  }
  return null;
}

export type DocumentoLido = {
  /** Como veio no boleto: "002316", "1237/8", "226/2026/4". */
  texto: string;
  /** NF sem zeros à esquerda ("2316", "1237"); null quando o documento não é uma NF (série Z: "226/2026/4"). */
  nota: string | null;
  /** Nº da parcela quando o boleto diz ("1237/8" → 8). */
  parcela: number | null;
};

/** Interpreta o "Nº do documento": "002316" → NF 2316; "1237/8" → NF 1237, parcela 8; "226/2026/4" → sem NF, parcela 4. */
export function lerNumeroDocumento(texto: string | null | undefined): DocumentoLido | null {
  const t = (texto ?? "").trim();
  if (!/^\d+(\/\d+){0,2}$/.test(t)) return null;
  const partes = t.split("/");
  const semZeros = (n: string) => (/^0+$/.test(n) ? null : n.replace(/^0+/, ""));
  if (partes.length === 1) return { texto: t, nota: semZeros(partes[0]), parcela: null };
  const parcela = Number(partes[partes.length - 1]) || null;
  return { texto: t, nota: partes.length === 2 ? semZeros(partes[0]) : null, parcela };
}

/** Letra da parcela no código do título do Consistem: 1 → A, 2 → B… ('U' = parcela única). */
export function letraDaParcela(parcela: number): string | null {
  return parcela >= 1 && parcela <= 20 ? String.fromCharCode(64 + parcela) : null;
}

/** CPF ou CNPJ com os dígitos verificadores certos (só os dígitos); null se não confere — descarta leitura errada do OCR. */
export function cpfCnpjValido(texto: string | null | undefined): string | null {
  let d = (texto ?? "").replace(/\D/g, "");
  if (d.length === 15 && d[0] === "0") d = d.slice(1); // o Bradesco imprime o CNPJ com um zero a mais: "045.498.204/0001-32"
  if ((d.length !== 11 && d.length !== 14) || /^(\d)\1+$/.test(d)) return null;
  const cpf = d.length === 11;
  const dv = (base: string) => {
    let soma = 0;
    for (let k = 0; k < base.length; k++) {
      // CPF: pesos 10..2 / 11..2; CNPJ: 2..9 da direita para a esquerda, recomeçando.
      const peso = cpf ? base.length + 1 - k : ((base.length - 1 - k) % 8) + 2;
      soma += Number(base[k]) * peso;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const n = d.length;
  return dv(d.slice(0, n - 2)) === Number(d[n - 2]) && dv(d.slice(0, n - 1)) === Number(d[n - 1]) ? d : null;
}

export type BoletoLido = {
  linha: LinhaDecodificada | null;
  documento: DocumentoLido | null;
  /** CPF/CNPJ do pagador (só dígitos), só quando os DVs conferem. */
  pagadorDocumento: string | null;
  /** Beneficiário é a AKF Securitizadora (título cedido). */
  beneficiarioAkf: boolean;
  /** Lido por OCR (o PDF era imagem). */
  porOcr: boolean;
  avisos: string[];
};

export const BOLETO_SEM_LEITURA: BoletoLido = { linha: null, documento: null, pagadorDocumento: null, beneficiarioAkf: false, porOcr: false, avisos: [] };

/** Item logo abaixo do rótulo (mesma coluna): é onde fica o valor de cada campo da ficha do boleto. */
function valorAbaixo(itens: readonly ItemTexto[], rotulo: ItemTexto, alturaLinha: number): ItemTexto | null {
  return itens
    .filter((i) => i !== rotulo && Math.abs(i.x - rotulo.x) <= alturaLinha * 0.8 && i.y > rotulo.y && i.y - rotulo.y <= alturaLinha * 1.6)
    .sort((a, b) => a.y - b.y)[0] ?? null;
}

/**
 * Lê o boleto a partir dos itens de texto posicionados (do PDF ou do OCR; a 1ª página basta).
 * `alturaLinha` = altura aproximada de uma linha de texto na unidade das coordenadas (pontos no PDF, pixels no OCR).
 */
export function lerBoleto(paginas: readonly PaginaTexto[], opcoes: { porOcr?: boolean; alturaLinha?: number } = {}): BoletoLido {
  const porOcr = !!opcoes.porOcr;
  const alturaLinha = opcoes.alturaLinha ?? 11;
  const itens = paginas[0]?.itens ?? [];
  if (itens.length === 0) return { ...BOLETO_SEM_LEITURA, porOcr, avisos: ["Boleto sem texto legível: ligue pelo nº da NF ou escolha a parcela."] };

  let linha: LinhaDecodificada | null = null;
  for (const i of itens) if ((linha = procurarLinhaDigitavel(i.texto))) break;

  let documento: DocumentoLido | null = null;
  // "Número do documento", "Nº do Documento" (o OCR lê "N* do documento")
  for (const rotulo of itens.filter((i) => /\b(n\W?|n[úu]mero)\s*do\s*documento\b/i.test(i.texto))) {
    const valor = valorAbaixo(itens, rotulo, alturaLinha);
    if ((documento = lerNumeroDocumento(valor?.texto.split(/\s+/)[0]))) break;
  }
  // Layout sem rótulo reconhecido: NF de 6 dígitos sozinha (como a AKF imprime "002345").
  documento ??= lerNumeroDocumento(itens.find((i) => /^\d{6}$/.test(i.texto.trim()))?.texto);

  // Pagador: "NOME, CNPJ: 00.000.000/0000-00" (AKF) ou "NOME | CNPJ/CPF: 0…" (Bradesco), logo abaixo/ao lado do rótulo.
  // O OCR às vezes lê "CNP)/CPF"; o DV descarta o número lido errado.
  let pagadorDocumento: string | null = null;
  for (const rotulo of itens.filter((i) => /^pagador:?/i.test(i.texto.trim()))) {
    const vizinhos = itens.filter((i) => Math.abs(i.y - rotulo.y) <= alturaLinha * 1.6 && i.x >= rotulo.x - alturaLinha);
    for (const v of [rotulo, ...vizinhos]) {
      const m = /(?:CNP\S|CPF)(?:\s*\/\s*CPF)?:?\s*([\d.\/-]{11,20})/i.exec(v.texto);
      if (m && (pagadorDocumento = cpfCnpjValido(m[1]))) break;
    }
    if (pagadorDocumento) break;
  }

  const beneficiarioAkf = itens.some((i) => /AKF SECURITIZADORA/i.test(i.texto));
  const avisos: string[] = [];
  if (!linha) avisos.push(porOcr ? "Não consegui ler a linha digitável na imagem do boleto." : "Não encontrei a linha digitável no boleto.");
  return { linha, documento, pagadorDocumento, beneficiarioAkf, porOcr, avisos };
}

export type TituloCandidato = {
  id: string;
  documento: string;
  /** NF sem zeros à esquerda (null na série Z). */
  nota: string | null;
  vencimento: string;
  valorCentavos: number;
  cedido: boolean;
  temBoleto: boolean;
  /** CPF/CNPJ do cliente (só dígitos), quando cadastrado. */
  clienteDocumento?: string | null;
  /**
   * false = cliente não aceita pagar à AKF: no título cedido o boleto é o próprio da Neo, que recebe e repassa à AKF. Vem da
   * marcação "sem boleto" na solicitação de antecipação, do kit da filial ou da lista de clientes sem boleto de factoring.
   */
  aceitaBoletoFactoring?: boolean;
};

export type Escolha = {
  /** Título ligado sozinho; null = a pessoa escolhe. */
  tituloId: string | null;
  avisos: string[];
};

const dataBr = (iso: string | null) => iso?.split("-").reverse().join("/") ?? "—";
const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** Letra final do código do título ("1001237H" → "H"). */
const letraDoTitulo = (documento: string) => (/[A-Z]$/.test(documento) ? documento.slice(-1) : null);

/**
 * Liga o boleto ao título. `candidatos` = títulos em aberto da NF lida e os de mesmo vencimento + valor da linha digitável.
 * 1º pela NF (e a letra da parcela, quando o boleto diz "NF/parcela"; senão a única parcela ou a que bate vencimento e valor);
 * 2º por vencimento + valor exatos (desempate pelo CPF/CNPJ do pagador e pela parcela). Só liga sozinho com UM resultado.
 */
export function escolherTitulo(boleto: Pick<BoletoLido, "linha" | "documento" | "pagadorDocumento" | "beneficiarioAkf"> | null, candidatos: readonly TituloCandidato[]): Escolha {
  const linha = boleto?.linha ?? null;
  const doc = boleto?.documento ?? null;
  const letra = doc?.parcela ? letraDaParcela(doc.parcela) : null;
  const bateLinha = (t: TituloCandidato) => !!linha && t.vencimento === linha.vencimento && t.valorCentavos === linha.valorCentavos;
  const unico = (lista: readonly TituloCandidato[]) => (lista.length === 1 ? lista[0] : null);

  let escolhido: TituloCandidato | null = null;
  const daNota = doc?.nota ? candidatos.filter((t) => t.nota === doc.nota) : [];
  if (daNota.length > 0) {
    escolhido = (letra ? unico(daNota.filter((t) => letraDoTitulo(t.documento) === letra)) : null)
      ?? unico(daNota)
      ?? unico(daNota.filter(bateLinha));
  }
  if (!escolhido && linha) {
    let exatos = candidatos.filter(bateLinha);
    const filtrar = (f: (t: TituloCandidato) => boolean) => {
      const r = exatos.filter(f);
      if (r.length > 0) exatos = r;
    };
    if (exatos.length > 1 && boleto?.pagadorDocumento) filtrar((t) => t.clienteDocumento === boleto.pagadorDocumento);
    if (exatos.length > 1 && letra) filtrar((t) => letraDoTitulo(t.documento) === letra);
    escolhido = unico(exatos);
  }

  if (!escolhido) {
    if (candidatos.length === 0) return { tituloId: null, avisos: [doc?.nota ? `Nenhum título em aberto da NF ${doc.nota} nem com o vencimento e o valor do boleto.` : "Nenhum título em aberto com o vencimento e o valor do boleto: informe a NF."] };
    if (daNota.length > 1) return { tituloId: null, avisos: [`A NF ${doc!.nota} tem ${daNota.length} parcelas em aberto: escolha a deste boleto.`] };
    return { tituloId: null, avisos: ["Mais de um título possível: escolha o deste boleto."] };
  }
  return { tituloId: escolhido.id, avisos: conferir(boleto, escolhido) };
}

/** Conferência boleto × título escolhido (sozinho ou pela pessoa). */
export function conferir(boleto: Pick<BoletoLido, "linha" | "documento" | "pagadorDocumento" | "beneficiarioAkf"> | null, titulo: TituloCandidato): string[] {
  const avisos: string[] = [];
  const linha = boleto?.linha ?? null;
  const doc = boleto?.documento ?? null;
  if (linha && linha.vencimento !== titulo.vencimento) avisos.push(`Vencimento do boleto ${dataBr(linha.vencimento)} × título ${dataBr(titulo.vencimento)}.`);
  if (linha && linha.valorCentavos !== titulo.valorCentavos) avisos.push(`Valor do boleto diferente do título (${reais(linha.valorCentavos)} × ${reais(titulo.valorCentavos)}).`);
  if (doc?.nota && titulo.nota && doc.nota !== titulo.nota) avisos.push(`O boleto é da NF ${doc.nota}, o título é da NF ${titulo.nota}.`);
  const letra = doc?.parcela ? letraDaParcela(doc.parcela) : null;
  const letraTitulo = letraDoTitulo(titulo.documento);
  if (letra && letraTitulo && letraTitulo !== "U" && letra !== letraTitulo) avisos.push(`O boleto é da parcela ${doc!.parcela} (${letra}), o título é ${titulo.documento}.`);
  if (boleto?.pagadorDocumento && titulo.clienteDocumento && boleto.pagadorDocumento !== titulo.clienteDocumento) avisos.push("O CPF/CNPJ do pagador do boleto não é o do cliente do título.");
  if (boleto?.beneficiarioAkf && !titulo.cedido) avisos.push("Boleto da AKF, mas o título não está marcado como cedido.");
  // Cliente que não aceita pagar à AKF: no título cedido o boleto é o próprio da Neo (recebe e repassa à AKF no dia seguinte).
  if (boleto?.beneficiarioAkf && titulo.aceitaBoletoFactoring === false) avisos.push("Cliente NÃO aceita boleto de factoring: este boleto é da AKF; o boleto deve ser o próprio da Neo.");
  else if (boleto && linha && !boleto.beneficiarioAkf && titulo.cedido && titulo.aceitaBoletoFactoring !== false) avisos.push("Título cedido à AKF, mas o boleto não é da AKF.");
  if (titulo.temBoleto) avisos.push("O título já tem boleto: este passa a valer (o anterior fica guardado).");
  return avisos;
}
