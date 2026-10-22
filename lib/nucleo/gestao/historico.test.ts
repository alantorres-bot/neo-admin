import { describe, expect, it } from "vitest";
import { descreverEvento, type EventoHistorico } from "./historico";

const e = (evento: string, de: string | null, para: string | null, detalhe: string | null = null): EventoHistorico =>
  ({ em: "2026-10-22T12:00:00Z", quem: "Alan", evento, de, para, detalhe });

describe("descreverEvento", () => {
  it("descreve cada mudança em português", () => {
    expect(descreverEvento(e("criada", null, "X", "manual"))).toBe("Criou a tarefa");
    expect(descreverEvento(e("criada", null, "X", "modulo"))).toBe("Pendência publicada pelo módulo");
    expect(descreverEvento(e("status", "aberta", "em_andamento"))).toBe("Situação: Aberta → Em andamento");
    expect(descreverEvento(e("responsavel_id", null, "Karina"))).toBe("Responsável: sem responsável → Karina");
    expect(descreverEvento(e("prazo", "2026-10-22", null))).toBe("Prazo: 22/10/2026 → sem prazo");
    expect(descreverEvento(e("criticidade", "normal", "critica"))).toBe("Prioridade: Normal → Crítica");
    expect(descreverEvento(e("bloqueio_motivo", null, "Sem extrato", "uuid"))).toBe("Bloqueou: Sem extrato (depende de outra pendência)");
    expect(descreverEvento(e("bloqueio_motivo", "Sem extrato", null))).toBe("Desbloqueou");
    expect(descreverEvento(e("aguarda_gestor_motivo", null, "Posso dar 5%?"))).toBe("Pediu decisão do gestor: Posso dar 5%?");
    expect(descreverEvento(e("aguarda_gestor_motivo", "Posso?", null))).toBe("Pedido de decisão encerrado");
    expect(descreverEvento(e("destaque_manual", null, "intervir", "Cliente estratégico"))).toBe('Ajustou o destaque para "Intervir": Cliente estratégico');
    expect(descreverEvento(e("destaque_manual", "intervir", null))).toBe("Retirou o ajuste do destaque");
    expect(descreverEvento(e("precisa_distribuir", "false", "true"))).toBe('Marcou como "precisa distribuir"');
    expect(descreverEvento(e("categoria", null, "conferencia"))).toBe("Categoria: — → Conferência");
    expect(descreverEvento(e("titulo", "a", "b"))).toBe('Título alterado para "b"');
  });

  it("comentários com o tipo", () => {
    expect(descreverEvento(e("comentario:cobranca_gestor", null, "Preciso hoje"))).toBe("Cobrou andamento: Preciso hoje");
    expect(descreverEvento(e("comentario:resposta_gestor", null, "Pode"))).toBe("Respondeu ao pedido de decisão: Pode");
    expect(descreverEvento(e("comentario:cancelamento", null, "Duplicada"))).toBe("Motivo do cancelamento: Duplicada");
    expect(descreverEvento(e("comentario:comentario", null, "Andando"))).toBe("Comentou: Andando");
  });
});
