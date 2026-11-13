/** Caderno de marcenaria: monta o documento (HTML para impressão em A3 paisagem) e os dados da planilha. */
import { BASE_ATUAL } from "../modelo/projetoBase";
import { cartaoModulo, tabelaDePecas, textoDasFerragens } from "./cartoes";
import { CHAPA, estimativaDeChapas, lotesDoGrupo, type LinhaChapa } from "./chapas";
import { CSS_DESENHO, DEFS_HACHURAS, Desenho, fmt } from "./desenho";
import { FERRAGENS, LOTES, PADROES, criarMarcenaria, listaDePecas, resumoDeFerragens, resumoDeFitas, resumoDeMateriais, todasAsPecas, type Marcenaria } from "./projeto";
import type { Prancha } from "./pranchas-cozinha";
import { CORTES_A, corteCozinhaB, cortesCozinhaA, detalheCantoCozinha, detalheTipo, elevacaoCozinhaA, elevacaoCozinhaB, plantaCozinha, solidosCozinhaA } from "./pranchas-cozinha";
import { CORTES_SUITE, cortesSuite, elevacaoSuiteA, elevacaoSuiteB, plantaSuite } from "./pranchas-suite";
import type { Modulo } from "./tipos";
import { desenharCorte } from "./vistas";

export const REVISAO = "01";

/** Histórico de revisões (aparece na capa). */
export const REVISOES: { rev: string; data: string; texto: string }[] = [
  { rev: "00", data: "13/11/2026", texto: "Emissão inicial." },
  { rev: "01", data: "13/11/2026", texto: "Lava-louças alinhada com o forno: mesma base, régua embaixo e gaveta rasa em cima (M3); frente de cima do M2 na mesma linha. Estimativa de chapas na prancha Q-01 e na planilha." },
];

const chapasDe = (lista: LinhaChapa[], padrao: string, esp: number) => lista.find((l) => l.padrao === padrao && l.esp === esp)?.chapas ?? 0;
const somaChapas = (lista: LinhaChapa[]) => lista.reduce((t, l) => t + l.chapas, 0);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dec = (v: number, casas = 2) => v.toFixed(casas).replace(".", ",");

