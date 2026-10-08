import { describe, expect, it } from "vitest";
import {
  centavosDeTexto, cruzarComCarteira, explicarDiferenca, lerPlanilhaAkf, parcelaDoNumero, parecenca, type LinhaAkf, type TituloApp,
} from "./conciliacao";

let seq = 0;
const titulo = (documento: string, nf: string | null, vencimento: string, valor: number, cliente: string, extra: Partial<TituloApp> = {}): TituloApp => ({
  id: `t${++seq}`, documento, notaFiscal: nf, vencimento, valorCentavos: Math.round(valor * 100), cliente, unidade: "matriz", cedido: false, codPortador: "91", partes: [], ...extra,
});
const naAkf = (documento: string, nf: string | null, vencimento: string, valor: number, cliente: string, extra: Partial<TituloApp> = {}) =>
  titulo(documento, nf, vencimento, valor, cliente, { cedido: true, codPortador: "998", ...extra });
const linha = (numero: string, vencimento: string, valor: number, sacado: string, extra: Partial<LinhaAkf> = {}): LinhaAkf => ({
  linha: ++seq, numero, vencimento, valorCentavos: Math.round(valor * 100), sacado, bordero: "7000", status: "Aberto", dtPagto: null, vlPagtoCentavos: null, ...extra,
});

describe("centavosDeTexto", () => {
  it("lê os formatos que o Excel e o Brasil produzem", () => {
    expect(centavosDeTexto("210000")).toBe(21_000_000);
    expect(centavosDeTexto("179357.82")).toBe(17_935_782);
    expect(centavosDeTexto("1.234,56")).toBe(123_456);
    expect(centavosDeTexto("R$ 1.234.567,89")).toBe(123_456_789);
    expect(centavosDeTexto("1.234")).toBe(123_400); // milhar
    expect(centavosDeTexto("")).toBeNull();
    expect(centavosDeTexto("abc")).toBeNull();
  });
});

describe("parcelaDoNumero e parecenca", () => {
  it("decodifica os números reais da planilha", () => {
    expect(parcelaDoNumero("1266/5")).toEqual({ nf: "1266", letra: "E", unica: false });
    expect(parcelaDoNumero("002323")).toEqual({ nf: "2323", letra: null, unica: true });
    expect(parcelaDoNumero("1349")).toEqual({ nf: "1349", letra: null, unica: true });
    expect(parcelaDoNumero("226/2026/2")).toEqual({ nf: null, letra: "B", unica: false });
    expect(parcelaDoNumero("7897/2026/03")).toEqual({ nf: null, letra: "C", unica: false });
    expect(parcelaDoNumero("7897/2026/03/02")).toEqual({ nf: null, letra: "C", unica: false });
    expect(parcelaDoNumero("205/2026/5")).toEqual({ nf: null, letra: "E", unica: false });
    expect(parcelaDoNumero("R4182- 1/ 1")).toEqual({ nf: null, letra: null, unica: false });
  });

  it("tolera erro de digitação e nome cortado, mas não confunde clientes", () => {
    expect(parecenca("HERMES RESIDENCCE EMPREEN", "HERMES RESIDENCE EMPREENDIMENTOS IMOBILIARIOS LTDA")).toBeGreaterThanOrEqual(0.6);
    expect(parecenca("VITALE V21 EMPRRENDIMENTO", "VITALE V21 EMPREENDIMENTOS IMOBILIARIOS LTDA")).toBeGreaterThanOrEqual(0.6);
    expect(parecenca("CANOPUS CONSTRUÇOES FORTA", "CANOPUS CONSTRUCOES FORTALEZA LTDA")).toBeGreaterThanOrEqual(0.6);
    expect(parecenca("J SETE CONSTRUTORA LTDA", "AMORIM COUTINHO ENGENHARIA E CONSTRUCOES LTDA")).toBeLessThan(0.6);
  });
});

