import { describe, expect, it } from "vitest";
import type { GrupoCobranca, TituloCobranca } from "../../../../supabase/functions/_shared/cobranca";
import {
  abaInicial, agruparPorNota, aplicarFiltros, contarFilas, filaDaParcela, linkWhatsApp, marcoDaDescricao, montarTextoBusca, nomeParcela, ordenarContatos,
  ordenarParcelas, paginar, prazoDaParcela, removerCobrancasFeitas, totalDaFila, totalDeTarefas, type ItemBase, type ItemContato, type ItemParcela, type Tarefas,
} from "./tarefas";

const base = (cliente: string, unidade: "matriz" | "contagem" = "matriz", documentos: string[] = []): ItemBase => ({
  clienteId: `id-${cliente}`, cliente, codigo: null, unidade, textoBusca: montarTextoBusca(cliente, null, documentos),
});
const parcela = (cliente: string, documento: string, vencimento: string, unidade: "matriz" | "contagem" = "matriz", extra: Partial<ItemParcela> = {}): ItemParcela => ({
  ...base(cliente, unidade, [documento]), id: `p-${documento}`, documento, parcela: "1", vencimento, valorCentavos: 100_00, estagio: "aguardando_boleto",
  prazo: vencimento, contato: null, andamento: null, diasAtraso: 0, notaSaidaId: null, nota: null, ...extra,
});
const vazio = (): Tarefas => ({ hoje: "2026-10-20", anexar: [], enviar: [], dados: [], confirmar: [], cobrar: [], baixa: [], contato: [] });

describe("filaDaParcela", () => {
  it("só parcela aguardando boleto entra; com PDF vai para enviar, sem PDF para anexar", () => {
    expect(filaDaParcela({ estagio: "aguardando_boleto", forma: "boleto", temBoleto: false })).toBe("anexar");
    expect(filaDaParcela({ estagio: "aguardando_boleto", forma: "boleto", temBoleto: true })).toBe("enviar");
    expect(filaDaParcela({ estagio: "boleto_enviado", forma: "boleto", temBoleto: true })).toBeNull();
    expect(filaDaParcela({ estagio: "importado", forma: "boleto", temBoleto: false })).toBeNull();
  });

  it("anexar só entra a 30 dias ou menos do vencimento; enviar e dados não dependem da janela", () => {
    const base = { estagio: "aguardando_boleto", forma: "boleto", hoje: "2026-10-06" };
    expect(filaDaParcela({ ...base, temBoleto: false, vencimento: "2026-11-05" })).toBe("anexar");
    expect(filaDaParcela({ ...base, temBoleto: false, vencimento: "2026-11-06" })).toBeNull();
    expect(filaDaParcela({ ...base, temBoleto: false, vencimento: "2026-09-20" })).toBe("anexar"); // vencido
    expect(filaDaParcela({ ...base, temBoleto: true, vencimento: "2027-03-01" })).toBe("enviar");
    expect(filaDaParcela({ ...base, forma: "transferencia", temBoleto: false, vencimento: "2027-03-01" })).toBe("dados");
  });

  it("transferência sai das filas de boleto e vai para os dados de pagamento, com ou sem PDF", () => {
    expect(filaDaParcela({ estagio: "aguardando_boleto", forma: "transferencia", temBoleto: false })).toBe("dados");
    expect(filaDaParcela({ estagio: "aguardando_boleto", forma: "transferencia", temBoleto: true })).toBe("dados");
    expect(filaDaParcela({ estagio: "boleto_enviado", forma: "transferencia", temBoleto: false })).toBeNull();
  });
});

describe("prazo e ordenação", () => {
  it("prazo = vencimento menos 8 dias; se já passou, hoje", () => {
    expect(prazoDaParcela("2026-10-30", "2026-10-20")).toBe("2026-10-22");
    expect(prazoDaParcela("2026-10-25", "2026-10-20")).toBe("2026-10-20");
  });

  it("vencimento mais próximo primeiro; empate por cliente e documento", () => {
    const lista = ordenarParcelas([parcela("Zeta", "10", "2026-10-30"), parcela("Beta", "20", "2026-10-25"), parcela("Alfa", "30", "2026-10-25")]);
    expect(lista.map((p) => p.documento)).toEqual(["30", "20", "10"]);
  });

  it("clientes sem contato: título mais urgente primeiro", () => {
    const c = (nome: string, v: string): ItemContato => ({ ...base(nome), titulos: 1, totalCentavos: 1, menorVencimento: v, maiorAtraso: 0 });
    expect(ordenarContatos([c("B", "2026-11-01"), c("A", "2026-10-25"), c("C", "2026-10-25")]).map((x) => x.cliente)).toEqual(["A", "C", "B"]);
  });

  it("nome da parcela só leva /n depois da primeira", () => {
    expect(nomeParcela({ documento: "1234", parcela: "1" })).toBe("1234");
    expect(nomeParcela({ documento: "1234", parcela: "2" })).toBe("1234/2");
  });
});

