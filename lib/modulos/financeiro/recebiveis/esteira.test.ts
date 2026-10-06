import { describe, expect, it } from "vitest";
import { montarEsteira, type InteracaoEsteira, type TituloEsteira } from "./esteira";

const HOJE = "2026-10-20";
const base = (extra: Partial<TituloEsteira> = {}): TituloEsteira => ({
  estagio: "boleto_enviado", vencimento: "2026-11-10", boletoAnexado: true, boletoEnviadoEm: "2026-10-18T14:00:00Z", dataPagamento: null,
  reguaPausadaAte: null, reguaAplica: true, ...extra,
});
const i = (tipo: string, criado_em: string, descricao: string | null = null): InteracaoEsteira => ({ tipo, criado_em, descricao });
const estados = (e: ReturnType<typeof montarEsteira>) => Object.fromEntries(e.map((x) => [x.chave, x.estado]));

describe("montarEsteira", () => {
  it("título novo aguardando boleto: o boleto é o passo atual", () => {
    const e = montarEsteira(base({ estagio: "aguardando_boleto", boletoAnexado: false, boletoEnviadoEm: null }), [], HOJE);
    expect(estados(e)).toMatchObject({ boleto: "atual", envio: "pendente", confirmacao: "pendente", vencimento: "pendente", pago: "pendente" });
    expect(e[0].detalhe).toBe("falta anexar o PDF");
  });

  it("boleto anexado e ainda não enviado: o envio é o passo atual", () => {
    const e = montarEsteira(base({ estagio: "aguardando_boleto", boletoEnviadoEm: null }), [], HOJE);
    expect(estados(e)).toMatchObject({ boleto: "feita", envio: "atual" });
    expect(e[1].detalhe).toBe("falta registrar o envio");
  });

  it("boleto enviado e vencimento longe: confirmação pendente com a data em que abre", () => {
    const e = montarEsteira(base(), [i("boleto_enviado", "2026-10-18T14:00:00Z")], HOJE);
    expect(estados(e)).toMatchObject({ boleto: "feita", envio: "feita", confirmacao: "pendente" });
    expect(e.find((x) => x.chave === "confirmacao")!.detalhe).toBe("a partir de 03/11");
    expect(e.find((x) => x.chave === "envio")!.quando).toBe("2026-10-18T14:00:00Z");
  });

  it("dentro da janela de 7 dias: confirmação é o passo atual, com o prazo (vencimento − 4 dias)", () => {
    const e = montarEsteira(base({ vencimento: "2026-10-25" }), [], HOJE);
    const c = e.find((x) => x.chave === "confirmacao")!;
    expect(c.estado).toBe("atual");
    expect(c.detalhe).toBe("contatar até 21/10");
  });

  it("sem resposta: continua atual, agora pedindo a ligação", () => {
    const e = montarEsteira(base({ vencimento: "2026-10-25" }), [i("sem_resposta_confirmacao", "2026-10-19T10:00:00Z")], HOJE);
    expect(e.find((x) => x.chave === "confirmacao")!.detalhe).toBe("sem resposta em 19/10; ligar");
  });

  it("cliente confirmou: feita, com a data", () => {
    const e = montarEsteira(base({ estagio: "confirmado_cliente", vencimento: "2026-10-25" }), [i("confirmacao", "2026-10-19T10:00:00Z")], HOJE);
    expect(e.find((x) => x.chave === "confirmacao")).toMatchObject({ estado: "feita", quando: "2026-10-19T10:00:00Z", detalhe: "cliente confirmou" });
  });

  it("vencido há 7 dias na régua: D+1 na vez se não feita, D+5 na vez, D+10 pendente com a data", () => {
    const e = montarEsteira(base({ estagio: "vencido", vencimento: "2026-10-13" }), [], HOJE);
    expect(estados(e)).toMatchObject({ vencimento: "feita", d1: "atual", d5: "atual", d10: "pendente", confirmacao: "fora" });
    expect(e.find((x) => x.chave === "d10")!.detalhe).toBe("a partir de 23/10");
    expect(e.find((x) => x.chave === "vencimento")!.detalhe).toBe("7 dias de atraso");
  });

  it("cobrança registrada marca o marco como feita (e promessa e contestação também contam)", () => {
    const e = montarEsteira(base({ estagio: "vencido", vencimento: "2026-10-13" }), [
      i("cobranca", "2026-10-14T10:00:00Z", "Cobrança D+1 enviada por WhatsApp."),
      i("contestacao", "2026-10-18T10:00:00Z", "Cobrança D+5: o cliente contestou a cobrança (por e-mail)."),
    ], HOJE);
    expect(estados(e)).toMatchObject({ d1: "feita", d5: "feita", d10: "pendente" });
    expect(e.find((x) => x.chave === "d5")!.detalhe).toBe("cliente contestou");
  });

  it("promessa em vigor aparece como passo atual e pausa a régua", () => {
    const e = montarEsteira(base({ estagio: "promessa", vencimento: "2026-10-19", reguaPausadaAte: "2026-10-27" }), [i("promessa", "2026-10-20T09:00:00Z", "Cobrança D+1: o cliente prometeu pagar em 27/10/2026 (por telefone).")], HOJE);
    expect(estados(e)).toMatchObject({ d1: "feita", promessa: "atual" });
    expect(e.find((x) => x.chave === "promessa")!.detalhe).toBe("régua pausada até 27/10/2026");
  });

  it("fora da régua (vencimento antes do corte): as cobranças ficam como 'fora'", () => {
    const e = montarEsteira(base({ estagio: "vencido", vencimento: "2026-09-01", reguaAplica: false }), [], HOJE);
    expect(estados(e)).toMatchObject({ d1: "fora", d5: "fora", d10: "fora" });
    expect(e.find((x) => x.chave === "d1")!.detalhe).toBe("fora da régua");
  });

  it("pago: tudo encerrado, com a data do pagamento", () => {
    const e = montarEsteira(base({ estagio: "pago", vencimento: "2026-10-10", dataPagamento: "2026-10-12" }), [], HOJE);
    const ultimo = e[e.length - 1];
    expect(ultimo).toMatchObject({ chave: "pago", rotulo: "Pago", estado: "feita", quando: "2026-10-12" });
    expect(estados(e)).toMatchObject({ d1: "fora", d5: "fora", d10: "fora" });
  });

  it("título anterior à esteira (sem anexo nem registro de envio): passos marcados como não registrados", () => {
    const e = montarEsteira(base({ estagio: "importado", boletoAnexado: false, boletoEnviadoEm: null }), [], HOJE);
    expect(estados(e)).toMatchObject({ boleto: "fora", envio: "fora" });
    expect(e[0].detalhe).toBe("não registrado no sistema");
  });
});
