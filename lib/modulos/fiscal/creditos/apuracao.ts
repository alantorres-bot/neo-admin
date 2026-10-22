// Fiscal > Créditos tributários: regra da apuração (espelho em TS da função fis_apuracao, migration 0200).
// Usada para conferir o banco nos testes, montar a prévia da importação e agregar as linhas devolvidas pelo banco.
// Saldo final = saldo inicial + gerado + reconhecido + ajustes(+) − ajustes(−) − utilizado − compensado − baixado
//               + transferências recebidas − transferências enviadas.
// O saldo inicial do mês = saldo final do mês anterior do MESMO crédito + implantação (saldo inicial) lançada no mês.
// Estorno entra na coluna do lançamento original, com sinal invertido (sem dupla contagem).
import { somarMeses } from "./formatos";

export type Classe = "saldo_inicial" | "gerado" | "reconhecido" | "ajuste" | "utilizacao" | "compensacao" | "baixa" | "transferencia";

export type MovimentoApuracao = {
  competencia: string; // 'AAAA-MM-01'
  classe: Classe;
  natureza: "entrada" | "saida";
  /** efeito no saldo, em centavos (estorno de uma saída é positivo) */
  valorAssinado: number;
  status: "pendente" | "efetivo" | "rejeitado";
};

export type LinhaApuracao = {
  competencia: string;
  /** parte do saldo inicial que é implantação (saldo trazido de fora do sistema) lançada neste mês */
  saldoInicial: number; implantado: number; gerado: number; reconhecido: number; ajustesPositivos: number; ajustesNegativos: number;
  utilizado: number; compensado: number; baixado: number; transferidoEntrada: number; transferidoSaida: number;
  saldoFinal: number; pendentes: number;
};

const vazia = (competencia: string): LinhaApuracao => ({
  competencia, saldoInicial: 0, implantado: 0, gerado: 0, reconhecido: 0, ajustesPositivos: 0, ajustesNegativos: 0, utilizado: 0, compensado: 0, baixado: 0,
  transferidoEntrada: 0, transferidoSaida: 0, saldoFinal: 0, pendentes: 0,
});

/** Apuração de UM crédito, mês a mês, de `inicio` a `fim` (inclusive), a partir da primeira competência com movimento. */
export function apurarCredito(movimentos: readonly MovimentoApuracao[], inicio: string, fim: string, origem?: string): LinhaApuracao[] {
  const primeira = [origem, ...movimentos.map((m) => m.competencia)].filter((x): x is string => !!x).sort()[0];
  if (!primeira) return [];
  let saldo = movimentos.filter((m) => m.status === "efetivo" && m.competencia < inicio).reduce((s, m) => s + m.valorAssinado, 0);
  const linhas: LinhaApuracao[] = [];
  for (let c = inicio; c <= fim; c = somarMeses(c, 1)) {
    if (c < primeira) continue;
    const l = vazia(c);
    const doMes = movimentos.filter((m) => m.competencia === c);
    let total = 0, implantacao = 0;
    for (const m of doMes) {
      if (m.status === "pendente") { l.pendentes++; continue; }
      if (m.status !== "efetivo") continue;
      total += m.valorAssinado;
      const v = m.valorAssinado;
      switch (m.classe) {
        case "saldo_inicial": implantacao += v; break;
        case "gerado": l.gerado += v; break;
        case "reconhecido": l.reconhecido += v; break;
        case "ajuste": if (m.natureza === "entrada") l.ajustesPositivos += v; else l.ajustesNegativos -= v; break;
        case "utilizacao": l.utilizado -= v; break;
        case "compensacao": l.compensado -= v; break;
        case "baixa": l.baixado -= v; break;
        case "transferencia": if (m.natureza === "entrada") l.transferidoEntrada += v; else l.transferidoSaida -= v; break;
      }
    }
    l.saldoInicial = saldo + implantacao;
    l.implantado = implantacao;
    saldo += total;
    l.saldoFinal = saldo;
    linhas.push(l);
  }
  return linhas;
}

/** Confere a identidade da apuração (útil em testes e na tela, para apontar linha inconsistente). */
export function fechaConta(l: LinhaApuracao): boolean {
  return l.saldoInicial + l.gerado + l.reconhecido + l.ajustesPositivos - l.ajustesNegativos - l.utilizado - l.compensado - l.baixado
    + l.transferidoEntrada - l.transferidoSaida === l.saldoFinal;
}

