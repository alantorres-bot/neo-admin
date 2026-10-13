import { describe, expect, it } from "vitest";
import { proximaAcao, situacaoDaNota, textoVencimento, urgenciaDaNota, type KitParaSituacao } from "./estagios";

const kit = (extra: Partial<KitParaSituacao> = {}): KitParaSituacao => ({
  estagio: "recebida", notas: 1, demonstrativos: 0, cartas: 0, exigeCarta: false, parcelas: 0, boletos: 0, notaEnviada: false, ...extra,
});

describe("situacaoDaNota", () => {
  it("1 Falta demonstrativo, com a implantação correndo em paralelo para Cuiabá", () => {
    expect(situacaoDaNota(kit())).toEqual({ estagio: "falta_demonstrativo", tarefas: { filial: ["Anexar demonstrativo"], cuiaba: ["Implantar"] } });
    // implantada e com boleto, mas sem demonstrativo: continua faltando demonstrativo
    expect(situacaoDaNota(kit({ estagio: "pronta", parcelas: 1, boletos: 1 })).estagio).toBe("falta_demonstrativo");
  });
  it("2 A implantar · 3 Aguardando boleto · 4 Pronta", () => {
    expect(situacaoDaNota(kit({ demonstrativos: 1 }))).toEqual({ estagio: "a_implantar", tarefas: { filial: [], cuiaba: ["Implantar"] } });
    expect(situacaoDaNota(kit({ demonstrativos: 2, estagio: "implantada", parcelas: 1 })))
      .toEqual({ estagio: "aguardando_boleto", tarefas: { filial: [], cuiaba: ["Anexar boleto"] } });
    expect(situacaoDaNota(kit({ demonstrativos: 1, estagio: "pronta", parcelas: 1, boletos: 1 })))
      .toEqual({ estagio: "pronta", tarefas: { filial: ["Enviar ao cliente"], cuiaba: [] } });
  });
  it("carta de cessão exigida faltando fica com Cuiabá", () => {
    const s = situacaoDaNota(kit({ demonstrativos: 1, estagio: "implantada", parcelas: 1, boletos: 1, exigeCarta: true }));
    expect(s).toEqual({ estagio: "aguardando_boleto", tarefas: { filial: [], cuiaba: ["Anexar carta de cessão"] } });
  });
  it("5 e 6: exceção da nota enviada antes do boleto", () => {
    expect(situacaoDaNota(kit({ demonstrativos: 1, estagio: "implantada", parcelas: 1, notaEnviada: true })).estagio).toBe("nota_enviada");
    expect(situacaoDaNota(kit({ demonstrativos: 1, estagio: "pronta", parcelas: 1, boletos: 1, notaEnviada: true })))
      .toEqual({ estagio: "boleto_a_enviar", tarefas: { filial: ["Enviar boleto"], cuiaba: [] } });
  });
  it("7 Enviada e 8 Cancelada sem tarefas", () => {
    expect(situacaoDaNota(kit({ estagio: "enviada" }))).toEqual({ estagio: "enviada", tarefas: { filial: [], cuiaba: [] } });
    expect(situacaoDaNota(kit({ estagio: "cancelada" })).estagio).toBe("cancelada");
  });
  it("nota fatura faltando é tarefa da filial", () => {
    expect(situacaoDaNota(kit({ notas: 0, demonstrativos: 1 })).tarefas.filial).toEqual(["Anexar nota fatura"]);
  });
});

describe("urgência pelo vencimento", () => {
  const H = "2026-10-13";
  it("faixas", () => {
    expect(urgenciaDaNota("a_implantar", "2026-10-12", H)).toBe("atrasada");
    expect(urgenciaDaNota("a_implantar", "2026-10-18", H)).toBe("critica");
    expect(urgenciaDaNota("a_implantar", "2026-10-23", H)).toBe("atencao");
    expect(urgenciaDaNota("a_implantar", "2026-10-24", H)).toBe("normal");
    expect(urgenciaDaNota("a_implantar", null, H)).toBe("sem_data");
    expect(urgenciaDaNota("enviada", "2026-10-12", H)).toBeNull();
  });
  it("texto do vencimento", () => {
    expect(textoVencimento("2026-10-11", H)).toBe("venceu há 2 dias");
    expect(textoVencimento("2026-10-12", H)).toBe("venceu há 1 dia");
    expect(textoVencimento("2026-10-13", H)).toBe("vence hoje");
    expect(textoVencimento("2026-10-14", H)).toBe("amanhã");
    expect(textoVencimento("2026-10-21", H)).toBe("em 8 dias");
  });
});

describe("proximaAcao", () => {
  it("cada lado vê a sua tarefa; sem tarefa, quem está com a vez", () => {
    const s = situacaoDaNota(kit()); // falta demonstrativo + implantar
    expect(proximaAcao(s, "filial", "normal")).toEqual({ rotulo: "Anexar demonstrativo", minha: true });
    expect(proximaAcao(s, "cuiaba", "normal")).toEqual({ rotulo: "Implantar", minha: true });
    const aguardando = situacaoDaNota(kit({ demonstrativos: 1, estagio: "implantada", parcelas: 1 }));
    expect(proximaAcao(aguardando, "filial", "normal")).toEqual({ rotulo: "Aguardando Cuiabá", minha: false });
    const pronta = situacaoDaNota(kit({ demonstrativos: 1, estagio: "pronta", parcelas: 1, boletos: 1 }));
    expect(proximaAcao(pronta, "cuiaba", "normal")).toEqual({ rotulo: "Aguardando filial", minha: false });
  });
  it("filial: NF crítica ou atrasada parada com Cuiabá vira 'Cobrar boleto de Cuiabá'", () => {
    const s = situacaoDaNota(kit({ demonstrativos: 1, estagio: "implantada", parcelas: 1 }));
    expect(proximaAcao(s, "filial", "critica")).toEqual({ rotulo: "Cobrar boleto de Cuiabá", minha: true });
    expect(proximaAcao(s, "filial", "atrasada").rotulo).toBe("Cobrar boleto de Cuiabá");
    expect(proximaAcao(s, "filial", "atencao").rotulo).toBe("Aguardando Cuiabá");
  });
  it("enviada: Ver", () => {
    expect(proximaAcao(situacaoDaNota(kit({ estagio: "enviada" })), "filial", null)).toEqual({ rotulo: "Ver", minha: false });
  });
});