describe("cobranças já feitas", () => {
  const t = (id: string, vencimento: string, valorCentavos: number): TituloCobranca => ({ id, contraparteId: "c", nomeCliente: "Cliente", documento: id, parcela: "1", vencimento, valorCentavos, estagio: "vencido" });
  const grupo = (marco: 1 | 5 | 10, titulos: TituloCobranca[]): GrupoCobranca => ({
    contraparteId: "c", nomeCliente: "Cliente", unidade: "matriz", marco, titulos, totalCentavos: titulos.reduce((s, x) => s + x.valorCentavos, 0), vencimentoMaisAntigo: titulos[0].vencimento,
  });

  it("reconhece o D+n na descrição do registro", () => {
    expect(marcoDaDescricao("Cobrança D+5 enviada por WhatsApp.")).toBe(5);
    expect(marcoDaDescricao("Cobrança D+10: o cliente prometeu pagar")).toBe(10);
    expect(marcoDaDescricao("Boleto enviado por e-mail.")).toBeNull();
    expect(marcoDaDescricao(null)).toBeNull();
  });

  it("grupo inteiro já cobrado naquele marco some; só uma parcela cobrada recalcula o total", () => {
    const g1 = grupo(1, [t("a", "2026-10-19", 100_00), t("b", "2026-10-19", 200_00)]);
    const g5 = grupo(5, [t("c", "2026-10-15", 50_00)]);
    const r = removerCobrancasFeitas([g1, g5], (id, marco) => (id === "a" && marco === 1) || (id === "c" && marco === 5));
    expect(r).toHaveLength(1);
    expect(r[0].titulos.map((x) => x.id)).toEqual(["b"]);
    expect(r[0].totalCentavos).toBe(200_00);
  });

  it("cobrança de um marco anterior não conta para o marco atual", () => {
    const g5 = grupo(5, [t("c", "2026-10-15", 50_00)]);
    // a parcela foi cobrada no D+1, mas agora está no D+5: continua na fila
    expect(removerCobrancasFeitas([g5], (_id, marco) => marco === 1)).toHaveLength(1);
  });
});

describe("filtros e contagens", () => {
  const tarefas = (): Tarefas => ({
    ...vazio(),
    anexar: [parcela("Construtora Alfa", "111", "2026-10-25"), parcela("Beta Ação", "400222", "2026-10-26", "contagem")],
    dados: [parcela("Alfa Engenharia", "333", "2026-10-27")],
    contato: [{ ...base("Gama"), titulos: 1, totalCentavos: 1, menorVencimento: "2026-10-25", maiorAtraso: 0 }],
  });

  it("unidade filtra todas as filas; busca acha por cliente (sem acento) ou documento", () => {
    expect(contarFilas(aplicarFiltros(tarefas(), { unidade: "contagem", busca: "" })).anexar).toBe(1);
    expect(totalDeTarefas(aplicarFiltros(tarefas(), { unidade: "matriz", busca: "" }))).toBe(3);
    expect(aplicarFiltros(tarefas(), { unidade: null, busca: "acao" }).anexar.map((i) => i.cliente)).toEqual(["Beta Ação"]);
    expect(aplicarFiltros(tarefas(), { unidade: null, busca: "alfa" }).dados).toHaveLength(1);
    expect(aplicarFiltros(tarefas(), { unidade: null, busca: "400222" }).anexar).toHaveLength(1);
  });

  it("sem filtros, o total é a soma das filas", () => {
    const t = tarefas();
    expect(totalDeTarefas(aplicarFiltros(t, { unidade: null, busca: "" }))).toBe(4);
  });

  it("a aba que abre é a primeira com itens; todas vazias, a primeira", () => {
    expect(abaInicial(contarFilas(tarefas()))).toBe("anexar");
    expect(abaInicial(contarFilas({ ...vazio(), cobrar: [{} as never] }))).toBe("cobrar");
    expect(abaInicial(contarFilas(vazio()))).toBe("anexar");
  });
});

