import { describe, expect, it } from "vitest";
import { lerResposta, planejar, type RegraGravada } from "@/supabase/functions/_shared/regras-cartao";
import { regraVigente, type RegraCartao } from "./cartoes";
import { CARTOES_TESTE } from "./cartoes.test";
import { causaDivergencia, cartaoDivergente } from "./conciliacao";
import { selecionarTitulos, type LancamentoEspelho } from "./selecao-titulos";

const REGRAS: RegraCartao[] = [
  { codFornecedor: "622", cartao: "INTER PJ", parcelasPadrao: 1, vigenciaIni: "2026-01-01", vigenciaFim: "2026-09-30" },
  { codFornecedor: "622", cartao: "SICREDI PF", parcelasPadrao: 1, vigenciaIni: "2026-10-01", vigenciaFim: null },
  { codFornecedor: "544", cartao: "ITAU PJ", parcelasPadrao: 3, vigenciaIni: "2026-03-01", vigenciaFim: null },
];
const SICREDI_PF = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;

describe("regraVigente", () => {
  it("vale a regra da data; troca de cartão pela vigência; sem fornecedor ou data, nenhuma", () => {
    expect(regraVigente(REGRAS, "622", "2026-09-30")?.cartao).toBe("INTER PJ");
    expect(regraVigente(REGRAS, "622", "2026-10-01")?.cartao).toBe("SICREDI PF");
    expect(regraVigente(REGRAS, "622", "2025-12-31")).toBeUndefined();
    expect(regraVigente(REGRAS, null, "2026-10-01")).toBeUndefined();
  });
});

describe("seleção com a regra do Neo Fiscal", () => {
  let n = 0;
  const lanc = (complemento: string, valor: number, cod: string | null, emissao: string, extra: Partial<LancamentoEspelho> = {}): LancamentoEspelho => ({
    id: `r${++n}`, cod_lancamento: String(n), num_documento: `${n}/1`, cod_fornecedor: cod, fornecedor_nome: `F${cod}`, complemento_historico: complemento,
    categoria_doc: null, data_vencimento: "2026-10-10", data_emissao: emissao, valor_documento: valor, valor_atualizado: valor, baixado_em: null, ...extra,
  });
  it("título sem a marca do cartão entra pela regra; título que cita outro cartão mas tem regra deste vira candidato forte; regra de outro cartão marca divergência", () => {
    const r = selecionarTitulos([
      lanc("PECAS MANUTENCAO", 300, "622", "2026-10-02"),                 // sem marca, regra = SICREDI PF → entra porRegra
      lanc("PECAS MANUTENCAO", 50, "622", "2026-09-20"),                  // sem marca, na data a regra era INTER PJ → fora
      lanc("CARTAO INTER - PECAS", 70, "622", "2026-10-03"),              // cita Inter (vence 10 → PJ), regra = SICREDI PF → outros com aviso
      lanc("CARTÃO SICREDI 3 X;- MATERIA", 900, "544", "2026-10-01"),      // cita Sicredi, regra = ITAU PJ → entra, com cartaoDaRegra ITAU PJ
    ], SICREDI_PF, CARTOES_TESTE, "2026-10-10", { regras: REGRAS });
    expect(r.doCartao.map((t) => [t.complemento, t.porRegra ?? false, t.cartaoDaRegra])).toEqual([
      ["CARTÃO SICREDI 3 X;- MATERIA", false, "ITAU PJ"], ["PECAS MANUTENCAO", true, "SICREDI PF"],
    ]);
    expect(r.outros.map((o) => o.detalhe)).toEqual(["Cita o cartão INTER PJ, mas a regra do fornecedor no Neo Fiscal é SICREDI PF: provável cartão trocado"]);
    const [comRegraDeOutro, porRegra] = r.doCartao;
    expect(cartaoDivergente(comRegraDeOutro, SICREDI_PF, CARTOES_TESTE)).toBe(true);
    expect(causaDivergencia(comRegraDeOutro, SICREDI_PF, CARTOES_TESTE, "2026-10-10", r.doCartao)).toMatch(/regra do fornecedor no Neo Fiscal é o cartão ITAU PJ/);
    expect(causaDivergencia(porRegra, SICREDI_PF, CARTOES_TESTE, "2026-10-10", r.doCartao)).toMatch(/pela regra do Neo Fiscal/);
  });
  it("sem regras, tudo como antes (compatível com a chamada antiga)", () => {
    const l = [lanc("PECAS MANUTENCAO", 300, "622", "2026-10-02"), lanc("CARTÃO SICREDI 1x — X", 10, "1", "2026-10-02")];
    expect(selecionarTitulos(l, SICREDI_PF, CARTOES_TESTE, "2026-10-10").doCartao).toHaveLength(1);
    expect(selecionarTitulos(l, SICREDI_PF, CARTOES_TESTE, "2026-10-10", 5, null).doCartao).toHaveLength(1);
  });
});

describe("sincronização das regras (espelho)", () => {
  it("valida a resposta do Neo Fiscal", () => {
    expect(lerResposta({ erro: "Não autorizado." })).toEqual({ ok: false, erro: "Neo Fiscal: Não autorizado." });
    expect(lerResposta({ versao: 2, regras: [] }).ok).toBe(false);
    expect(lerResposta({ versao: 1, regras: [{ codFornecedor: 622, cartao: "X", vigenciaIni: "01/10/2026", vigenciaFim: null }] }).ok).toBe(false);
    const ok = lerResposta({ versao: 1, regras: [{ codFornecedor: 622, cartao: "SICREDI PF", parcelasPadrao: 0, vigenciaIni: "2026-10-01", vigenciaFim: null }] });
    expect(ok).toEqual({ ok: true, regras: [{ codFornecedor: "622", cartao: "SICREDI PF", parcelasPadrao: 1, vigenciaIni: "2026-10-01", vigenciaFim: null }] });
  });
  it("planeja inserir, atualizar (vigência encerrada lá) e remover o que sumiu", () => {
    const gravadas: RegraGravada[] = [
      { id: "a", cod_fornecedor: "622", cartao: "INTER PJ", parcelas_padrao: 1, vigencia_ini: "2026-01-01", vigencia_fim: null },
      { id: "b", cod_fornecedor: "999", cartao: "NUBANK PF", parcelas_padrao: 1, vigencia_ini: "2026-05-01", vigencia_fim: null },
    ];
    const recebidas = [
      { codFornecedor: "622", cartao: "INTER PJ", parcelasPadrao: 1, vigenciaIni: "2026-01-01", vigenciaFim: "2026-09-30" },
      { codFornecedor: "622", cartao: "SICREDI PF", parcelasPadrao: 1, vigenciaIni: "2026-10-01", vigenciaFim: null },
    ];
    expect(planejar(recebidas, gravadas)).toEqual({
      inserir: [{ cod_fornecedor: "622", cartao: "SICREDI PF", parcelas_padrao: 1, vigencia_ini: "2026-10-01", vigencia_fim: null }],
      atualizar: [{ id: "a", campos: { vigencia_fim: "2026-09-30" } }],
      remover: ["b"],
    });
  });
});
