import { describe, expect, it } from "vitest";
import { aposFalha, destinoDoAviso, mensagemSlack, prioridadeClickup, tarefaClickup } from "../../../supabase/functions/_shared/notificacoes";

describe("avisos (Slack)", () => {
  it("destino: DM da pessoa ou canal da gestão; sem destino, ignora com o motivo", () => {
    expect(destinoDoAviso({ destinatario_id: "u1" }, "U0123ABCD", "C0123")).toEqual({ destino: "U0123ABCD" });
    expect(destinoDoAviso({ destinatario_id: "u1" }, null, "C0123")).toEqual({ ignorar: expect.stringContaining("sem usuário do Slack") });
    expect(destinoDoAviso({ destinatario_id: null }, null, "C0123")).toEqual({ destino: "C0123" });
    expect(destinoDoAviso({ destinatario_id: null }, null, null)).toEqual({ ignorar: expect.stringContaining("Canal da gestão") });
  });
  it("mensagem com link absoluto para o Neo Admin", () => {
    expect(mensagemSlack({ texto: "Vence hoje", link: "/gestao/abc" }, "https://neo.exemplo/")).toBe("Vence hoje\n<https://neo.exemplo/gestao/abc|Abrir no Neo Admin>");
    expect(mensagemSlack({ texto: "Resumo", link: null }, "https://neo.exemplo")).toBe("Resumo");
  });

  it("texto digitado não vira menção geral nem link falso no Slack", () => {
    expect(mensagemSlack({ texto: "Pedido: <!channel> <https://falso.exemplo|Abrir no Neo Admin> & cia", link: null }, ""))
      .toBe("Pedido: &lt;!channel&gt; &lt;https://falso.exemplo|Abrir no Neo Admin&gt; &amp; cia");
  });
  it("tenta de novo até 3 vezes", () => {
    expect(aposFalha(0)).toEqual({ status: "pendente", tentativas: 1 });
    expect(aposFalha(2)).toEqual({ status: "falhou", tentativas: 3 });
  });
});

describe("ClickUp", () => {
  it("prioridade e corpo da tarefa, com o link da pendência e o prazo ao meio-dia de Cuiabá", () => {
    expect(prioridadeClickup("critica")).toBe(1);
    expect(prioridadeClickup("normal")).toBe(3);
    const t = tarefaClickup({ id: "p1", titulo: "Implementar sugestão nº 2", descricao: "Ler o OFX", prazo: "2026-10-30", criticidade: "alta" }, "https://neo.exemplo");
    expect(t).toMatchObject({ name: "Implementar sugestão nº 2", priority: 2, due_date: Date.parse("2026-10-30T16:00:00Z"), due_date_time: false });
    expect(t.description).toContain("https://neo.exemplo/gestao/p1");
    expect(t.description).toContain("não alteram a pendência");
    expect(tarefaClickup({ id: "p2", titulo: "X", descricao: null, prazo: null, criticidade: "normal" }, "https://neo.exemplo").due_date).toBeUndefined();
  });
});