/** Regras só da impressão (página A3 e corpo do documento). */
const CSS_IMPRESSAO = `
@page{size:420mm 297mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

/** Estilos das pranchas: valem na impressão e na página publicada (lá, prefixados para não vazar). */
export const CSS_PRANCHAS = `
*{box-sizing:border-box}
.prancha{position:relative;width:420mm;height:297mm;padding:7mm;page-break-after:always;break-after:page;overflow:hidden;background:#fff;font-family:"Liberation Sans",Arial,Helvetica,sans-serif;color:#111;font-size:2.9mm;line-height:1.35}
.prancha>.moldura{position:absolute;inset:7mm;border:0.45mm solid #111;pointer-events:none}
.prancha>.area{position:absolute;left:10mm;right:10mm;top:10mm;bottom:23mm;display:flex;flex-direction:column;gap:2.5mm;overflow:hidden}
.carimbo{position:absolute;left:7mm;right:7mm;bottom:7mm;height:13mm;border-top:0.45mm solid #111;display:grid;grid-template-columns:1.25fr 2fr 0.55fr 0.5fr 0.5fr 0.45fr;font-size:2.5mm}
.carimbo>div{border-right:0.2mm solid #111;padding:1.2mm 2.2mm;display:flex;flex-direction:column;justify-content:center;min-width:0}
.carimbo>div:last-child{border-right:0}
.carimbo small{font-size:1.9mm;color:#555;text-transform:uppercase;letter-spacing:0.05mm}
.carimbo b{font-size:3.1mm}
.centro{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.linha{display:flex;gap:4mm;align-items:flex-end;justify-content:center}
h1,h2,h3,p{margin:0}
h2{font-size:4.4mm;border-bottom:0.3mm solid #111;padding-bottom:0.8mm;margin-bottom:1.5mm}
h3{font-size:3.3mm;margin:1.5mm 0 0.8mm}
.legenda{display:flex;flex-wrap:wrap;gap:1mm 5mm;font-size:2.4mm;color:#111;align-items:center;border:0.2mm solid #9ca3af;padding:1mm 2mm;background:#fafafa}
.legenda b.m{display:inline-block;min-width:3.4mm;text-align:center;font-size:2.5mm}
.mP{color:#15803d}.mE{color:#c2410c}.mL{color:#b91c1c}.mT{color:#6d28d9}.mA{color:#0369a1}
.titulo-des{font-size:3.4mm;font-weight:700}
.sub{font-size:2.5mm;color:#374151}
.colunas{display:grid;gap:5mm}
.c2{grid-template-columns:1fr 1fr}.c3{grid-template-columns:1fr 1fr 1fr}.c32{grid-template-columns:3fr 2fr}.c23{grid-template-columns:2fr 3fr}
table{border-collapse:collapse;width:100%}
table.t{font-size:2.5mm;line-height:1.25}
table.t th{background:#111;color:#fff;font-weight:600;padding:0.8mm 1.3mm;text-align:left;vertical-align:bottom}
table.t td{border-bottom:0.12mm solid #9ca3af;padding:0.7mm 1.3mm;vertical-align:top}
table.t td.c,table.t th.c{text-align:center}
table.t td.n,table.t th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
table.t tr.grupo td{background:#e5e7eb;font-weight:700;border-bottom:0.2mm solid #111}
table.t tr.total td{font-weight:700;border-top:0.3mm solid #111;border-bottom:0}
table.t td.vazio{background:#fffbea;border:0.15mm solid #9ca3af;min-width:24mm}
table.orc td{height:8.5mm;vertical-align:middle}
table.orc tr.grupo td{height:auto}
table.t i{color:#4b5563}
ul.lista{margin:0;padding-left:4mm}
ul.lista li{margin-bottom:0.8mm}
.caixa{border:0.25mm solid #111;padding:2mm 2.5mm}
.aviso{border:0.3mm solid #b45309;background:#fffbeb;padding:1.6mm 2.2mm;font-size:2.6mm}
.capa-titulo{font-size:11mm;font-weight:700;line-height:1.05;letter-spacing:-0.1mm}
.capa-sub{font-size:5mm;color:#374151;margin-top:1.5mm}
.fotos{display:grid;gap:3mm}
.fotos figure{margin:0;border:0.25mm solid #111;display:flex;flex-direction:column;min-height:0}
.fotos img{display:block;width:100%;height:100%;object-fit:contain;min-height:0;flex:1;background:#f3f4f6}
.fotos.natural img{height:auto;flex:none;aspect-ratio:1650/1200}
.texto{font-size:3.15mm}
.texto table.t{font-size:2.95mm}
.texto .sub{font-size:2.75mm}
.texto .aviso{font-size:2.95mm}
.fotos figcaption{font-size:2.4mm;padding:0.8mm 1.5mm;border-top:0.25mm solid #111;background:#f3f4f6}
.pill{display:inline-block;border:0.15mm solid #111;border-radius:1mm;padding:0 1mm;font-size:2.2mm;font-weight:700}
.t-medir{background:#fee2e2}.t-decidir{background:#ede9fe}.t-aparelho{background:#e0f2fe}.t-tecnico{background:#fef3c7}
.cartao{border:0.25mm solid #111;display:flex;flex-direction:column;min-height:0}
.cartao>header{display:flex;align-items:baseline;gap:3mm;padding:1.2mm 2.5mm;border-bottom:0.25mm solid #111;background:#f3f4f6}
.cartao .cod{font-size:4.6mm}
.cartao .nome{font-size:3.5mm;font-weight:700}
.cartao .med{font-size:2.9mm}
.cartao .lote{margin-left:auto;font-size:2.5mm;color:#374151}
.cartao-corpo{display:flex;gap:3mm;padding:2mm 2.5mm;align-items:flex-start}
.cartao-des{display:flex;gap:1mm;align-items:flex-end;flex:none}
.cartao-info{flex:1;min-width:0;font-size:2.45mm;line-height:1.3}
.cartao-info p{margin:0 0 1.2mm}
.cartao-info .notas{margin:1mm 0 0;padding-left:3.5mm;color:#374151}
.cartao-info .notas li{margin-bottom:0.4mm}
table.pecas{font-size:2.3mm;line-height:1.2;margin-bottom:1.2mm}
table.pecas th{background:#111;color:#fff;font-weight:600;padding:0.5mm 1mm;text-align:left}
table.pecas td{border-bottom:0.1mm solid #9ca3af;padding:0.35mm 1mm;vertical-align:top}
table.pecas td.c,table.pecas th:nth-child(1){text-align:center}
table.pecas td.n{white-space:nowrap;font-variant-numeric:tabular-nums}
table.pecas i{color:#4b5563}
.am{display:inline-block;width:2.2mm;height:2.2mm;border:0.1mm solid #111;margin-right:1mm;vertical-align:-0.3mm}
.amg{display:inline-block;width:9mm;height:5mm;border:0.15mm solid #111;vertical-align:middle}
${CSS_DESENHO}
`;

const LEGENDA = `<div class="legenda"><b>Origem das medidas:</b>
<span><b class="m mP">P</b> cota escrita na planta da construtora</span>
<span><b class="m mE">E</b> estimada pela escala da planta — conferir no local</span>
<span><b class="m mA">A</b> aparelho com medida típica — conferir o modelo</span>
<span><b class="m mT">T</b> proposta técnica do interior — a aprovar</span>
<span><b class="m">sem marca</b> medida do móvel no 3D aprovado</span></div>`;

function folha(p: Prancha, n: number, total: number, data: string): string {
  return `<section class="prancha" id="${p.cod}"><div class="area">${p.html}</div><div class="moldura"></div>
<div class="carimbo"><div><small>Documento</small><b>Caderno de marcenaria</b><span>Projeto executivo para orçamento</span></div>
<div><small>Prancha</small><b>${p.cod} — ${esc(p.titulo)}</b></div>
<div><small>Escala</small><b>${p.escala}</b></div><div><small>Unidade</small><b>mm</b></div>
<div><small>Revisão · data</small><b>${REVISAO} · ${data}</b></div><div><small>Folha</small><b>${n}/${total}</b></div></div></section>`;
}

const desenho = (titulo: string, sub: string, svg: string) => `<div><div class="titulo-des">${esc(titulo)}</div><div class="sub">${esc(sub)}</div></div><div class="centro">${svg}</div>`;

const vaoTexto = (v: [number, number, number]) => (v.every((x) => x > 0) ? v.map(fmt).join(" × ") : v[1] > 0 ? `${fmt(v[1])} de altura livre` : "—");

const dimsDoModulo = (m: Modulo) => `${fmt(m.caixa.s1 - m.caixa.s0)} × ${fmt(m.caixa.z1 - m.caixa.z0)} × ${fmt(m.caixa.d1 - m.caixa.d0)}`;

function quadroDeModulos(mc: Marcenaria, lotes: string[]): string {
  const linhas = mc.modulos
    .filter((m) => lotes.includes(m.lote))
    .map((m) => {
      const { linhas: pecas } = listaDePecas(m);
      const area = pecas.reduce((a, l) => a + l.areaM2, 0);
      return `<tr><td class="c"><b>${m.cod}</b></td><td>${esc(m.nome)}</td><td class="c">${m.lote}</td><td class="n">${dimsDoModulo(m)}</td><td class="n">${m.caixa.z0 > 0 ? fmt(m.caixa.z0) : "piso"}</td><td>${esc(m.externo)}</td><td class="n">${pecas.reduce((a, l) => a + l.qtd, 0)}</td><td class="n">${dec(area)}</td></tr>`;
    })
    .join("");
  return `<table class="t"><thead><tr><th class="c">Cód.</th><th>Módulo</th><th class="c">Lote</th><th class="n">L × A × P</th><th class="n">Base a</th><th>Frentes e acabamento</th><th class="n">Peças</th><th class="n">MDF m²</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

/** Detalhe em corte do encontro aéreo superior / faixa verde / aéreo de madeira. */
function detalheAereos(mc: Marcenaria): string {
  const e = 5;
  const d = new Desenho(-100 - 10 * e, 1480 - 4 * e, 420 + 34 * e, 2080 + 8 * e, e);
  d.ret(-100, 1480, 0, 2080, "par", { camada: 0 });
  const solidos = solidosCozinhaA(mc)
    .filter((x) => x.s1 > 0 && x.z1 > 1480 && x.z0 < 2080 && x.classe !== "aparelho")
    .map((x) => ({ ...x, z0: Math.max(x.z0, 1480), z1: Math.min(x.z1, 2080) }));
  desenharCorte(d, solidos, { s: 400, olhar: 1, alcance: 1 });
  d.cadeiaH([0, 320], 1480 - 0.5 * e, { lado: -1 });
  d.cadeiaH([0, 360], 2080 + 4 * e, { lado: 1 });
  d.cadeiaV([1550, 1900, 1980], 360 + 9 * e, { lado: 1, ref: 360 });
  d.chamada(351, 1940, "régua frontal verde 80 × 18", 12, -3, { tam: 2 });
  d.chamada(312, 1909, "fechamento inferior 60 × 18", 20, 5, { tam: 2 });
  d.chamada(351, 2030, "porta off-white (fecho toque)", 12, -6, { tam: 2 });
  d.chamada(311, 1700, "porta em madeira (fecho toque)", 20, 3, { tam: 2 });
  d.chamada(170, 1940, "vazio de 80: fiação e fonte do LED", -20, 12, { tam: 2 });
  d.chamada(35, 1547, "perfil de LED embutido", 16, 8, { tam: 2 });
  d.txt(210, 2080 + 9 * e, "Detalhe — encontro dos aéreos (corte, 1:5)", { tam: 2.6, peso: 700 });
  return d.svg("Detalhe do encontro dos aéreos");
}

function tabelaSimples(mc: Marcenaria, cods: string[]): string {
  return cods
    .map((cod) => {
      const m = mc.modulos.find((x) => x.cod === cod)!;
      const { linhas } = listaDePecas(m);
      return `<article class="cartao sem-desenho"><header><b class="cod">${m.cod}</b><span class="nome">${esc(m.nome)}</span><span class="med">${dimsDoModulo(m)} (L × A × P)</span><span class="lote">Lote ${m.lote}</span></header>
<div class="cartao-corpo"><div class="cartao-info"><p><b>Descrição.</b> ${esc(m.externo)}${m.interno !== "—" ? ` ${esc(m.interno)}` : ""}</p>${tabelaDePecas(linhas)}<p class="ferr"><b>Ferragens.</b> ${textoDasFerragens(m)}</p>${m.notas.length ? `<ul class="notas">${m.notas.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div></div></article>`;
    })
    .join("");
}

export interface OpcoesCaderno {
  /** Imagens 3D (nome → data URL). */
  imagens?: Record<string, string>;
  data?: string;
}

export interface Planilha {
  resumo: Record<string, string>;
  modulos: (string | number)[][];
  pecas: (string | number)[][];
  ferragensPorModulo: (string | number)[][];
  ferragens: (string | number)[][];
  materiais: (string | number)[][];
  fitas: (string | number)[][];
  aparelhos: (string | number)[][];
  pendencias: (string | number)[][];
  lotes: (string | number)[][];
  /** Estimativa de chapas: padrão, espessura, área, chapas (tudo), aproveitamento, A + B, A, B, C. */
  chapas: (string | number)[][];
}

export function dadosDaPlanilha(mc: Marcenaria, data: string): Planilha {
  const pecas = todasAsPecas(mc);
  const loteDe = new Map(mc.modulos.map((m) => [m.cod, m.lote]));
  const nomeLote = new Map(LOTES.map((l) => [l.cod, l]));
  return {
    resumo: { titulo: "Caderno de marcenaria — projeto executivo para orçamento", revisao: REVISAO, data, base: BASE_ATUAL, peDireito: String(mc.peDireito) },
    modulos: mc.modulos.map((m) => {
      const { linhas } = listaDePecas(m);
      return [m.lote, m.cod, m.nome, m.caixa.s1 - m.caixa.s0, m.caixa.z1 - m.caixa.z0, m.caixa.d1 - m.caixa.d0, m.caixa.z0, linhas.reduce((a, l) => a + l.qtd, 0), Math.round(linhas.reduce((a, l) => a + l.areaM2, 0) * 100) / 100, m.externo, m.interno, m.abertura, m.notas.join(" | ")];
    }),
    pecas: pecas.map((l) => [loteDe.get(l.modulo) ?? "", l.modulo, l.n, l.nome, l.qtd, l.comp, l.larg, l.esp, PADROES[l.padrao].nome, PADROES[l.padrao].espec, l.fitaC, l.fitaL, l.fitaM, l.areaM2, l.obs ?? ""]),
    ferragensPorModulo: mc.modulos.flatMap((m) => m.ferragens.map((f) => [m.lote, m.cod, FERRAGENS[f.item].nome, FERRAGENS[f.item].espec, FERRAGENS[f.item].unidade, f.qtd, f.obs ?? ""])),
    ferragens: resumoDeFerragens(mc.modulos).map((f) => [f.nome, f.espec, f.unidade, f.qtd, f.modulos]),
    materiais: resumoDeMateriais(pecas).map((r) => [PADROES[r.padrao].nome, r.esp, PADROES[r.padrao].espec, r.pecas, r.areaM2, PADROES[r.padrao].onde]),
    fitas: resumoDeFitas(mc).map((f) => [PADROES[f.padrao].nome, f.tipo, f.metros]),
    aparelhos: mc.aparelhos.map((a) => [a.nome, a.situacao, a.medida.join(" × "), vaoTexto(a.vao), a.onde, a.pontos, a.atencao]),
    pendencias: mc.pendencias.map((p) => [p.cod, p.onde, p.tipo, p.afetaPreco ? "sim" : "não", p.texto]),
    lotes: LOTES.map((l) => [l.cod, l.grupo, l.nome, l.opcional ? "opcional" : "obrigatório", mc.modulos.filter((m) => m.lote === l.cod).map((m) => m.cod).join(", "), nomeLote.get(l.cod) ? "" : ""]),
    chapas: (() => {
      const tudo = estimativaDeChapas(mc);
      const ab = estimativaDeChapas(mc, [...lotesDoGrupo("A"), ...lotesDoGrupo("B")]);
      const [a, b, c] = ["A", "B", "C"].map((g) => estimativaDeChapas(mc, lotesDoGrupo(g)));
      return tudo.map((l) => [PADROES[l.padrao].nome, l.esp, l.areaM2, l.chapas, l.aproveitamento, chapasDe(ab, l.padrao, l.esp), chapasDe(a, l.padrao, l.esp), chapasDe(b, l.padrao, l.esp), chapasDe(c, l.padrao, l.esp)]);
    })(),
  };
}

export interface Caderno {
  html: string;
  pranchas: { cod: string; titulo: string }[];
  planilha: Planilha;
  /** Para a página publicada: estilos das pranchas e o HTML de cada folha. */
  css: string;
  folhas: { cod: string; titulo: string; escala: string; html: string }[];
  resumo: { modulos: number; pecas: number; areaM2: number; peDireito: number; data: string; revisao: string };
}

export function gerarCaderno(o: OpcoesCaderno = {}): Caderno {
  const mc = criarMarcenaria();
  const data = o.data ?? "13/11/2026";
  const img = (nome: string, legenda: string) => (o.imagens?.[nome] ? `<figure><img src="${o.imagens[nome]}" alt="${esc(legenda)}"><figcaption>${esc(legenda)}</figcaption></figure>` : `<figure><figcaption>${esc(legenda)} (imagem não gerada)</figcaption></figure>`);
  const pecas = todasAsPecas(mc);
  const materiais = resumoDeMateriais(pecas);
  const fitas = resumoDeFitas(mc);
  const ferragens = resumoDeFerragens(mc.modulos);
  const pd = mc.peDireito;
  const chapasTudo = estimativaDeChapas(mc);
  const chapasAB = estimativaDeChapas(mc, [...lotesDoGrupo("A"), ...lotesDoGrupo("B")]);
  const totalArea = materiais.reduce((a, r) => a + r.areaM2, 0);
  const totalPecas = materiais.reduce((a, r) => a + r.pecas, 0);
  const nPortas = mc.modulos.reduce((a, m) => a + m.solidos.filter((x) => x.classe === "porta").length, 0);
  const nGavetas = mc.modulos.reduce((a, m) => a + m.solidos.filter((x) => x.classe === "frente-gaveta").length, 0);

  const pranchas: Prancha[] = [];
  const add = (cod: string, titulo: string, escala: string, html: string) => pranchas.push({ cod, titulo, escala, html });

  // ------------------------------------------------------------------ 01 — notas gerais
  add(
    "N-01",
    "Notas gerais, sistema construtivo e materiais",
    "—",
    `<div class="colunas c3 texto" style="flex:1;min-height:0">
<div><h2>Sistema construtivo de referência</h2>
<p class="sub" style="margin-bottom:1.5mm">Padrão único para que todos orcem a mesma coisa. Quem trabalhar com outro sistema (por exemplo, caixa de 18 mm) deve cotar este como base e a alternativa em separado.</p>
<table class="t"><tbody>
<tr><td><b>Caixas</b></td><td>MDF BP 15 mm branco TX, 2 faces. Laterais inteiras; base e tampo entre as laterais; união por cavilha e minifix (ou parafuso estrutural oculto).</td></tr>
<tr><td><b>Frentes e peças aparentes</b></td><td>MDF BP 18 mm, 2 faces, no padrão indicado em cada módulo (portas, frentes de gaveta, painéis, molduras, réguas e rodapés).</td></tr>
<tr><td><b>Fundos</b></td><td>MDF BP 6 mm branco, sobrepostos e parafusados (ou em canal), 2 mm menores que a caixa de cada lado.</td></tr>
<tr><td><b>Prateleiras</b></td><td>15 mm; 18 mm quando o vão passa de 800 mm ou recebe aparelho. Reguláveis: 4 pinos, 1 mm de folga lateral e 20 mm de recuo na frente.</td></tr>
<tr><td><b>Gavetas</b></td><td>Caixa em MDF 15 mm branco (2 laterais, contrafrente e traseira) e fundo de 6 mm. Corrediça telescópica: 13 mm de cada lado.</td></tr>
<tr><td><b>Folgas</b></td><td>3 mm entre frentes; 3 mm no topo e na base das frentes; 2 mm de batente entre a frente e a caixa.</td></tr>
<tr><td><b>Fitas de borda</b></td><td>PVC 1 mm na cor do painel em todas as bordas das frentes e peças aparentes; PVC 0,45 mm nas bordas visíveis das caixas. Nas listas: C = borda do comprimento, L = borda da largura.</td></tr>
<tr><td><b>Rodapés</b></td><td>Cozinha: 100 mm, recuado 60 mm, removível, sobre pés reguláveis. Guarda-roupa: 80 mm, recuado 60 mm na frente.</td></tr>
<tr><td><b>Painéis engrossados</b></td><td>30 mm = 2 chapas de 15 mm coladas (painel da geladeira e painel da ponte).</td></tr>
<tr><td><b>Réguas de ajuste</b></td><td>Parede e teto fora de prumo: prever réguas de arremate no mesmo padrão, definidas na medição e incluídas no preço.</td></tr>
<tr><td><b>Fixação</b></td><td>Aéreos em suporte regulável com bucha adequada à alvenaria; armário-ponte com fixação reforçada.</td></tr>
<tr><td><b>Montagem</b></td><td>No local, incluída. Portas acima de 2.000 mm com tensor.</td></tr>
</tbody></table></div>
<div><h2>Padrões de acabamento</h2>
<p class="sub" style="margin-bottom:1.5mm">As cores abaixo são as do 3D aprovado. Não há marca definida: cada marceneiro informa fabricante, linha e nome do padrão que propõe e apresenta amostra.</p>
<table class="t"><thead><tr><th>Cor</th><th>Padrão</th><th>Onde</th></tr></thead><tbody>
${(Object.keys(PADROES) as (keyof typeof PADROES)[]).map((k) => `<tr><td><span class="amg" style="background:${PADROES[k].cor}"></span></td><td><b>${esc(PADROES[k].nome)}</b><br>${esc(PADROES[k].espec)}</td><td>${esc(PADROES[k].onde)}</td></tr>`).join("")}
<tr><td><span class="amg" style="background:#dbe6ec"></span></td><td><b>Espelho</b><br>Prata 3 mm, bordas lapidadas, colado</td><td>Portas do G2</td></tr>
<tr><td><span class="amg" style="background:#3a4233"></span></td><td><b>Puxador cava</b><br>Perfil de alumínio escuro fosco</td><td>Topo das frentes de baixo da cozinha</td></tr>
</tbody></table>
<h3>Fora deste orçamento (outros fornecedores)</h3>
<ul class="lista"><li>Bancadas de quartzo, frontões de granilite e revestimento do shaft (marmoraria).</li><li>Cubas, torneiras e eletrodomésticos.</li><li>Pontos elétricos, hidráulicos e de gás; fitas de LED do teto.</li><li>Banheiro, quarto 2, rack e demais móveis: não fazem parte deste caderno.</li></ul></div>
<div><h2>Regras para o orçamento</h2>
<ul class="lista">
<li><b>Preço por lote</b>, separado: A1 a A4 (cozinha), B1 e B2 (guarda-roupa) e, como opcionais, C1 a C4 (complementos da suíte). Usar o quadro da prancha Q-02.</li>
<li><b>Informar</b> fabricante e linha do MDF e das ferragens, prazo de entrega e de montagem, garantia, validade da proposta e forma de pagamento.</li>
<li><b>Incluir no preço</b>: medição técnica, projeto de fabricação, todas as ferragens listadas, réguas de ajuste, recortes para instalações, transporte, montagem e limpeza.</li>
<li><b>Itens opcionais</b> (perfil de LED sob o aéreo, organizador de talheres, alternativas de abertura): cotar em linha separada.</li>
<li><b>Alternativas técnicas</b> do marceneiro são bem-vindas, sempre como opção à parte, sem mexer no preço-base.</li>
<li><b>Lista de peças é de referência</b>: serve para dimensionar material e mão de obra. O plano de corte definitivo é do marceneiro, depois da medição no local.</li>
<li><b>Divergência</b> entre este caderno e a medição: avisar antes de fabricar.</li>
</ul>
<h3>Medição técnica antes da fabricação</h3>
<div class="aviso">As cotas marcadas <b class="mP">P</b> vêm da planta da construtora; as marcadas <b class="mE">E</b> foram lidas pela escala da imagem. O <b>pé-direito (${pd} mm) é estimado</b> e define a altura de tudo o que vai até o teto. Nenhuma peça deve ser cortada sem a medição no local. Pendências completas na prancha P-01.</div>
<h3>Correspondência com o 3D</h3>
<p>Largura, altura, profundidade e posição de cada módulo saem diretamente do modelo 3D aprovado (base ${BASE_ATUAL}); as vistas, os cortes e as listas são gerados das mesmas peças. O interior dos armários não aparece no 3D: é proposta técnica, marcada <b class="mT">T</b>.</p>
<div style="margin-top:3mm">${detalheTipo(mc)}</div></div></div>`,
  );

  // ------------------------------------------------------------------ cozinha
  add("C-01", "Cozinha · planta e quadro de módulos", "1:15", `${LEGENDA}<div class="centro">${plantaCozinha(mc)}</div>${quadroDeModulos(mc, ["A1", "A2", "A3", "A4"])}`);
  add("C-02", "Cozinha · elevação A — vista externa", "1:15", `${LEGENDA}${desenho("Elevação A — vista externa", "Parede da bancada, vista do corredor. Triângulos tracejados: abertura das portas (o vértice fica do lado das dobradiças).", elevacaoCozinhaA(mc, false))}`);
  add("C-03", "Cozinha · elevação A — vista interna", "1:15", `${LEGENDA}${desenho("Elevação A — vista interna (sem portas e frentes)", "Caixas, divisórias, prateleiras e gavetas. Aparelhos em tracejado, com medidas típicas (ver prancha C-06).", elevacaoCozinhaA(mc, true))}`);
  add("C-04", "Cozinha · cortes transversais", "1:20", `${LEGENDA}<div><div class="titulo-des">Cortes transversais da parede A</div><div class="sub">Posições na planta (C-01): ${CORTES_A.map((c) => `corte ${c.n} a ${c.s} mm do shaft`).join(" · ")}. Peças cortadas em cinza; o que fica atrás, em vista.</div></div><div class="centro"><div class="linha">${cortesCozinhaA(mc)}</div></div>`);
  add("C-05", "Cozinha · área de serviço e canto do L", "1:12,5 e 1:10", `${LEGENDA}<div class="centro"><div class="linha">${elevacaoCozinhaB(mc, false)}${corteCozinhaB(mc)}${detalheCantoCozinha(mc)}</div></div>`);
  add(
    "C-06",
    "Cozinha · aparelhos, pontos de instalação e detalhe dos aéreos",
    "1:5",
    `<div class="colunas c32 texto" style="flex:1;min-height:0"><div>
<h2>Aparelhos e vãos previstos</h2>
<p class="sub" style="margin-bottom:1.5mm">Nenhum modelo foi informado: as medidas dos aparelhos são típicas de mercado. Informar marca e modelo antes de fechar os vãos.</p>
<table class="t"><thead><tr><th>Aparelho</th><th>Situação</th><th class="n">Aparelho (L × A × P)</th><th class="n">Vão previsto (L × A × P)</th><th>Onde</th><th>Atenção</th></tr></thead><tbody>
${mc.aparelhos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${a.situacao}</td><td class="n">${a.medida.map(fmt).join(" × ")} <b class="mA">A</b></td><td class="n">${vaoTexto(a.vao)}</td><td>${esc(a.onde)}</td><td>${esc(a.atencao)}</td></tr>`).join("")}
</tbody></table>
<h2 style="margin-top:3mm">Pontos de instalação que a marcenaria precisa encontrar</h2>
<p class="sub" style="margin-bottom:1.5mm">A posição dos pontos existentes não consta na planta. A coluna "onde deve ficar" é a necessidade do projeto; confirmar com o eletricista e o encanador o que já existe.</p>
<table class="t"><thead><tr><th>Ponto</th><th>Onde deve ficar</th><th>Para quê</th></tr></thead><tbody>
${mc.aparelhos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.onde)}</td><td>${esc(a.pontos)}</td></tr>`).join("")}
<tr><td><b>Pia</b></td><td>Dentro do M4, abaixo da cuba</td><td>Água fria e esgoto; recorte no fundo do módulo</td></tr>
<tr><td><b>Tanque</b></td><td>Dentro do T1 ou na parede da janela</td><td>Água fria e esgoto; no decorado a torneira sai da parede</td></tr>
<tr><td><b>Fita de LED sob o aéreo</b></td><td>Fonte no vazio da faixa verde (FV)</td><td>Ponto de energia com interruptor</td></tr>
<tr><td><b>Tomadas de bancada</b></td><td>No frontão, entre 900 e 1.550 mm</td><td>Recortes na pedra (marmoraria); não interferem nos armários</td></tr>
</tbody></table></div>
<div class="centro">${detalheAereos(mc)}</div></div>`,
  );
  add("C-07", "Cozinha · módulos M1 e M2", "1:10", cartaoModulo(mc, "M1") + cartaoModulo(mc, "M2"));
  add("C-08", "Cozinha · módulos M3 e M4", "1:10", cartaoModulo(mc, "M3") + cartaoModulo(mc, "M4"));
  add("C-09", "Cozinha · módulos M5 e T1", "1:10", cartaoModulo(mc, "M5") + cartaoModulo(mc, "T1", { cortes: [540] }));
  add("C-10", "Cozinha · módulos AG e NM", "1:10", cartaoModulo(mc, "AG") + cartaoModulo(mc, "NM"));
  const as = mc.modulos.find((m) => m.cod === "AS")!;
  add(
    "C-11",
    "Cozinha · módulos AS e AM",
    "1:12,5 e 1:20",
    cartaoModulo(mc, "AS", { escala: 12.5, recorte: [as.caixa.s0, (as.caixa.s0 + as.caixa.s1) / 2], avisoDesenho: "Desenhada a 1ª das 2 caixas (a 2ª é igual, com as duas laterais brancas). A lista traz as duas." }) + cartaoModulo(mc, "AM", { escala: 20 }),
  );
  add("C-12", "Cozinha · painel, faixa verde e rodapé", "—", tabelaSimples(mc, ["PG", "FV", "RA"]));
  add(
    "C-13",
    "Cozinha · imagens 3D",
    "—",
    `<div class="sub">Imagens do modelo 3D aprovado, para comparar com os desenhos técnicos. Cores e proporções são as do projeto; os aparelhos são representações genéricas.</div>
<div class="fotos" style="grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;flex:1;min-height:0">
${img("marc-cozinha-frontal", "Parede A de frente (sem a divisória da sala) — comparar com a elevação C-02")}${img("cozinha-referencia", "Vista a partir da entrada da cozinha")}
${img("marc-cozinha-servico", "Área de serviço: tanque, lava e seca e canto do L — comparar com C-05")}${img("geladeira", "Torre da geladeira: painel lateral e armário superior")}</div>`,
  );

  // ------------------------------------------------------------------ suíte
  add("G-01", "Suíte · planta e quadro de módulos", "1:20", `${LEGENDA}<div class="centro">${plantaSuite(mc)}</div>${quadroDeModulos(mc, ["B1", "B2", "C1", "C2", "C3", "C4"])}`);
  add("G-02", "Suíte · elevação A — vista externa", "1:15", `${LEGENDA}${desenho("Elevação A — vista externa", "Parede da cabeceira: painel, armário-ponte, cabeceira, criados, coluna e guarda-roupa de espelho. À direita, a lateral do G4.", elevacaoSuiteA(mc, false))}`);
  add("G-03", "Suíte · elevação A — vista interna", "1:15", `${LEGENDA}${desenho("Elevação A — vista interna (sem as portas)", "Interior proposto: cabideiro duplo no G2 e prateleiras no armário-ponte.", elevacaoSuiteA(mc, true))}`);
  add("G-04", "Suíte · elevação B — vistas externa e interna", "1:20", `${LEGENDA}<div class="centro"><div class="linha">${elevacaoSuiteB(mc, false)}${elevacaoSuiteB(mc, true)}</div></div>`);
  add("G-05", "Suíte · cortes", "1:15", `${LEGENDA}<div><div class="titulo-des">Cortes do guarda-roupa e dos complementos</div><div class="sub">${CORTES_SUITE.map((c) => `Corte ${c.n}: ${c.legenda}`).join(" · ")}. Cortes 1 e 2 pela parede A; 3 a 5 pela parede B.</div></div><div class="centro"><div class="linha">${cortesSuite(mc)}</div></div>`);
  add("G-06", "Suíte · módulos G2 e CO", "1:20", cartaoModulo(mc, "G2", { escala: 20 }) + tabelaSimples(mc, ["CO"]));
  add("G-07", "Suíte · módulo G4 (portas cinza + canto)", "1:15", cartaoModulo(mc, "G4", { escala: 15, cortes: [1350] }));
  const ap = mc.modulos.find((m) => m.cod === "AP")!;
  add(
    "G-08",
    "Suíte · complementos: AP, CR, PJ e CB",
    "1:10 e 1:5",
    cartaoModulo(mc, "AP", { escala: 10, recorte: [ap.caixa.s0, ap.caixa.s0 + (ap.caixa.s1 - ap.caixa.s0) / 3], avisoDesenho: "Desenhada 1 das 3 caixas iguais. A lista traz as três." }) +
      cartaoModulo(mc, "CR1", { escala: 5, avisoDesenho: "São 2 criados iguais (CR1 e CR2): a lista abaixo é de uma unidade." }),
  );
  add("G-09", "Suíte · painel lateral e cabeceira", "—", tabelaSimples(mc, ["PJ", "CB"]));
  add(
    "G-10",
    "Suíte · imagens 3D",
    "—",
    `<div class="sub">Imagens do modelo 3D aprovado, para comparar com os desenhos técnicos. O interior do guarda-roupa não aparece no 3D.</div>
<div class="fotos" style="grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;flex:1;min-height:0">
${img("marc-suite-frontal", "Parede A de frente (sem a parede do quarto 2 e sem a cama) — comparar com a elevação G-02")}${img("marc-suite-canto", "Guarda-roupa em L: espelho, moldura de carvalho, portas cinza e lateral")}
${img("marc-suite-guarda-roupa", "Vista a partir da janela: armário-ponte, coluna e guarda-roupa")}${img("marc-suite-ponte", "Vista a partir da porta: cabeceira, criados e armário-ponte")}</div>`,
  );

  // ------------------------------------------------------------------ quantitativos, orçamento e pendências
  add(
    "Q-01",
    "Quantitativos · materiais, fitas e ferragens",
    "—",
    `<div class="colunas c23 texto" style="flex:1;min-height:0"><div>
<h2>Chapas de MDF (área líquida e estimativa de chapas)</h2>
<table class="t"><thead><tr><th>Cor</th><th>Material</th><th class="n">Peças</th><th class="n">Área (m²)</th><th class="n">Chapas<br>A + B</th><th class="n">Chapas<br>A + B + C</th></tr></thead><tbody>
${materiais.map((r) => `<tr><td><span class="amg" style="background:${PADROES[r.padrao].cor}"></span></td><td><b>MDF ${fmt(r.esp)} mm</b> · ${esc(PADROES[r.padrao].nome)}</td><td class="n">${r.pecas}</td><td class="n">${dec(r.areaM2)}</td><td class="n">${chapasDe(chapasAB, r.padrao, r.esp) || "—"}</td><td class="n"><b>${chapasDe(chapasTudo, r.padrao, r.esp)}</b></td></tr>`).join("")}
<tr class="total"><td></td><td>Total</td><td class="n">${totalPecas}</td><td class="n">${dec(totalArea)}</td><td class="n">${somaChapas(chapasAB)}</td><td class="n">${somaChapas(chapasTudo)}</td></tr></tbody></table>
<p class="sub" style="margin-top:1mm">Peças e área: todos os lotes. Chapas inteiras de ${fmt(CHAPA.comp)} × ${fmt(CHAPA.larg)} mm pelo plano de corte de referência (refilo de ${CHAPA.refilo} mm, serra de ${CHAPA.serra} mm, veio respeitado nos madeirados). A + B = cozinha e guarda-roupa; A + B + C inclui os complementos da suíte. É estimativa: o plano de corte do marceneiro pode variar em uma chapa por material, e contratar os lotes em separado aumenta a soma. Detalhe por lote na planilha, aba Chapas.</p>
<h2 style="margin-top:3mm">Fitas de borda</h2>
<table class="t"><thead><tr><th>Cor</th><th>Padrão</th><th>Tipo</th><th class="n">Metros</th></tr></thead><tbody>
${fitas.map((f) => `<tr><td><span class="amg" style="background:${PADROES[f.padrao].cor}"></span></td><td>${esc(PADROES[f.padrao].nome)}</td><td>${f.tipo}</td><td class="n">${dec(f.metros, 1)}</td></tr>`).join("")}
<tr class="total"><td></td><td>Total</td><td></td><td class="n">${dec(fitas.reduce((a, f) => a + f.metros, 0), 1)}</td></tr></tbody></table>
<p class="sub" style="margin-top:1mm">Metragem líquida das bordas indicadas nas listas de peças; acrescentar a sobra de aplicação.</p></div>
<div><h2>Ferragens e acessórios (todos os lotes)</h2>
<table class="t"><thead><tr><th>Item</th><th>Especificação</th><th class="n">Qtd</th><th>Un.</th><th>Módulos</th></tr></thead><tbody>
${ferragens.map((f) => `<tr><td><b>${esc(f.nome)}</b></td><td>${esc(f.espec)}</td><td class="n">${String(f.qtd).replace(".", ",")}</td><td>${f.unidade}</td><td>${f.modulos}</td></tr>`).join("")}
</tbody></table>
<p class="sub" style="margin-top:1mm">Especificação por função, sem marca: o marceneiro informa fabricante e linha (ou equivalente técnico). Parafusos, cavilhas, minifix, buchas e cola estão incluídos na montagem. A lista por módulo está em cada prancha de detalhamento e na planilha.</p></div></div>`,
  );
  const grupos = [...new Set(LOTES.map((l) => l.grupo))];
  add(
    "Q-02",
    "Quadro para orçamento (preencher e devolver)",
    "—",
    `<div class="colunas c32 texto" style="flex:1;min-height:0"><div>
<h2>Preço por lote</h2>
<table class="t orc"><thead><tr><th class="c">Lote</th><th>Descrição</th><th>Módulos</th><th class="n">MDF m²</th><th>Valor (R$)</th><th>Observações do marceneiro</th></tr></thead><tbody>
${grupos
  .map((g) => {
    const linhas = LOTES.filter((l) => l.grupo === g)
      .map((l) => {
        const mods = mc.modulos.filter((m) => m.lote === l.cod);
        const area = mods.reduce((a, m) => a + listaDePecas(m).linhas.reduce((b, x) => b + x.areaM2, 0), 0);
        return `<tr><td class="c"><b>${l.cod}</b></td><td>${esc(l.nome)}</td><td>${mods.map((m) => m.cod).join(", ")}</td><td class="n">${dec(area)}</td><td class="vazio"></td><td class="vazio"></td></tr>`;
      })
      .join("");
    return `<tr class="grupo"><td colspan="6">${esc(g)}</td></tr>${linhas}`;
  })
  .join("")}
<tr class="grupo"><td colspan="6">Itens opcionais e alternativas</td></tr>
<tr><td class="c">O1</td><td>Perfil de LED embutido sob o aéreo de madeira (2,46 m) + fonte</td><td>AM</td><td class="n">—</td><td class="vazio"></td><td class="vazio"></td></tr>
<tr><td class="c">O2</td><td>Organizador de talheres na gaveta 1</td><td>M1</td><td class="n">—</td><td class="vazio"></td><td class="vazio"></td></tr>
<tr><td class="c">O3</td><td>Alternativa: caixas em MDF 18 mm (todos os lotes)</td><td>—</td><td class="n">—</td><td class="vazio"></td><td class="vazio"></td></tr>
<tr><td class="c">O4</td><td>Alternativa: aéreo superior com 6 portas de ≈ 512 mm</td><td>AS</td><td class="n">—</td><td class="vazio"></td><td class="vazio"></td></tr>
<tr><td class="c">O5</td><td>Alternativa: cabideiro basculante no lugar do varão alto</td><td>G2</td><td class="n">—</td><td class="vazio"></td><td class="vazio"></td></tr>
<tr class="total"><td colspan="4">Total dos lotes A e B (sem opcionais)</td><td class="vazio"></td><td class="vazio"></td></tr>
</tbody></table></div>
<div><h2>Condições da proposta</h2>
<table class="t"><tbody>
${["Marcenaria / responsável", "Data da proposta e validade", "MDF: fabricante e linha (por padrão de cor)", "Dobradiças e corrediças: fabricante e linha", "Puxador cava: tipo e acabamento propostos", "Prazo de fabricação após a medição", "Prazo de montagem no local", "Forma de pagamento", "Garantia (estrutura, ferragens, acabamento)", "Inclui medição técnica e projeto de fabricação?", "Inclui transporte, montagem e limpeza?", "O que NÃO está incluído", "Ressalvas e pontos que mudariam o preço"].map((t) => `<tr><td style="width:42%"><b>${t}</b></td><td class="vazio" style="height:9.5mm"></td></tr>`).join("")}
</tbody></table>
<p class="sub" style="margin-top:1.5mm">Para comparar propostas: mesmos lotes, mesmas medidas, mesmos padrões e mesmas ferragens deste caderno. Qualquer troca deve aparecer em "ressalvas".</p>
<h3>Conferir em cada proposta</h3>
<ul class="lista"><li>Preço separado por lote e opcionais em linha própria.</li><li>MDF e ferragens identificados (fabricante e linha), com amortecimento e extração total onde o caderno pede.</li><li>Medição técnica, projeto de fabricação, transporte, montagem, réguas de ajuste e recortes incluídos.</li><li>Prazos de fabricação e de montagem por escrito.</li><li>Garantia por escrito e o que ela cobre.</li></ul></div></div>`,
  );
  const rotulo: Record<string, string> = { medir: "medir no local", decidir: "decidir", aparelho: "aparelho", tecnico: "ponto técnico" };
  add(
    "P-01",
    "Pendências, medidas a conferir e decisões em aberto",
    "—",
    `<div class="texto" style="display:flex;flex-direction:column;gap:2.5mm"><div class="aviso">Este caderno foi feito a partir da planta da construtora e do modelo 3D, <b>sem medição no local</b>. A tabela separa o que precisa ser medido, o que depende do modelo dos aparelhos e o que é decisão do cliente. "Muda o preço" indica o que pode alterar o valor do orçamento.</div>
<table class="t"><thead><tr><th class="c">Cód.</th><th>Onde</th><th>Tipo</th><th>Pendência</th><th class="c">Muda o preço?</th></tr></thead><tbody>
${mc.pendencias.map((p) => `<tr><td class="c"><b>${p.cod}</b></td><td>${p.onde}</td><td><span class="pill t-${p.tipo}">${rotulo[p.tipo]}</span></td><td>${esc(p.texto)}</td><td class="c">${p.afetaPreco ? "<b>sim</b>" : "não"}</td></tr>`).join("")}
</tbody></table>
<div class="colunas c3" style="margin-top:1mm">
<div class="caixa"><b>Medidas confirmadas (planta)</b><br>Cozinha: 1.500 de largura e 3.870 do shaft à parede do fundo. Suíte: 2.510 × 3.920. São cotas escritas na planta; mesmo assim, conferir na medição técnica.</div>
<div class="caixa"><b>Medidas estimadas</b><br>Pé-direito ${pd}; shaft 220 × 650; espessura das paredes; posição e tamanho de portas e janelas; fim da divisória da cozinha. Lidas pela escala da imagem da planta.</div>
<div class="caixa"><b>A levantar no local</b><br>Tomadas, interruptores, pontos de água, esgoto e gás; prumo e esquadro das paredes; nível do piso e do teto; rodapés e guarnições existentes.</div></div></div>`,
  );

  // ------------------------------------------------------------------ capa (por último, para ter o índice)
  const indice = pranchas.map((p, i) => `<tr><td class="c">${i + 2}</td><td><b>${p.cod}</b></td><td>${esc(p.titulo)}</td></tr>`);
  const metade = Math.ceil(indice.length / 2);
  const capa: Prancha = {
    cod: "CAPA",
    titulo: "Capa, escopo e índice",
    escala: "—",
    html: `<div class="colunas" style="grid-template-columns:1.15fr 1fr;flex:1;min-height:0">
<div style="display:flex;flex-direction:column;gap:3mm;min-height:0">
<div><div class="capa-titulo">Caderno de marcenaria</div><div class="capa-sub">Projeto executivo para orçamento · cozinha, área de serviço e guarda-roupa da suíte</div></div>
<div class="caixa"><b>Objetivo.</b> Reunir tudo o que um marceneiro precisa para orçar exatamente os mesmos móveis: medidas de cada módulo e de cada peça, materiais, fitas, ferragens, vistas, cortes e imagens 3D. Todas as medidas em <b>milímetros</b>. Revisão ${REVISAO} de ${data}. ${pranchas.length + 1} pranchas em A3 e uma planilha de quantitativos.</div>
${LEGENDA}
<div class="colunas c2" style="gap:4mm">
<div><h3 style="margin-top:0">Escopo, em lotes</h3><table class="t"><tbody>${LOTES.map((l) => `<tr><td class="c"><b>${l.cod}</b></td><td>${esc(l.nome)}${l.opcional ? " <i>(opcional)</i>" : ""}</td></tr>`).join("")}</tbody></table></div>
<div><h3 style="margin-top:0">Leia antes de orçar</h3><ul class="lista">
<li>Não houve medição no local: o <b>pé-direito (${pd} mm) é estimado</b> e a medição técnica é obrigatória antes de fabricar.</li>
<li>Os <b>modelos dos aparelhos não foram informados</b>: os nichos usam medidas típicas (prancha C-06).</li>
<li>O <b>interior do guarda-roupa é proposta</b>, ainda a aprovar pelo cliente (marca <b class="mT">T</b>).</li>
<li>Padrões de MDF e ferragens estão especificados por função e cor, <b>sem marca</b>: informar o que será usado.</li>
<li>Pedras, cubas, aparelhos e instalações <b>não entram</b> neste orçamento.</li>
<li>Preço <b>por lote</b>, no quadro da prancha Q-02. Pendências na P-01.</li></ul></div></div>
<div class="fotos natural" style="grid-template-columns:1fr 1fr">${img("marc-cozinha-frontal", "Cozinha — parede A (modelo 3D)")}${img("marc-suite-canto", "Suíte — guarda-roupa em L (modelo 3D)")}</div></div>
<div style="display:flex;flex-direction:column;min-height:0"><h2>Índice das pranchas</h2>
<div class="colunas c2" style="gap:4mm"><table class="t"><thead><tr><th class="c">Folha</th><th>Cód.</th><th>Prancha</th></tr></thead><tbody>${indice.slice(0, metade).join("")}</tbody></table>
<table class="t"><thead><tr><th class="c">Folha</th><th>Cód.</th><th>Prancha</th></tr></thead><tbody>${indice.slice(metade).join("")}</tbody></table></div>
<h3>Códigos dos módulos</h3>
<p><b>Cozinha:</b> M1 a M5 armários de baixo · RA rodapé · PG painel da geladeira · AG armário sobre a geladeira · AS aéreo superior · FV faixa verde · AM aéreo de madeira · NM nicho do micro-ondas · T1 módulo do tanque.<br>
<b>Suíte:</b> G2 guarda-roupa de espelho · G4 guarda-roupa de portas cinza + canto · CO coluna · AP armário-ponte · PJ painel lateral · CB cabeceira · CR1 e CR2 criados.</p>
<h3>Revisões</h3>
<table class="t"><tbody>${REVISOES.map((r) => `<tr><td class="c"><b>${r.rev}</b></td><td class="n">${r.data}</td><td>${esc(r.texto)}</td></tr>`).join("")}</tbody></table>
<h3>Totais de referência</h3>
<p>${mc.modulos.length} módulos · ${totalPecas} peças de MDF · ${dec(totalArea, 1)} m² de chapa (área líquida) · ${somaChapas(chapasAB)} chapas para a cozinha e o guarda-roupa (${somaChapas(chapasTudo)} com os complementos) · ${dec(fitas.reduce((a, f) => a + f.metros, 0), 0)} m de fita de borda · ${nPortas} portas e ${nGavetas} gavetas.</p></div></div>`,
  };
  const todas = [capa, ...pranchas];
  const folhas = todas.map((p, i) => ({ cod: p.cod, titulo: p.titulo, escala: p.escala, html: folha(p, i + 1, todas.length, data) }));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Caderno de marcenaria</title><style>${CSS_IMPRESSAO}${CSS_PRANCHAS}</style></head><body>${DEFS_HACHURAS}${folhas.map((f) => f.html).join("\n")}</body></html>`;
  return {
    html,
    pranchas: todas.map((p) => ({ cod: p.cod, titulo: p.titulo })),
    planilha: dadosDaPlanilha(mc, data),
    css: CSS_PRANCHAS,
    folhas,
    resumo: { modulos: mc.modulos.length, pecas: totalPecas, areaM2: Math.round(totalArea * 10) / 10, peDireito: pd, data, revisao: REVISAO },
  };
}
