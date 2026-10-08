// Conferência da carteira da AKF com a planilha da própria AKF ("RECEBIVEIS - AKF.xlsx"): regras puras, sem banco e sem tela.
//
// A planilha é a verdade sobre o que está descontado na AKF. O cruzamento diz, para cada linha dela, se o título já está na AKF
// no app (cedido ou portador 998), se falta marcá-lo como cedido, se a AKF tem só uma PARTE do título (antecipação parcial) e se
// a parte do app está certa; e, no sentido contrário, o que o app tem na AKF e a planilha não tem. Nada é gravado aqui: quem
// aplica cada correção é uma pessoa, uma a uma, com as funções de banco do módulo (akf_marcar_cedido, akf_desdobrar_titulo...).
//
// O "Número" da planilha NÃO é o documento do app. Exemplos reais: `1266/5` = NF 1266, parcela 5 = `1001266E`; `002323` = NF 2323 da
// Filial Contagem = `4002323U`; `226/2026/2` = `Z00027B` (série Z: o número é outro); `7897/2026/03/02` = segunda parte da parcela
// 3 (C) de `Z00026C`. Por isso o casamento usa cliente (nome aproximado) + valor + vencimento, e o número só desempata.
import { normalizarTexto, PORTADOR_AKF } from "../../../../supabase/functions/_shared/akf";
import type { Matriz } from "../../../integracoes/importador/tabela";

// ---------------------------------------------------------------------------------------------------------------------------
// Tipos

export type LinhaAkf = {
  /** Linha na planilha (base 1), para o usuário achar. */
  linha: number;
  numero: string;
  vencimento: string; // aaaa-mm-dd
  valorCentavos: number;
  sacado: string;
  bordero: string | null;
  status: string;
  dtPagto: string | null;
  vlPagtoCentavos: number | null;
};

export type PlanilhaAkf = {
  linhas: LinhaAkf[];
  totalLidoCentavos: number;
  /** "TOTAL" e "Qtde títulos" escritos no rodapé da planilha, se existirem. */
  totalDeclaradoCentavos: number | null;
  qtdDeclarada: number | null;
  avisos: string[];
};

export type ParteApp = { id: string; valorCentavos: number; vencimento: string };

export type TituloApp = {
  id: string;
  documento: string;
  notaFiscal: string | null;
  vencimento: string;
  valorCentavos: number;
  cliente: string;
  unidade: string;
  cedido: boolean;
  codPortador: string | null;
  /** Partes antecipadas ativas (antecipação parcial). */
  partes: ParteApp[];
};

// ---------------------------------------------------------------------------------------------------------------------------
// Leitura da planilha

