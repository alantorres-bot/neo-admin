/**
 * Fotos de perto dos itens que têm foto de referência (rack, cadeira, eletros, marcenaria, espelho do banheiro),
 * para conferir lado a lado com as fotos do Alan. Salva em tests/e2e/capturas/detalhes/.
 * Uso: npm run build && node tests/e2e/capturar-detalhes.mjs [nome...] [--nitido]   (sem nomes: todas)
 * --nitido: 2× de resolução, em capturas/detalhes-nitido/ (imagens que vão para o Alan).
 * --hora=20 (hora do dia, 6 a 22), --luzes (acende as luzes de dia), --sem-realismo (desliga o acabamento realista);
 *   com qualquer um deles o arquivo ganha um sufixo (ex.: cozinha-geral-20h.png).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const nitido = process.argv.includes("--nitido");
const saida = join(raiz, "tests/e2e/capturas", nitido ? "detalhes-nitido" : "detalhes");
mkdirSync(saida, { recursive: true });
const PORTA = 5183;

/**
 * nome → [de x, y, altura] → [para x, y, altura], em cm da planta.
 * `esconder` tira móveis da frente da câmera; `mover` leva um móvel para um ponto livre só para a foto ([x, y, rotação]).
 */
const DETALHES = {
  "rack-frente": { de: [262, 200, 62], para: [388, 200, 34], esconder: ["sala-sofa"] },
  "rack-lado": { de: [300, 318, 95], para: [388, 205, 30] },
  "cadeira": { de: [258, 318, 98], para: [318, 222, 44], mover: { "jan-cadeira-1": [318, 215, 0] }, esconder: ["sala-luminaria"] },
  "cadeira-costas": { de: [378, 132, 98], para: [318, 222, 50], mover: { "jan-cadeira-1": [318, 215, 0] }, esconder: ["sala-luminaria", "sala-rack", "sala-tv", "sala-soundbar"] },
  "mesa-cadeiras": { de: [338, 398, 118], para: [226, 470, 55] },
  "geladeira": { de: [222, 474, 100], para: [48, 484, 94], esconder: ["jan-mesa", "jan-cadeira-1", "jan-cadeira-2", "jan-cadeira-3", "jan-cadeira-4"] },
  "lava-e-seca": { de: [118, 262, 112], para: [108, 100, 62] },
  "micro-ondas": { de: [160, 400, 168], para: [30, 418, 172] },
  "lava-loucas": { de: [150, 345, 82], para: [45, 311, 46] },
  "cozinha-geral": { de: [318, 372, 158], para: [30, 300, 118] },
  // mesmo ponto de vista da foto de referência (lá a cozinha é espelhada): da mesa, olhando a bancada até a janela
  "cozinha-referencia": { de: [166, 516, 152], para: [22, 262, 112] },
  "banheiro-espelho": { de: [574, 412, 148], para: [581, 520, 128] },
  // portas: do começo do corredor (quarto 2 à esquerda, banheiro à direita, suíte ao fundo) e a de entrada, fechada
  "portas-corredor": { de: [418, 352, 150], para: [650, 352, 105] },
  "porta-entrada": { de: [300, 400, 150], para: [337, 531, 105], esconder: ["jan-mesa", "jan-cadeira-1", "jan-cadeira-2", "jan-cadeira-3", "jan-cadeira-4"] },
  "banheiro-geral": { de: [640, 408, 160], para: [540, 505, 95] },
};

const opcao = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const hora = opcao("hora") ? Number(opcao("hora")) : null;
const luzes = process.argv.includes("--luzes");
const semRealismo = process.argv.includes("--sem-realismo");
const sufixo = `${hora !== null ? `-${String(hora).replace(".", "h")}${Number.isInteger(hora) ? "h" : ""}` : ""}${luzes ? "-luzes" : ""}${semRealismo ? "-simples" : ""}`;
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const nomes = pedidos.length ? pedidos : Object.keys(DETALHES);
// O Vite é iniciado direto pelo Node (e não por "npx"): assim `servidor.kill()` encerra o servidor de verdade,
// em vez de deixar um processo órfão ocupando a porta.
const servidor = spawn(process.execPath, [join(raiz, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORTA), "--strictPort"], { cwd: raiz, stdio: "pipe" });
const erros = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORTA}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: nitido ? 2 : 1 });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto(`http://localhost:${PORTA}/?teste`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: ".painel,.faixa-inferior,.vistas,.andar,.camada-rotulos,.barra,.aviso-base{display:none!important}" });
  for (const nome of nomes) {
    const d = DETALHES[nome];
    if (!d) throw new Error(`Detalhe desconhecido: ${nome}`);
    await page.evaluate(
      ({ nome, d, hora, luzes, semRealismo }) => {
        const app = window.__estudio;
        const base = (window.__base ??= app.getState().projeto);
        const esconder = new Set(d.esconder ?? []);
        const mover = d.mover ?? {};
        const vista = { id: `det-${nome}`, nome, de: { x: d.de[0], y: d.de[1], altura: d.de[2] }, para: { x: d.para[0], y: d.para[1], altura: d.para[2] } };
        app.setState((s) => ({
          projeto: {
            ...base,
            moveis: base.moveis.filter((m) => !esconder.has(m.id)).map((m) => (mover[m.id] ? { ...m, x: mover[m.id][0], y: mover[m.id][1], rotacao: mover[m.id][2] } : m)),
            vistas: [...base.vistas, vista],
          },
          selecao: null,
          visao: {
            ...s.visao,
            camera: "interna",
            vistaId: vista.id,
            paredes: "inteiras",
            cotas: false,
            teto: !d.semParedes,
            horaSol: hora ?? s.visao.horaSol,
            luzArtificial: luzes,
            realismo: !semRealismo,
          },
        }));
      },
      { nome, d, hora, luzes, semRealismo },
    );
    await page.waitForTimeout(hora !== null || luzes ? 2600 : 1500);
    await page.screenshot({ path: join(saida, `${nome}${sufixo}.png`) });
    console.log(`✔ ${nome}`);
  }
  await browser.close();
} finally {
  servidor.kill();
}
console.log(erros.length ? `ERROS:\n${[...new Set(erros)].slice(0, 8).join("\n")}` : "sem erros no console");
process.exit(erros.length ? 1 : 0);
