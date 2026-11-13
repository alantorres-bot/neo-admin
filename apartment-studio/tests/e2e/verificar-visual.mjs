/**
 * Verificação visual (Etapas 1–3): sobe o build com `vite preview`, abre no Chromium,
 * captura cada câmera, confere que o canvas 3D não está vazio, que não há erro no console,
 * que a edição de medida funciona e que o projeto continua salvo após recarregar.
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
      const r = await fetch(URL_APP);
      if (r.ok) return;
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
    return { ok: true, desvio: Math.sqrt(soma2 / n - media * media), cores: cores.size, media };
  });
}

async function capturar(page, nome) {
  await page.waitForTimeout(900);
  const a = await analisarCanvas(page);
  await page.screenshot({ path: join(saida, `${nome}.png`) });
  ok(a.ok && a.desvio > 8 && a.cores > 15, `${nome}: canvas renderizado (desvio ${a.desvio?.toFixed(1)}, ${a.cores} cores)`);
  return a;
}

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
  await page.waitForTimeout(1500);

  await capturar(page, "01-perspectiva");
  ok((await page.locator(".rotulo-ambiente").count()) === 6, "6 ambientes rotulados");

  await page.click('[data-teste="paredes-recortadas"]');
  await capturar(page, "02-perspectiva-recortada");

  await page.click('[data-teste="camera-superior"]');
  await capturar(page, "03-planta-superior");
  ok((await page.locator(".rotulo-cota").count()) > 10, "cotas das paredes visíveis na planta");

  // edição: selecionar parede pela lista e alterar comprimento
  await page.click("text=Estrutura");
  await page.click("text=Cozinha · externa >> nth=0");
  const campo = page.locator('[data-teste="propriedades"] .campo:has-text("Comprimento") input');
  ok((await campo.inputValue()) === "280", "parede selecionada mostra comprimento 280");
  await campo.fill("300");
  await campo.press("Enter");
  await page.waitForTimeout(300);
  ok((await campo.inputValue()) === "300", "comprimento alterado para 300");
  await capturar(page, "04-planta-parede-editada");

  // desfazer / refazer
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  ok((await campo.inputValue()) === "280", "Ctrl+Z desfaz a alteração");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(200);
  ok((await campo.inputValue()) === "300", "Ctrl+Shift+Z refaz a alteração");

  // câmera interna
  await page.click('[data-teste="camera-interna"]');
  await page.waitForTimeout(600);
  await capturar(page, "05-interna-sala");
  // olhar em volta arrastando e andar com W
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 350, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await capturar(page, "06-interna-girada");

  await page.click("text=Ambientes");
  await page.locator("li:has-text('Quarto principal') .entrar").click({ force: true });
  await capturar(page, "07-interna-quarto");

  // luzes + teto em perspectiva
  await page.click('[data-teste="camera-perspectiva"]');
  await page.click('[data-teste="paredes-inteiras"]');
  await page.click("text=Luzes");
  await capturar(page, "08-perspectiva-luzes");

  await page.click('[data-teste="paredes-ocultas"]');
  await capturar(page, "09-perspectiva-paredes-ocultas");
  await page.click('[data-teste="paredes-inteiras"]');

  // planta de referência: importar imagem e calibrar por uma cota
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000; c.height = 800;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 800);
    g.strokeStyle = "#222"; g.lineWidth = 12; g.strokeRect(50, 50, 760, 700);
    g.lineWidth = 6; g.beginPath(); g.moveTo(330, 50); g.lineTo(330, 400); g.lineTo(500, 400); g.lineTo(500, 750); g.stroke();
    g.fillStyle = "#c00"; g.font = "28px sans-serif"; g.fillText("planta de teste", 380, 300);
    return c.toDataURL("image/png");
  });
  await page.click('[data-teste="aba-planta"]');
  await page.setInputFiles('input[type="file"]', { name: "planta-teste.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
  await page.waitForTimeout(800);
  await capturar(page, "10-planta-importada");
  await page.click("text=Calibrar pela cota");
  const cv = await page.locator("canvas").boundingBox();
  await page.mouse.click(cv.x + cv.width * 0.45, cv.y + cv.height * 0.6);
  await page.mouse.click(cv.x + cv.width * 0.6, cv.y + cv.height * 0.6);
  await page.waitForTimeout(300);
  await page.fill('.calibracao input', "500");
  await page.click(".calibracao >> text=Aplicar");
  await page.waitForTimeout(500);
  ok(await page.locator("text=Calibrada: cota de 500 cm").isVisible(), "calibração da escala aplicada pela cota");
  await capturar(page, "11-planta-calibrada");

  // persistência: recarregar mantém a parede com 300
  await page.waitForTimeout(900); // salvamento automático (600 ms)
  await page.reload();
  await page.waitForSelector("canvas");
  await page.click("text=Estrutura");
  await page.click("text=Cozinha · externa >> nth=0");
  ok((await campo.inputValue()) === "300", "após recarregar, a alteração continua salva (IndexedDB)");

  ok(erros.length === 0, `sem erros no console${erros.length ? `: ${erros.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
} catch (e) {
  falhas.push(String(e));
  console.error(e);
} finally {
  servidor.kill();
}

console.log(falhas.length ? `\n${falhas.length} falha(s).` : "\nTudo certo.");
process.exit(falhas.length ? 1 : 0);
