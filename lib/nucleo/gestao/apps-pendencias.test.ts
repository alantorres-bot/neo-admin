import { describe, expect, it } from "vitest";
import { lerResposta, montarPendencias } from "@/supabase/functions/_shared/apps-pendencias";

const resposta = {
  versao: 1,
  geradoEm: "2026-10-23T15:00:00Z",
  tipos: [
    { codigo: "nf_entrada", titulo: "NF de entrada com pendência", quantidade: 14,
      detalhe: [{ rotulo: "vencidas", quantidade: 3 }, { rotulo: "aguardando o contador", quantidade: 2 }],
      prazo: "2026-10-22", maisAntiga: "2026-10-18", caminho: "/pendencias" },
    { codigo: "nfse", titulo: "NFS-e tomadas pedindo ação", quantidade: 4, detalhe: [], prazo: null, maisAntiga: null, caminho: "/nfse" },
    { codigo: "nf_saida", titulo: "NF de saída com pendência", quantidade: 0, detalhe: [], prazo: null, maisAntiga: null, caminho: "/pendencias-saida" },
  ],
};

describe("lerResposta", () => {
  it("aceita a resposta versão 1 e limpa caminho e detalhe inválidos", () => {
    const r = lerResposta({ ...resposta, tipos: [{ ...resposta.tipos[1], caminho: "//mal.com", detalhe: [{ rotulo: "x", quantidade: 0 }] }] });
    expect(r).toEqual({ ok: true, tipos: [{ codigo: "nfse", titulo: "NFS-e tomadas pedindo ação", quantidade: 4, detalhe: [], prazo: null, maisAntiga: null, caminho: null }] });
  });

  it("recusa a leitura inteira se um tipo vier malformado ou repetido (nada se encerra por engano)", () => {
    expect(lerResposta({ versao: 2, tipos: [] }).ok).toBe(false);
    expect(lerResposta({ versao: 1 }).ok).toBe(false);
    expect(lerResposta({ versao: 1, tipos: [{ codigo: "nf", titulo: "x", quantidade: -1 }] }).ok).toBe(false);
    expect(lerResposta({ versao: 1, tipos: [{ codigo: "Nf Entrada", titulo: "x", quantidade: 1 }] }).ok).toBe(false);
    expect(lerResposta({ versao: 1, tipos: [resposta.tipos[1], resposta.tipos[1]] }).ok).toBe(false);
  });
});

describe("montarPendencias", () => {
  const lido = lerResposta(resposta);
  if (!lido.ok) throw new Error("resposta de teste inválida");
  const app = { codigo: "vigilancia_fiscal", nome: "Vigilância Fiscal", responsaveis: { nf_entrada: "11111111-1111-1111-1111-111111111111" } };

  it("uma por tipo com quantidade, título com o detalhe, link na tela do app e prazo vencido = alta", () => {
    const [nf, nfse, ...resto] = montarPendencias(app, lido.tipos, "2026-10-23");
    expect(resto).toEqual([]); // o tipo zerado fica de fora: a publicação o encerra
    expect(nf).toEqual({
      chave_origem: "app:vigilancia_fiscal:nf_entrada",
      titulo: "Vigilância Fiscal — NF de entrada com pendência: 14 (3 vencidas, 2 aguardando o contador)",
      descricao: "A mais antiga está aberta desde 18/10/2026. Resolva no próprio aplicativo; a contagem é atualizada a cada 30 minutos.",
      prazo: "2026-10-22", prioridade: "alta",
      responsavel_id: "11111111-1111-1111-1111-111111111111", precisa_distribuir: false,
      link: "/apps/vigilancia_fiscal?tela=/pendencias",
    });
    expect(nfse).toMatchObject({ titulo: "Vigilância Fiscal — NFS-e tomadas pedindo ação: 4", prazo: null, prioridade: "normal", responsavel_id: null, precisa_distribuir: true });
  });

  it("prazo de hoje ainda não é alta", () => {
    expect(montarPendencias(app, lido.tipos, "2026-10-22")[0].prioridade).toBe("normal");
  });
});
