import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import { assuntoCompensavel, cartaoDivergente, casar, classificar, compensarEstornos, conciliar, type DecisaoItem, type Estabelecimento, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { selecionarTitulos, type LancamentoEspelho } from "./selecao-titulos";

const NUBANK = CARTOES_TESTE.find((c) => c.codigo === "NUBANK PF")!;
let seq = 0;
const linha = (descricao: string, valor: number, extra: Partial<LinhaFatura> = {}): LinhaFatura => ({
  id: `l${++seq}`, ordem: seq, dataCompra: "2026-06-05", descricao, valorCentavos: Math.round(valor * 100), parcelaNum: null, parcelaTotal: null, ...extra,
});
const titulo = (complemento: string, valor: number, extra: Partial<TituloPagar> = {}): TituloPagar => ({
  id: `t${++seq}`, numeroTitulo: `${1000 + seq}/1`, fornecedor: "NU PAGAMENTOS S.A.", vencimento: "2026-06-27", complemento, tipoTitulo: "Passagens", valorCentavos: Math.round(valor * 100), ...extra,
});
const DICIONARIO: Estabelecimento[] = [
  { padrao: "NUVIAGENS", categoria: "Passagens aéreas", contaFluxo: "Passagens" },
  { padrao: "EBW", categoria: "Passagens aéreas", contaFluxo: "Passagens" },
  { padrao: "HOTEIS.COM", categoria: "Hospedagem", contaFluxo: "Hospedagens" },
  { padrao: "NUTAG", categoria: "Pedágio", contaFluxo: "Viagens e Lobby" },
  { padrao: "CLICKUP", categoria: "Assinaturas e software", contaFluxo: "Softwares e Licenças" },
  { padrao: "MERCADOLIVRE", categoria: "Marketplace", contaFluxo: null },
  { padrao: "UBER", categoria: "Transporte e aplicativos", contaFluxo: "[A PREENCHER]" },
];

describe("compensação", () => {
  it('IOF × "IOF de volta" e estorno × relançamento se anulam; estorno sem par permanece', () => {
    expect(assuntoCompensavel('IOF de volta de "Hoteis.com"')).toBe("HOTEIS.COM");
    expect(assuntoCompensavel("Estorno de Uber")).toBe("UBER");
    const linhas = [
      linha("IOF de Hoteis.com", 4.07), linha("IOF de volta de Hoteis.com", -4.07),
      linha("Uber *Trip", 25.9), linha("Estorno de Uber *Trip", -25.9), linha("Uber *Trip", 25.9),
      linha("Estorno de Amazon", -99.9), linha("ClickUp", 120),
    ];
    const r = compensarEstornos(linhas);
    expect(r.compensados).toHaveLength(2);
    expect(r.compensados.map((c) => [c.credito.descricao, c.debito.descricao])).toEqual([["Estorno de Uber *Trip", "Uber *Trip"], ["IOF de volta de Hoteis.com", "IOF de Hoteis.com"]]);
    expect(r.restantes.map((l) => l.descricao)).toEqual(["Uber *Trip", "Estorno de Amazon", "ClickUp"]);
  });
});

describe("casamento", () => {
  it("exato por valor com desempate pela descrição; tolerância de centavos; agrupamento", () => {
    const linhas = [linha("EBW*NuViagens - Parcela 3/8", 352.12), linha("Hoteis.com", 352.12), linha("ClickUp", 120.01), linha("NuTag", 20), linha("NuTag", 20), linha("NuTag", 20), linha("NuTag", 20)];
    const titulos = [titulo("CARTAO NUBANK - HOTEIS.COM CUIABA", 352.12), titulo("CARTAO NUBANK - VIAGENS EBW", 352.12), titulo("CARTAO NUBANK - CLICKUP", 120), titulo("CARTAO NUBANK - PEDAGIOS", 80)];
    const r = casar(linhas, titulos, 5);
    expect(r.casamentos.map((c) => [c.linhas[0].descricao, c.titulo.complemento, c.modo])).toEqual([
      ["EBW*NuViagens - Parcela 3/8", "CARTAO NUBANK - VIAGENS EBW", "Exato"],
      ["Hoteis.com", "CARTAO NUBANK - HOTEIS.COM CUIABA", "Exato"],
      ["ClickUp", "CARTAO NUBANK - CLICKUP", "Arredondamento"],
      ["NuTag", "CARTAO NUBANK - PEDAGIOS", "Agrupado"],
    ]);
    expect(r.casamentos[2].diferencaCentavos).toBe(1);
    expect(r.casamentos[3].linhas).toHaveLength(4);
    expect(r.linhasSemTitulo).toEqual([]);
    expect(r.titulosSemLinha).toEqual([]);
  });
});

describe("classificação", () => {
  it("estorno → encargo → parcela > 1 → dicionário → não identificado; conta [A PREENCHER] vira vazia", () => {
    expect(classificar(linha("Estorno de X", -10), DICIONARIO).natureza).toBe("Estorno / crédito");
    expect(classificar(linha("IOF de Compra Internacional", 4), DICIONARIO)).toEqual({ natureza: "Encargo financeiro", categoria: "Encargo financeiro", contaFluxo: "" });
    expect(classificar(linha("Anuidade Diferenc 07/12", 50), DICIONARIO).natureza).toBe("Encargo financeiro");
    expect(classificar(linha("Belenus", 1073.98, { parcelaNum: 2, parcelaTotal: 10 }), DICIONARIO)).toEqual({ natureza: "Parcela não desdobrada", categoria: "", contaFluxo: "" });
    expect(classificar(linha("EBW*NuViagens", 352.12, { parcelaNum: 1, parcelaTotal: 8 }), DICIONARIO)).toEqual({ natureza: "Despesa sem nota fiscal", categoria: "Passagens aéreas", contaFluxo: "Passagens" });
    expect(classificar(linha("Mercado*MercadoLivre", 99), DICIONARIO)).toEqual({ natureza: "Despesa sem nota fiscal", categoria: "Marketplace", contaFluxo: "" });
    expect(classificar(linha("Uber *Trip", 25.9), DICIONARIO).contaFluxo).toBe("");
    expect(classificar(linha("Mundo Azul", 5919.84), DICIONARIO).natureza).toBe("Não identificado");
  });
  it("cartão divergente tolera grafia e desambigua pelo vencimento", () => {
    expect(cartaoDivergente({ complemento: "CARTAO NUBANCK - VIAGENS", vencimento: "2026-06-27" }, NUBANK, CARTOES_TESTE)).toBe(false);
    expect(cartaoDivergente({ complemento: "CARTAO INTER - VIAGENS", vencimento: "2026-06-28" }, NUBANK, CARTOES_TESTE)).toBe(true);
    expect(cartaoDivergente({ complemento: "VIAGENS", vencimento: "2026-06-27" }, NUBANK, CARTOES_TESTE)).toBe(false);
  });
});

describe("conciliar — calibração como a skill", () => {
  // Ciclo fechado corretamente: 6 linhas úteis + 2 pares compensados + 4 pedágios num título só → zero a lançar, zero divergências.
  const linhas = [
    linha("EBW*NuViagens - NuPay - Parcela 3/8", 352.12), linha("Hoteis.com", 1180.5), linha("ClickUp", 120.01), linha("IOF de Compra Internacional", 4.07),
    linha("NuTag", 20), linha("NuTag", 20), linha("NuTag", 20), linha("NuTag", 20),
    linha("IOF de Hoteis.com", 2.5), linha("IOF de volta de Hoteis.com", -2.5), linha("Uber *Trip", 30), linha("Estorno de Uber *Trip", -30),
  ];
  const titulos = [
    titulo("CARTAO NUBANK - VIAGENS EBW", 352.12), titulo("CARTAO NUBANK - HOTEIS.COM", 1180.5), titulo("CARTAO NUBANK - CLICKUP", 120),
    titulo("CARTAO NUBANK - IOF", 4.07, { fornecedor: "NU PAGAMENTOS", tipoTitulo: "Cartão de Crédito Empre" }), titulo("CARTAO NUBANK - PEDAGIOS NUTAG", 80),
  ];
  const total = 352.12 + 1180.5 + 120.01 + 4.07 + 80;
  const base = { cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-06-27", totalInformadoCentavos: Math.round(total * 100), estabelecimentos: DICIONARIO };

  it("ciclo correto: integridade OK, 4 exatos + 1 agrupamento + 2 compensados, nada a lançar, arredondamento justificado", () => {
    const r = conciliar({ ...base, linhas, titulos });
    expect(r.integridadeOk).toBe(true);
    expect(r.contagens).toMatchObject({ compensados: 2, conciliados: 4, agrupamentos: 1, aLancar: 0, divergencias: 0, cartaoDivergente: 0 });
    expect(r.diferencaCentavos).toBe(1); // 120,01 na fatura × 120,00 no título (arredondamento tolerado)
    expect(r.arredondamentoCentavos).toBe(1);
    expect(r.residuoCentavos).toBe(0);
    expect(r.conciliados.find((c) => c.modo === "Arredondamento")?.diferencaCentavos).toBe(1);
  });

  it("detecção: 2 títulos removidos e 1 cartão trocado → 2 itens a lançar com categoria/conta e 1 alerta", () => {
    const semDois = titulos.filter((t) => !/HOTEIS|IOF$/.test(t.complemento));
    const trocado = semDois.map((t) => (t.complemento.includes("CLICKUP") ? { ...t, complemento: "CARTAO INTER - CLICKUP" } : t));
    const r = conciliar({ ...base, linhas, titulos: trocado });
    expect(r.contagens).toMatchObject({ aLancar: 2, divergencias: 0, cartaoDivergente: 1 });
    expect(r.aLancar.map((a) => [a.linha.descricao, a.natureza, a.categoria, a.contaFluxo, a.complementoSugerido])).toEqual([
      ["Hoteis.com", "Despesa sem nota fiscal", "Hospedagem", "Hospedagens", "CARTÃO NUBANK PF 1x — HOTEIS.COM"],
      ["IOF de Compra Internacional", "Encargo financeiro", "Encargo financeiro", "[CONFERIR]", "CARTÃO NUBANK PF 1x — IOF DE COMPRA INTERNACIONAL"],
    ]);
    expect(r.porNatureza["Despesa sem nota fiscal"]).toBe(118_050);
    expect(r.porNatureza["Encargo financeiro"]).toBe(407);
    expect(r.residuoCentavos).toBe(0);
    expect(r.quadro.at(-1)).toMatchObject({ centavos: 0, destaque: true });
  });

  it("título órfão: causa provável e resíduo zero quando tudo está justificado; parcela não desdobrada; não identificado", () => {
    const extra = [...titulos, titulo("CARTAO NUBANK - COMPRA ANTIGA", 500), titulo("CARTAO NUBANK - DUPLICADO", 352.12)];
    const maisLinhas = [...linhas, linha("Belenus Belene", 1073.98, { parcelaNum: 2, parcelaTotal: 10 }), linha("Mundo Azul", 5919.84, { parcelaNum: 1, parcelaTotal: 3 })];
    const r = conciliar({ ...base, totalInformadoCentavos: base.totalInformadoCentavos + 107_398 + 591_984, linhas: maisLinhas, titulos: extra });
    expect(r.divergencias.map((d) => [d.titulo.complemento, d.causa])).toEqual([
      ["CARTAO NUBANK - COMPRA ANTIGA", "Sem correspondência na fatura — apurar antes de qualquer exclusão"],
      ["CARTAO NUBANK - DUPLICADO", "Outro título de mesmo valor no ciclo — possível duplicidade"],
    ]);
    expect(r.aLancar.map((a) => [a.natureza, a.parcelas, a.categoria])).toEqual([["Parcela não desdobrada", 10, "[CONFERIR]"], ["Não identificado", 3, "[CONFERIR]"]]);
    expect(r.residuoCentavos).toBe(0);
    expect(r.integridadeOk).toBe(true);
  });
});

describe("selecionarTitulos (espelho cap_lancamentos)", () => {
  const SICREDI_PF = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;
  const lanc = (complemento: string, vencimento: string, valor: number, extra: Partial<LancamentoEspelho> = {}): LancamentoEspelho => ({
    id: `c${++seq}`, cod_lancamento: String(seq), num_documento: `${seq}/1`, cod_fornecedor: "485", fornecedor_nome: "SHOCK METAIS", complemento_historico: complemento,
    categoria_doc: "Matéria Prima", data_vencimento: vencimento, valor_documento: valor, valor_atualizado: valor, baixado_em: null, ...extra,
  });
  it("entra quem vence na janela e cita o cartão (ou o banco com vencimento no dia); outros cartões vão para 'outros'; baixado usa o valor do documento", () => {
    const r = selecionarTitulos([
      lanc("CARTÃO SICREDI 3 X;- MATERIA PRIMA ALUMINIO", "2026-10-10", 28013.79),
      lanc("CARTAO SICRED - REFORMA", "2026-10-12", 100),                                // janela de 5 dias; dia 12 não decide PF/PJ → ambíguo com o cartão entre os candidatos → entra
      lanc("CARTÃO SICREDI PJ 1x — X", "2026-10-10", 50),                                // PJ explícito → outro cartão
      lanc("CARTAO INTER - PNEUS", "2026-10-10", 70),                                    // Inter PJ (vence 10) → outro cartão
      lanc("PAGO NO CARTAO", "2026-10-10", 10),                                          // só marca
      lanc("LUVAS / MASCARAS", "2026-10-10", 10),                                        // sem cartão: fora
      lanc("CARTÃO SICREDI 1x — ANTIGA", "2026-09-10", 10),                              // fora da janela
      lanc("CARTÃO SICREDI 1x — BAIXADA", "2026-10-10", 90, { valor_atualizado: 0, baixado_em: "2026-10-09", valor_documento: 90 }),
    ], SICREDI_PF, CARTOES_TESTE, "2026-10-10");
    expect(r.doCartao.map((t) => [t.complemento, t.valorCentavos])).toEqual([
      ["CARTÃO SICREDI 3 X;- MATERIA PRIMA ALUMINIO", 2_801_379], ["CARTÃO SICREDI 1x — BAIXADA", 9_000], ["CARTAO SICRED - REFORMA", 10_000],
    ]);
    expect(r.outros.map((o) => [o.titulo.complemento, o.situacao])).toEqual([["CARTÃO SICREDI PJ 1x — X", "outro_cartao"], ["CARTAO INTER - PNEUS", "outro_cartao"], ["PAGO NO CARTAO", "so_marca"]]);
    expect(r.tituloDaFatura).toBeNull();
  });
  it("título no borderô do fechamento (saldo zero, lido da API) entra pelo valor do documento e fica marcado", () => {
    const r = selecionarTitulos([lanc("CARTÃO SICREDI 3 X;- MATERIA PRIMA", "2026-10-10", 28013.79, { valor_atualizado: 0, tem_bordero: true })], SICREDI_PF, CARTOES_TESTE, "2026-10-10");
    expect(r.doCartao.map((t) => [t.valorCentavos, t.emBordero])).toEqual([[2_801_379, true]]);
  });
  it("título no valor exato da fatura contra o banco (ou citando o cartão) é a fatura lançada como título único: sai do cruzamento", () => {
    const lancs = [
      lanc("CARTÃO CREDITO SICREDI PF", "2026-10-13", 78528.72, { cod_fornecedor: "80", fornecedor_nome: "BANCO SICREDI S.A.", num_documento: "131026" }),
      lanc("FATURA CARTAO", "2026-10-13", 15706.44, { cod_fornecedor: "76", fornecedor_nome: "BANCO INTER S.A", num_documento: "102026" }),
      lanc("CARTÃO SICREDI 3 X;- MATERIA PRIMA", "2026-10-10", 28013.79),
    ];
    const r = selecionarTitulos(lancs, SICREDI_PF, CARTOES_TESTE, "2026-10-10", 5, 7_852_872);
    expect(r.tituloDaFatura?.numeroTitulo).toBe("131026");
    expect(r.doCartao).toHaveLength(1);
    expect(r.outros.map((o) => o.situacao)).toEqual(["so_marca"]); // "FATURA CARTAO" do Inter: diz CARTÃO sem o banco e não bate com o total
    // sem o total informado, o título único entra como título comum do cartão
    expect(selecionarTitulos(lancs, SICREDI_PF, CARTOES_TESTE, "2026-10-10").doCartao).toHaveLength(2);
  });
});

describe("conciliar com decisões por item (Fase 2b)", () => {
  const SICREDI = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;
  const anuidade = linha("Anuidade Diferenc 07/12", 50);
  const credito = linha("Credito Anuidade Cartao", -50);
  const ckt = linha("Ckt Assessoria Cpv", 4936.74, { parcelaNum: 1, parcelaTotal: 12 });
  const belenus = linha("Belenus Belene", 1073.98, { parcelaNum: 1, parcelaTotal: 10 });
  const shock = linha("Shock Metais", 28013.79, { parcelaNum: 3, parcelaTotal: 3 });
  const tShock = titulo("CARTÃO SICREDI 3 X;- MATERIA PRIMA", 28013.79, { codLancamento: "461723", vencimento: "2026-10-10" });
  const tBelenus = titulo("CARTÃO SICREDI PF 10 X", 10739.44, { codLancamento: "658604", vencimento: "2026-10-10" });
  const tTrocado = titulo("CARTAO INTER - CKT", 4936.74, { codLancamento: "777", vencimento: "2026-10-10" });
  const linhas = [anuidade, credito, ckt, belenus, shock];
  const total = 50 - 50 + 4936.74 + 1073.98 + 28013.79;
  const dec = (tipo: DecisaoItem["tipo"], linhasD: string[], titulosD: string[] = [], extra: Partial<DecisaoItem> = {}): DecisaoItem => ({
    id: `d${++seq}`, tipo, linhas: linhasD, titulos: titulosD, categoria: null, contaFluxo: null, motivo: "motivo", autor: "operador", em: "2026-10-12", ...extra,
  });
  const base = { cartao: SICREDI, cartoes: CARTOES_TESTE, vencimento: "2026-10-10", totalInformadoCentavos: Math.round(total * 100), linhas, estabelecimentos: DICIONARIO };

  it("sem decisões: 4 pendentes (anuidade, crédito, Ckt, Belenus a desdobrar: NF de 10 × parcela com R$ 0,36 de diferença)", () => {
    const r = conciliar({ ...base, titulos: [tShock, tBelenus], titulosExtras: [tTrocado] });
    expect(r.pendentes).toBe(4);
    expect(r.divergencias).toEqual([]);
    expect(r.aDesdobrar?.map((p) => p.titulo.codLancamento)).toEqual(["658604"]);
    expect(r.contagens.titulos).toBe(2);   // o título de outro cartão não entra sozinho
  });

  it("compensar, casar à mão (com título de outro cartão), justificar, classificar e observar", () => {
    const decisoes = [
      dec("compensar", [anuidade.id, credito.id]),
      dec("casar", [ckt.id], ["777"], { motivo: "cartão trocado no lançamento" }),
      dec("casar", [belenus.id], ["658604"], { motivo: "título pelo total; fatura cobra a parcela 1/10" }),
      dec("observar", [shock.id], [], { motivo: "conferir NF" }),
    ];
    const r = conciliar({ ...base, titulos: [tShock, tBelenus], titulosExtras: [tTrocado], decisoes });
    expect(r.pendentes).toBe(0);
    expect(r.aLancar).toHaveLength(0);
    expect(r.divergencias).toHaveLength(0);
    expect(r.compensados.find((c) => c.decisao)?.decisao?.tipo).toBe("compensar");
    expect(r.conciliados.filter((c) => c.modo === "Manual").map((c) => [c.titulo.codLancamento, c.diferencaCentavos])).toEqual([["777", 0], ["658604", 107_398 - 1_073_944]]);
    expect(r.contagens).toMatchObject({ manuais: 2, titulos: 3 });
    expect(r.ajusteManualCentavos).toBe(107_398 - 1_073_944);
    expect(r.residuoCentavos).toBe(0);
    expect(r.decisoesSemEfeito).toEqual([]);   // a observação na linha casada automaticamente não tem item, mas observação não conta
  });

  it("justificar linha tira da pendência sem mudar o resíduo; classificar troca categoria e conta", () => {
    const decisoes = [
      dec("justificar", [credito.id], [], { motivo: "crédito abatido no título da anuidade" }),
      dec("classificar", [ckt.id], [], { categoria: "Consultoria", contaFluxo: "Serviços de Terceiros" }),
    ];
    const sem = conciliar({ ...base, titulos: [tShock] });
    const com = conciliar({ ...base, titulos: [tShock], decisoes });
    expect(com.pendentes).toBe(sem.pendentes - 1);
    expect(com.residuoCentavos).toBe(sem.residuoCentavos);
    const item = com.aLancar.find((a) => a.linha.id === ckt.id)!;
    expect([item.categoria, item.contaFluxo, item.classificacao?.id]).toEqual(["Consultoria", "Serviços de Terceiros", decisoes[1].id]);
    expect(com.aLancar.find((a) => a.linha.id === credito.id)?.justificativa?.motivo).toBe("crédito abatido no título da anuidade");
  });

  it("decisão sem efeito: título fora da janela, compensação que não fecha, justificativa de item já resolvido", () => {
    const decisoes = [
      dec("casar", [belenus.id], ["NAO-EXISTE"]),
      dec("compensar", [anuidade.id, ckt.id]),
      dec("justificar", [shock.id]),   // o Shock casa sozinho pelo valor
    ];
    const r = conciliar({ ...base, titulos: [tShock, tBelenus], decisoes });
    expect(r.decisoesSemEfeito.map((s) => s.motivo)).toEqual([
      "As linhas não somam zero.", "Um dos títulos não está mais na janela do vencimento.", "O item já foi resolvido pelo cruzamento (ou não está mais na fatura).",
    ]);
  });
});

describe("conciliar com antecipações candidatas", () => {
  const SICREDI = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;
  const ckt = linha("Ckt Assessoria Cpv", 4936.74, { parcelaNum: 1, parcelaTotal: 12 });
  const outra = linha("Loja Qualquer", 120);
  const aCpv = titulo("ANTECIPAÇÃO CPV MKT DIGITAL", 4936.74, { codLancamento: "33377", antecipacao: true, vencimento: "2026-10-10" });
  const aSobra = titulo("ANTECIPAÇÃO OUTRA", 999, { codLancamento: "33400", antecipacao: true, vencimento: "2026-10-10" });
  const base = { cartao: SICREDI, cartoes: CARTOES_TESTE, vencimento: "2026-10-10", totalInformadoCentavos: 505_674, linhas: [ckt, outra], titulos: [], estabelecimentos: DICIONARIO };
  it("casa só por valor idêntico, conta nos títulos e fica para conferir; a que sobra não entra no total", () => {
    const r = conciliar({ ...base, antecipacoes: [aCpv, aSobra] });
    const c = r.conciliados.find((x) => x.modo === "Antecipação")!;
    expect([c.titulo.codLancamento, c.aderencia]).toEqual(["33377", "Conferir: antecipação sem o cartão no texto"]);
    expect(r.totalTitulosCentavos).toBe(493_674);
    expect(r.contagens).toMatchObject({ conciliados: 1, titulos: 1, aLancar: 1 });
    expect(r.aLancar.map((a) => a.linha.descricao)).toEqual(["Loja Qualquer"]);
  });
  it("decisão casar pode usar a antecipação candidata", () => {
    const decisoes: DecisaoItem[] = [{ id: "d-ant", tipo: "casar", linhas: [outra.id], titulos: ["33400"], categoria: null, contaFluxo: null, motivo: "antecipação da loja", autor: "op", em: "2026-10-12" }];
    const r = conciliar({ ...base, antecipacoes: [aCpv, aSobra], decisoes });
    expect(r.conciliados.find((x) => x.modo === "Manual")?.titulo.codLancamento).toBe("33400");
    expect(r.pendentes).toBe(0);
  });
});

describe("compra parcelada lançada pelo total (regra 61)", () => {
  const base = { cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-06-27", estabelecimentos: DICIONARIO };
  const compra = () => linha("MP*TERABYTESHOP", 499.13, { parcelaNum: 1, parcelaTotal: 6 });

  it("1/6 com a NF de 6 × parcela: vai para 'a desdobrar', fora de 'a lançar' e das divergências; bloqueia e o resíduo é zero", () => {
    const l = compra();
    const nf = titulo("CARTAO NUBANK 1 X", 2994.78, { fornecedor: "TERABYTE ATACADO" });
    const r = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [l], titulos: [nf] });
    expect(r.aDesdobrar).toEqual([{ linha: l, titulo: nf, parcelas: 6, parcelaCentavos: 49_913, diferencaCentavos: 0, parcelaInicial: 1 }]);
    expect(r.aLancar).toEqual([]);
    expect(r.divergencias).toEqual([]);
    expect(r.pendentes).toBe(1);
    expect(r.contagens.aDesdobrar).toBe(1);
    expect(r.desdobrarCentavos).toBe(49_913 - 299_478);
    expect(r.quadro.find((q) => q.rotulo.includes("parcelada lançada pelo total"))?.centavos).toBe(-249_565);
    expect(r.residuoCentavos).toBe(0);
  });

  it("tolerância: arredondamento do emissor de até 10 centavos por parcela (+ 5); acima disso não casa", () => {
    const perto = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [titulo("NF", 2994.8)] });
    expect(perto.aDesdobrar?.[0].diferencaCentavos).toBe(2);
    const limite = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [titulo("NF", 2995.43)] });
    expect(limite.aDesdobrar).toHaveLength(1);
    const longe = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [titulo("NF", 2995.44)] });
    expect(longe.aDesdobrar).toEqual([]);
    expect(longe.aLancar).toHaveLength(1);
    expect(longe.divergencias).toHaveLength(1);
  });

  it("2/6 continua 'parcela não desdobrada'; sem título cheio a 1/6 continua 'a lançar'; à vista nunca entra", () => {
    const r = conciliar({
      ...base, totalInformadoCentavos: 3 * 49_913,
      linhas: [linha("LOJA A", 499.13, { parcelaNum: 2, parcelaTotal: 6 }), compra(), linha("LOJA B", 499.13)],
      titulos: [titulo("OUTRA NF", 1000)],
    });
    expect(r.aDesdobrar).toEqual([]);
    expect(r.aLancar.map((a) => a.natureza)).toEqual(["Parcela não desdobrada", "Não identificado", "Não identificado"]);
  });

  it("título com o valor exato da parcela casa primeiro (já desdobrado); dois candidatos: o de menor diferença, depois a descrição", () => {
    const l = compra();
    const parcela = titulo("CARTAO NUBANK - TERABYTE PARC 1/6", 499.13);
    const r1 = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [l], titulos: [parcela, titulo("NF", 2994.78)] });
    expect(r1.conciliados.map((c) => c.titulo)).toEqual([parcela]);
    expect(r1.aDesdobrar).toEqual([]);
    const outra = titulo("CARTAO NUBANK - ACADEMIA", 2994.78, { fornecedor: "ACADEMIA" });
    const certa = titulo("CARTAO NUBANK - TERABYTESHOP", 2994.78, { fornecedor: "TERABYTE" });
    const r2 = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [outra, certa] });
    expect(r2.aDesdobrar?.[0].titulo).toBe(certa);
    expect(r2.divergencias.map((d) => d.titulo)).toEqual([outra]);
    const r3 = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [titulo("CARTAO NUBANK - TERABYTE", 2994.83), titulo("NF", 2994.79)] });
    expect(r3.aDesdobrar?.[0].titulo.valorCentavos).toBe(299_479);
  });

  it("duas linhas 1/6 iguais e uma só NF cheia: uma desdobra, a outra fica a lançar", () => {
    const r = conciliar({ ...base, totalInformadoCentavos: 2 * 49_913, linhas: [compra(), compra()], titulos: [titulo("NF", 2994.78)] });
    expect(r.aDesdobrar).toHaveLength(1);
    expect(r.aLancar).toHaveLength(1);
  });

  it("linha justificada à mão não é detectada; antecipação não serve de título cheio", () => {
    const l = compra();
    const justificar: DecisaoItem = { id: "d1", tipo: "justificar", linhas: [l.id], titulos: [], categoria: null, contaFluxo: null, motivo: "x", autor: null, em: "" };
    const r = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [l], titulos: [titulo("NF", 2994.78)], decisoes: [justificar] });
    expect(r.aDesdobrar).toEqual([]);
    expect(r.aLancar[0].justificativa?.id).toBe("d1");
    const r2 = conciliar({ ...base, totalInformadoCentavos: 49_913, linhas: [compra()], titulos: [titulo("NF", 2994.78, { antecipacao: true })] });
    expect(r2.aDesdobrar).toEqual([]);
  });
});