describe("lerPlanilhaAkf", () => {
  const cab = ["Nome do Cedente", "Tipo Recebível", "Carteira", "CNPJ Cedente", "Número", "Vencimento", "Valor", "Sacado", "Nº Borderô", "Status", "Dt Pagto", "Vl Pagto", "Emissão NF-e", "Modo Cobrança"];
  const l = (numero: string, venc: string, valor: string, sacado: string, status = "Aberto") => ["NEO", "Duplicata", "C. Própria", "17", numero, venc, valor, sacado, "7001", status, "", "", "01/09/2026", "Banco"];
  const rodape = (total: string, qtd: string) => [["", "", "", "", "", "", "", "", "", "", "", "", "", ""], ["", "", "", "", "TOTAL", "", total, "", "", "", "", "", "", ""], ["", "", "", "", "Qtde títulos", "", qtd, "", "", "", "", "", "", ""]];

  it("lê as linhas, ignora o rodapé e confere o total", () => {
    const r = lerPlanilhaAkf([cab, l("1349", "06/10/2026", "400000", "TC CONSTRUTORA"), l("002323", "05/10/2026", "700.5", "GBLX"), ...rodape("400700.5", "2")]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.planilha.linhas).toHaveLength(2);
    expect(r.planilha.linhas[0]).toMatchObject({ linha: 2, numero: "1349", vencimento: "2026-10-06", valorCentavos: 40_000_000, sacado: "TC CONSTRUTORA", bordero: "7001", status: "Aberto" });
    expect(r.planilha.linhas[1].valorCentavos).toBe(70_050);
    expect(r.planilha.totalDeclaradoCentavos).toBe(40_070_050);
    expect(r.planilha.qtdDeclarada).toBe(2);
    expect(r.planilha.avisos).toEqual([]);
  });

  it("avisa quando a soma ou a quantidade não bate com o rodapé", () => {
    const r = lerPlanilhaAkf([cab, l("1", "06/10/2026", "100", "A"), ...rodape("999", "3")]);
    expect(r.ok && r.planilha.avisos.length).toBe(2);
  });

  it("ignora linha ilegível com aviso e recusa planilha sem cabeçalho ou sem títulos", () => {
    const r = lerPlanilhaAkf([cab, l("1", "data ruim", "100", "A"), l("2", "06/10/2026", "100", "B")]);
    expect(r.ok && r.planilha.linhas.length).toBe(1);
    expect(r.ok && r.planilha.avisos[0]).toMatch(/Linha 2/);
    expect(lerPlanilhaAkf([["a", "b"], ["1", "2"]])).toMatchObject({ ok: false });
    expect(lerPlanilhaAkf([cab])).toMatchObject({ ok: false, erro: "A planilha não tem nenhum título." });
  });

  it("reconhece o cabeçalho sem acento e fora de ordem", () => {
    const m = [["VALOR", "SACADO", "NUMERO", "VENCIMENTO"], ["1.000,00", "X", "55", "01/12/2026"]];
    const r = lerPlanilhaAkf(m);
    expect(r.ok && r.planilha.linhas[0]).toMatchObject({ numero: "55", valorCentavos: 100_000, vencimento: "2026-12-01" });
  });
});

