// Leitor da "Ficha Registro de Empregado" do escritório (PDF com texto; decisão de 27/11/2026, docs/modulos/rh-folha.md regra 1).
// O texto corrido do PDF embaralha rótulos e valores, então a leitura é por POSIÇÃO: cada caixa da ficha tem o rótulo em cima, à
// esquerda, e o valor uns 8 pt abaixo; o valor vai até o próximo rótulo da mesma linha. Calibrado nas fichas reais de 2024–2026
// (modelo único do escritório). Só lê; quem grava é o formulário de colaborador.
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { formatarCpf, somenteDigitos, validarCpf } from "@/lib/nucleo/documentos";
import { EMPREGADOR_POR_CNPJ } from "@/lib/modulos/rh/folha/relacao-liquidos";

export type FichaLida = {
  nome: string | null; cpf: string | null; cnpj: string | null; empregador: string | null; matriculaEscritorio: string | null;
  dataAdmissao: string | null; salario: number | null; funcao: string | null;
  dataNascimento: string | null; telefone: string | null; endereco: string | null; pis: string | null;
  rg: string | null; rgOrgao: string | null; rgEmissao: string | null; ctps: string | null; ctpsSerie: string | null; ctpsUf: string | null;
  nomePai: string | null; nomeMae: string | null;
};
export type ResultadoFicha = { ok: true; dados: FichaLida; avisos: string[] } | { ok: false; erro: string };

const MESMA_LINHA = 1.5;   // rótulos da mesma faixa da ficha variam até ~0,4 pt
const ALTURA_VALOR = 13;   // o valor fica 7–12 pt abaixo do rótulo (CNPJ, o mais baixo: +12)

const limpo = (t: string) => t.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();

/** Rótulo pelo texto exato (o primeiro de cima para baixo). */
function rotulo(itens: readonly ItemTexto[], texto: string): ItemTexto | undefined {
  return itens.filter((i) => i.texto.trim() === texto).sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

/**
 * Valor da caixa de um rótulo: itens logo abaixo dele, da coluna do rótulo até o próximo rótulo à direita na mesma linha (ou
 * `xMax`). `altura` maior para caixas de duas linhas (endereço). Linhas juntadas com espaço.
 */
function valorDe(itens: readonly ItemTexto[], texto: string, opcoes: { altura?: number; xMax?: number } = {}): string | null {
  const r = rotulo(itens, texto);
  if (!r) return null;
  const vizinho = itens.filter((i) => i !== r && Math.abs(i.y - r.y) <= MESMA_LINHA && i.x > r.x + 1).sort((a, b) => a.x - b.x)[0];
  const xMax = Math.min(opcoes.xMax ?? Infinity, vizinho?.x ?? Infinity);
  const altura = opcoes.altura ?? ALTURA_VALOR;
  const valor = itens
    .filter((i) => i.y > r.y + 3 && i.y <= r.y + altura && i.x >= r.x - 6 && i.x < xMax)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.texto)
    .join(" ");
  return limpo(valor) || null;
}