const dataIso = (texto: string): string | null => {
  const t = texto.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** "1.234,56", "1234,56", "1234.56" e "210000" viram centavos; vazio ou ilegível, null. */
export function centavosDeTexto(texto: string): number | null {
  let t = texto.replace(/[R$\s]/g, "");
  if (t === "" || !/^-?[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Lê a matriz da planilha da AKF. Acha o cabeçalho pelos nomes (sem depender de acento nem de ordem), lê até a linha em branco ou
 * "TOTAL" e confere a soma com o "TOTAL" escrito no rodapé.
 */
export function lerPlanilhaAkf(matriz: Matriz): { ok: true; planilha: PlanilhaAkf } | { ok: false; erro: string } {
  const norm = (c: string) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const cab = matriz.findIndex((l) => {
    const n = l.map(norm);
    return n.includes("numero") && n.includes("vencimento") && n.includes("valor") && n.includes("sacado");
  });
  if (cab < 0) return { ok: false, erro: "Não encontrei o cabeçalho da planilha da AKF (colunas Número, Vencimento, Valor e Sacado)." };
  const nomes = matriz[cab].map(norm);
  const col = (...opcoes: string[]) => nomes.findIndex((n) => opcoes.some((o) => n === o || n.startsWith(o)));
  const iNumero = col("numero");
  const iVenc = col("vencimento");
  const iValor = col("valor");
  const iSacado = col("sacado");
  const iBordero = nomes.findIndex((n) => n.includes("border"));
  const iStatus = col("status");
  const iDtPagto = col("dt pagto");
  const iVlPagto = col("vl pagto");

  const linhas: LinhaAkf[] = [];
  const avisos: string[] = [];
  let totalDeclarado: number | null = null;
  let qtdDeclarada: number | null = null;
  for (let i = cab + 1; i < matriz.length; i++) {
    const l = matriz[i];
    const numero = (l[iNumero] ?? "").trim();
    const rotulo = norm(numero);
    if (rotulo === "total") {
      totalDeclarado = centavosDeTexto(l[iValor] ?? "");
      continue;
    }
    if (rotulo.startsWith("qtde")) {
      const q = centavosDeTexto(l[iValor] ?? "");
      qtdDeclarada = q === null ? null : Math.round(q / 100);
      continue;
    }
    if (numero === "") continue; // linha em branco entre os títulos e o rodapé
    const vencimento = dataIso(l[iVenc] ?? "");
    const valor = centavosDeTexto(l[iValor] ?? "");
    if (!vencimento || valor === null || valor <= 0) {
      avisos.push(`Linha ${i + 1} (${numero}): vencimento ou valor ilegível; ignorada.`);
      continue;
    }
    linhas.push({
      linha: i + 1, numero, vencimento, valorCentavos: valor, sacado: (l[iSacado] ?? "").trim(),
      bordero: iBordero >= 0 ? (l[iBordero] ?? "").trim() || null : null,
      status: iStatus >= 0 ? (l[iStatus] ?? "").trim() : "",
      dtPagto: iDtPagto >= 0 ? dataIso(l[iDtPagto] ?? "") : null,
      vlPagtoCentavos: iVlPagto >= 0 ? centavosDeTexto(l[iVlPagto] ?? "") : null,
    });
  }
  if (linhas.length === 0) return { ok: false, erro: "A planilha não tem nenhum título." };
  const totalLido = linhas.reduce((s, l) => s + l.valorCentavos, 0);
  if (totalDeclarado !== null && totalDeclarado !== totalLido) {
    avisos.push(`A soma lida (${moeda(totalLido)}) é diferente do TOTAL escrito na planilha (${moeda(totalDeclarado)}). Confira o arquivo.`);
  }
  if (qtdDeclarada !== null && qtdDeclarada !== linhas.length) {
    avisos.push(`Li ${linhas.length} títulos, mas a planilha diz ${qtdDeclarada}. Confira o arquivo.`);
  }
  return { ok: true, planilha: { linhas, totalLidoCentavos: totalLido, totalDeclaradoCentavos: totalDeclarado, qtdDeclarada, avisos } };
}

const moeda = (centavos: number) => `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------------------------------------
// Nome do cliente e número do título

const PALAVRAS_SEM_PESO = new Set(["LTDA", "EPP", "ME", "SPE", "SA", "S", "A", "EIRELI", "DE", "DA", "DO", "DAS", "DOS", "E", "CIA", "COMPANHIA"]);

const distancia = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const atual = [i];
    for (let j = 1; j <= n; j++) atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    anterior = atual;
  }
  return anterior[n];
};

const palavras = (nome: string) =>
  normalizarTexto(nome).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((p) => p !== "" && !PALAVRAS_SEM_PESO.has(p));

/** Quanto do nome da planilha aparece no nome do app (0 a 1), tolerando erro de digitação e nome cortado. */
export function parecenca(nomePlanilha: string, nomeApp: string): number {
  const a = palavras(nomePlanilha);
  const b = palavras(nomeApp);
  if (a.length === 0 || b.length === 0) return 0;
  const acertos = a.filter((p) => b.some((q) => {
    if (p === q) return true;
    // nome cortado na planilha ("EMPREEN" por "EMPREENDIMENTOS")
    if (Math.min(p.length, q.length) >= 5 && (p.startsWith(q) || q.startsWith(p))) return true;
    const limite = Math.min(p.length, q.length) >= 10 ? 2 : Math.min(p.length, q.length) >= 6 ? 1 : 0;
    return limite > 0 && distancia(p, q) <= limite;
  })).length;
  return acertos / Math.min(a.length, b.length);
}

const LIMITE_NOME = 0.6;

/** A parcela citada no número da planilha: `1266/5` → 5 (E); `226/2026/2` → 2 (B); `7897/2026/03/02` → 3 (C); `1349` → única. */
export function parcelaDoNumero(numero: string): { nf: string | null; letra: string | null; unica: boolean } {
  const t = numero.trim();
  const partes = t.split("/").map((p) => p.trim());
  const inteiros = (p: string) => /^\d+$/.test(p);
  if (partes.length >= 3 && inteiros(partes[1]) && /^(19|20)\d\d$/.test(partes[1]) && inteiros(partes[2])) {
    const n = Number(partes[2]);
    return { nf: null, letra: n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : null, unica: false };
  }
  if (partes.length === 2 && inteiros(partes[0]) && inteiros(partes[1])) {
    const n = Number(partes[1]);
    return { nf: String(Number(partes[0])), letra: n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : null, unica: false };
  }
  if (partes.length === 1 && inteiros(partes[0])) return { nf: String(Number(partes[0])), letra: null, unica: true };
  return { nf: null, letra: null, unica: false };
}

/** O número da planilha combina com este título do app (NF e/ou letra da parcela)? 0 = sem pista; maior = mais certo. */
function pistaDoNumero(linha: LinhaAkf, t: TituloApp): number {
  const p = parcelaDoNumero(linha.numero);
  const sufixo = t.documento.slice(-1).toUpperCase();
  let pontos = 0;
  if (p.nf && t.notaFiscal && String(Number(t.notaFiscal)) === p.nf) pontos += 2;
  if (p.letra && sufixo === p.letra) pontos += 1;
  if (p.unica && sufixo === "U") pontos += 1;
  return pontos;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cruzamento

export type ItemCerto = { linha: LinhaAkf; titulo: TituloApp; diasDeDiferenca: number };
export type ItemMarcar = {
  linha: LinhaAkf;
  titulo: TituloApp;
  /** Partes ativas que precisam ser encerradas antes (a função de banco recusa marcar título com parte ativa). */
  encerrarPartesAntes: ParteApp[];
};
export type ParteALancar = { linha: LinhaAkf; valorCentavos: number; vencimento: string };
export type ItemParcial = {
  titulo: TituloApp;
  linhas: LinhaAkf[];
  /** Soma do que a AKF tem deste título segundo a planilha. */
  planilhaCentavos: number;
  /** Soma do que o app tem na AKF deste título (partes ativas; o título inteiro conta como o valor dele). */
  appCentavos: number;
  /** Já está certo (partes iguais em valor e vencimento). */
  certo: boolean;
  lancar: ParteALancar[];
  encerrar: ParteApp[];
  /** O título está marcado como cedido por inteiro no app: é preciso retirá-lo da AKF antes de lançar as partes. */
  retirarCedidoAntes: boolean;
};
export type ItemAConfirmar = { linha: LinhaAkf; titulo: TituloApp; motivo: string };

export type ResultadoConferencia = {
  resumo: {
    planilhaQtd: number;
    planilhaCentavos: number;
    appQtd: number;
    appCentavos: number;
    diferencaCentavos: number;
  };
  certos: ItemCerto[];
  marcar: ItemMarcar[];
  parciais: ItemParcial[];
  aConfirmar: ItemAConfirmar[];
  /** Cedido ou portador 998 no app, sem linha na planilha. */
  soNoApp: TituloApp[];
  /** Parte ativa no app de um título que a planilha não cita. */
  partesSoNoApp: { titulo: TituloApp; parte: ParteApp }[];
  semTitulo: LinhaAkf[];
};

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
/** A AKF "corrige" o vencimento (dia útil): até esta diferença o título inteiro casa sem pergunta. */
export const TOLERANCIA_DIAS = 5;
/** Além da tolerância, até este limite o casamento por cliente e valor ainda é proposto, mas "a confirmar". */
const LIMITE_A_CONFIRMAR = 20;

const naAkf = (t: Pick<TituloApp, "cedido" | "codPortador">) => t.cedido || t.codPortador === PORTADOR_AKF;
const valorNaAkf = (t: TituloApp): number => (naAkf(t) ? t.valorCentavos : t.partes.reduce((s, p) => s + p.valorCentavos, 0));

/** Cruza as linhas da planilha com a carteira em aberto do app. Puro: devolve o que está certo e o que falta corrigir. */
export function cruzarComCarteira(linhas: readonly LinhaAkf[], titulos: readonly TituloApp[]): ResultadoConferencia {
  const usados = new Set<string>(); // títulos inteiros já casados
  const casadas = new Set<number>(); // linhas já resolvidas
  const certos: ItemCerto[] = [];
  const marcar: ItemMarcar[] = [];
  const aConfirmar: ItemAConfirmar[] = [];

  // 1) Título inteiro: mesmo cliente e mesmo valor; escolhe o par de menor diferença de vencimento, depois o de mais pistas no número.
  type Par = { linha: LinhaAkf; titulo: TituloApp; dias: number; pista: number };
  const pares: Par[] = [];
  for (const l of linhas) {
    for (const t of titulos) {
      if (t.valorCentavos !== l.valorCentavos || parecenca(l.sacado, t.cliente) < LIMITE_NOME) continue;
      const dias = Math.abs(diasEntre(l.vencimento, t.vencimento));
      if (dias > LIMITE_A_CONFIRMAR) continue;
      pares.push({ linha: l, titulo: t, dias, pista: pistaDoNumero(l, t) });
    }
  }
  pares.sort((a, b) => b.pista - a.pista || a.dias - b.dias || a.linha.linha - b.linha.linha);
  for (const p of pares) {
    if (usados.has(p.titulo.id) || casadas.has(p.linha.linha)) continue;
    usados.add(p.titulo.id);
    casadas.add(p.linha.linha);
    if (naAkf(p.titulo)) {
      // Já está na AKF no app: a diferença de vencimento (a AKF corrige a data) não muda a classificação, só aparece como informação.
      certos.push({ linha: p.linha, titulo: p.titulo, diasDeDiferenca: diasEntre(p.linha.vencimento, p.titulo.vencimento) });
    } else if (p.dias > TOLERANCIA_DIAS) {
      // Fora da AKF no app e com data muito diferente: pode não ser o mesmo título; quem decide é a pessoa.
      aConfirmar.push({ linha: p.linha, titulo: p.titulo, motivo: `vencimento ${p.dias} dias diferente (${dataBr(p.linha.vencimento)} na planilha, ${dataBr(p.titulo.vencimento)} no app)` });
    } else {
      marcar.push({ linha: p.linha, titulo: p.titulo, encerrarPartesAntes: p.titulo.partes });
    }
  }

  // 2) Antecipação parcial: o que sobrou da planilha, de títulos do mesmo cliente com valor MAIOR. Várias linhas podem ser o mesmo título.
  const restantes = linhas.filter((l) => !casadas.has(l.linha));
  const porTitulo = new Map<string, LinhaAkf[]>();
  const semTitulo: LinhaAkf[] = [];
  for (const l of restantes) {
    const candidatos = titulos
      .filter((t) => !usados.has(t.id) && t.valorCentavos > l.valorCentavos && parecenca(l.sacado, t.cliente) >= LIMITE_NOME)
      .map((t) => ({ t, pista: pistaDoNumero(l, t), dias: Math.abs(diasEntre(l.vencimento, t.vencimento)), jaParcial: t.partes.length > 0 }));
    if (candidatos.length === 0) {
      semTitulo.push(l);
      continue;
    }
    // Pista do número primeiro; depois quem já tem parte (a continuação do que já foi lançado); depois o vencimento mais perto.
    candidatos.sort((a, b) => b.pista - a.pista || Number(b.jaParcial) - Number(a.jaParcial) || a.dias - b.dias);
    const melhor = candidatos[0];
    if (melhor.pista === 0 && !melhor.jaParcial && candidatos.length > 1 && candidatos[1].pista === 0 && !candidatos[1].jaParcial && candidatos[1].dias === melhor.dias) {
      aConfirmar.push({ linha: l, titulo: melhor.t, motivo: "mais de um título do cliente poderia ser o desta linha" });
      continue;
    }
    porTitulo.set(melhor.t.id, [...(porTitulo.get(melhor.t.id) ?? []), l]);
  }

  const parciais: ItemParcial[] = [];
  const titulosPorId = new Map(titulos.map((t) => [t.id, t]));
  for (const [id, ls] of porTitulo) {
    const t = titulosPorId.get(id)!;
    const soma = ls.reduce((s, l) => s + l.valorCentavos, 0);
    if (soma >= t.valorCentavos) {
      // As linhas somam o título inteiro ou mais: não é parcial, é para conferir.
      for (const l of ls) aConfirmar.push({ linha: l, titulo: t, motivo: `as linhas deste cliente somam ${moeda(soma)}, que não é menor que o título (${moeda(t.valorCentavos)})` });
      continue;
    }
    usados.add(t.id);
    for (const l of ls) casadas.add(l.linha);
    const partesApp = t.partes;
    const lancar: ParteALancar[] = [];
    const sobraApp = [...partesApp];
    for (const l of ls) {
      const i = sobraApp.findIndex((p) => p.valorCentavos === l.valorCentavos && Math.abs(diasEntre(p.vencimento, l.vencimento)) <= TOLERANCIA_DIAS);
      if (i >= 0) sobraApp.splice(i, 1);
      else lancar.push({ linha: l, valorCentavos: l.valorCentavos, vencimento: l.vencimento });
    }
    const certo = lancar.length === 0 && sobraApp.length === 0 && !t.cedido;
    parciais.push({
      titulo: t, linhas: ls, planilhaCentavos: soma, appCentavos: valorNaAkf(t), certo, lancar, encerrar: sobraApp, retirarCedidoAntes: t.cedido,
    });
  }
  parciais.sort((a, b) => a.titulo.vencimento.localeCompare(b.titulo.vencimento) || a.titulo.documento.localeCompare(b.titulo.documento));

  // 3) O que o app tem na AKF e a planilha não cita.
  const parcialIds = new Set(porTitulo.keys());
  const aConfirmarIds = new Set(aConfirmar.map((x) => x.titulo.id));
  const soNoApp = titulos.filter((t) => naAkf(t) && !usados.has(t.id) && !aConfirmarIds.has(t.id));
  const partesSoNoApp = titulos
    .filter((t) => !naAkf(t) && t.partes.length > 0 && !parcialIds.has(t.id) && !aConfirmarIds.has(t.id))
    .flatMap((t) => t.partes.map((parte) => ({ titulo: t, parte })));

  const planilhaCentavos = linhas.reduce((s, l) => s + l.valorCentavos, 0);
  const appCentavos = titulos.reduce((s, t) => s + valorNaAkf(t), 0);
  const appQtd = titulos.filter((t) => naAkf(t) || t.partes.length > 0).length;
  return {
    resumo: { planilhaQtd: linhas.length, planilhaCentavos, appQtd, appCentavos, diferencaCentavos: planilhaCentavos - appCentavos },
    certos,
    marcar,
    parciais,
    aConfirmar,
    soNoApp,
    partesSoNoApp,
    semTitulo,
  };
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Explica a diferença de totais em parcelas: quanto falta marcar, lançar de parte e retirar, mais o que a planilha tem sem título no
 * app. Soma das categorias = diferença do resumo (a menos de títulos "a confirmar", que ficam de fora até alguém decidir).
 */
export function explicarDiferenca(r: ResultadoConferencia): {
  faltaMarcarCentavos: number; faltaParcialCentavos: number; semTituloCentavos: number; soNoAppCentavos: number; aConfirmarCentavos: number;
} {
  const faltaMarcarCentavos = r.marcar.reduce((s, m) => s + m.titulo.valorCentavos - m.encerrarPartesAntes.reduce((x, p) => x + p.valorCentavos, 0), 0);
  const faltaParcialCentavos = r.parciais.reduce((s, p) => s + p.planilhaCentavos - p.appCentavos, 0);
  const semTituloCentavos = r.semTitulo.reduce((s, l) => s + l.valorCentavos, 0);
  const soNoAppCentavos = -(r.soNoApp.reduce((s, t) => s + t.valorCentavos, 0) + r.partesSoNoApp.reduce((s, p) => s + p.parte.valorCentavos, 0));
  // "A confirmar": o que a planilha tem nessas linhas menos o que o app tem dos títulos citados (cada título uma vez).
  const titulosAConfirmar = new Map(r.aConfirmar.map((c) => [c.titulo.id, c.titulo]));
  const aConfirmarCentavos = r.aConfirmar.reduce((s, c) => s + c.linha.valorCentavos, 0) - [...titulosAConfirmar.values()].reduce((s, t) => s + valorNaAkf(t), 0);
  return { faltaMarcarCentavos, faltaParcialCentavos, semTituloCentavos, soNoAppCentavos, aConfirmarCentavos };
}
