// Fiscal > Créditos tributários: leitura PARCIAL do arquivo da EFD ICMS/IPI (SPED Fiscal), só para obter o saldo credor a
// transportar informado na escrituração e compará-lo com o saldo calculado (Apuração Mensal > saldo oficial).
// O que é lido (layout do Guia Prático da EFD ICMS/IPI; testado só com arquivo sintético — validar com um arquivo real):
//   0000: DT_INI (campo 4), DT_FIN (5), NOME (6), CNPJ (7), UF (9)
//   E110: VL_SLD_CREDOR_TRANSPORTAR (campo 14) — apuração do ICMS das operações próprias
//   E520: VL_SC_IPI (campo 7) — saldo credor do IPI a transportar
// NÃO interpreta notas, ajustes (E111/E220…), ICMS-ST (E200/E210), DIFAL nem qualquer outro bloco.

export type SaldosSped = {
  cnpj: string; nome: string; uf: string; inicio: string; fim: string; competencia: string;
  icmsSaldoCredorTransportar: number | null; // centavos
  ipiSaldoCredor: number | null; // centavos
  avisos: string[];
};

function dataSped(t: string | undefined): string | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(t ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function valorSped(t: string | undefined): number | null {
  if (t === undefined || t.trim() === "") return null;
  const m = /^(\d+)(?:,(\d{1,2}))?$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export type LeituraSped = { ok: true; saldos: SaldosSped } | { ok: false; erro: string };

export function lerSaldosEfdIcmsIpi(texto: string): LeituraSped {
  const linhas = texto.split(/\r?\n/);
  const reg = (codigo: string) => linhas.find((l) => l.startsWith(`|${codigo}|`))?.split("|");
  const r0000 = reg("0000");
  if (!r0000) return { ok: false, erro: "Não é um arquivo da EFD ICMS/IPI (registro 0000 não encontrado)." };
  const inicio = dataSped(r0000[4]), fim = dataSped(r0000[5]);
  const cnpj = (r0000[7] ?? "").replace(/\D/g, "");
  if (!inicio || !fim || cnpj.length !== 14) return { ok: false, erro: "Registro 0000 com período ou CNPJ inválido." };
  if (inicio.slice(0, 7) !== fim.slice(0, 7)) return { ok: false, erro: "O arquivo deve ser de um único mês." };
  const avisos: string[] = [];
  const e110 = reg("E110");
  const e520 = reg("E520");
  const icms = e110 ? valorSped(e110[14]) : null;
  const ipi = e520 ? valorSped(e520[7]) : null;
  if (!e110) avisos.push("Sem registro E110 (apuração do ICMS).");
  else if (icms === null) avisos.push("E110 sem saldo credor a transportar legível.");
  if (!e520) avisos.push("Sem registro E520 (apuração do IPI).");
  if (linhas.filter((l) => l.startsWith("|E110|")).length > 1) avisos.push("Mais de um E110: usado o primeiro.");
  return {
    ok: true,
    saldos: { cnpj, nome: r0000[6] ?? "", uf: r0000[9] ?? "", inicio, fim, competencia: `${inicio.slice(0, 7)}-01`, icmsSaldoCredorTransportar: icms, ipiSaldoCredor: ipi, avisos },
  };
}
