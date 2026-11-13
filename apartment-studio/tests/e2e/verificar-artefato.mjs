/**
 * Confere a página única gerada por `npm run artefato` (a que é publicada para abrir no celular):
 * abre dist-artefato/teste.html direto do disco, em tela de celular, e verifica que a cena renderiza,
 * que a planta embutida carrega e que não há erro de script.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arquivo = join(raiz, "dist-artefato/teste.html");
const saida = join(raiz, "tests/e2e/capturas/artefato");
mkdirSync(saida, { recursive: true });

const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) falhas.push(msg);
};
if (!existsSync(arquivo)) {
  console.error("Rode antes: npm run artefato");
  process.exit(1);
}
const tamanho = statSync(join(raiz, "dist-artefato/apartment-studio.html")).size;
ok(tamanho < 16 * 1024 * 1024, `página dentro do limite de 16 MB (${(tamanho / 1048576).toFixed(2)} MB)`);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const tema of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: tema });
  await context.route("**fonts.googleapis.com**", (r) => r.abort()); // sem internet no teste: cai nas fontes do sistema
  const page = await context.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto(pathToFileURL(arquivo).href);
  await page.waitForSelector("canvas", { timeout: 20000 });
  await page.waitForTimeout(2500);
  const desenhado = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const t = document.createElement("canvas");
    t.width = 80;
    t.height = 80;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0, 80, 80);
    const d = g.getImageData(0, 0, 80, 80).data;
    const cores = new Set();
    for (let i = 0; i < d.length; i += 4) cores.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
    return cores.size;
  });
  ok(desenhado > 15, `tema ${tema}: cena 3D renderizada no celular (${desenhado} cores)`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), `tema ${tema}: sem rolagem horizontal na página`);
  await page.screenshot({ path: join(saida, `celular-${tema}.png`) });
  if (tema === "light") {
    await page.tap('[data-teste="aba-moveis"]');
    await page.waitForTimeout(500);
    ok((await page.locator('[data-teste^="movel-"]').count()) > 60, "lista de móveis abre na folha inferior");
    await page.screenshot({ path: join(saida, "celular-moveis.png") });
    await page.tap('[data-teste="movel-sala-sofa"]');
    await page.waitForTimeout(500);
    ok(await page.locator("#movel-nome").isVisible(), "propriedades do móvel abrem no celular");
    await page.screenshot({ path: join(saida, "celular-propriedades.png") });
    await page.tap(".fechar");
    await page.evaluate(() => document.querySelector('[data-teste="vista-v-entrada"]').click());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(saida, "celular-entrada.png") });
    ok((await page.locator(".andar button").count()) === 4, "botões de andar aparecem na vista interna");
    // Etapa 5 no celular: noite (as luzes acendem sozinhas) e o botão que desliga o modo realista
    const media = () =>
      page.evaluate(() => {
        const c = document.querySelector("canvas");
        const t = document.createElement("canvas");
        t.width = t.height = 60;
        const g = t.getContext("2d");
        g.drawImage(c, 0, 0, 60, 60);
        const d = g.getImageData(0, 0, 60, 60).data;
        let soma = 0;
        for (let i = 0; i < d.length; i += 4) soma += d[i] + d[i + 1] + d[i + 2];
        return soma / (d.length / 4) / 3;
      });
    const dia = await media();
    await page.locator("#hora-sol").fill("21");
    await page.waitForTimeout(2500);
    const noite = await media();
    ok((await page.locator(".hora").innerText()).includes("☾"), "relógio do celular muda para a noite");
    ok(noite > 25 && noite < dia, `à noite a cena fica mais escura, mas iluminada pelas luzes da casa (${dia.toFixed(0)} → ${noite.toFixed(0)})`);
    await page.screenshot({ path: join(saida, "celular-noite.png") });
    await page.evaluate(() => document.querySelector('[data-teste="alternar-realismo"]').click());
    await page.waitForTimeout(1500);
    const simples = await media();
    ok(simples > 25, `com Realista desligado a cena continua desenhada (${simples.toFixed(0)})`);
    await page.evaluate(() => document.querySelector('[data-teste="alternar-realismo"]').click());
    await page.locator("#hora-sol").fill("10");
    await page.waitForTimeout(800);
    // planta embutida: liga o decalque e confere que a imagem carregou
    const carregou = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(0);
          img.src = window.__PLANTA_ORIGINAL__;
        }),
    );
    ok(carregou === 1536, "imagem da planta embutida na página");
  }
  ok(erros.length === 0, `tema ${tema}: sem erro de script${erros.length ? `: ${erros.slice(0, 2).join(" | ")}` : ""}`);
  await context.close();
}
// armazenamento do navegador bloqueado (janela privativa, pré-visualização): a página precisa abrir do mesmo jeito
{
  const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await context.route("**fonts.googleapis.com**", (r) => r.abort());
  await context.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { get: () => { throw new DOMException("bloqueado", "SecurityError"); } });
  });
  const page = await context.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto(pathToFileURL(arquivo).href);
  const abriu = await page.waitForSelector("canvas", { timeout: 20000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  ok(abriu && erros.length === 0, `abre mesmo com o armazenamento do navegador bloqueado${erros.length ? `: ${erros[0]}` : ""}`);
  await context.close();
}
await browser.close();
console.log(falhas.length ? `\n${falhas.length} falha(s).` : "\nTudo certo.");
process.exit(falhas.length ? 1 : 0);
