// Comparação da assinatura do GED (scripts/ged-conferir-assinaturas.mjs): repositório x banco instalado.
import { describe, expect, it } from "vitest";
import { compararAssinaturas } from "../../scripts/ged-conferir-assinaturas.mjs";

const f = (nome: string, o: Record<string, unknown> = {}) => ({ nome, args: "", security_definer: true, corpo_md5: "a", anon: false, authenticated: false, service_role: true, ...o });
const base = { funcoes: [f("ged_x"), f("ged_y")], tabelas: [{ tabela: "ged_t", rls: true }], politicas: [{ tabela: "ged_t", politica: "ler", comando: "SELECT", papeis: ["authenticated"] }] };
type Linha = { item: string; situacao: string; campos?: string[] };

describe("compararAssinaturas", () => {
  it("igual: tudo OK", () => {
    expect(compararAssinaturas(base, structuredClone(base)).every((l: Linha) => l.situacao === "OK")).toBe(true);
  });

  it("corpo diferente, privilégio a mais, função ausente, função só no banco, RLS desligada e política faltando são apontados", () => {
    const banco = {
      funcoes: [f("ged_x", { corpo_md5: "b", authenticated: true }), f("ged_z")],
      tabelas: [{ tabela: "ged_t", rls: false }],
      politicas: [],
    };
    expect(compararAssinaturas(base, banco).map((l: Linha) => [l.item, l.situacao, l.campos ?? []])).toEqual([
      ["ged_x()", "DIVERGENTE", ["corpo_md5", "authenticated"]],
      ["ged_y()", "AUSENTE", []],
      ["ged_z()", "SO_NO_BANCO", []],
      ["ged_t", "DIVERGENTE", ["rls"]],
      ["ged_t.ler", "AUSENTE", []],
    ]);
  });
});
