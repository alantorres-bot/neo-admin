// Fiscal > Créditos tributários: movimentos do mês a partir da EFD, num crédito por tributo (ICMS, IPI, PIS, Cofins).
// O razão reproduz a escrituração: créditos do mês entram como credito_apurado, o que foi abatido como utilizacao, e a diferença
// entre o saldo do sistema no fim do mês anterior e o saldo anterior declarado vira ajuste (para o contador conferir).
// Valores em centavos. Layouts dos Guias Práticos da EFD ICMS/IPI e da EFD-Contribuições:
//   EFD ICMS/IPI     0000: DT_INI (4) · E110: débitos (2..5), créditos (6..9), saldo credor anterior (10), a transportar (14)
//                    E520: saldo anterior (2), débitos (3, 5), créditos (4, 6), saldo credor a transportar (7)
//   EFD-Contribuições 0000: DT_INI (6) · M100/M500: crédito disponível do mês (12) · M200/M600: créditos descontados do mês (3)
//                    e de meses anteriores (4) · 1100/1500: mês de origem (2, MMAAAA), disponível (12), saldo final (18)

export type TributoEfd = "ICMS" | "IPI" | "PIS" | "COFINS";
export type TipoMovimentoEfd = "ajuste_positivo" | "ajuste_negativo" | "credito_apurado" | "utilizacao";
export type MovimentoEfd = { tipo: TipoMovimentoEfd; valor: number; descricao: string };
export type ApuracaoEfd = {
  tributo: TributoEfd; competencia: string; // AAAA-MM
  saldoSistemaAnterior: number; saldoAnteriorDeclarado: number; saldoFinalDeclarado: number; movimentos: MovimentoEfd[];
};

function centavos(t: string | undefined): number {
  const s = (t ?? "").trim();
  if (s === "") return 0;
  const m = /^(\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Valor inválido na EFD: "${s}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const registros = (texto: string, codigo: string) =>
  texto.split(/\r?\n/).filter((l) => l.startsWith(`|${codigo}|`)).map((l) => l.split("|"));

function competencia(texto: string, campoDtIni: number): string {
  const r0 = registros(texto, "0000")[0];
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(r0?.[campoDtIni] ?? "");
  if (!m) throw new Error("Arquivo sem registro 0000 válido.");
  return `${m[3]}-${m[2]}`;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mmaaaa = (comp: string) => `${comp.slice(5)}/${comp.slice(0, 4)}`;

function montar(tributo: TributoEfd, comp: string, saldoSistema: number, anterior: number, credito: number, usado: number,
  final: number, fonte: string): ApuracaoEfd {
  const movimentos: MovimentoEfd[] = [];
  const dif = anterior - saldoSistema;
  if (dif !== 0) movimentos.push({
    tipo: dif > 0 ? "ajuste_positivo" : "ajuste_negativo", valor: Math.abs(dif),
    descricao: `Saldo anterior declarado na ${fonte} ${mmaaaa(comp)} (${brl(anterior)}) difere do saldo do sistema no fim do mês anterior (${brl(saldoSistema)})`,
  });
  if (credito) movimentos.push({ tipo: "credito_apurado", valor: credito, descricao: `Créditos do período (${fonte} ${mmaaaa(comp)})` });
  if (usado) movimentos.push({ tipo: "utilizacao", valor: usado, descricao: `Dedução dos débitos do período (${fonte} ${mmaaaa(comp)})` });
  if (anterior + credito - usado !== final) {
    throw new Error(`${tributo} ${mmaaaa(comp)}: saldo anterior ${brl(anterior)} + créditos ${brl(credito)} − deduções ${brl(usado)} ≠ saldo final declarado ${brl(final)}. Confira a EFD.`);
  }
  return { tributo, competencia: comp, saldoSistemaAnterior: saldoSistema, saldoAnteriorDeclarado: anterior, saldoFinalDeclarado: final, movimentos };
}

/** ICMS (E110) ou IPI (E520) do mês, dado o saldo do crédito no sistema no fim do mês anterior (centavos). */
export function apurarIcmsIpi(texto: string, tributo: "ICMS" | "IPI", saldoSistema: number): ApuracaoEfd {
  const comp = competencia(texto, 4);
  const reg = registros(texto, tributo === "ICMS" ? "E110" : "E520")[0];
  if (!reg && tributo === "ICMS") throw new Error("EFD sem registro E110.");
  const v = (i: number) => (reg ? centavos(reg[i]) : 0);
  const [anterior, final, credito, debito] = tributo === "ICMS"
    ? [v(10), v(14), v(6) + v(7) + v(8) + v(9), v(2) + v(3) + v(4) + v(5)]
    : [v(2), v(7), v(4) + v(6), v(3) + v(5)];
  return montar(tributo, comp, saldoSistema, anterior, credito, Math.min(debito, anterior + credito), final, "EFD ICMS/IPI");
}

/** PIS (M100/M200/1100) ou Cofins (M500/M600/1500) do mês, somando as origens num só crédito. */
export function apurarContribuicoes(texto: string, tributo: "PIS" | "COFINS", saldoSistema: number): ApuracaoEfd {
  const comp = competencia(texto, 6);
  const [rCred, rApur, rCtrl] = tributo === "PIS" ? ["M100", "M200", "1100"] : ["M500", "M600", "1500"];
  const origemDoMes = `${comp.slice(5)}${comp.slice(0, 4)}`;
  const controle = registros(texto, rCtrl);
  const anterior = controle.filter((r) => r[2] !== origemDoMes).reduce((s, r) => s + centavos(r[12]), 0);
  const final = controle.reduce((s, r) => s + centavos(r[18]), 0);
  const credito = registros(texto, rCred).reduce((s, r) => s + centavos(r[12]), 0);
  const apur = registros(texto, rApur)[0];
  const usado = apur ? centavos(apur[3]) + centavos(apur[4]) : 0;
  return montar(tributo, comp, saldoSistema, anterior, credito, usado, final, "EFD-Contribuições");
}