describe("soma de títulos — NF conjunta (regra 5d)", () => {
  const base = { cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-06-27", estabelecimentos: [] };
  it("linha 6/10 paga dois títulos da parcela /6: casa sozinha; a diferença vira arredondamento", () => {
    const l = linha("MERCADOLIVRE*5", 107.61, { parcelaNum: 6, parcelaTotal: 10 });
    const a = titulo("CARTÃO NUBANK 10X - NF CONJUNTA COM TECHMODER", 42.14, { numeroTitulo: "241525/6", codFornecedor: "1" });
    const b = titulo("CARTÃO NUBANK 10X - NF CONJUNTA COM R.B QUEIROZ", 65.48, { numeroTitulo: "8774/6", codFornecedor: "2" });
    const outro = titulo("CARTAO NUBANK - X", 30, { numeroTitulo: "999/1" });
    const r = conciliar({ ...base, totalInformadoCentavos: 10_761, linhas: [l], titulos: [a, b, outro] });
    const c = r.conciliados.find((x) => x.modo === "Soma")!;
    expect([c.titulo, ...(c.titulosExtras ?? [])].map((t) => t.numeroTitulo).sort()).toEqual(["241525/6", "8774/6"]);
    expect(c.diferencaCentavos).toBe(-1);
    expect(r.aLancar).toEqual([]);
    expect(r.divergencias.map((d) => d.titulo.numeroTitulo)).toEqual(["999/1"]);
    expect(r.arredondamentoCentavos).toBe(-1);
  });
  it("parcela diferente da linha não casa sozinha: vira sugestão (trava)", () => {
    const l = linha("MERCADOLIVRE*5", 107.61, { parcelaNum: 6, parcelaTotal: 10 });
    const r = conciliar({ ...base, totalInformadoCentavos: 10_761, linhas: [l], titulos: [titulo("CARTAO NUBANK - A", 42.14, { numeroTitulo: "1/5" }), titulo("CARTAO NUBANK - B", 65.48, { numeroTitulo: "2/6" })] });
    expect(r.conciliados).toEqual([]);
    expect(r.sugestoesSoma?.map((x) => x.titulos.map((t) => t.numeroTitulo))).toEqual([["1/5", "2/6"]]);
    expect(r.aLancar).toHaveLength(1);
  });
  it("à vista: casa com 'CONJUNTA' em todos ou o mesmo fornecedor; sem vínculo é sugestão", () => {
    const l = () => linha("LOJA X", 100);
    const conj = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l()], titulos: [titulo("CARTAO NUBANK - NF CONJUNTA A", 40), titulo("CARTAO NUBANK - NF CONJUNTA B", 60)] });
    expect(conj.conciliados[0]?.modo).toBe("Soma");
    const forn = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l()], titulos: [titulo("CARTAO NUBANK - A", 40, { codFornecedor: "7" }), titulo("CARTAO NUBANK - B", 60, { codFornecedor: "7" })] });
    expect(forn.conciliados[0]?.modo).toBe("Soma");
    const sem = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l()], titulos: [titulo("CARTAO NUBANK - A", 40, { codFornecedor: "7" }), titulo("CARTAO NUBANK - B", 60, { codFornecedor: "8" })] });
    expect(sem.conciliados).toEqual([]);
    expect(sem.sugestoesSoma).toHaveLength(1);
  });
  it("duas combinações vinculadas: não arrisca, vira sugestão", () => {
    const l = linha("LOJA X", 100);
    const ts = [titulo("CARTAO NUBANK - NF CONJUNTA A", 40), titulo("CARTAO NUBANK - NF CONJUNTA B", 60), titulo("CARTAO NUBANK - NF CONJUNTA C", 60)];
    const r = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l], titulos: ts });
    expect(r.conciliados).toEqual([]);
    expect(r.sugestoesSoma).toHaveLength(1);
  });
});

