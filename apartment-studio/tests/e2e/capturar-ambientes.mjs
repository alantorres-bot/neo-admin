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
const nitido = process.argv.includes("--nitido"); // 2× para imagens que vão para o Alan
const opcao = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const hora = opcao("hora") ? Number(opcao("hora")) : null; // --hora=20: tudo à noite
const so = opcao("so")?.split(","); // --so=00-3d,10-sala: só essas imagens
const saida = join(raiz, "tests/e2e/capturas", celular ? "celular" : nitido ? "perspectivas" : "ambientes");
mkdirSync(saida, { recursive: true });
const PORTA = 5182;

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
  const context = await browser.newContext({
    viewport: celular ? { width: 390, height: 780 } : nitido ? { width: 1280, height: 800 } : { width: 1440, height: 900 },
    deviceScaleFactor: celular || nitido ? 2 : 1,
    hasTouch: celular,
    colorScheme: escuro ? "dark" : "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000); // sem placa de vídeo, a primeira imagem de cada vista demora
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto(`http://localhost:${PORTA}/?teste`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2500);
  if (hora !== null) await page.evaluate((h) => window.__estudio.setState((s) => ({ visao: { ...s.visao, horaSol: h } })), hora);
  if (limpo) await page.addStyleTag({ content: ".painel,.faixa-inferior,.vistas,.andar,.camada-rotulos,.barra{display:none!important}" });
  if (limpo) {
    // sem painéis sobra espaço: aproxima a câmera para o apartamento ocupar o quadro
    await page.waitForTimeout(600);
    const c = await page.locator("canvas").boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    for (let i = 0; i < 17; i++) {
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(120);
    }
  }
  // clique por script: funciona mesmo com a barra escondida no modo --limpo
  const clicar = (teste) => page.evaluate((t) => document.querySelector(`[data-teste="${t}"]`).click(), teste);
  const foto = async (nome) => {
    if (so && !so.includes(nome)) return;
    await page.waitForTimeout(hora !== null ? 2400 : 1400);
    await page.screenshot({ path: join(saida, `${nome}${hora !== null ? `-${hora}h` : ""}${escuro ? "-escuro" : ""}.png`) });
  };
  await foto("00-3d");
  await clicar("paredes-recortadas");
  await foto("01-3d-paredes-baixas");
  await clicar("camera-superior");
  await foto("02-planta");
  await clicar("paredes-inteiras");
  const vistas = await page.evaluate(() => [...document.querySelectorAll(".vistas button")].map((b) => b.getAttribute("data-teste")));
  for (const v of vistas) {
    const nome = `10-${v.replace("vista-v-", "")}`;
    // vista não pedida: nem troca de câmera (no Chromium sem placa de vídeo cada troca custa caro)
    if (so && !so.includes(nome)) continue;
    await clicar(v);
    await foto(nome);
  }
  await browser.close();
} finally {
  servidor.kill();
}
console.log(erros.length ? `ERROS:\n${[...new Set(erros)].slice(0, 8).join("\n")}` : "sem erros no console");
process.exit(erros.length ? 1 : 0);
