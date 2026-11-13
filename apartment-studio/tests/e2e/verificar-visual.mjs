/**
 * Verificação visual e funcional: sobe o build com `vite preview`, abre no Chromium e confere
 * que o 3D renderiza em cada câmera, que as cotas da planta batem, que o editor de móveis funciona
 * (selecionar, medidas, aviso de conflito, girar, duplicar, excluir, adicionar, arrastar),
 * desfazer/refazer, acabamentos e iluminação (pintura por face, piso, acabamento de móvel, noite, espelho,
 * modo realista), calibração da planta e que tudo continua salvo após recarregar.
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
// "?teste" expõe o estado do app para conferência (window.__estudio e window.__cena) — ver main.tsx
const URL_APP = `http://localhost:${PORTA}/?teste`;

// O Vite é iniciado direto pelo Node (e não por "npx"): assim `servidor.kill()` encerra o servidor de verdade,
// em vez de deixar um processo órfão ocupando a porta.
const servidor = spawn(process.execPath, [join(raiz, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORTA), "--strictPort"], { cwd: raiz, stdio: "pipe" });
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
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

  // ------------------------------------------------------------------ acabamentos e iluminação (Etapa 5)
  const estado = (fn) => page.evaluate(fn);
  const paredeSofa = () => estado(() => window.__estudio.getState().projeto.planta.paredes.find((p) => p.id === "p-coz-sala"));
  /** Fração dos pontos da imagem que são azul-marinho (parede pintada). */
  const fracaoAzul = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas");
      const tmp = document.createElement("canvas");
      tmp.width = 200;
      tmp.height = 120;
      const ctx = tmp.getContext("2d");
      ctx.drawImage(c, 0, 0, 200, 120);
      const d = ctx.getImageData(0, 0, 200, 120).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 100 && d[i + 2] > d[i] + 18 && d[i + 2] < 170) n++;
      return n / (d.length / 4);
    });
  /** Quantos espelhos são redesenhados (reflexo de verdade) num quadro da vista atual. */
  const espelhosAtivos = () =>
    estado(() => {
      const { scene, advance } = window.__cena;
      const total = () => {
        let n = 0;
        scene.traverse((o) => o.isReflector && (n += o.userData.reflexos ?? 0));
        return n;
      };
      advance(performance.now()); // acomoda a vista
      const antes = total();
      advance(performance.now());
      return total() - antes;
    });

  // a parede de trás do sofá abre azul-marinho só do lado da sala (opção A, escolhida pelo Alan)
  const azulSoDaSala = (p) => p.acabamentos?.length === 1 && p.acabamentos[0].ambiente === "amb-sala" && p.acabamentos[0].cor === "#1c2444";
  await page.click('[data-teste="vista-v-sala"]');
  await page.waitForTimeout(900);
  let pSofa = await paredeSofa();
  ok(azulSoDaSala(pSofa) && (pSofa.acabamentos[0].revestimento ?? "pintura") === "pintura", "o projeto abre com a parede do sofá azul-marinho só do lado da sala");
  const azulBase = await fracaoAzul();
  ok(azulBase > 0.08, `a parede azul aparece na sala (${(azulBase * 100).toFixed(1)}% da imagem)`);
  await capturar(page, "11-sala-parede-azul");
  await page.click('[data-teste="vista-v-cozinha"]');
  await page.waitForTimeout(900);
  ok((await fracaoAzul()) < 0.02, "do lado da cozinha a mesma parede continua clara");
  // voltar ao padrão, pintar de novo e revestir pela interface
  await page.click('[data-teste="vista-v-sala"]');
  await page.click('[data-teste="aba-estrutura"]');
  await page.click('[data-teste="parede-p-coz-sala"]');
  await page.click(`${P} [data-teste="face-amb-sala"] >> text=Voltar ao padrão`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  ok((await paredeSofa()).acabamentos === undefined, "voltar ao padrão remove o acabamento da face");
  const semAzul = await fracaoAzul();
  ok(semAzul < azulBase - 0.04, `sem a pintura, o azul some da imagem (${(azulBase * 100).toFixed(1)}% → ${(semAzul * 100).toFixed(1)}%)`);
  await page.click('[data-teste="parede-p-coz-sala"]');
  await page.click(`${P} [data-teste="face-amb-sala"] button[aria-label="Azul-marinho"]`);
  await page.waitForTimeout(300);
  ok(azulSoDaSala(await paredeSofa()), "pintar de novo de azul-marinho, só do lado da sala");
  await page.selectOption(`${P} [data-teste="face-amb-sala"] select`, "tijolinho");
  await page.waitForTimeout(300);
  pSofa = await paredeSofa();
  ok(pSofa.acabamentos[0].revestimento === "tijolinho" && pSofa.acabamentos[0].cor === "#1c2444", "trocar para tijolinho mantém a cor escolhida");
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  pSofa = await paredeSofa();
  ok(azulSoDaSala(pSofa) && pSofa.acabamentos[0].revestimento === undefined, "três Ctrl+Z devolvem a parede à pintura azul do projeto");

  // pintar um ambiente inteiro e trocar o piso
  await page.click('[data-teste="aba-ambientes"]');
  await page.click('[data-teste="ambiente-amb-quarto2"]');
  await page.click(`${P} [aria-label="Cor: paredes de Quarto 2"] button[aria-label="Verde sálvia"]`);
  await page.selectOption("#piso-material", "madeira");
  await page.waitForTimeout(400);
  const q2 = await estado(() => {
    const pl = window.__estudio.getState().projeto.planta;
    return {
      piso: pl.ambientes.find((a) => a.id === "amb-quarto2"),
      faces: pl.paredes.flatMap((p) => (p.acabamentos ?? []).filter((a) => a.ambiente === "amb-quarto2").map((a) => `${p.id}:${a.cor}`)),
      // fora o que já vem no projeto: azulejo do banheiro e a parede azul da sala
      outros: pl.paredes.flatMap((p) => (p.acabamentos ?? []).filter((a) => !["amb-quarto2", "amb-banheiro", "amb-sala"].includes(a.ambiente))).length,
      sala: pl.paredes.flatMap((p) => (p.acabamentos ?? []).filter((a) => a.ambiente === "amb-sala")).length,
    };
  });
  ok(q2.faces.length >= 4 && q2.faces.every((f) => f.endsWith("#7d8a74")) && q2.outros === 0 && q2.sala === 1, `quarto 2 pintado de verde em ${q2.faces.length} paredes, sem vazar para os vizinhos`);
  ok(q2.piso.pisoMaterial === "madeira" && q2.piso.piso === "#c79f72", "piso do quarto 2 trocado para madeira");
  await page.click('[data-teste="vista-v-quarto2"]');
  await capturar(page, "12-quarto2-verde-madeira");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const q2volta = await estado(() => {
    const pl = window.__estudio.getState().projeto.planta;
    return { material: pl.ambientes.find((a) => a.id === "amb-quarto2").pisoMaterial, faces: pl.paredes.flatMap((p) => (p.acabamentos ?? []).filter((a) => a.ambiente === "amb-quarto2")).length };
  });
  ok(q2volta.material === undefined && q2volta.faces === 0, "dois Ctrl+Z desfazem o piso e a pintura do quarto");

  // portas: de madeira por padrão; dá para pintar e voltar
  const portaEntrada = () => estado(() => window.__estudio.getState().projeto.planta.aberturas.find((a) => a.id === "pt-entrada"));
  await page.click('[data-teste="aba-estrutura"]');
  await page.click('[data-teste="abertura-pt-entrada"]');
  ok((await page.locator("#porta-acabamento").inputValue()) === "madeira", "portas saem em madeira por padrão");
  ok(await page.locator(`${P} button[aria-label="Madeira (padrão)"]`).evaluate((b) => b.getAttribute("aria-pressed") === "true"), "o tom padrão da porta aparece marcado");
  await page.selectOption("#porta-acabamento", "pintura");
  await page.click(`${P} [aria-label="Cor: porta"] button[aria-label="Grafite"]`);
  await page.waitForTimeout(300);
  let pt = await portaEntrada();
  ok(pt.acabamento === "pintura" && pt.cor === "#3b3e42", "porta de entrada pintada de grafite");
  await page.keyboard.press("Escape");
  await page.click('[data-teste="vista-v-mesa"]');
  await capturar(page, "11b-porta-pintada");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  pt = await portaEntrada();
  ok(pt.acabamento === undefined && pt.cor === undefined, "dois Ctrl+Z devolvem a porta à madeira padrão");
  await capturar(page, "11c-porta-madeira");

  // acabamento e cor de uma parte do móvel
  await page.click('[data-teste="aba-moveis"]');
  await page.click('[data-teste="movel-sala-rack"]');
  await page.selectOption(`${P} [data-teste="acabamento-frente"]`, "fosco");
  await page.click(`${P} [aria-label="Cor: Portas ripadas"] button[aria-label="Azul-marinho"]`);
  await page.waitForTimeout(300);
  const rack = await estado(() => window.__estudio.getState().projeto.moveis.find((m) => m.id === "sala-rack"));
  ok(rack.acabamentos?.frente === "fosco" && rack.cores?.frente === "#1c2444", "portas do rack em laca fosca azul-marinho");
  await page.click(`${P} >> text=Voltar às cores originais`);
  await page.waitForTimeout(300);
  const rackVolta = await estado(() => window.__estudio.getState().projeto.moveis.find((m) => m.id === "sala-rack"));
  ok(!rackVolta.cores && !rackVolta.acabamentos, "voltar às cores originais limpa as trocas");
  await page.keyboard.press("Escape");

  // noite: as luzes acendem sozinhas
  const luzesNaCena = () =>
    estado(() => {
      let n = 0;
      window.__cena.scene.traverse((o) => (o.isPointLight || o.isRectAreaLight) && n++);
      return n;
    });
  await page.click('[data-teste="vista-v-cozinha"]');
  const luzesDeDia = await luzesNaCena();
  await page.locator("#hora-sol").fill("20");
  await page.waitForTimeout(700);
  ok((await page.locator(".hora").innerText()).includes("☾ 20h"), "relógio marca noite às 20h");
  ok(await page.locator('[data-teste="alternar-luzes"]').isDisabled(), "à noite o botão Luzes fica travado em aceso");
  const luzesDeNoite = await luzesNaCena();
  ok(luzesDeNoite >= 10 && luzesDeNoite > luzesDeDia, `à noite as luzes da casa acendem (${luzesDeDia} de dia → ${luzesDeNoite} à noite)`);
  await capturar(page, "13-cozinha-noite");
  await page.locator("#hora-sol").fill("10");

  // espelho de verdade só à vista; modo simples desliga tudo
  await page.click('[data-teste="vista-v-banheiro"]');
  await page.waitForTimeout(900);
  ok((await espelhosAtivos()) === 1, "no banheiro o espelho reflete o ambiente");
  await capturar(page, "14-banheiro-espelho");
  await page.click('[data-teste="vista-v-sala"]');
  await page.waitForTimeout(900);
  ok((await espelhosAtivos()) === 0, "na sala nenhum espelho é redesenhado (estão fora da vista)");
  await page.click('[data-teste="alternar-realismo"]');
  await page.click('[data-teste="vista-v-banheiro"]');
  await page.waitForTimeout(900);
  ok((await espelhosAtivos()) === 0, "com Realista desligado o espelho volta ao acabamento simples");
  await capturar(page, "15-banheiro-simples");
  await page.click('[data-teste="alternar-realismo"]');

  // ------------------------------------------------------------------ versões, histórico e exportação (Etapa 6)
  const versoes = () => estado(() => window.__estudio.getState().versoes.map((v) => ({ id: v.id, nome: v.nome, miniatura: (v.miniatura ?? "").slice(0, 22) })));
  const sofaX = () => estado(() => window.__estudio.getState().projeto.moveis.find((m) => m.id === "sala-sofa").x);
  await page.click('[data-teste="vista-v-sala"]');
  await page.waitForTimeout(900);
  await page.click('[data-teste="aba-versoes"]');
  ok((await page.locator(".versoes .versao").count()) === 0, "nenhuma versão guardada no começo");
  await page.fill("#versao-nome", "Como combinamos");
  await page.click('[data-teste="versao-salvar"]');
  await page.waitForTimeout(400);
  let vs = await versoes();
  ok(vs.length === 1 && vs[0].nome === "Como combinamos" && vs[0].miniatura.startsWith("data:image/jpeg"), "versão salva com nome e miniatura da cena");
  ok((await page.locator(".versao.aberta").count()) === 1, 'a versão recém-salva aparece como "a que está aberta"');
  const idA = vs[0].id;
  // muda a decoração (sofá 60 cm para o lado) e guarda outra versão, sem nome
  const xAntes = await sofaX();
  await estado(() => {
    const s = window.__estudio.getState();
    s.alterarMovel("sala-sofa", "Mover sofá", { x: s.projeto.moveis.find((m) => m.id === "sala-sofa").x + 60 });
  });
  await page.waitForTimeout(400);
  ok((await page.locator(".versao.aberta").count()) === 0, "depois de mexer, nenhuma versão é igual ao que está aberto");
  await page.click('[data-teste="versao-salvar"]');
  await page.waitForTimeout(400);
  vs = await versoes();
  ok(vs.length === 2 && /^Versão 1 — \d{2}\/\d{2} \d{2}h\d{2}$/.test(vs[0].nome), `versão sem nome ganha número, dia e hora ("${vs[0]?.nome}")`);
  // abrir a primeira devolve a decoração; Ctrl+Z desfaz a abertura
  await page.click(`[data-teste="versao-${idA}"] [data-teste="versao-abrir"]`);
  await page.waitForTimeout(400);
  ok((await sofaX()) === xAntes, "abrir a versão antiga devolve o sofá ao lugar");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  ok((await sofaX()) === xAntes + 60, "Ctrl+Z desfaz a abertura da versão");
  // renomear, duplicar e excluir (com confirmação na própria lista)
  await page.click(`[data-teste="versao-${idA}"] [data-teste="versao-renomear"]`);
  await page.fill(`[data-teste="versao-${idA}"] input`, "Parede azul");
  await page.keyboard.press("Enter");
  await page.click(`[data-teste="versao-${idA}"] [data-teste="versao-duplicar"]`);
  await page.waitForTimeout(400);
  vs = await versoes();
  ok(vs.length === 3 && vs.some((v) => v.nome === "Parede azul") && vs.some((v) => v.nome === "Parede azul (cópia)"), "renomear e duplicar versões");
  const idCopia = vs.find((v) => v.nome === "Parede azul (cópia)").id;
  await page.click(`[data-teste="versao-${idCopia}"] [data-teste="versao-excluir"]`);
  ok((await versoes()).length === 3, "excluir pede confirmação antes de apagar");
  await page.click(`[data-teste="versao-${idCopia}"] [data-teste="versao-excluir-sim"]`);
  await page.waitForTimeout(300);
  ok((await versoes()).length === 2, "versão excluída depois da confirmação");
  await page.locator(".painel-esq").screenshot({ path: join(saida, "16-aba-versoes.png") });

  // histórico: voltar para antes de um passo desfaz também os que vieram depois
  const passos = await estado(() => window.__estudio.getState().passado.map((p) => p.rotulo));
  const iMover = passos.lastIndexOf("Mover sofá");
  ok(iMover >= 0 && (await page.locator(".historico li").count()) === Math.min(40, passos.length), `histórico lista os ${passos.length} passos desta visita`);
  await page.click(`[data-teste="historico-${iMover}"]`);
  await page.waitForTimeout(300);
  ok((await sofaX()) === xAntes && (await estado(() => window.__estudio.getState().passado.length)) === iMover, "voltar no histórico devolve o sofá e encurta a lista");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(300);
  ok((await sofaX()) === xAntes + 60, "o passo desfeito pelo histórico pode ser refeito");
  await page.keyboard.press("Control+z");

  // exportar: imagem do tamanho pedido, cena de volta ao tamanho da tela, arquivo com nome da vista
  const telaAntes = await estado(() => {
    const c = document.querySelector(".palco canvas");
    return [c.width, c.height];
  });
  await page.selectOption("#imagem-formato", "paisagem");
  await page.selectOption("#imagem-qualidade", "alta");
  await page.click('[data-teste="imagem-gerar"]');
  await page.waitForSelector('[data-teste="imagem-previa"] img', { timeout: 90_000 });
  const imagem = await page.evaluate(async () => {
    const i = document.querySelector('[data-teste="imagem-previa"] img');
    await i.decode();
    const t = document.createElement("canvas");
    t.width = 160;
    t.height = 90;
    const g = t.getContext("2d");
    g.drawImage(i, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    const cores = new Set();
    for (let k = 0; k < d.length; k += 4) cores.add(`${d[k] >> 3},${d[k + 1] >> 3},${d[k + 2] >> 3}`);
    return { w: i.naturalWidth, h: i.naturalHeight, cores: cores.size };
  });
  ok(imagem.w === 1920 && imagem.h === 1080, `imagem exportada em 1920 × 1080 (${imagem.w} × ${imagem.h})`);
  ok(imagem.cores > 40, `a imagem exportada tem a cena desenhada (${imagem.cores} cores)`);
  await page.screenshot({ path: join(saida, "17-imagem-exportada.png") });
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.click('[data-teste="imagem-salvar"]')]);
  ok(/^apartamento-sala-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.jpg$/.test(arquivo.suggestedFilename()), `arquivo salvo com o nome da vista e a data (${arquivo.suggestedFilename()})`);
  await page.click('[data-teste="imagem-fechar"]');
  await page.waitForTimeout(600);
  const telaDepois = await estado(() => {
    const c = document.querySelector(".palco canvas");
    return [c.width, c.height];
  });
  ok(telaDepois[0] === telaAntes[0] && telaDepois[1] === telaAntes[1], "depois de exportar, a cena volta ao tamanho da tela");
  await capturar(page, "18-depois-de-exportar");

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
  const guardadas = await estado(() => window.__estudio.getState().versoes.map((v) => v.nome).sort());
  ok(guardadas.length === 2 && guardadas[0] === "Parede azul", `após recarregar, as versões continuam guardadas (${guardadas.join(", ")})`);

  // ------------------------------------------------------------------ banco da página publicada (simulado)
  // Na página publicada o projeto vai para o banco da própria página; aqui um banco falso em memória
  // confere a lógica: grava após a alteração e outro aparelho (contexto novo) abre o que foi salvo.
  const cofre = new Map();
  const comBanco = async (ctx) => {
    await ctx.exposeFunction("__bancoLer", (c) => cofre.get(c) ?? null);
    await ctx.exposeFunction("__bancoGravar", (c, json) => void cofre.set(c, json));
    await ctx.exposeFunction("__bancoApagar", (c) => void cofre.delete(c));
    await ctx.exposeFunction("__bancoListar", (colecao) => [...cofre.keys()].filter((k) => k.startsWith(`${colecao}/`)));
    await ctx.addInitScript(() => {
      const foto = (caminho, j) => ({ id: caminho.split("/").pop(), exists: j !== null, data: () => (j === null ? undefined : Object.freeze(JSON.parse(j))) });
      const doc = (caminho) => ({
        get: async () => foto(caminho, await window.__bancoLer(caminho)),
        set: async (d) => window.__bancoGravar(caminho, JSON.stringify(d)),
        delete: async () => window.__bancoApagar(caminho),
      });
      const collection = (colecao) => ({
        get: async () => {
          const docs = [];
          for (const caminho of await window.__bancoListar(colecao)) docs.push(foto(caminho, await window.__bancoLer(caminho)));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      });
      window.claude = { use: async (nome) => (nome === "db" ? Object.freeze({ doc, collection }) : null) };
    });
  };
  const abrir = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await comBanco(ctx);
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => erros.push(String(e)));
    await pg.goto(URL_APP);
    await pg.waitForSelector("canvas");
    await pg.waitForTimeout(1500);
    await pg.click('[data-teste="aba-moveis"]');
    await pg.click('[data-teste="movel-jan-mesa"]');
    return { ctx, pg };
  };
  const a = await abrir();
  ok(!cofre.has("projetos/principal"), "banco da página: nada é gravado antes de o usuário alterar algo");
  await campo(a.pg, "Altura").fill("78");
  await campo(a.pg, "Altura").press("Enter");
  await a.pg.waitForTimeout(1500);
  const gravado = cofre.get("projetos/principal");
  ok(!!gravado && JSON.parse(gravado).projeto.moveis.some((m) => m.id === "jan-mesa" && m.altura === 78), "banco da página: alteração gravada no documento do projeto");
  ok(!!gravado && gravado.length < 200_000 && !gravado.includes("data:image"), `banco da página: documento enxuto (${Math.round((gravado?.length ?? 0) / 1024)} KB de 256)`);
  ok((await a.pg.locator('.salvo[title*="conta"]').count()) === 1, 'indicador mostra "salvo na conta"');
  // versões também vão para a conta: uma por documento, em versoes/<id>
  await a.pg.keyboard.press("Escape");
  await a.pg.click('[data-teste="aba-versoes"]');
  await a.pg.fill("#versao-nome", "Mesa mais alta");
  await a.pg.click('[data-teste="versao-salvar"]');
  await a.pg.click('[data-teste="versao-salvar"]');
  await a.pg.waitForTimeout(1200);
  const docsVersao = () => [...cofre.keys()].filter((k) => k.startsWith("versoes/"));
  ok(docsVersao().length === 2 && docsVersao().every((k) => cofre.get(k).length < 200_000), `banco da página: cada versão num documento próprio (${docsVersao().map((k) => Math.round(cofre.get(k).length / 1024) + " KB").join(", ")})`);
  const idApagar = await a.pg.evaluate(() => window.__estudio.getState().versoes.find((v) => v.nome !== "Mesa mais alta").id);
  await a.pg.click(`[data-teste="versao-${idApagar}"] [data-teste="versao-excluir"]`);
  await a.pg.click(`[data-teste="versao-${idApagar}"] [data-teste="versao-excluir-sim"]`);
  await a.pg.waitForTimeout(800);
  ok(docsVersao().length === 1, "banco da página: versão excluída some também da conta");
  await a.ctx.close();
  const b = await abrir(); // outro aparelho: armazenamento do navegador vazio
  ok((await campo(b.pg, "Altura").inputValue()) === "78", "outro aparelho abre o projeto salvo na conta");
  const noOutro = await b.pg.evaluate(() => window.__estudio.getState().versoes.map((v) => v.nome));
  ok(noOutro.length === 1 && noOutro[0] === "Mesa mais alta", "outro aparelho encontra as versões guardadas na conta");
  await b.ctx.close();

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
