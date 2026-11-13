/**
 * Verificação visual e funcional: sobe o build com `vite preview`, abre no Chromium e confere
 * que o 3D renderiza em cada câmera, que as cotas da planta batem, que o editor de móveis funciona
 * (selecionar, medidas, aviso de conflito, girar, duplicar, excluir, adicionar, arrastar),
 * desfazer/refazer, calibração da planta e que tudo continua salvo após recarregar.
 * Uso: npm run build && npm run e2e   (capturas em tests/e2e/capturas/)
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const saida = join(raiz, "tests/e2e/capturas");
mkdirSync(saida, { recursive: true });
const PORTA = 5181;
const URL_APP = `http://localhost:${PORTA}/`;

const servidor = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort"], { cwd: raiz, stdio: "pipe" });
const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) falhas.push(msg);
};

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_APP)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("vite preview não subiu");
}

/** Variação de cor no canvas: canvas vazio/preto tem desvio ~0. */
async function analisarCanvas(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { ok: false };
    const tmp = document.createElement("canvas");
    tmp.width = 200;
    tmp.height = 120;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, 200, 120);
    const d = ctx.getImageData(0, 0, 200, 120).data;
    let soma = 0, soma2 = 0, n = 0;
    const cores = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      soma += l; soma2 += l * l; n++;
      cores.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
    }
    const media = soma / n;
    return { ok: true, desvio: Math.sqrt(soma2 / n - media * media), cores: cores.size };
  });
}

async function capturar(page, nome) {
  await page.waitForTimeout(900);
  const a = await analisarCanvas(page);
  await page.screenshot({ path: join(saida, `${nome}.png`) });
  ok(a.ok && a.desvio > 4 && a.cores > 15, `${nome}: cena renderizada (desvio ${a.desvio?.toFixed(1)}, ${a.cores} cores)`);
}

const P = '[data-teste="propriedades"]';
const campo = (page, rotulo) => page.locator(`${P} .campo:has(.campo-rotulo:text-is("${rotulo}")) input`);
const contarMoveis = (page) => page.locator('.painel-esq [data-teste^="movel-"]').count();

