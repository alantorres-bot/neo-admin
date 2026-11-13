/**
 * Galeria de perspectivas: sobe o build, abre no Chromium e salva uma imagem por vista
 * (3D, planta e cada ambiente por dentro) em tests/e2e/capturas/ambientes/.
 * Uso: npm run build && node tests/e2e/capturar-ambientes.mjs [--celular] [--escuro]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const celular = process.argv.includes("--celular");
const escuro = process.argv.includes("--escuro");
const limpo = process.argv.includes("--limpo"); // sem painéis, só a cena
const saida = join(raiz, "tests/e2e/capturas", celular ? "celular" : "ambientes");
mkdirSync(saida, { recursive: true });
const PORTA = 5182;

const servidor = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort"], { cwd: raiz, stdio: "pipe" });
const erros = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORTA}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({
    viewport: celular ? { width: 390, height: 780 } : { width: 1440, height: 900 },
    deviceScaleFactor: celular ? 2 : 1,
    hasTouch: celular,
    colorScheme: escuro ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto(`http://localhost:${PORTA}/`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2500);
  if (limpo) await page.addStyleTag({ content: ".painel,.faixa-inferior,.vistas,.andar,.camada-rotulos{display:none!important}" });
  const foto = async (nome) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(saida, `${nome}${escuro ? "-escuro" : ""}.png`) });
  };
  await foto("00-3d");
  await page.click('[data-teste="paredes-recortadas"]');
  await foto("01-3d-paredes-baixas");
  await page.click('[data-teste="camera-superior"]');
  await foto("02-planta");
  await page.click('[data-teste="paredes-inteiras"]');
  const vistas = await page.evaluate(() => [...document.querySelectorAll(".vistas button")].map((b) => b.getAttribute("data-teste")));
  for (const v of vistas) {
    await page.evaluate((sel) => document.querySelector(`[data-teste="${sel}"]`).click(), v);
    await foto(`10-${v.replace("vista-v-", "")}`);
  }
  await browser.close();
} finally {
  servidor.kill();
}
console.log(erros.length ? `ERROS:\n${[...new Set(erros)].slice(0, 8).join("\n")}` : "sem erros no console");
process.exit(erros.length ? 1 : 0);