describe("NF lançada pelo total em outro mês (fora da janela)", () => {
  const base = { cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-10-27", estabelecimentos: [] };
  it("linha 3/6 × título cheio em aberto fora da janela: a desdobrar a partir da 3; só a linha pesa no quadro", () => {
    const l = linha("HOTEL", 100, { parcelaNum: 3, parcelaTotal: 6 });
    const nf = titulo("CARTAO NUBANK 6X - HOTEL", 600.02, { vencimento: "2026-08-27" });
    const r = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l], titulos: [], titulosCheiosForaDaJanela: [nf] });
    expect(r.aDesdobrar).toEqual([{ linha: l, titulo: nf, parcelas: 6, parcelaCentavos: 10_000, diferencaCentavos: 2, parcelaInicial: 3, foraDaJanela: true }]);
    expect(r.aLancar).toEqual([]);
    expect(r.totalTitulosCentavos).toBe(0);
    expect(r.desdobrarCentavos).toBe(10_000);
    expect(r.residuoCentavos).toBe(0);
    expect(r.pendentes).toBe(1);
  });
  it("dois candidatos: não arrisca (a linha continua a lançar)", () => {
    const l = linha("HOTEL", 100, { parcelaNum: 3, parcelaTotal: 6 });
    const r = conciliar({ ...base, totalInformadoCentavos: 10_000, linhas: [l], titulos: [], titulosCheiosForaDaJanela: [titulo("CARTAO NUBANK - A", 600), titulo("CARTAO NUBANK - B", 600)] });
    expect(r.aDesdobrar).toEqual([]);
    expect(r.aLancar).toHaveLength(1);
  });
});
