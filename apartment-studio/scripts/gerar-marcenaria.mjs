/**
 * Gera o caderno de marcenaria (docs/marcenaria): HTML, PDF em A3 paisagem e os dados da planilha.
 * Uso: node scripts/gerar-marcenaria.mjs [--previa] [--so=C-02,C-03]
 *   --previa: salva também um PNG de cada prancha em docs/marcenaria/previa/ (para conferência visual).
 * As imagens 3D vêm de docs/marcenaria/imagens (geradas por tests/e2e/capturar-detalhes.mjs marc-* …).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "docs/marcenaria");
mkdirSync(saida, { recursive: true });
const opcao = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const previa = process.argv.includes("--previa");
const so = opcao("so")?.split(",");

const { createServer } = await import(pathToFileURL(join(raiz, "node_modules/vite/dist/node/index.js")).href);
const vite = await createServer({ root: raiz, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let resultado;
try {
  const { gerarCaderno } = await vite.ssrLoadModule("/src/marcenaria/caderno.ts");
  const imagens = {};
  const pastaImagens = join(saida, "imagens");
  if (existsSync(pastaImagens)) {
    for (const arq of readdirSync(pastaImagens).filter((a) => a.endsWith(".jpg"))) {
      imagens[arq.replace(/\.jpg$/, "")] = `data:image/jpeg;base64,${readFileSync(join(pastaImagens, arq)).toString("base64")}`;
    }
  }
  resultado = gerarCaderno({ imagens });
} finally {
  await vite.close();
}
writeFileSync(join(saida, "caderno-marcenaria.html"), resultado.html);
// ---------------------------------------------------------------- planilha de quantitativos
{
  const { xlsx, E } = await import("./xlsx.mjs");
  const p = resultado.planilha;
  const cab = (...nomes) => nomes.map((v) => ({ v, s: E.cabecalho }));
  const n2 = (v) => ({ v, s: E.decimal2 });
  const n3 = (v) => ({ v, s: E.decimal3 });
  const n1 = (v) => ({ v, s: E.decimal1 });
  const negrito = (v) => ({ v, s: E.negrito });
  const nota = (v) => ({ v, s: E.nota });
  const lotes = p.lotes;
  const fimAB = 1 + lotes.filter((l) => !String(l[1]).startsWith("C")).length;
  const fimLotes = 1 + lotes.length;
  const opcionais = [
    ["O1", "Opcional", "Perfil de LED embutido sob o aéreo de madeira (2,46 m) + fonte", "AM"],
    ["O2", "Opcional", "Organizador de talheres na gaveta 1", "M1"],
    ["O3", "Alternativa", "Caixas em MDF 18 mm (todos os lotes)", "—"],
    ["O4", "Alternativa", "Aéreo superior com 6 portas de ≈ 512 mm", "AS"],
    ["O5", "Alternativa", "Cabideiro basculante no lugar do varão alto", "G2"],
  ];
  const condicoes = ["Marcenaria / responsável", "Data da proposta e validade", "MDF: fabricante e linha (por padrão de cor)", "Dobradiças e corrediças: fabricante e linha", "Puxador cava: tipo e acabamento propostos", "Prazo de fabricação após a medição", "Prazo de montagem no local", "Forma de pagamento", "Garantia (estrutura, ferragens, acabamento)", "Inclui medição técnica e projeto de fabricação?", "Inclui transporte, montagem e limpeza?", "O que NÃO está incluído", "Ressalvas e pontos que mudariam o preço"];
  const linhasOrc = [
    cab("Lote", "Grupo", "Descrição", "Módulos", "Tipo", "Valor (R$)", "Observações do marceneiro"),
    ...lotes.map((l) => [negrito(l[0]), l[1], l[2], l[4], l[3], { v: "", s: E.moeda }, { v: "", s: E.preencher }]),
    ...opcionais.map((o) => [negrito(o[0]), "Opcionais e alternativas", o[2], o[3], o[1], { v: "", s: E.moeda }, { v: "", s: E.preencher }]),
    [{ v: "Total dos lotes A e B (sem opcionais)", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { f: `SUM(F2:F${fimAB})`, s: E.moeda }, { v: "", s: E.grupo }],
    [{ v: "Total com os complementos da suíte (lotes C)", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { f: `SUM(F2:F${fimLotes})`, s: E.moeda }, { v: "", s: E.grupo }],
    [],
    cab("Condições da proposta", "", "Preencher"),
    ...condicoes.map((c) => [negrito(c), { v: "", s: E.negrito }, { v: "", s: E.preencher }]),
  ];
  const nPecas = p.pecas.length;
  const abas = [
    {
      nome: "Leia-me",
      colunas: [118],
      linhas: [
        [{ v: p.resumo.titulo, s: E.titulo }],
        [`Revisão ${p.resumo.revisao} · ${p.resumo.data} · todas as medidas em milímetros · acompanha o caderno em PDF (pranchas em A3).`],
        [],
        [negrito("Como usar esta planilha")],
        ["Orçamento — preencher as células amarelas: valor de cada lote, opcionais e condições da proposta. Os totais somam sozinhos."],
        ["Módulos — medidas externas de cada módulo (largura × altura × profundidade), frentes, interior e sistema de abertura."],
        ["Peças — lista de peças de referência: uma linha por peça igual dentro do módulo, com medidas, material e bordas com fita."],
        ["Ferragens e Ferragens por módulo — especificação por função (sem marca) e quantidades."],
        ["Materiais — área líquida de MDF por padrão e espessura e metragem de fita de borda."],
        ["Aparelhos — medidas típicas adotadas e vãos previstos. Pendências — o que precisa ser medido, decidido ou confirmado."],
        [],
        [negrito("Avisos")],
        [`Não houve medição no local. O pé-direito (${p.resumo.peDireito} mm) é estimado e define a altura de tudo o que vai até o teto. Medição técnica obrigatória antes de fabricar.`],
        ["Os modelos dos aparelhos não foram informados: os nichos usam medidas típicas de mercado."],
        ["O interior do guarda-roupa é proposta do projeto, ainda a aprovar pelo cliente."],
        ["A lista de peças serve para dimensionar material e mão de obra. O plano de corte definitivo é do marceneiro, depois da medição."],
        ["Fita: C = bordas no comprimento da peça; L = bordas na largura. Frentes e peças aparentes: PVC 1 mm; caixas: PVC 0,45 mm."],
        ["Pedras, cubas, torneiras, eletrodomésticos e instalações elétricas e hidráulicas não fazem parte deste orçamento."],
      ],
    },
    { nome: "Orçamento", colunas: [9, 32, 62, 24, 13, 18, 52], linhas: linhasOrc, congelar: 1 },
    {
      nome: "Módulos",
      colunas: [7, 7, 34, 10, 10, 13, 12, 8, 10, 60, 60, 50, 70],
      linhas: [cab("Lote", "Cód.", "Módulo", "Largura", "Altura", "Profundidade", "Base a (do piso)", "Peças", "MDF (m²)", "Frentes e acabamento", "Interior", "Abertura", "Notas"), ...p.modulos.map((m) => [m[0], negrito(m[1]), m[2], m[3], m[4], m[5], m[6], m[7], n2(m[8]), m[9], m[10], m[11], m[12]])],
      congelar: 1,
      filtro: `A1:M${p.modulos.length + 1}`,
    },
    {
      nome: "Peças",
      colunas: [7, 8, 5, 44, 6, 13, 10, 10, 15, 44, 7, 7, 9, 10, 52],
      linhas: [
        cab("Lote", "Módulo", "Nº", "Peça", "Qtd", "Comprimento", "Largura", "Espessura", "Padrão", "Material", "Fita C", "Fita L", "Fita (m)", "Área (m²)", "Observação"),
        ...p.pecas.map((l) => [l[0], negrito(l[1]), l[2], l[3], l[4], n1(l[5]), n1(l[6]), l[7], l[8], l[9], l[10], l[11], n2(l[12]), n3(l[13]), l[14]]),
        [{ v: "Total (respeita o filtro)", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { f: `SUBTOTAL(109,E2:E${nPecas + 1})`, s: E.inteiro }, "", "", "", "", "", "", "", { f: `SUBTOTAL(109,M2:M${nPecas + 1})`, s: E.decimal2 }, { f: `SUBTOTAL(109,N2:N${nPecas + 1})`, s: E.decimal2 }, ""],
      ],
      congelar: 1,
      filtro: `A1:O${nPecas + 1}`,
    },
    { nome: "Ferragens", colunas: [58, 70, 7, 10, 34], linhas: [cab("Item", "Especificação", "Un.", "Qtd total", "Módulos"), ...p.ferragens.map((f) => [negrito(f[0]), f[1], f[2], n2(f[3]), f[4]])], congelar: 1 },
    {
      nome: "Ferragens por módulo",
      colunas: [7, 8, 58, 62, 7, 9, 44],
      linhas: [cab("Lote", "Módulo", "Item", "Especificação", "Un.", "Qtd", "Observação"), ...p.ferragensPorModulo.map((f) => [f[0], negrito(f[1]), f[2], f[3], f[4], n2(f[5]), f[6]])],
      congelar: 1,
      filtro: `A1:G${p.ferragensPorModulo.length + 1}`,
    },
    {
      nome: "Materiais",
      colunas: [18, 11, 56, 9, 16, 70],
      linhas: [
        cab("Padrão", "Espessura", "Especificação", "Peças", "Área líquida (m²)", "Onde"),
        ...p.materiais.map((m) => [negrito(m[0]), m[1], m[2], m[3], n2(m[4]), m[5]]),
        [{ v: "Total", s: E.grupo }, { v: "", s: E.grupo }, { v: "", s: E.grupo }, { f: `SUM(D2:D${p.materiais.length + 1})`, s: E.inteiro }, { f: `SUM(E2:E${p.materiais.length + 1})`, s: E.decimal2 }, { v: "", s: E.grupo }],
        [nota("Área líquida das peças, sem perdas de corte. Chapa de 2.750 × 1.840 mm ≈ 5,06 m²: acrescentar a perda do plano de corte.")],
        [],
        cab("Fita de borda — padrão", "", "Tipo", "", "Metros"),
        ...p.fitas.map((f) => [negrito(f[0]), "", f[1], "", n1(f[2])]),
        [nota("Metragem líquida das bordas indicadas na lista de peças; acrescentar a sobra de aplicação.")],
      ],
    },
    { nome: "Aparelhos", colunas: [34, 12, 24, 26, 34, 52, 70], linhas: [cab("Aparelho", "Situação", "Medida adotada (L × A × P)", "Vão previsto (L × A × P)", "Onde", "Pontos de instalação", "Atenção"), ...p.aparelhos.map((a) => [negrito(a[0]), ...a.slice(1)])], congelar: 1 },
    { nome: "Pendências", colunas: [8, 11, 14, 14, 130], linhas: [cab("Cód.", "Onde", "Tipo", "Muda o preço?", "Pendência"), ...p.pendencias.map((x) => [negrito(x[0]), x[1], x[2], x[3], x[4]])], congelar: 1 },
  ];
  writeFileSync(join(saida, "planilha-marcenaria.xlsx"), xlsx(abas));
}

const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1588, height: 1123 } });
await page.goto(pathToFileURL(join(saida, "caderno-marcenaria.html")).href);
await page.waitForLoadState("networkidle");
if (previa) {
  const pasta = join(saida, "previa");
  if (!so) rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  for (const p of resultado.pranchas) {
    if (so && !so.includes(p.cod)) continue;
    await page.locator(`section[id="${p.cod}"]`).screenshot({ path: join(pasta, `${p.cod}.png`) });
  }
}
await page.pdf({ path: join(saida, "caderno-marcenaria.pdf"), width: "420mm", height: "297mm", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`Caderno: ${resultado.pranchas.length} pranchas → ${join(saida, "caderno-marcenaria.pdf")} · planilha → ${join(saida, "planilha-marcenaria.xlsx")}`);
