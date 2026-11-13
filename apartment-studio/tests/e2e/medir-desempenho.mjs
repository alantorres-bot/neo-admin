/**
 * Mede o custo de desenhar a cena: chamadas de desenho, triângulos, geometrias, texturas e programas,
 * por modo de câmera. Serve para comparar antes/depois de uma mudança (o tempo absoluto no Chromium sem
 * placa de vídeo não vale como referência de celular; as contagens valem). `primeiroQuadroMs` é o tranco de
 * entrar numa vista pela primeira vez; `msPorQuadro`, o regime depois disso.
 * Uso: npm run build && node tests/e2e/medir-desempenho.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORTA = 5184;
const servidor = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort"], { cwd: raiz, stdio: "pipe" });
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORTA}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`http://localhost:${PORTA}/?teste`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(3000);
  const medir = async (nome, visao) => {
    await page.evaluate((v) => window.__estudio.setState((s) => ({ visao: { ...s.visao, ...v } })), visao);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const { gl, scene, advance } = window.__cena;
      const ctx = gl.getContext();
      // primeiro quadro da vista: inclui o que só acontece uma vez (compilar materiais, enviar texturas)
      const tPrimeiro = performance.now();
      advance(performance.now());
      ctx.finish();
      const primeiroQuadroMs = Math.round(performance.now() - tPrimeiro);
      advance(performance.now());
      advance(performance.now());
      // um quadro exato, com a contagem zerada antes
      gl.info.autoReset = false;
      gl.info.reset();
      advance(performance.now());
      const i = gl.info;
      const r = { chamadas: i.render.calls, triangulos: i.render.triangles, geometrias: i.memory.geometries, texturas: i.memory.textures, programas: i.programs?.length ?? 0 };
      // tempo médio de 8 quadros, esperando a placa terminar cada um
      const t0 = performance.now();
      for (let k = 0; k < 8; k++) {
        advance(performance.now());
        ctx.finish();
      }
      const msPorQuadro = Math.round((performance.now() - t0) / 8);
      gl.info.autoReset = true;
      let malhas = 0;
      let luzes = 0;
      scene.traverse((o) => {
        if (o.isMesh) malhas++;
        if (o.isLight) luzes++;
      });
      return { ...r, msPorQuadro, primeiroQuadroMs, malhas, luzes };
    });
    console.log(nome.padEnd(26), JSON.stringify(r));
  };
  await medir("3D paredes baixas", { camera: "perspectiva", paredes: "recortadas" });
  await medir("3D paredes inteiras", { camera: "perspectiva", paredes: "inteiras" });
  await medir("planta", { camera: "superior", paredes: "recortadas" });
  await medir("por dentro (sala)", { camera: "interna", vistaId: "v-sala" });
  await medir("banheiro (espelho)", { camera: "interna", vistaId: "v-banheiro" });
  await medir("suíte (espelho)", { camera: "interna", vistaId: "v-suite" });
  await medir("guarda-roupa (espelho)", { camera: "interna", vistaId: "v-guarda-roupa" });
  await medir("por dentro + luzes", { camera: "interna", vistaId: "v-cozinha", luzArtificial: true });
  await medir("por dentro, noite", { camera: "interna", vistaId: "v-cozinha", luzArtificial: false, horaSol: 20 });
  await medir("por dentro, sem realismo", { camera: "interna", vistaId: "v-cozinha", horaSol: 10, realismo: false });
  await medir("3D, sem realismo", { camera: "perspectiva", paredes: "recortadas", realismo: false });
  await browser.close();
} finally {
  servidor.kill();
}
process.exit(0);
