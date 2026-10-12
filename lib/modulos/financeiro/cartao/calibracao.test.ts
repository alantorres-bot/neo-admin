// Calibração dos leitores com as faturas REAIS do Drive (só leitura; nada é gravado). Roda apenas quando a variável
// NEO_AMOSTRAS_CARTAO aponta para a pasta "02 - FATURA CARTAO" (uma subpasta por cartão). Para cada PDF legível, exige que
// a soma das linhas não descartadas seja igual ao total impresso pelo emissor — é a prova de que a extração está completa.
// PDFs com senha (Inter, Itaú) são pulados, a menos que NEO_SENHA_PDF_<PASTA> esteja definida (ex.: NEO_SENHA_PDF_INTER_PJ).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairPaginasDoPdf } from "./fatura-pdf";
import { lerFatura } from "./leitores";
import { somaLinhas } from "./leitores/comum";
import { brl } from "./texto";
import type { CodigoLeitor } from "./modulo";

const PASTA = process.env.NEO_AMOSTRAS_CARTAO;

// Leitor esperado pela pasta; como há faturas guardadas na pasta errada (caso real), o teste aceita qualquer leitor que feche.
const leitorDaPasta = (pasta: string): CodigoLeitor => (/SICREDI/i.test(pasta) ? "sicredi" : /PICPAY/i.test(pasta) ? "picpay" : /INTER/i.test(pasta) ? "inter" : /UNICRED/i.test(pasta) ? "unicred" : "generico");
const TODOS: CodigoLeitor[] = ["sicredi", "picpay", "inter", "unicred", "generico"];

function listarPdfs(raiz: string): { cartao: string; caminho: string }[] {
  const saida: { cartao: string; caminho: string }[] = [];
  for (const cartao of readdirSync(raiz)) {
    const dir = join(raiz, cartao);
    if (!statSync(dir).isDirectory()) continue;
    const andar = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) andar(p);
        else if (/\.pdf$/i.test(f)) saida.push({ cartao, caminho: p });
      }
    };
    andar(dir);
  }
  return saida;
}

describe.skipIf(!PASTA)("calibração dos leitores com as faturas do Drive", () => {
  const pdfs = PASTA ? listarPdfs(PASTA) : [];
  it("encontrou PDFs", () => { expect(pdfs.length).toBeGreaterThan(0); });

  for (const { cartao, caminho } of pdfs) {
    it(`${cartao}: ${caminho.split(/[\\/]/).slice(-2).join("/")}`, async () => {
      const senha = process.env[`NEO_SENHA_PDF_${cartao.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\W+/g, "_").toUpperCase()}`];
      const ex = await extrairPaginasDoPdf(readFileSync(caminho), senha);
      if (!ex.ok) {
        if (ex.precisaSenha) { console.warn(`[pulado, precisa de senha] ${caminho}`); return; }
        throw new Error(ex.erro);
      }
      // o vencimento real não importa para a soma; serve só para o ano das compras
      const esperado = leitorDaPasta(cartao);
      const resultados = [esperado, ...TODOS.filter((l) => l !== esperado)].map((leitor) => ({ leitor, r: lerFatura(leitor, ex.paginas, { vencimento: "2026-12-31" }) }));
      const fecha = resultados.find(({ r }) => r.avisos.length === 0 && r.totalImpressoCentavos !== null && r.vencimentoImpresso !== null && somaLinhas(r.linhas) === r.totalImpressoCentavos);
      const { leitor, r } = fecha ?? resultados[0];
      console.log(`${cartao} [${leitor}${fecha && leitor !== esperado ? ", pasta diz " + esperado : ""}] linhas=${r.linhas.length} descartadas=${r.linhas.filter((l) => l.descartada).length} soma=${brl(somaLinhas(r.linhas))} total=${r.totalImpressoCentavos === null ? "?" : brl(r.totalImpressoCentavos)} venc=${r.vencimentoImpresso ?? "?"} avisos=${r.avisos.length}`);
      expect(fecha, `nenhum leitor fechou ${caminho}`).toBeDefined();
    });
  }
});
