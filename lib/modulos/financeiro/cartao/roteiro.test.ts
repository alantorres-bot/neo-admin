import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import { chaveTitulo, conciliar, type DecisaoItem, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { montarRoteiro, motivoNaoEhOMesmo, possiveisTitulos, recusaDeLancamento, travaDeLancamento } from "./roteiro";
import type { OutroTitulo } from "./selecao-titulos";

const NUBANK = CARTOES_TESTE.find((c) => c.codigo === "NUBANK PF")!;
let seq = 0;
const linha = (descricao: string, valor: number, extra: Partial<LinhaFatura> = {}): LinhaFatura => ({
  id: `l${++seq}`, ordem: seq, dataCompra: "2026-09-20", descricao, valorCentavos: Math.round(valor * 100), parcelaNum: null, parcelaTotal: null, ...extra,
});
const titulo = (complemento: string, valor: number, extra: Partial<TituloPagar> = {}): TituloPagar => ({
  id: `t${++seq}`, codLancamento: String(30000 + seq), numeroTitulo: `${2000 + seq}/1`, fornecedor: "PASSAGENS AEREAS", vencimento: "2026-10-27", complemento, tipoTitulo: "Passagens",
  valorCentavos: Math.round(valor * 100), ...extra,
});
const decisao = (tipo: DecisaoItem["tipo"], linhas: string[], titulos: string[], motivo: string): DecisaoItem => ({
  id: `d${++seq}`, tipo, linhas, titulos, categoria: null, contaFluxo: null, motivo, autor: "Teste", em: "2026-10-21T12:00:00Z",
});

function apurar(linhas: LinhaFatura[], titulos: TituloPagar[], extra: { outros?: OutroTitulo[]; decisoes?: DecisaoItem[] } = {}) {
  const outros = extra.outros ?? [];
  const total = linhas.reduce((s, l) => s + l.valorCentavos, 0);
  const resultado = conciliar({
    cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-10-27", totalInformadoCentavos: total, linhas, titulos, estabelecimentos: [],
    decisoes: extra.decisoes ?? [], titulosExtras: outros.map((o) => o.titulo),
  });
  return { resultado, outros };
}
const outro = (t: TituloPagar): OutroTitulo => ({ titulo: t, situacao: "so_marca", detalhe: "" });

describe("possível título já lançado", () => {
  it("linha de R$ 822,89 × título de R$ 822,90 nos outros títulos de cartão: travada até casar ou dizer que não é o mesmo", () => {
    const nu = linha("NuViagens", 822.89);
    const t = titulo("CRATAO NUBANK - PASSAGENS 3X", 822.9);
    const semRelacao = titulo("CARTAO INTER PJ - HOTEL", 410);
    const base = apurar([nu], [], { outros: [outro(t), outro(semRelacao)] });
    const trava = travaDeLancamento(base.resultado, base.outros);
    expect(trava.geral).toEqual([]);
    expect(trava.possiveis.get(nu.id)?.map((x) => x.id)).toEqual([t.id]);
    expect(recusaDeLancamento(trava, [nu.id])).toMatch(/Possível título já lançado: nº .*R\$\s?822,90/);

    const casada = apurar([nu], [], { outros: [outro(t), outro(semRelacao)], decisoes: [decisao("casar", [nu.id], [chaveTitulo(t)], "é a mesma compra")] });
    expect(recusaDeLancamento(travaDeLancamento(casada.resultado, casada.outros), [nu.id])).toBeNull();

    const conferida = apurar([nu], [], { outros: [outro(t)], decisoes: [decisao("observar", [nu.id], [], motivoNaoEhOMesmo(t))] });
    expect(possiveisTitulos(conferida.resultado, conferida.outros).size).toBe(0);
    expect(recusaDeLancamento(travaDeLancamento(conferida.resultado, conferida.outros), [nu.id])).toBeNull();
  });

  it("observação de outro título não libera; linha 2/3 × título ≈ 3 × parcela também é possível título", () => {
    const parc = linha("Hotel - Parcela 2/3", 100, { parcelaNum: 2, parcelaTotal: 3 });
    const cheio = titulo("CARTAO NUBANK 3X - HOTEL", 300.02);
    const outroQualquer = titulo("CARTAO NUBANK - X", 1);
    const r = apurar([parc], [], { outros: [outro(cheio)], decisoes: [decisao("observar", [parc.id], [], motivoNaoEhOMesmo(outroQualquer))] });
    expect(possiveisTitulos(r.resultado, r.outros).get(parc.id)?.map((x) => x.id)).toEqual([cheio.id]);
  });

  it("encargo e estorno não entram na verificação", () => {
    const iof = linha("IOF de compra internacional", 12.34);
    const estorno = linha("Estorno de Uber", -12.34);
    const r = apurar([iof, estorno], [], { outros: [outro(titulo("CARTAO NUBANK - IOF", 12.34))] });
    expect(possiveisTitulos(r.resultado, r.outros).size).toBe(0);
  });
});

describe("trava geral", () => {
  it("compra parcelada lançada pelo total e divergência sem decisão travam todo lançamento; observação na divergência libera", () => {
    const um = linha("Loja - Parcela 1/2", 50, { parcelaNum: 1, parcelaTotal: 2 });
    const nf = titulo("CARTAO NUBANK 2X - LOJA", 100);
    const comDesdobrar = apurar([um], [nf]);
    expect(comDesdobrar.resultado.aDesdobrar).toHaveLength(1);
    expect(travaDeLancamento(comDesdobrar.resultado, []).geral[0]).toMatch(/Desdobre antes/);

    const compra = linha("Padaria", 30);
    const sobra = titulo("CARTAO NUBANK - SEM LINHA", 999);
    const r = apurar([compra], [sobra]);
    const trava = travaDeLancamento(r.resultado, []);
    expect(trava.geral[0]).toMatch(/Confira antes o título sem linha/);
    expect(recusaDeLancamento(trava, [compra.id])).toMatch(/Confira antes/);

    const vista = apurar([compra], [sobra], { decisoes: [decisao("observar", [], [chaveTitulo(sobra)], "parcela de outro mês")] });
    expect(travaDeLancamento(vista.resultado, []).geral).toEqual([]);
  });
});

describe("roteiro", () => {
  it("encargos pendentes: o passo atual é o 1; depois de lançados, o passo atual vai para a compra", () => {
    const iof = linha("IOF de compra internacional", 5);
    const compra = linha("Padaria", 30);
    const antes = apurar([iof, compra], []);
    const p = montarRoteiro({ resultado: antes.resultado, outros: [] });
    expect(p.map((x) => x.estado)).toEqual(["feito", "atual", "nao_se_aplica", "nao_se_aplica", "nao_se_aplica", "pendente", "nao_se_aplica", "pendente"]);

    const t = titulo("CARTAO NUBANK PF — ENCARGOS: IOF", 5, { fornecedor: "NU PAGAMENTOS" });
    const depois = apurar([iof, compra], [t]);
    const q = montarRoteiro({ resultado: depois.resultado, outros: [], encargosLancados: "34002" });
    expect(q[1]).toMatchObject({ estado: "feito", detalhe: "Encargos lançados: 34002." });
    expect(q.find((x) => x.estado === "atual")?.titulo).toBe("Lançar compras");
  });

  it("tudo conciliado: o passo atual é Fechar; títulos do espelho deixam o Preparar pendente", () => {
    const compra = linha("Padaria", 30);
    const r = apurar([compra], [titulo("CARTAO NUBANK - PADARIA", 30)]);
    const p = montarRoteiro({ resultado: r.resultado, outros: [] });
    expect(p.at(-1)?.estado).toBe("atual");
    expect(p.filter((x) => x.estado === "pendente")).toEqual([]);
    expect(montarRoteiro({ resultado: r.resultado, outros: [], origemTitulos: "espelho" })[0].estado).toBe("atual");
  });
});
