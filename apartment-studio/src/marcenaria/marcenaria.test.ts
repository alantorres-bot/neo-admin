import { describe, expect, it } from "vitest";
import { criarProjetoBase } from "../modelo/projetoBase";
import { alturasDasGavetas } from "./cozinha";
import { FOLGA_CORREDICA } from "./construtor";
import { CLASSES_DE_CORTE, FERRAGENS, LOTES, criarMarcenaria, ehPecaDeCorte, listaDePecas, resumoDeFerragens, resumoDeFitas, resumoDeMateriais, todasAsPecas } from "./projeto";
import { caixaDoMovel, movelDoProjeto } from "./quadros";
import type { Caixa3, Solido } from "./tipos";

const mc = criarMarcenaria();
const mod = (cod: string) => mc.modulos.find((m) => m.cod === cod)!;
const volumeComum = (a: Caixa3, b: Caixa3) =>
  Math.max(0, Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0)) * Math.max(0, Math.min(a.d1, b.d1) - Math.max(a.d0, b.d0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const uniao = (cs: Caixa3[]): Caixa3 => ({
  s0: Math.min(...cs.map((c) => c.s0)),
  s1: Math.max(...cs.map((c) => c.s1)),
  d0: Math.min(...cs.map((c) => c.d0)),
  d1: Math.max(...cs.map((c) => c.d1)),
  z0: Math.min(...cs.map((c) => c.z0)),
  z1: Math.max(...cs.map((c) => c.z1)),
});

describe("quadros de referência", () => {
  it("usam as cotas da planta", () => {
    expect(mc.quadros["coz-a"].comprimento).toBe(3870); // cota 3,87
    expect(mc.quadros["sui-a"].comprimento).toBe(3920); // cota 3,92
    expect(mc.quadros["sui-b"].comprimento).toBe(2510); // cota 2,51
    expect(mc.quadros["coz-b"].comprimento).toBe(1280); // 1,50 − shaft estimado de 22
  });
});

describe("os módulos correspondem ao modelo 3D", () => {
  it("cada módulo tem a envoltória dos móveis que executa", () => {
    for (const m of mc.modulos) {
      if (!m.movelIds.length) continue;
      const esperado = uniao(m.movelIds.map((id) => caixaDoMovel(movelDoProjeto(mc.projeto, id), mc.quadros[m.conjunto as "coz-a"])));
      expect(m.caixa, m.cod).toEqual(esperado);
    }
  });

  it("toda a marcenaria sob medida da cozinha e da suíte está no caderno", () => {
    const cobertos = new Set(mc.modulos.flatMap((m) => m.movelIds));
    const fora = mc.projeto.moveis.filter((m) => (m.grupo === "cozinha" || m.grupo === "suite-marcenaria") && m.situacao === "sob-medida" && !cobertos.has(m.id)).map((m) => m.id);
    // pedras, cubas e fitas de LED não são marcenaria
    expect(fora.sort()).toEqual(["coz-bancada", "coz-cuba", "coz-frontao", "coz-frontao-janela", "coz-led", "coz-led-teto-1", "coz-led-teto-2", "coz-pedra-janela", "coz-revest-shaft-a", "coz-revest-shaft-b", "coz-tanque"]);
  });

  it("as peças não saem da envoltória do módulo (exceto espelho e puxadores, sobrepostos)", () => {
    for (const m of mc.modulos) {
      for (const s of m.solidos.filter(ehPecaDeCorte)) {
        expect(s.s0, `${m.cod} ${s.nome}`).toBeGreaterThanOrEqual(m.caixa.s0 - 0.01);
        expect(s.s1, `${m.cod} ${s.nome}`).toBeLessThanOrEqual(m.caixa.s1 + 0.01);
        expect(s.d0, `${m.cod} ${s.nome}`).toBeGreaterThanOrEqual(m.caixa.d0 - 0.01);
        expect(s.d1, `${m.cod} ${s.nome}`).toBeLessThanOrEqual(m.caixa.d1 + 0.01);
        expect(s.z0, `${m.cod} ${s.nome}`).toBeGreaterThanOrEqual(m.caixa.z0 - 0.01);
        expect(s.z1, `${m.cod} ${s.nome}`).toBeLessThanOrEqual(m.caixa.z1 + 0.01);
      }
    }
  });

  it("os módulos da parede A fecham a cota de 3,87 m sem vãos nem sobreposição", () => {
    const base = ["M1", "M2", "M3", "M4", "M5", "PG"].map((c) => mod(c).caixa);
    expect(base[0].s0).toBe(0);
    for (let i = 1; i < base.length; i++) expect(base[i].s0).toBe(base[i - 1].s1);
    const vaoGeladeira = mc.quadros["coz-a"].comprimento - base[base.length - 1].s1;
    expect(vaoGeladeira).toBe(750);
    expect(mod("AG").caixa.s1).toBe(3870);
    expect(mod("AM").caixa.s1).toBe(mod("NM").caixa.s0);
    expect(mod("NM").caixa.s1).toBe(mod("PG").caixa.s0);
    expect(mod("AS").caixa.z0).toBe(mod("FV").caixa.z1);
    expect(mod("FV").caixa.z0).toBe(mod("AM").caixa.z1);
  });

  it("a parede A da suíte fecha a cota de 3,92 m", () => {
    const seq = ["PJ", "AP", "CO", "G2"].map((c) => mod(c).caixa);
    expect(seq[0].s0).toBe(0);
    for (let i = 1; i < seq.length; i++) expect(seq[i].s0).toBe(seq[i - 1].s1);
    expect(seq[3].s1 + 570).toBe(3920); // + canto de 570 (profundidade do G4)
    expect(mod("G4").caixa.s0).toBe(0);
    expect(mod("G4").caixa.s1).toBe(1650);
  });

  it("os móveis vão até o pé-direito do modelo", () => {
    for (const c of ["PG", "AG", "AS", "CO", "G2", "G4", "AP", "PJ"]) expect(mod(c).caixa.z1, c).toBe(mc.peDireito);
  });
});

describe("peças", () => {
  it("nenhuma peça de MDF atravessa outra dentro do módulo", () => {
    for (const m of mc.modulos) {
      const pecas = m.solidos.filter((s) => ehPecaDeCorte(s) || s.classe === "espelho" || s.classe === "varao");
      for (let i = 0; i < pecas.length; i++) {
        for (let j = i + 1; j < pecas.length; j++) {
          expect(volumeComum(pecas[i], pecas[j]), `${m.cod}: ${pecas[i].nome} × ${pecas[j].nome}`).toBeLessThan(1);
        }
      }
    }
  });

  it("módulos vizinhos não se atravessam", () => {
    for (const conjunto of ["coz-a", "coz-b", "sui-a", "sui-b"]) {
      const todos = mc.modulos.filter((m) => m.conjunto === conjunto).flatMap((m) => m.solidos.filter(ehPecaDeCorte).map((s) => ({ s, cod: m.cod })));
      for (let i = 0; i < todos.length; i++) {
        for (let j = i + 1; j < todos.length; j++) {
          if (todos[i].cod === todos[j].cod) continue;
          expect(volumeComum(todos[i].s, todos[j].s), `${todos[i].cod} ${todos[i].s.nome} × ${todos[j].cod} ${todos[j].s.nome}`).toBeLessThan(1);
        }
      }
    }
  });

  it("espessuras são as do sistema (6, 15 ou 18 mm)", () => {
    for (const l of todasAsPecas(mc)) expect([6, 15, 18], `${l.modulo} ${l.nome} ${l.comp}×${l.larg}×${l.esp}`).toContain(l.esp);
  });

  it("nenhuma peça passa do tamanho da chapa (2.750 × 1.840)", () => {
    for (const l of todasAsPecas(mc)) {
      expect(l.comp, `${l.modulo} ${l.nome}`).toBeLessThanOrEqual(2750);
      expect(l.larg, `${l.modulo} ${l.nome}`).toBeLessThanOrEqual(1840);
    }
  });

  it("a lista agrupa peças iguais e a área bate com a soma dos sólidos", () => {
    for (const m of mc.modulos) {
      const { linhas } = listaDePecas(m);
      const areaLinhas = linhas.reduce((a, l) => a + l.areaM2, 0);
      const unicas = new Set<string>();
      const areaSolidos = m.solidos.filter(ehPecaDeCorte).reduce((a, s) => {
        if (s.peca) {
          if (unicas.has(s.peca.chave)) return a;
          unicas.add(s.peca.chave);
          return a + (s.peca.comp * s.peca.larg) / 1e6;
        }
        const e = [s.s1 - s.s0, s.d1 - s.d0, s.z1 - s.z0].sort((x, y) => x - y);
        return a + ((s.chapas ?? 1) * e[1] * e[2]) / 1e6;
      }, 0);
      expect(areaLinhas, m.cod).toBeCloseTo(areaSolidos, 1);
      expect(new Set(linhas.map((l) => l.n)).size).toBe(linhas.length);
    }
  });

  it("as gavetas cabem no vão com as corrediças", () => {
    for (const m of mc.modulos) {
      const laterais = m.solidos.filter((s) => s.classe === "gaveta" && s.nome.endsWith(": lateral"));
      const porGaveta = new Map<string, Solido[]>();
      for (const s of laterais) porGaveta.set(`${s.nome}@${s.z0}`, [...(porGaveta.get(`${s.nome}@${s.z0}`) ?? []), s]);
      for (const [nome, par] of porGaveta) {
        expect(par.length, `${m.cod} ${nome}`).toBe(2);
        const largura = Math.max(...par.map((p) => p.s1)) - Math.min(...par.map((p) => p.s0));
        expect(largura, `${m.cod} ${nome}`).toBeGreaterThan(300);
        // corrediça de cada lado: a caixa da gaveta é 26 mm mais estreita que o vão
        const estrutura = m.solidos.filter((s) => (s.classe === "lateral" || s.classe === "divisoria") && s.z0 <= par[0].z0 && s.z1 >= par[0].z1);
        const esquerda = Math.max(...estrutura.filter((s) => s.s1 <= par[0].s0 + 0.01).map((s) => s.s1));
        expect(Math.min(...par.map((p) => p.s0)) - esquerda, `${m.cod} ${nome}`).toBeCloseTo(FOLGA_CORREDICA, 1);
      }
    }
  });

  it("frentes de gaveta do M1 somam a altura útil com 3 mm de folga", () => {
    const hs = alturasDasGavetas(3, 764);
    expect(hs.reduce((a, b) => a + b, 0) + 2 * 3).toBe(764);
    expect(hs[0]).toBeLessThan(hs[1]);
    expect(hs[1]).toBeLessThan(hs[2]);
  });

  it("portas de giro têm lado de dobradiça definido", () => {
    for (const m of mc.modulos) for (const s of m.solidos.filter((x) => x.classe === "porta")) expect(s.dobr, `${m.cod} ${s.nome}`).toBeDefined();
  });
});

describe("resumos", () => {
  it("ferragens cadastradas e lotes existentes", () => {
    for (const m of mc.modulos) {
      for (const f of m.ferragens) expect(FERRAGENS[f.item], `${m.cod} ${f.item}`).toBeDefined();
      expect(LOTES.some((l) => l.cod === m.lote), m.cod).toBe(true);
    }
    expect(resumoDeFerragens(mc.modulos).length).toBeGreaterThan(10);
  });

  it("dobradiças: uma conta por porta", () => {
    const dobr = resumoDeFerragens(mc.modulos).filter((f) => f.item.startsWith("dob-")).reduce((a, f) => a + f.qtd, 0);
    const portas = mc.modulos.flatMap((m) => m.solidos.filter((s) => s.classe === "porta"));
    expect(portas.length).toBe(25); // cozinha 15 + suíte 10
    expect(dobr).toBeGreaterThanOrEqual(portas.length * 2);
  });

  it("materiais e fitas somam valores positivos", () => {
    const mats = resumoDeMateriais(todasAsPecas(mc));
    expect(mats.every((m) => m.areaM2 > 0)).toBe(true);
    expect(resumoDeFitas(mc).every((f) => f.metros > 0)).toBe(true);
    expect(CLASSES_DE_CORTE.length).toBeGreaterThan(5);
  });

  it("o projeto-base usado é o do aplicativo", () => {
    expect(mc.projeto.base).toBe(criarProjetoBase().base);
  });
});
