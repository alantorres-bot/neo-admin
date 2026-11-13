/**
 * Gera a página única para publicar como Artifact (abre no celular, salva na conta):
 *   dist-artefato/apartment-studio.html  → conteúdo da página (sem <html>/<head>/<body>: a publicação envolve)
 *   dist-artefato/teste.html             → o mesmo conteúdo dentro de um esqueleto, para testar localmente
 * Tudo embutido: CSS, JavaScript e a imagem da planta. Fontes: Google Fonts (único host de fonte permitido).
 * Uso: npm run artefato [-- --titulo="título atual da página publicada"]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "dist-artefato");
const build = join(saida, "build");

rmSync(saida, { recursive: true, force: true });
mkdirSync(saida, { recursive: true });
execFileSync("npx", ["vite", "build", "--base=./", `--outDir=${build}`, "--emptyOutDir"], { cwd: raiz, stdio: "inherit" });

const arquivos = readdirSync(join(build, "assets"));
const js = arquivos.filter((a) => a.endsWith(".js"));
const css = arquivos.filter((a) => a.endsWith(".css"));
if (js.length !== 1 || css.length !== 1) throw new Error(`Esperava 1 JS e 1 CSS, achei ${js.length} e ${css.length}`);

const codigo = readFileSync(join(build, "assets", js[0]), "utf8").replaceAll("</script", "<\\/script");
const estilo = readFileSync(join(build, "assets", css[0]), "utf8");
const planta = readFileSync(join(raiz, "public/referencia/planta-apartamento.webp")).toString("base64");

// O título da página publicada pode ter sido trocado pelo dono (ele renomeia direto na página). Para não desfazer
// a troca numa republicação, passe o título atual: npm run artefato -- --titulo="…". Ele não fica no repositório.
const tituloPedido = process.argv.find((a) => a.startsWith("--titulo="))?.slice("--titulo=".length);
const titulo = (tituloPedido || "Apartment Studio 3D").replace(/&/g, "&amp;").replace(/</g, "&lt;");

const pagina = `<title>${titulo}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600&display=swap">
<style>${estilo}</style>
<div id="root"></div>
<script>window.__PLANTA_ORIGINAL__="data:image/webp;base64,${planta}";</script>
<script type="module">${codigo}</script>
`;
writeFileSync(join(saida, "apartment-studio.html"), pagina);

// mesmo esqueleto que a publicação aplica (charset, viewport com viewport-fit=cover e um reset pequeno)
const esqueleto = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>
${pagina}</body></html>`;
writeFileSync(join(saida, "teste.html"), esqueleto);
rmSync(build, { recursive: true, force: true });

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`dist-artefato/apartment-studio.html: ${kb(pagina.length)} (JS ${kb(codigo.length)}, CSS ${kb(estilo.length)}, planta ${kb(planta.length)})`);