describe("cruzarComCarteira (casos reais da AKF de 08/10/2026)", () => {
  // Clientes e títulos como no banco de produção; os valores e as datas são os mesmos dos casos que motivaram a conferência.
  const JSETE = "J SETE CONSTRUTORA LTDA";
  const AMORIM = "AMORIM COUTINHO ENGENHARIA E CONSTRUCOES LTDA";
  const TC = "TC CONSTRUTORA E INCORPORADORA LTDA";

  it("título inteiro que a AKF tem e o app não marcou: 'falta marcar'", () => {
    const b = titulo("Z00027B", null, "2026-10-08", 67000, JSETE);
    const c = titulo("Z00027C", null, "2026-11-08", 67000, JSETE);
    const d = naAkf("Z00027D", null, "2026-12-08", 134000, JSETE);
    const r = cruzarComCarteira([
      linha("226/2026/2", "2026-10-08", 67000, JSETE), linha("226/2026/3", "2026-11-08", 67000, JSETE), linha("226/2026/4", "2026-12-08", 134000, JSETE),
    ], [b, c, d, titulo("Z00027E", null, "2027-01-08", 134000, JSETE)]);
    expect(r.marcar.map((m) => m.titulo.documento).sort()).toEqual(["Z00027B", "Z00027C"]);
    expect(r.certos.map((x) => x.titulo.documento)).toEqual(["Z00027D"]);
    expect(r.soNoApp).toEqual([]);
    expect(explicarDiferenca(r).faltaMarcarCentavos).toBe(13_400_000);
    expect(r.resumo.diferencaCentavos).toBe(13_400_000);
  });

  it("antecipação parcial que falta: a planilha tem parte de um título que o app tem inteiro e livre", () => {
    const t = titulo("1001349U", "1349", "2026-09-17", 695223.9, TC);
    const r = cruzarComCarteira([linha("1349", "2026-10-06", 400000, TC)], [t]);
    expect(r.parciais).toHaveLength(1);
    expect(r.parciais[0]).toMatchObject({ planilhaCentavos: 40_000_000, appCentavos: 0, certo: false, retirarCedidoAntes: false, encerrar: [] });
    expect(r.parciais[0].lancar).toEqual([expect.objectContaining({ valorCentavos: 40_000_000, vencimento: "2026-10-06" })]);
    expect(r.marcar).toEqual([]);
    expect(r.semTitulo).toEqual([]);
  });

  it("parte do app diferente da planilha: encerra a antiga e lança as novas (cada parcela pela letra do número)", () => {
    const c = titulo("Z00026C", null, "2026-09-29", 1_970_000, AMORIM, { partes: [{ id: "p1", valorCentavos: 50_000_000, vencimento: "2026-09-29" }] });
    const dd = titulo("Z00026D", null, "2026-10-29", 1_494_000, AMORIM);
    const a = titulo("Z00026A", null, "2026-07-29", 3_330_000, AMORIM, { codPortador: "237" });
    const r = cruzarComCarteira([
      linha("7897/2026/03", "2026-10-09", 200000, AMORIM), linha("7897/2026/03/02", "2026-10-09", 350000, AMORIM), linha("7897/2026/4", "2026-10-29", 400000, AMORIM),
    ], [a, c, dd]);
    const pc = r.parciais.find((p) => p.titulo.documento === "Z00026C")!;
    expect(pc.lancar.map((x) => x.valorCentavos)).toEqual([20_000_000, 35_000_000]);
    expect(pc.encerrar.map((x) => x.id)).toEqual(["p1"]);
    expect(pc.planilhaCentavos).toBe(55_000_000);
    expect(pc.appCentavos).toBe(50_000_000);
    const pd = r.parciais.find((p) => p.titulo.documento === "Z00026D")!;
    expect(pd.lancar).toHaveLength(1);
    expect(pd.encerrar).toEqual([]);
    expect(r.parciais.find((p) => p.titulo.documento === "Z00026A")).toBeUndefined();
  });

  it("parte que já está certa (valor e vencimento) não gera ação", () => {
    const t = titulo("Z00026D", null, "2026-10-29", 1_494_000, AMORIM, { partes: [{ id: "p9", valorCentavos: 40_000_000, vencimento: "2026-10-28" }] });
    const r = cruzarComCarteira([linha("7897/2026/4", "2026-10-29", 400000, AMORIM)], [t]);
    expect(r.parciais[0]).toMatchObject({ certo: true, lancar: [], encerrar: [] });
  });

  it("vencimento corrigido pela AKF (dias de diferença) não atrapalha quando o título já está na AKF", () => {
    const t = naAkf("1001360U", "1360", "2026-10-14", 200000, "CANOPUS CONSTRUCOES TERESINA LTDA");
    const r = cruzarComCarteira([linha("1360", "2026-10-20", 200000, "CANOPUS CONSTRUÇOES TERESI")], [t]);
    expect(r.certos).toHaveLength(1);
    expect(r.certos[0].diasDeDiferenca).toBe(6);
    expect(r.aConfirmar).toEqual([]);
  });

  it("título fora da AKF com vencimento muito diferente fica 'a confirmar' (não vira ação automática)", () => {
    const t = titulo("1001400U", "1400", "2026-10-01", 50000, "CLIENTE ALFA LTDA");
    const r = cruzarComCarteira([linha("1400", "2026-10-12", 50000, "CLIENTE ALFA LTDA")], [t]);
    expect(r.marcar).toEqual([]);
    expect(r.aConfirmar).toHaveLength(1);
    expect(r.aConfirmar[0].motivo).toMatch(/11 dias diferente/);
  });

  it("erro de digitação no nome do cliente não impede o casamento", () => {
    const t = naAkf("4002314U", "2314", "2026-10-14", 3030.52, "HERMES RESIDENCE EMPREENDIMENTOS IMOBILIARIOS LTDA");
    const r = cruzarComCarteira([linha("002314", "2026-10-14", 3030.52, "HERMES RESIDENCCE EMPREEN")], [t]);
    expect(r.certos).toHaveLength(1);
  });

  it("linha da planilha sem título no app e título do app (cedido/998) sem linha", () => {
    const so = naAkf("4002325U", "2325", "2026-10-16", 19744.5, "SPE 7 COPAM EMPREENDIMENTOS");
    const r = cruzarComCarteira([linha("R4182- 1/ 1", "2026-10-02", 287.57, "CONSTRUTORA IRMAOS LORENZ")], [so]);
    expect(r.semTitulo.map((l) => l.numero)).toEqual(["R4182- 1/ 1"]);
    expect(r.soNoApp.map((t) => t.documento)).toEqual(["4002325U"]);
    const e = explicarDiferenca(r);
    expect(e.semTituloCentavos).toBe(28_757);
    expect(e.soNoAppCentavos).toBe(-1_974_450);
    expect(r.resumo.diferencaCentavos).toBe(e.semTituloCentavos + e.soNoAppCentavos);
  });

  it("parte ativa no app de um título que a planilha não cita aparece à parte", () => {
    const t = titulo("Z00099A", null, "2026-12-01", 100000, "CLIENTE BETA LTDA", { partes: [{ id: "px", valorCentavos: 3_000_000, vencimento: "2026-12-01" }] });
    const r = cruzarComCarteira([], [t]);
    expect(r.partesSoNoApp).toHaveLength(1);
    expect(r.resumo.appCentavos).toBe(3_000_000);
    expect(explicarDiferenca(r).soNoAppCentavos).toBe(-3_000_000);
  });

  it("título cedido por inteiro no app, mas a AKF tem só parte: retira o cedido antes de lançar a parte", () => {
    const t = naAkf("1001500U", "1500", "2026-11-01", 100000, "CLIENTE GAMA LTDA");
    const r = cruzarComCarteira([linha("1500", "2026-11-01", 60000, "CLIENTE GAMA LTDA")], [t]);
    expect(r.parciais[0]).toMatchObject({ retirarCedidoAntes: true, certo: false, planilhaCentavos: 6_000_000, appCentavos: 10_000_000 });
  });

  it("título livre com parte ativa que a planilha mostra por inteiro: encerra a parte antes de marcar", () => {
    const t = titulo("1001600U", "1600", "2026-11-01", 100000, "CLIENTE DELTA LTDA", { partes: [{ id: "py", valorCentavos: 4_000_000, vencimento: "2026-11-01" }] });
    const r = cruzarComCarteira([linha("1600", "2026-11-01", 100000, "CLIENTE DELTA LTDA")], [t]);
    expect(r.marcar).toHaveLength(1);
    expect(r.marcar[0].encerrarPartesAntes.map((p) => p.id)).toEqual(["py"]);
    expect(explicarDiferenca(r).faltaMarcarCentavos).toBe(6_000_000); // 100.000 − 40.000 que o app já contava
    expect(r.resumo.diferencaCentavos).toBe(6_000_000);
  });

  it("dois títulos iguais do mesmo cliente: cada linha casa com um (um para um), pela data", () => {
    const a = titulo("1001700A", "1700", "2026-10-10", 5000, "CLIENTE EPSILON LTDA");
    const b = titulo("1001700B", "1700", "2026-11-10", 5000, "CLIENTE EPSILON LTDA");
    const r = cruzarComCarteira([linha("1700/2", "2026-11-10", 5000, "CLIENTE EPSILON LTDA"), linha("1700/1", "2026-10-10", 5000, "CLIENTE EPSILON LTDA")], [a, b]);
    expect(r.marcar.map((m) => [m.linha.numero, m.titulo.documento]).sort()).toEqual([["1700/1", "1001700A"], ["1700/2", "1001700B"]]);
  });

  it("a diferença total é explicada pelas categorias", () => {
    const c = titulo("Z00026C", null, "2026-09-29", 1_970_000, AMORIM, { partes: [{ id: "p1", valorCentavos: 50_000_000, vencimento: "2026-09-29" }] });
    const j = titulo("Z00027B", null, "2026-10-08", 67000, JSETE);
    const solto = naAkf("4002338U", "2338", "2026-10-20", 2129.7, "JBL EMPREENDIMENTOS");
    const r = cruzarComCarteira([
      linha("7897/2026/03", "2026-10-09", 200000, AMORIM), linha("7897/2026/03/02", "2026-10-09", 350000, AMORIM),
      linha("226/2026/2", "2026-10-08", 67000, JSETE), linha("R1", "2026-10-02", 100, "NINGUEM CONHECIDO"),
    ], [c, j, solto]);
    const e = explicarDiferenca(r);
    expect(e.faltaMarcarCentavos + e.faltaParcialCentavos + e.semTituloCentavos + e.soNoAppCentavos + e.aConfirmarCentavos).toBe(r.resumo.diferencaCentavos);
  });
});
