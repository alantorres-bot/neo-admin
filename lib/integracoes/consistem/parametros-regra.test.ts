import { describe, expect, it } from "vitest";
import {
  CHAVE_ULTIMA_ALTERACAO_REGRA, CHAVES_REGRA, lerParametrosRegra, lerUltimaAlteracaoRegra, PARAMETROS_PADRAO,
} from "../../../supabase/functions/_shared/parametros-regra";
import { DIAS_CONTATO_ANTES, DIAS_JANELA_CONFIRMACAO, MINIMO_PADRAO_CENTAVOS, planejarConfirmacoes, prazoConfirmacao, type TituloConfirmacao } from "../../../supabase/functions/_shared/confirmacao";
import { DIAS_JANELA_ANEXAR_BOLETO, dentroDaJanelaDoBoleto } from "../../../supabase/functions/_shared/consistem-receber";
import { TRAVA_PENDENCIAS_COBRANCA } from "../../../supabase/functions/_shared/cobranca";
import { filaDaParcela } from "../../modulos/financeiro/recebiveis/tarefas";
import { montarEsteira } from "../../modulos/financeiro/recebiveis/esteira";

const linhas = (o: Record<string, unknown>) => Object.entries(o).map(([chave, valor]) => ({ chave, valor }));

describe("padrões", () => {
  it("são os valores que estavam cravados no código (nada muda até alguém editar)", () => {
    expect(PARAMETROS_PADRAO.janelaBoletoDias).toBe(DIAS_JANELA_ANEXAR_BOLETO);
    expect(PARAMETROS_PADRAO.janelaConfirmacaoDias).toBe(DIAS_JANELA_CONFIRMACAO);
    expect(PARAMETROS_PADRAO.prazoContatoAntesDias).toBe(DIAS_CONTATO_ANTES);
    expect(PARAMETROS_PADRAO.minimoConfirmacaoCentavos).toBe(MINIMO_PADRAO_CENTAVOS);
    expect(PARAMETROS_PADRAO.travaPendenciasCobranca).toBe(TRAVA_PENDENCIAS_COBRANCA);
  });

  it("sem linhas, vale o padrão (régua e esteira desligadas sem data)", () => {
    expect(lerParametrosRegra([])).toEqual(PARAMETROS_PADRAO);
    expect(lerParametrosRegra(null)).toEqual(PARAMETROS_PADRAO);
  });
});

describe("lerParametrosRegra", () => {
  it("lê os valores gravados", () => {
    const p = lerParametrosRegra(linhas({
      [CHAVES_REGRA.esteira]: "2026-10-06", [CHAVES_REGRA.regua]: "2026-11-01", [CHAVES_REGRA.minimo]: 10000,
      [CHAVES_REGRA.janelaBoleto]: 45, [CHAVES_REGRA.janelaConfirmacao]: 10, [CHAVES_REGRA.prazoContato]: 2, [CHAVES_REGRA.trava]: 80,
    }));
    expect(p).toEqual({
      esteiraAPartirDe: "2026-10-06", reguaAPartirDe: "2026-11-01", minimoConfirmacaoCentavos: 1_000_000,
      janelaBoletoDias: 45, janelaConfirmacaoDias: 10, prazoContatoAntesDias: 2, travaPendenciasCobranca: 80,
    });
  });

  it("aceita número em texto (o jsonb pode vir como string) e cai no padrão se inválido", () => {
    expect(lerParametrosRegra(linhas({ [CHAVES_REGRA.minimo]: "25000", [CHAVES_REGRA.janelaBoleto]: "20" })).janelaBoletoDias).toBe(20);
    const ruim = lerParametrosRegra(linhas({
      [CHAVES_REGRA.minimo]: -5, [CHAVES_REGRA.janelaBoleto]: 0, [CHAVES_REGRA.janelaConfirmacao]: 99, [CHAVES_REGRA.prazoContato]: 1.5,
      [CHAVES_REGRA.trava]: "abc", [CHAVES_REGRA.regua]: "01/11/2026", [CHAVES_REGRA.esteira]: "2026-02-31",
    }));
    expect(ruim).toEqual(PARAMETROS_PADRAO);
  });

  it("prazo de contato zero é válido (contatar no dia do vencimento)", () => {
    expect(lerParametrosRegra(linhas({ [CHAVES_REGRA.prazoContato]: 0 })).prazoContatoAntesDias).toBe(0);
  });

  it("lê a última alteração", () => {
    expect(lerUltimaAlteracaoRegra(linhas({ [CHAVE_ULTIMA_ALTERACAO_REGRA]: { por: "Ana", em: "2026-10-08T12:00:00Z" } }))).toEqual({ por: "Ana", em: "2026-10-08T12:00:00Z" });
    expect(lerUltimaAlteracaoRegra([])).toBeNull();
    expect(lerUltimaAlteracaoRegra(linhas({ [CHAVE_ULTIMA_ALTERACAO_REGRA]: "x" }))).toBeNull();
  });
});

describe("as regras mudam conforme os parâmetros", () => {
  it("janela do boleto: 30 → 45 dias", () => {
    expect(dentroDaJanelaDoBoleto("2026-11-20", "2026-10-08")).toBe(false); // 43 dias
    expect(dentroDaJanelaDoBoleto("2026-11-20", "2026-10-08", 45)).toBe(true);
    const parcela = { estagio: "aguardando_boleto", forma: "boleto", temBoleto: false, vencimento: "2026-11-20", hoje: "2026-10-08" };
    expect(filaDaParcela(parcela)).toBeNull();
    expect(filaDaParcela({ ...parcela, janelaBoletoDias: 45 })).toBe("anexar");
  });

  it("prazo de confirmação: vencimento menos 4 → menos 2", () => {
    expect(prazoConfirmacao("2026-10-20", "2026-10-08")).toBe("2026-10-16");
    expect(prazoConfirmacao("2026-10-20", "2026-10-08", 2)).toBe("2026-10-18");
    expect(prazoConfirmacao("2026-10-09", "2026-10-08", 4)).toBe("2026-10-08"); // já passou: hoje
  });

  it("janela de confirmação: 7 → 10 dias", () => {
    const t: TituloConfirmacao = { id: "1", contraparteId: "c", nomeCliente: "Cliente", documento: "10", parcela: "1", vencimento: "2026-10-18", valorCentavos: 30_000_00, estagio: "importado" };
    expect(planejarConfirmacoes([t], "2026-10-08", MINIMO_PADRAO_CENTAVOS)).toHaveLength(0); // 10 dias
    expect(planejarConfirmacoes([t], "2026-10-08", MINIMO_PADRAO_CENTAVOS, 10)).toHaveLength(1);
  });

  it("esteira do título usa a janela e o prazo da regra", () => {
    const t = { estagio: "importado", vencimento: "2026-10-16", boletoAnexado: false, boletoEnviadoEm: null, dataPagamento: null, reguaPausadaAte: null, reguaAplica: false, forma: "boleto" as const };
    const conf = (regra?: { janelaConfirmacaoDias: number; prazoContatoAntesDias: number }) =>
      montarEsteira(t, [], "2026-10-08", regra).find((e) => e.chave === "confirmacao")!;
    expect(conf().estado).toBe("pendente"); // 8 dias: fora da janela de 7
    expect(conf({ janelaConfirmacaoDias: 10, prazoContatoAntesDias: 3 }).estado).toBe("atual");
    expect(conf({ janelaConfirmacaoDias: 10, prazoContatoAntesDias: 3 }).detalhe).toContain("13/10");
  });
});