try {
  await esperarServidor();
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const erros = [];
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  page.on("pageerror", (e) => erros.push(String(e)));

  await page.goto(URL_APP);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2000);

  // ------------------------------------------------------------------ câmeras e planta
  await capturar(page, "01-3d");
  ok((await page.locator(".rotulo-ambiente").count()) === 8, "8 ambientes rotulados");
  await page.click('[data-teste="paredes-inteiras"]');
  await capturar(page, "02-3d-paredes-inteiras");
  await page.click('[data-teste="paredes-recortadas"]');
  await page.click('[data-teste="camera-superior"]');
  await capturar(page, "03-planta");
  ok((await page.locator(".rotulo-cota.real").count()) === 14, "14 cotas da planta conferidas (verde) na vista superior");
  ok((await page.locator(".rotulo-cota.duvida").count()) === 2, "2 cotas a confirmar sinalizadas");
  await page.click('[data-teste="aba-planta"]');
  ok(await page.locator("text=14 de 16 conferem").isVisible(), "painel informa 14 de 16 cotas conferidas");
  await page.check("text=Mostrar a planta sob o modelo");
  await page.click('[data-teste="alternar-moveis"]');
  await capturar(page, "03b-planta-sobreposta");
  await page.click('[data-teste="alternar-moveis"]');
  await page.uncheck("text=Mostrar a planta sob o modelo");

  // ------------------------------------------------------------------ edição de parede
  await page.click('[data-teste="aba-estrutura"]');
  await page.click('[data-teste="parede-p-topo-q1"]');
  const comprimento = campo(page, "Comprimento");
  ok((await comprimento.inputValue()) === "260", "parede selecionada mostra comprimento 260 (eixo)");
  await comprimento.fill("300");
  await comprimento.press("Enter");
  await page.waitForTimeout(300);
  ok((await page.locator(".rotulo-cota.erro").count()) === 1, "cota 2,51 do quarto passa a acusar divergência");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  ok((await comprimento.inputValue()) === "260", "Ctrl+Z desfaz a alteração da parede");

  // ------------------------------------------------------------------ editor de móveis
  await page.click('[data-teste="aba-moveis"]');
  const total = await contarMoveis(page);
  ok(total >= 60, `lista de móveis do apartamento (${total} itens)`);
  await page.click('[data-teste="movel-sala-sofa"]');
  ok((await campo(page, "Largura").inputValue()) === "230", "sofá selecionado: largura 230 cm");
  ok((await campo(page, "→ x").inputValue()) === "217", "sofá em x = 217");
  ok(!(await page.locator(`${P} .aviso`).count()), "sofá sem conflito na posição original");
  await campo(page, "→ x").fill("190");
  await campo(page, "→ x").press("Enter");
  await page.waitForTimeout(300);
  ok(await page.locator(`${P} .aviso:has-text("Atravessa uma parede")`).isVisible(), "empurrar o sofá contra a divisória gera aviso de parede");
  await capturar(page, "04-movel-em-conflito");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  ok((await campo(page, "→ x").inputValue()) === "217", "Ctrl+Z devolve o sofá");

  // arrastar na planta (encosta sozinho nas paredes e móveis)
  const cv = await page.locator("canvas").boundingBox();
  const zoom = Math.min((cv.width - 640) / (9.13 * 1.12), (cv.height - 90) / (5.31 * 1.12));
  const tela = (x, y) => ({ x: cv.x + cv.width / 2 + (x / 100 - 4.615) * zoom, y: cv.y + cv.height / 2 + (y / 100 - 2.655) * zoom });
  const sofa = tela(217, 201);
  await page.mouse.move(sofa.x, sofa.y);
  await page.mouse.down();
  await page.mouse.move(sofa.x + 20, sofa.y + 30, { steps: 6 });
  await page.mouse.move(sofa.x + 40, sofa.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const yArrastado = Number((await campo(page, "↓ y").inputValue()).replace(",", "."));
  ok(yArrastado > 240, `arrastar com o mouse move o sofá (y = ${yArrastado})`);
  await capturar(page, "05-movel-arrastado");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  ok((await campo(page, "↓ y").inputValue()) === "201", "um Ctrl+Z desfaz o arraste inteiro");

  // girar, duplicar, excluir
  await page.click('[data-teste="girar-esq"]');
  await page.waitForTimeout(200);
  ok((await page.locator(`${P} .linha-botoes .campo input`).inputValue()) === "180", "girar 90° → rotação 180°");
  await page.keyboard.press("Control+z");
  await page.click('[data-teste="duplicar"]');
  await page.waitForTimeout(300);
  ok((await contarMoveis(page)) === total + 1, "duplicar cria um novo móvel");
  await page.click('[data-teste="excluir"]');
  await page.waitForTimeout(300);
  ok((await contarMoveis(page)) === total, "excluir remove o móvel");

  // adicionar da biblioteca
  await page.click('[data-teste="moveis-adicionar"]');
  await page.click(".chips >> text=Decoração");
  await page.click('[data-teste="catalogo-planta-vaso"]');
  await page.waitForTimeout(400);
  ok((await page.locator("#movel-nome").inputValue()) === "Planta em vaso", "item da biblioteca entra selecionado");
  ok((await contarMoveis(page)) === total + 1, "biblioteca adiciona ao apartamento");
  await campo(page, "Altura").fill("140");
  await campo(page, "Altura").press("Enter");
  await page.waitForTimeout(200);
  ok((await campo(page, "Altura").inputValue()) === "140", "redimensionar em cm");
  await capturar(page, "06-movel-adicionado");
  await page.locator("canvas").click({ position: { x: 20, y: cv.height - 20 } }); // tira o foco do campo sem selecionar nada novo
  await page.click(`[data-teste^="movel-m-"]`);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  ok((await contarMoveis(page)) === total, "tecla Delete exclui o móvel selecionado");

  // ------------------------------------------------------------------ vistas internas
  await page.click('[data-teste="vista-v-entrada"]');
  await capturar(page, "07-interna-entrada");
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 250, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await capturar(page, "08-interna-andando");
  await page.click('[data-teste="vista-v-suite"]');
  await page.click('[data-teste="alternar-luzes"]');
  await capturar(page, "09-interna-suite-luzes");
  await page.click('[data-teste="alternar-luzes"]');

  // ------------------------------------------------------------------ planta de referência: importar e calibrar
  await page.click('[data-teste="camera-superior"]');
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000; c.height = 800;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 800);
    g.strokeStyle = "#222"; g.lineWidth = 12; g.strokeRect(50, 50, 760, 700);
    g.fillStyle = "#c00"; g.font = "28px sans-serif"; g.fillText("planta de teste", 380, 300);
    return c.toDataURL("image/png");
  });
  await page.click('[data-teste="aba-planta"]');
  await page.click('[data-teste="alternar-moveis"]');
  await page.setInputFiles('input[type="file"]', { name: "planta-teste.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
  await page.waitForTimeout(800);
  await page.click("text=Calibrar pela cota");
  await page.mouse.click(cv.x + cv.width * 0.45, cv.y + cv.height * 0.55);
  await page.mouse.click(cv.x + cv.width * 0.6, cv.y + cv.height * 0.55);
  await page.waitForTimeout(300);
  await page.fill(".calibracao input", "500");
  await page.click(".calibracao >> text=Aplicar");
  await page.waitForTimeout(500);
  ok(await page.locator("text=Calibrada: cota de 500 cm").isVisible(), "calibração da escala aplicada pela cota");
  await capturar(page, "10-planta-calibrada");
  await page.click('[data-teste="alternar-moveis"]');

  // ------------------------------------------------------------------ persistência
  await page.click('[data-teste="aba-moveis"]');
  await page.click('[data-teste="movel-jan-mesa"]');
  await campo(page, "Largura").fill("140");
  await campo(page, "Largura").press("Enter");
  await page.waitForTimeout(1200); // salvamento automático (600 ms)
  await page.reload();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1200);
  await page.click('[data-teste="aba-moveis"]');
  await page.click('[data-teste="movel-jan-mesa"]');
  ok((await campo(page, "Largura").inputValue()) === "140", "após recarregar, a mesa alterada continua salva (IndexedDB)");

  const unicos = [...new Set(erros)];
  ok(unicos.length === 0, `sem erros no console${unicos.length ? `: ${unicos.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
} catch (e) {
  falhas.push(String(e));
  console.error(e);
} finally {
  servidor.kill();
}

console.log(falhas.length ? `\n${falhas.length} falha(s).` : "\nTudo certo.");
process.exit(falhas.length ? 1 : 0);
