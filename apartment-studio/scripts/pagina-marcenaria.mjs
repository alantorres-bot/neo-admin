/**
 * Página publicável do caderno de marcenaria (Artifact do Claude): as mesmas pranchas do PDF, ajustadas à largura
 * da tela, com ampliação por folha e botões para baixar o PDF e a planilha (capacidade `downloads`).
 * O arquivo é só o conteúdo da página: o esqueleto <html>/<head>/<body> entra na publicação.
 */

/** Prefixa cada seletor do CSS das pranchas, para ele não vazar para a moldura da página. */
export function escopar(css, prefixo) {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, decl) => {
    const sels = sel
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => `${prefixo} ${x}`);
    return `${sels.join(",")}{${decl}}`;
  });
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TEMA_ESCURO = "--mesa:#10161c;--superficie:#19212a;--tinta:#e7ecf1;--tinta-2:#9dabb8;--regua:#34414d;--copia:#86bde8;--copia-fundo:#1c2f40;--alerta:#f2c684;--alerta-fundo:#32260e;--papel:#ffffff;--sombra:rgba(0,0,0,.5);color-scheme:dark";

export function paginaDoCaderno({ css, folhas, resumo, pdfBase64, xlsxBase64 }) {
  const cssPranchas = escopar(css, ".v-papel").replaceAll('"Liberation Sans",Arial', '"Liberation Sans",Arimo,Arial');
  const figuras = folhas
    .map(
      (f) => `<figure class="v-folha" id="f-${f.cod}" data-zoom="0">
<figcaption><span class="v-cod">${f.cod}</span><span class="v-tit">${esc(f.titulo)}</span>${f.escala !== "—" ? `<span class="v-esc">escala ${esc(f.escala)} no A3</span>` : ""}<button class="v-zoom" type="button">Ampliar</button></figcaption>
<div class="v-quadro"><div class="v-escala"><div class="v-papel">${f.html}</div></div></div></figure>`,
    )
    .join("\n");
  return `<title>Caderno de Marcenaria</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Arimo:wght@400;600;700&display=swap">
<style>
/* Mesa de desenho: barra fixa com o seletor de pranchas; folhas A3 empilhadas, cada uma ajustada à largura; botão para ampliar. */
:root{--mesa:#e6eaee;--superficie:#ffffff;--tinta:#17212b;--tinta-2:#55626f;--regua:#c2cad3;--copia:#1d5a8a;--copia-fundo:#e3eef7;--alerta:#7a4406;--alerta-fundo:#fff3d9;--papel:#ffffff;--sombra:rgba(23,33,43,.16);
--f-ui:Arimo,"Helvetica Neue",Arial,sans-serif;--f-cod:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${TEMA_ESCURO}}}
:root[data-theme="dark"]{${TEMA_ESCURO}}
body{background:var(--mesa);color:var(--tinta);font-family:var(--f-ui);font-size:15px;line-height:1.5}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--superficie)}
.v-barra{position:sticky;top:env(safe-area-inset-top,0px);z-index:9;background:var(--superficie);border-bottom:1px solid var(--regua);padding-block:10px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.v-nome{font-weight:700;font-size:16px;margin-right:auto;min-width:0}
.v-nome small{display:block;font-weight:400;font-size:12px;color:var(--tinta-2)}
.v-barra select{font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--regua);border-radius:6px;background:var(--superficie);color:var(--tinta);min-width:0;max-width:100%;flex:1 1 240px}
.v-corpo{padding-block:18px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:20px;max-width:1500px;margin-inline:auto}
.v-intro{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:14px}
.v-cartao{background:var(--superficie);border:1px solid var(--regua);border-radius:8px;padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:8px}
.v-cartao h2{font-size:12px;margin:0;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta-2);font-weight:700}
.v-cartao p,.v-cartao ul{margin:0}
.v-cartao ul{padding-left:18px;display:flex;flex-direction:column;gap:4px}
.v-num{font-variant-numeric:tabular-nums;font-weight:700}
.v-alerta{background:var(--alerta-fundo);color:var(--alerta);border-color:transparent}
.v-alerta h2{color:var(--alerta)}
.v-botoes{display:flex;flex-wrap:wrap;gap:8px}
.v-baixar{font:inherit;font-size:14px;font-weight:600;padding:8px 14px;border-radius:6px;border:1px solid var(--copia);background:var(--copia);color:var(--superficie);cursor:pointer}
.v-estado{font-size:13px;color:var(--tinta-2);min-height:1.2em}
.v-folhas{display:flex;flex-direction:column;gap:22px}
.v-folha{margin:0;display:flex;flex-direction:column;gap:6px;min-width:0;scroll-margin-top:calc(env(safe-area-inset-top,0px) + 128px)}
.v-folha figcaption{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap}
.v-cod{font-family:var(--f-cod);font-weight:700;font-size:13px;color:var(--copia);background:var(--copia-fundo);padding:2px 7px;border-radius:4px}
.v-tit{font-weight:600;font-size:14px;min-width:0}
.v-esc{font-size:12px;color:var(--tinta-2)}
.v-zoom{margin-left:auto;font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--regua);border-radius:6px;background:var(--superficie);color:var(--tinta);cursor:pointer}
.v-zoom:focus-visible,.v-barra select:focus-visible,.v-baixar:focus-visible{outline:2px solid var(--copia);outline-offset:2px}
.v-quadro{background:var(--papel);border:1px solid var(--regua);box-shadow:0 2px 10px var(--sombra);overflow:hidden;max-width:100%}
.v-folha:not([data-zoom="0"]) .v-quadro{overflow:auto;max-height:78vh;-webkit-overflow-scrolling:touch}
.v-escala{position:relative;overflow:hidden;width:100%;aspect-ratio:420/297}
.v-papel{position:absolute;left:0;top:0;width:420mm;height:297mm;transform-origin:0 0}
${cssPranchas}
</style>
<header class="v-barra">
<div class="v-nome">Caderno de Marcenaria<small>Projeto executivo para orçamento · revisão ${esc(resumo.revisao)} · ${esc(resumo.data)}</small></div>
<select id="v-ir" aria-label="Ir para a prancha">${folhas.map((f) => `<option value="f-${f.cod}">${f.cod} — ${esc(f.titulo)}</option>`).join("")}</select>
</header>
<main class="v-corpo">
<section class="v-intro">
<div class="v-cartao"><h2>O que é</h2><p>Projeto da cozinha, da área de serviço e do guarda-roupa da suíte para pedir orçamento a marceneiros: <span class="v-num">${folhas.length}</span> pranchas em A3, <span class="v-num">${resumo.modulos}</span> módulos, <span class="v-num">${resumo.pecas}</span> peças de MDF (<span class="v-num">${String(resumo.areaM2).replace(".", ",")}</span> m²). Todas as medidas em milímetros.</p></div>
<div class="v-cartao v-alerta"><h2>Antes de orçar</h2><ul><li>Não houve medição no local. O pé-direito de ${resumo.peDireito} mm é estimado.</li><li>Os nichos usam medidas típicas: os modelos dos aparelhos não foram informados.</li><li>O interior do guarda-roupa é proposta, ainda a aprovar.</li><li>Pendências completas na prancha P-01.</li></ul></div>
<div class="v-cartao"><h2>Arquivos</h2><p>O mesmo conteúdo em PDF (para imprimir ou encaminhar) e a planilha de quantitativos, com o quadro de orçamento para preencher.</p>
<div class="v-botoes" id="v-botoes" hidden><button class="v-baixar" type="button" id="v-pdf-btn">Baixar o PDF</button><button class="v-baixar" type="button" id="v-xlsx-btn">Baixar a planilha</button></div>
<div class="v-estado" id="v-estado" role="status"></div></div>
</section>
<div class="v-folhas" id="v-folhas">
${figuras}
</div>
</main>
<script type="application/octet-stream" id="v-pdf">${pdfBase64}</script>
<script type="application/octet-stream" id="v-xlsx">${xlsxBase64}</script>
<script>
(function () {
  var folhas = Array.prototype.slice.call(document.querySelectorAll(".v-folha"));
  var ROTULOS = ["Ampliar", "Ampliar mais", "Ajustar à tela"];
  function niveis(ajuste) {
    return [ajuste, Math.max(0.5, ajuste * 2), Math.max(1, ajuste * 3.2)];
  }
  function ajustar(f) {
    var quadro = f.querySelector(".v-quadro");
    var escala = f.querySelector(".v-escala");
    var papel = f.querySelector(".v-papel");
    var largura = papel.offsetWidth;
    var altura = papel.offsetHeight;
    if (!largura || !quadro.clientWidth) return;
    var z = Number(f.getAttribute("data-zoom") || 0);
    var k = niveis(quadro.clientWidth / largura)[z];
    papel.style.transform = "scale(" + k + ")";
    escala.style.aspectRatio = "auto";
    escala.style.width = Math.round(largura * k) + "px";
    escala.style.height = Math.round(altura * k) + "px";
  }
  function todas() {
    folhas.forEach(function (f) {
      // mede sempre pela largura disponível: volta ao ajuste antes de recalcular
      var escala = f.querySelector(".v-escala");
      escala.style.width = "0px";
      ajustar(f);
    });
  }
  folhas.forEach(function (f) {
    var botao = f.querySelector(".v-zoom");
    botao.addEventListener("click", function () {
      var z = (Number(f.getAttribute("data-zoom") || 0) + 1) % 3;
      f.setAttribute("data-zoom", String(z));
      botao.textContent = ROTULOS[z];
      f.querySelector(".v-escala").style.width = "0px";
      ajustar(f);
      if (z === 0) f.querySelector(".v-quadro").scrollTo(0, 0);
    });
  });
  todas();
  var espera;
  window.addEventListener("resize", function () {
    clearTimeout(espera);
    espera = setTimeout(todas, 120);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(todas);

  var ir = document.getElementById("v-ir");
  ir.addEventListener("change", function () {
    var alvo = document.getElementById(ir.value);
    if (alvo) alvo.scrollIntoView({ block: "start" });
  });

  // PDF e planilha: só aparecem onde a página pode entregar arquivos
  var estado = document.getElementById("v-estado");
  function blob(id, tipo) {
    var bin = atob(document.getElementById(id).textContent.trim());
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  }
  function ligar(downloads) {
    if (!downloads) {
      estado.textContent = "Os dois arquivos foram enviados na conversa do Claude.";
      return;
    }
    document.getElementById("v-botoes").hidden = false;
    function salvar(id, nome, tipo) {
      estado.textContent = "Preparando " + nome + "…";
      downloads
        .save({ filename: nome, data: blob(id, tipo) })
        .then(function () {
          estado.textContent = nome + " entregue ao aparelho.";
        })
        .catch(function (e) {
          estado.textContent = e && e.code === "declined" ? "Download cancelado." : "Não foi possível baixar por aqui. Os arquivos também foram enviados na conversa.";
        });
    }
    document.getElementById("v-pdf-btn").addEventListener("click", function () {
      salvar("v-pdf", "caderno-marcenaria.pdf", "application/pdf");
    });
    document.getElementById("v-xlsx-btn").addEventListener("click", function () {
      salvar("v-xlsx", "planilha-marcenaria.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });
  }
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("downloads").then(ligar, function () {
      ligar(null);
    });
  } else ligar(null);
})();
</script>
`;
}