/** Linha do banco (fis_apuracao) com valores numeric -> centavos. */
export type LinhaBanco = {
  credito_id: string; empresa_id: string; estabelecimento_id: string; tributo_id: string; competencia: string;
  saldo_inicial: string | number; implantado: string | number; gerado: string | number; reconhecido: string | number; ajustes_positivos: string | number;
  ajustes_negativos: string | number; utilizado: string | number; compensado: string | number; baixado: string | number;
  transferido_entrada: string | number; transferido_saida: string | number; saldo_final: string | number; pendentes: number;
};

export type LinhaChave = LinhaApuracao & { chave: string; estabelecimentoId: string; tributoId: string; creditos: string[] };

const CAMPOS: [keyof LinhaApuracao, keyof LinhaBanco][] = [
  ["saldoInicial", "saldo_inicial"], ["implantado", "implantado"], ["gerado", "gerado"], ["reconhecido", "reconhecido"], ["ajustesPositivos", "ajustes_positivos"],
  ["ajustesNegativos", "ajustes_negativos"], ["utilizado", "utilizado"], ["compensado", "compensado"], ["baixado", "baixado"],
  ["transferidoEntrada", "transferido_entrada"], ["transferidoSaida", "transferido_saida"], ["saldoFinal", "saldo_final"],
];

function paraCentavos(v: string | number): number {
  const t = typeof v === "number" ? v.toFixed(2) : v;
  const neg = t.startsWith("-");
  const [i, f = "0"] = t.replace("-", "").split(".");
  const c = Number(i) * 100 + Number(f.padEnd(2, "0").slice(0, 2));
  return neg ? -c : c;
}

export function linhaDoBanco(l: LinhaBanco): LinhaApuracao {
  const r = vazia(l.competencia.slice(0, 10));
  for (const [a, b] of CAMPOS) (r[a] as number) = paraCentavos(l[b] as string | number);
  r.pendentes = Number(l.pendentes ?? 0);
  return r;
}

/** Agrega as linhas por estabelecimento + tributo + competência (visão "Apuração Mensal"). */
export function agregarPorChave(linhas: readonly LinhaBanco[]): LinhaChave[] {
  const mapa = new Map<string, LinhaChave>();
  for (const b of linhas) {
    const l = linhaDoBanco(b);
    const chave = `${b.estabelecimento_id}|${b.tributo_id}|${l.competencia}`;
    const atual = mapa.get(chave) ?? { ...vazia(l.competencia), chave, estabelecimentoId: b.estabelecimento_id, tributoId: b.tributo_id, creditos: [] };
    for (const [a] of CAMPOS) (atual[a] as number) += l[a] as number;
    atual.pendentes += l.pendentes;
    atual.creditos.push(b.credito_id);
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((x, y) => x.chave.localeCompare(y.chave));
}

/** Soma uma lista de linhas (consolidado do ano por tributo, por exemplo). */
export function somarLinhas(linhas: readonly LinhaApuracao[], competencia = ""): LinhaApuracao {
  const r = vazia(competencia);
  for (const l of linhas) {
    for (const [a] of CAMPOS) (r[a] as number) += l[a] as number;
    r.pendentes += l.pendentes;
  }
  return r;
}

export type Consolidado = LinhaApuracao & { meses: number; implantadoNoAno: number };

/**
 * Consolidado do exercício a partir das linhas MENSAIS já somadas de um conjunto (ex.: um tributo): saldo inicial = o do
 * primeiro mês (inclui a implantação feita nele); implantações dos meses seguintes saem à parte; saldo final = o do último mês.
 * Identidade: final = inicial + implantado no ano + gerado + reconhecido + ajustes(+) − ajustes(−) − utilizado − compensado
 * − baixado + recebido − enviado.
 */
export function consolidarExercicio(meses: readonly LinhaApuracao[]): Consolidado {
  const ordenados = [...meses].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const soma = somarLinhas(ordenados);
  const primeiro = ordenados[0];
  return {
    ...soma,
    competencia: primeiro?.competencia ?? "",
    saldoInicial: primeiro?.saldoInicial ?? 0,
    implantadoNoAno: soma.implantado - (primeiro?.implantado ?? 0),
    saldoFinal: ordenados.at(-1)?.saldoFinal ?? 0,
    meses: ordenados.length,
  };
}

export function consolidadoFechaConta(c: Consolidado): boolean {
  return c.saldoInicial + c.implantadoNoAno + c.gerado + c.reconhecido + c.ajustesPositivos - c.ajustesNegativos - c.utilizado - c.compensado - c.baixado
    + c.transferidoEntrada - c.transferidoSaida === c.saldoFinal;
}