/** "17/11/2026" → "2026-11-17" (data inexistente → null). */
export function dataDaFicha(texto: string | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto ?? "");
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "R$ 2.145,87" → 2145.87. */
export function reaisDaFicha(texto: string | null): number | null {
  const m = /(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(texto ?? "");
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}

/**
 * Matrícula do escritório. Conferido com o cadastro em 27/11/2026 (40 fichas): é o "Nº" do canto direito (000222); quando a
 * "Matrícula eSocial" difere, o cadastro segue o Nº (6 casos), salvo Nº 000001, que é ficha reimpressa sozinha: aí vale a eSocial
 * (2 casos). Se os dois diferem, avisa para conferir.
 */
export function matriculaDaFicha(numeroFicha: string, esocial: string, avisos: string[]): string | null {
  const n = numeroFicha.replace(/^0+(?=\d)/, ""), e = esocial.replace(/^0+(?=\d)/, "");
  const valida = (x: string) => /^\d{1,9}$/.test(x) && x !== "0";
  const escolhida = n === "1" && valida(e) ? e : valida(n) ? n : valida(e) ? e : null;
  if (valida(n) && valida(e) && n !== e) avisos.push(`A ficha traz Nº ${n} e matrícula eSocial ${e}; usei ${escolhida}. Confira no extrato do escritório.`);
  return escolhida;
}

const so = (texto: string | null, padrao: RegExp) => (texto && padrao.test(texto) ? texto : null);

export function lerFichaRegistro(paginas: readonly PaginaTexto[]): ResultadoFicha {
  const itens = paginas[0]?.itens ?? [];
  if (!rotulo(itens, "REGISTRO DE EMPREGADO") || !rotulo(itens, "Matrícula eSocial")) {
    return { ok: false, erro: "O arquivo não parece a Ficha Registro de Empregado do escritório." };
  }
  const avisos: string[] = [];
  const v = (texto: string, opcoes?: { altura?: number; xMax?: number }) => valorDe(itens, texto, opcoes);

  const cpfDigitos = somenteDigitos(v("CPF") ?? "");
  const cpf = cpfDigitos && validarCpf(cpfDigitos) ? formatarCpf(cpfDigitos) : null;
  if (cpfDigitos && !cpf) avisos.push("O CPF da ficha não confere (dígitos verificadores); digite o correto.");

  const cnpj = somenteDigitos(v("CNPJ") ?? "").padStart(14, "0");
  const empregador = EMPREGADOR_POR_CNPJ[cnpj] ?? null;
  if (!empregador) avisos.push(`O CNPJ do empregador (${cnpj}) não é de uma empresa da folha; escolha a empregadora.`);

  const numero = matriculaDaFicha(somenteDigitos(v("Nº") ?? ""), somenteDigitos(v("Matrícula eSocial") ?? ""), avisos);

  const por = v("Por");
  if (por && !/^m[êe]s$/i.test(por)) avisos.push(`O salário da ficha é por "${por}", não por mês; confira.`);

  const pis = somenteDigitos(v("Sob nº") ?? "");
  const dados: FichaLida = {
    nome: v("Empregado"),
    cpf,
    cnpj: cnpj === "00000000000000" ? null : cnpj,
    empregador,
    matriculaEscritorio: numero,
    dataAdmissao: dataDaFicha(v("Data de Admissão")),
    salario: reaisDaFicha(v("Salário")),
    funcao: v("Cargo"),
    dataNascimento: dataDaFicha(v("Data de nascimento")),
    telefone: v("Telefone Residencial") ?? v("Telefone Celular"),
    endereco: v("Residência", { altura: 22, xMax: 290 }),   // até 2 linhas; à direita fica o quadro de beneficiários
    pis: pis.length === 11 ? pis : null,
    rg: so(v("Cédula de Identidade")?.replace(/\s/g, "") ?? null, /^[0-9A-Z.-]{3,20}$/i),
    rgOrgao: v("Órgão/UF emissor"),
    rgEmissao: dataDaFicha(v("Data de emissão")),
    ctps: so(somenteDigitos(v("CTPS") ?? "") || null, /^\d{1,11}$/),
    ctpsSerie: so(somenteDigitos(v("Série") ?? "") || null, /^\d{1,6}$/),
    ctpsUf: so(v("UF CTPS")?.toUpperCase() ?? null, /^[A-Z]{2}$/),
    nomePai: v("Pai"),
    nomeMae: v("Mãe"),
  };
  if (!dados.nome) avisos.push("A ficha não trouxe o nome.");
  if (!cpfDigitos) avisos.push("A ficha não trouxe o CPF.");
  if (!dados.dataAdmissao) avisos.push("A ficha não trouxe a data de admissão.");
  return { ok: true, dados, avisos };
}
