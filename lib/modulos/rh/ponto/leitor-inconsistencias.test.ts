import { describe, expect, it } from "vitest";
import type { ItemTexto, PaginaTexto } from "@/lib/modulos/financeiro/cartao/leitores/tipos";
import { lerInconsistencias } from "./leitor-inconsistencias";

// Página sintética no layout do relatório "Inconsistências" do Control iD (x dos títulos medidos na imagem do PDF de 14/10/2026).
// Nomes fictícios.
const it_ = (x: number, y: number, texto: string, w = texto.length * 4): ItemTexto => ({ x, y, w, texto });

const CABECALHO = (y: number): ItemTexto[] => [
  it_(68, y, "DIA"), it_(145, y, "PREVISTO"), it_(248, y, "ENT. 1"), it_(288, y, "SAÍ. 1"), it_(321, y, "ENT. 2"), it_(361, y, "SAÍ. 2"),
  it_(394, y, "ENT. 3"), it_(434, y, "SAÍ. 3"),
  it_(470, y - 6, "TOTAL"), it_(469, y, "NORMAIS"), it_(515, y - 6, "TOTAL"), it_(514, y, "NOTURNO"),
  it_(560, y - 6, "DIA"), it_(558, y, "FALTA"), it_(597, y - 6, "FALTA E"), it_(597, y, "ATRASO"), it_(636, y, "ABONO"),
  it_(680, y - 6, "EXTRA"), it_(681, y, "50%D"), it_(712, y - 6, "EXTRA"), it_(711, y, "DIURNA"), it_(756, y - 6, "EXTRA"), it_(754, y, "NOTURNA"),
  it_(806, y - 6, "BANCO"), it_(806, y, "TOTAL"), it_(845, y - 6, "BANCO"), it_(845, y, "SALDO"),
];

const pessoa = (y: number, nome: string, mat: string, cargo: string) => [it_(68, y, `${nome} - NÚMERO DE MATRÍCULA: ${mat} - NOME DO CARGO: ${cargo}`, 400)];
const dia = (y: number, cols: Record<number, string>) => Object.entries(cols).map(([x, t]) => it_(Number(x), y, t));
const pagina = (numero: number, itens: ItemTexto[]): PaginaTexto => ({ numero, largura: 900, altura: 1300, itens });

const P1 = pagina(1, [
  it_(560, 20, "Emitido em 14/10/2026 às 09:43"),
  it_(63, 105, "Inconsistências"), it_(510, 115, "DE 26/09/2026 ATÉ 11/10/2026"),
  ...CABECALHO(160),
  ...pessoa(185, "FULANO DE TAL DA SILVA", "-", "AUXILIAR DE PRODUÇÃO I"),
  // esqueceu de bater a saída (marcação incluída com *)
  ...dia(200, { 68: "30/09/26 - QUA", 145: "07:00-11:00 12:00-17:00", 248: "06:51", 288: "11:01", 321: "*11:57*", 474: "04:00", 601: "05:00", 845: "02:10" }),
  // falta
  ...dia(212, { 68: "01/10/26 - QUI", 145: "07:00-11:00 12:00-17:00", 248: "FALTA", 573: "1", 601: "09:00", 845: "02:10" }),
  ...dia(224, { 68: "TOTAIS", 474: "04:00", 573: "1", 601: "14:00" }),
  ...pessoa(250, "BELTRANO SOUZA", "7", "AUXILIAR DE PRODUÇÃO III"),
  // data e dia da semana em itens separados; saída antecipada; saldo negativo
  ...dia(265, { 68: "09/10/26", 108: "- SEX", 145: "07:00-11:00 12:00-16:00", 248: "07:00", 288: "11:01", 321: "11:56", 361: "15:00", 474: "07:00", 601: "01:00", 842: "-14:08" }),
]);

const P2 = pagina(2, [
  ...CABECALHO(60),
  ...pessoa(85, "CICLANO DUARTE", "3", "SUPERVISOR DE PRODUÇÃO"),
  // esqueceu de bater a saída do almoço: o Control iD contou extra
  ...dia(100, { 68: "01/10/26 - QUI", 145: "07:00-11:00 12:00-17:00", 248: "*06:55*", 288: "11:59", 321: "19:04", 474: "05:00", 601: "04:00", 680: "02:05", 712: "02:05", 845: "11:38" }),
]);

describe("lerInconsistencias", () => {
  const r = lerInconsistencias([P1, P2]);

  it("lê o período do topo", () => {
    expect(r.inicio).toBe("2026-09-26");
    expect(r.fim).toBe("2026-10-11");
    expect(r.avisos).toEqual([]);
  });

  it("uma ocorrência por dia, sem as linhas TOTAIS, com a pessoa e o cargo", () => {
    expect(r.ocorrencias.map((o) => [o.nome, o.data])).toEqual([
      ["FULANO DE TAL DA SILVA", "2026-09-30"], ["FULANO DE TAL DA SILVA", "2026-10-01"], ["BELTRANO SOUZA", "2026-10-09"], ["CICLANO DUARTE", "2026-10-01"],
    ]);
    expect(r.ocorrencias[0]).toMatchObject({ matricula: null, cargo: "AUXILIAR DE PRODUÇÃO I", diaSemana: "QUA", previsto: "07:00-11:00 12:00-17:00" });
    expect(r.ocorrencias[2]).toMatchObject({ matricula: "7", diaSemana: "SEX" });
  });

  it("marcações por coluna, com o * do Control iD", () => {
    expect(r.ocorrencias[0].marcacoes).toEqual(["06:51", "11:01", "*11:57*", "", "", ""]);
    expect(r.ocorrencias[2].marcacoes).toEqual(["07:00", "11:01", "11:56", "15:00", "", ""]);
  });

  it("falta: sem marcações, falta/atraso do dia", () => {
    expect(r.ocorrencias[1]).toMatchObject({ falta: true, faltaAtrasoMin: 9 * 60, marcacoes: ["", "", "", "", "", ""] });
    expect(r.ocorrencias[0].falta).toBe(false);
  });

  it("falta/atraso, extras (50% e diurna são a mesma hora) e saldo do banco com sinal", () => {
    expect(r.ocorrencias[0]).toMatchObject({ faltaAtrasoMin: 300, totalNormaisMin: 240, extrasMin: 0, bancoSaldoMin: 130 });
    expect(r.ocorrencias[2]).toMatchObject({ faltaAtrasoMin: 60, bancoSaldoMin: -(14 * 60 + 8) });
    expect(r.ocorrencias[3]).toMatchObject({ extrasMin: 125, bancoSaldoMin: 11 * 60 + 38, marcacoes: ["*06:55*", "11:59", "19:04", "", "", ""] });
  });

  it("quebra de página: o cabeçalho da página 2 vale para ela", () => {
    expect(r.ocorrencias[3].ordem).toBe(4);
  });

  it("sem cabeçalho: avisa em vez de inventar", () => {
    const x = lerInconsistencias([pagina(1, [it_(10, 10, "QUALQUER COISA")])]);
    expect(x.ocorrencias).toEqual([]);
    expect(x.avisos.join(" ")).toMatch(/cabeçalho/);
  });

  it("dia sem funcionário antes: avisa", () => {
    const x = lerInconsistencias([pagina(1, [it_(510, 20, "DE 26/09/2026 ATÉ 11/10/2026"), ...CABECALHO(60), ...dia(80, { 68: "30/09/26 - QUA", 601: "01:00" })])]);
    expect(x.ocorrencias).toEqual([]);
    expect(x.avisos[0]).toMatch(/sem funcionário/);
  });
});