describe("paginar", () => {
  const lista = Array.from({ length: 120 }, (_, i) => i + 1);
  it("50 por página; a última leva o resto", () => {
    expect(paginar(lista, 1).itens).toHaveLength(50);
    expect(paginar(lista, 3)).toMatchObject({ pagina: 3, totalPaginas: 3, total: 120 });
    expect(paginar(lista, 3).itens).toEqual(lista.slice(100));
  });
  it("página fora do intervalo ou inválida cai na mais próxima; lista vazia tem uma página", () => {
    expect(paginar(lista, 99).pagina).toBe(3);
    expect(paginar(lista, 0).pagina).toBe(1);
    expect(paginar(lista, Number.NaN).pagina).toBe(1);
    expect(paginar([], 2)).toMatchObject({ itens: [], pagina: 1, totalPaginas: 1, total: 0 });
  });
});

describe("agruparPorNota", () => {
  it("parcelas da mesma NF e cliente viram um grupo, com total, vencimento e prazo mais próximos; título avulso fica sozinho", () => {
    const grupos = agruparPorNota([
      parcela("Alfa", "1397B", "2026-11-15", "matriz", { notaSaidaId: "n1", nota: "1397", prazo: "2026-11-07" }),
      parcela("Alfa", "1397A", "2026-10-15", "matriz", { notaSaidaId: "n1", nota: "1397", prazo: "2026-10-07" }),
      parcela("Beta", "900", "2026-10-10"),
      parcela("Alfa", "777", "2026-10-30"),
    ]);
    expect(grupos.map((g) => g.chave)).toEqual(["avulso|p-900", "Alfa|n1".replace("Alfa", "id-Alfa"), "avulso|p-777"]);
    const nf = grupos.find((g) => g.nota === "1397")!;
    expect(nf.parcelas.map((p) => p.documento)).toEqual(["1397A", "1397B"]); // dentro do grupo, a mais urgente primeiro
    expect(nf).toMatchObject({ totalCentavos: 200_00, vencimentoMaisProximo: "2026-10-15", prazo: "2026-10-07" });
  });

  it("a mesma NF de clientes diferentes não se mistura", () => {
    const g = agruparPorNota([
      parcela("Alfa", "1", "2026-10-15", "matriz", { notaSaidaId: "n1", nota: "1" }),
      parcela("Beta", "2", "2026-10-16", "matriz", { notaSaidaId: "n1", nota: "1" }),
    ]);
    expect(g).toHaveLength(2);
  });
});

describe("totalDaFila", () => {
  it("soma o valor das parcelas e o total dos grupos", () => {
    const t: Tarefas = {
      ...vazio(),
      anexar: [parcela("A", "1", "2026-10-20"), parcela("B", "2", "2026-10-21")],
      confirmar: [{ ...base("C"), parcelas: [], totalCentavos: 500_00, vencimentoMaisProximo: "2026-10-20", prazo: "2026-10-16", ligar: false, contato: null, andamento: null, mensagem: null, linkWhatsApp: null }],
    };
    expect(totalDaFila(t, "anexar")).toBe(200_00);
    expect(totalDaFila(t, "confirmar")).toBe(500_00);
    expect(totalDaFila(t, "cobrar")).toBe(0);
  });
});

describe("linkWhatsApp", () => {
  it("monta o link wa.me com o texto codificado, aceitando +55, DDD+número e máscara", () => {
    expect(linkWhatsApp("+5544991741030", "Olá, tudo bem?")).toBe("https://wa.me/5544991741030?text=Ol%C3%A1%2C%20tudo%20bem%3F");
    expect(linkWhatsApp("(44) 99174-1030", "x")).toBe("https://wa.me/5544991741030?text=x");
    expect(linkWhatsApp("65 3624-6365", "x")).toBe("https://wa.me/556536246365?text=x");
  });
  it("número ausente ou inválido não gera link", () => {
    expect(linkWhatsApp(null, "x")).toBeNull();
    expect(linkWhatsApp("", "x")).toBeNull();
    expect(linkWhatsApp("12345", "x")).toBeNull();
    expect(linkWhatsApp("+1 415 555 0100", "x")).toBeNull();
  });
});
