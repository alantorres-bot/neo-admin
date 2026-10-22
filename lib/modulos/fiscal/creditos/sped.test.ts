import { describe, expect, it } from "vitest";
import { lerSaldosEfdIcmsIpi } from "./sped";

// Arquivo sintético (FICTÍCIO), só com os registros lidos.
const ARQUIVO = [
  "|0000|017|0|01092026|30092026|INDUSTRIA MODELO (FICTICIA)|99999999000191||MT|000000000|5103403|||A|1|",
  "|E001|0|",
  "|E100|01092026|30092026|",
  "|E110|1000,00|0|0|0|1500,00|0|0|0|800,50|0|0|0|1300,50|0|",
  "|E520|200,00|300,00|450,00|0|0|350,00|0|",
  "|9999|6|",
].join("\r\n");

describe("leitura parcial da EFD ICMS/IPI", () => {
  it("lê período, CNPJ e saldos credores a transportar", () => {
    const r = lerSaldosEfdIcmsIpi(ARQUIVO);
    expect(r).toMatchObject({ ok: true, saldos: { cnpj: "99999999000191", competencia: "2026-09-01", icmsSaldoCredorTransportar: 130050, ipiSaldoCredor: 35000 } });
  });
  it("recusa o que não é EFD ICMS/IPI e avisa registros ausentes", () => {
    expect(lerSaldosEfdIcmsIpi("qualquer coisa").ok).toBe(false);
    const r = lerSaldosEfdIcmsIpi(ARQUIVO.split("\r\n").filter((l) => !l.startsWith("|E520|")).join("\n"));
    expect(r.ok && r.saldos.ipiSaldoCredor).toBeNull();
    expect(r.ok && r.saldos.avisos).toContain("Sem registro E520 (apuração do IPI).");
  });
});
