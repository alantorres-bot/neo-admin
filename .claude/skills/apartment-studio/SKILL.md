---
name: apartment-studio
description: Especialista do projeto Apartment Studio 3D (pasta apartment-studio/) — interpretar plantas baixas, modelar o apartamento em 3D, posicionar e dimensionar móveis, iluminação, materiais, renderização e otimização de cena em React Three Fiber. Use em qualquer pedido sobre o apartamento 3D, planta, paredes, portas, janelas, ambientes, móveis, decoração, materiais, luzes, câmeras, versões ou exportação de imagens do apartamento.
---

# Apartment Studio 3D

Aplicativo pessoal do Alan para reproduzir, mobiliar e decorar o próprio apartamento em 3D.
Projeto independente do Neo Admin: fica em `apartment-studio/` (Vite + React + TS), com `package.json`
próprio. Não usa nada do Neo Admin e o Neo Admin não o enxerga (excluído do `tsconfig`, ESLint e Docker da raiz).

Antes de mexer, leia:
- `apartment-studio/docs/PREFERENCIAS.md` — o que o Alan já tem, o que vai comprar, paleta e decisões por ambiente.
- `apartment-studio/docs/referencias/` — fotos que o Alan enviou (rack com cotas, cadeira, eletros, cozinha de
  referência, decorado do prédio) e, no `LEIAME.md`, o que cada uma mostra. **Olhe a foto antes de mexer no item.**
  Foto nova do Alan: guarde uma cópia reduzida ali (sem interface de aplicativo, nomes de pessoas ou do prédio)
  e registre no LEIAME — os anexos de uma conversa não aparecem nas outras.
- `apartment-studio/docs/ANALISE_PLANTA.md` — leitura da planta, cotas reais × estimadas, pendências.
- `apartment-studio/docs/ARQUITETURA.md` — modelo de dados, pastas, etapas e o que já existe.

## Estado da planta (atualizar quando mudar)

- Planta real lida em `src/modelo/plantaReal.ts`, imagem em `public/referencia/planta-apartamento.webp`.
- Cotas da planta = **vão interno**; escala 0,772 cm/px; origem no canto externo superior esquerdo.
- Cada cota escrita está em `planta.cotas` ligada a duas faces de parede; `conferirCotas()` e o teste
  garantem que continuam batendo. Ao mexer em parede, rode os testes: cota divergente = rever a mudança.
- Pendências com o Alan: ver seção "Dúvidas" de `docs/ANALISE_PLANTA.md`.

## Princípios inegociáveis

1. **Nunca inventar medida como se fosse real.** Toda medida do modelo é `Medida { valor (cm), origem }`,
   com `origem` = `cota` (lida na planta), `derivada` (calculada a partir de cotas: soma, diferença, escala),
   `estimada` (proporção visual na imagem ou padrão de mercado) ou `manual` (o Alan corrigiu).
   A interface mostra `≈` para estimada, nada para cota/manual. Ao ler uma planta, liste quais cotas existem
   e quais foram inferidas — e diga de onde veio cada inferência.
2. **Preservar a distribuição original.** Posição relativa dos ambientes, sentido das portas e lado das janelas
   seguem a planta; não "melhorar" layout sem pedido.
3. **Modelo paramétrico, nunca malha fixa.** Paredes ligam vértices (mover um vértice move todas as paredes
   ligadas); aberturas pertencem a uma parede e são posicionadas pela distância ao vértice `a`; ambientes são
   polígonos de vértices. A geometria 3D é sempre **derivada** do modelo (`src/modelo/geometria.ts`) — alterar
   dado regenera a cena, nunca editar mesh à mão.
4. **Unidades:** dados em **centímetros**; cena Three.js em **metros** (1 unidade = 1 m; converter com `cm/100`).
   Eixo X da planta = X da cena; eixo Y da planta (para baixo no desenho) = Z da cena. Altura = Y.
5. Interface em português do Brasil, para leigo: rótulos claros, nada de jargão sem explicação.
6. Etapas: não pular etapa sem aprovação do Alan; ao fim de cada uma, testar **e validar visualmente**
   (screenshot do 3D), não só compilar.

## Interpretação de planta baixa

- Identifique: contorno externo, paredes internas (traço grosso = alvenaria; fino = divisória/drywall),
  portas (arco de giro → sentido e lado da dobradiça; traço duplo paralelo = porta de correr), janelas
  (três linhas finas paralelas na parede), vãos livres (abertura sem folha), peitoris, bancadas, louças.
- Cotas: anote cada uma com o trecho a que se refere (face interna, eixo ou face externa — plantas de
  incorporadora costumam cotar **vão interno**). Se ambíguo, pergunte.
- Escala: escolha a maior cota confiável para calibrar px→cm; confira com uma segunda cota (diferença > 3% =
  avisar). Áreas de ambiente escritas na planta (m²) servem de conferência: área calculada vs. informada.
- Dimensões ausentes: derive por soma/diferença de cotas quando possível (`derivada`); senão meça na imagem
  calibrada (`estimada`). Padrões quando não houver nada: espessura parede 15 cm (externa) / 10–12 cm
  (interna), pé-direito 260 cm, porta 80×210 (banheiro 70–80), janela peitoril 110 (banheiro 160),
  porta de varanda de correr 210 de altura — sempre `estimada`.
- Registre tudo em `docs/ANALISE_PLANTA.md` (tabela: elemento, valor, origem, observação).

## Modelagem 3D (React Three Fiber)

- Parede = caixa ao longo do segmento a→b, estendida meia espessura nas pontas para fechar cantos.
  Aberturas: dividir a parede em trechos (cheios, abaixo do peitoril, acima da verga) — sem CSG.
- Piso/teto: `ShapeGeometry` do polígono do ambiente, rotacionado −90° em X. Teto ocultável.
- Modos de parede: inteira, recortada (corte a ~1 m, estilo "dollhouse") e oculta.
- Câmeras: perspectiva orbital (OrbitControls), superior ortográfica (planta), interna (altura dos olhos
  160 cm, arrastar para olhar, WASD/setas para andar).
- Seleção: clique seleciona parede/abertura/ambiente/móvel; painel de propriedades edita em cm.

## Móveis e decoração

- Catálogo em `src/catalogo/catalogo.ts` (itens) e `formas.ts` (formas paramétricas puras, frente em +z).
  Medidas de referência: sofá 3 lug. 210×90×85; cama casal 138×188 (queen 158×198, king 193×203);
  criado 45×35×55; guarda-roupa P 57–60; mesa jantar 4 lug. 120×80×75; banqueta assento 65 (bancada 90);
  geladeira 70×73×185; cooktop 58×51; forno 60; bancada cozinha P 60–62, A 90; box 80–95 de largura.
- Mobília do Alan em `src/modelo/mobilia.ts`: centro `x, y` em cm, `rotacao` em graus (0 = frente para
  baixo na planta, 90 = para a direita, 180 = para cima, 270 = para a esquerda), `elevacao` do piso.
  Toda mudança pedida pelo Alan entra ali **e** em `docs/PREFERENCIAS.md`; depois **aumente `BASE_ATUAL`**
  em `projetoBase.ts` para o app oferecer a versão nova a quem já tem projeto salvo.
- Antes de posicionar, calcule com as faces internas das paredes (tabela no topo de `mobilia.ts`) e rode
  `npm test`: o teste "nenhum móvel atravessa parede, invade giro de porta ou se sobrepõe a outro" tem que
  passar. Peças do mesmo conjunto planejado usam o mesmo `grupo`.
- Circulação mínima: 60 cm ao lado da cama, 80–90 cm em passagem principal, 75 cm na frente de armário.
  Quando a medida real não permitir o que foi pedido, diga isso ao Alan com os números — não ajuste calado.
- Planta de venda desenha móveis menores que o real: nunca copie o tamanho do móvel do desenho.

## Materiais e iluminação

- PBR (`MeshStandardMaterial`/`MeshPhysicalMaterial`): madeira (roughness 0.5–0.7), porcelanato polido
  (0.1–0.25), acetinado (0.4), mármore (0.15 + clearcoat), tinta fosca (0.9), vidro (transmission).
- Texturas procedurais (canvas) enquanto não houver imagens; repetir por metro real (`repeat = dim/escala`).
- Luz natural: sol direcional com sombra (shadow camera ajustada ao bounding box do apartamento) + céu
  hemisférico; artificial: pontos/spots por ambiente, temperatura de cor 2700–4000 K.
- Tons: `ACESFilmicToneMapping`, `SRGBColorSpace`.

## Desempenho

- Geometria derivada em `useMemo` por parede/ambiente; materiais compartilhados; `frameloop="demand"`
  quando possível; sombras só do sol; `dpr={[1, 2]}`; instanciar móveis repetidos; GLB com Draco/meshopt.

## Persistência e versões

- IndexedDB (idb-keyval): projeto salvo automaticamente; histórico desfazer/refazer por snapshots do estado
  (limite ~100); versões nomeadas = cópia do projeto. Imagem da planta guardada como Blob/dataURL no projeto.

## Página publicada (o Alan usa no celular)

- Endereço fixo: https://claude.ai/artifact/VUR55xAmwntHzhc96f3que. Depois de qualquer mudança validada:
  `npm run artefato && node tests/e2e/verificar-artefato.mjs` e republicar
  `dist-artefato/apartment-studio.html` com a ferramenta Artifact **nesse mesmo endereço** (em conversa nova:
  `action: "read"` no endereço e depois publicar com `url`). Não passar `capabilities` de novo: `db` (salvar na
  conta) e `downloads` (salvar a imagem exportada) são mantidas — passar só uma apagaria a outra.
- Antes de mudar o layout a pedido do Alan, leia o projeto dele: ArtifactData `get`, coleção `projetos`,
  documento `principal`; as versões que ele guardou ficam na coleção `versoes` (uma por documento). Se ele alterou algo no app (`alteradoPeloUsuario`), respeite o que ele fez e combine
  como aplicar a mudança — a base nova só entra para ele quando aceitar o aviso "há uma versão nova".
- Regras de página publicada que valem para a interface: cores só por tokens (tema claro e escuro), sem
  `alert/confirm/prompt`, sem download por link, tudo embutido (scripts externos só de CDN permitido).

## Luz, materiais e desempenho (Etapa 5)

- **Luz** vem de `cena/luz.ts` (hora → sol, céu, difusa, noite). Não espalhe intensidades pelo código: ajuste
  `SOL_PLENO` (luz.ts) e `FORCA_PLAFON` (catalogo.ts) e rode `node tests/e2e/verificar-artefato.mjs`, que exige a
  casa acesa à noite mais escura, na média, que de dia. Depois de mexer em luz ou material, capture **dia e noite**
  (`capturar-ambientes.mjs --limpo` e `--limpo --hora=20`) e olhe as duas.
- **Luminária nova** = item de catálogo com `luz` ("ponto" ou "fita"). Luz presa no teto dispensa o plafon
  automático do ambiente (`ambienteTemLuzDeTeto`). Luz artificial não faz sombra — não ligue `castShadow` nelas.
- **Parede**: pintura e revestimento ficam em `Parede.acabamentos`, por lado e por ambiente (`definirAcabamento`,
  `pintarAmbiente`). "Atrás do sofá" = parede `p-coz-sala`, lado da sala; "atrás dos remos" = `p-fundo-jantar`,
  lado do jantar. Nunca pinte `Parede.cor` para isso: ela vale para as duas faces.
- **Portas** são de madeira, um pouco mais escura que os armários de madeira da cozinha (o Alan informou; o tom
  exato não tem foto). O padrão fica em `COR_PORTA_PADRAO` (catalogo.ts); não volte para branco.
- **Acabamento novo de móvel**: `Acabamento` em formas.ts + `criar()` em materiais.ts + nome em `ui/acabamentos.tsx`.
- **Desempenho**: a cena precisa rodar no celular. Antes e depois de mexer no desenho, rode
  `node tests/e2e/medir-desempenho.mjs` (referência: ≈ 460 chamadas na vista 3D, ≈ 440 por dentro). Peças de um
  móvel são unidas por material; paredes são uma malha com grupos. Não crie malha por peça nem material por peça.
  Espelho de verdade só à vista (`haParedeEntre`); efeitos novos entram atrás do botão Realista.
- O estado do app fica acessível nos testes com `?teste` na URL: `window.__estudio` (store) e `window.__cena`
  (cena do React Three Fiber, sempre atual).

## Versões e exportação (Etapa 6)

- **Decisão de decoração do Alan** (pintura, móvel, posição) entra no projeto-base: pintura em `projetoBase.ts`
  (`pintar`), móveis em `mobilia.ts`; depois aumente `BASE_ATUAL`. Hoje: parede atrás do sofá azul-marinho só do
  lado da sala (opção A), rodapé branco, banheiro azulejado, portas em madeira.
- **Versões** são cópias do projeto inteiro com nome (`modelo/versoes.ts`); guardadas no navegador e na conta.
  Para comparar opções para o Alan, prefira gerar imagens das opções (como foi feito com a parede azul) e deixar
  que ele salve versões no app.
- **Exportar imagem**: `Exportador.tsx` redimensiona a cena, desenha e devolve. Não use download por link na página
  publicada — só `salvarArquivo` (`estado/arquivos.ts`), que passa pela capacidade `downloads`.
- O que abre por cima de tudo (prévia, avisos de tela inteira) vai num portal em `document.body`: os painéis criam
  o próprio contexto de empilhamento e escondem o que fica dentro deles.

## Caderno de marcenaria (projeto executivo para orçamento)

Pedido do Alan (13/11/2026): cozinha e guarda-roupa da suíte detalhados para orçar com três marceneiros. Ler
`apartment-studio/docs/MARCENARIA.md` antes de mexer.

- Código em `apartment-studio/src/marcenaria/`; saída em `docs/marcenaria/` (PDF de 28 pranchas A3 + planilha XLSX).
  Gerar com `npm run marcenaria`; conferir com `node scripts/gerar-marcenaria.mjs --previa` e **olhar as pranchas**.
- **Uma fonte só**: cada peça é um sólido (s ao longo da parede, d profundidade, z altura, em mm). Vistas, cortes,
  balões, lista de peças, fitas e áreas saem dos mesmos sólidos. Não desenhar nada "à mão" fora deles.
- A envoltória de cada módulo vem do 3D (`caixaDoMovel`). Mudou um móvel em `mobilia.ts`? O caderno acompanha e o
  teste de correspondência avisa se algo ficou de fora. Interior, espessuras e ferragens são proposta técnica.
- Toda cota carrega a origem: `P` planta · `E` estimada · `A` aparelho típico · `T` proposta · sem marca = 3D aprovado.
  Nunca apresentar estimada como confirmada; o que falta vira pendência (prancha P-01), não número inventado.
- Não alterar o visual aprovado (larguras, número de portas, cores) sem autorização do Alan: quando a execução pede
  mudança (ex.: portas de 769,5 mm, canto do L), manter o desenho, registrar a ressalva e oferecer a alternativa.
- O caderno vai para terceiros: sem nome, endereço ou nome do edifício. Textos neutros ("cliente", não "você").
- PDF leve: nada de texto com contorno nem hachura em padrão (pesavam 6 MB); fundo branco atrás do texto e cor chapada.
- Números em texto corrido com vírgula decimal (`fmt`); milhar com ponto.
- Página publicada do caderno: https://claude.ai/artifact/DPLCsCxLucQiXsRitLuGT8 (privada; capacidade `downloads`).
  Gerar com `node scripts/gerar-marcenaria.mjs --pagina=<arquivo>` e republicar na mesma URL sem `capabilities`.
  Ao mudar qualquer medida, regenerar PDF, planilha **e** página, e subir a revisão (`REVISAO` em `caderno.ts`).

## Verificação (obrigatória ao fim de cada etapa)

1. `npm run typecheck && npm test` em `apartment-studio/`.
2. `npm run build && npm run e2e` — abre o app no Chromium (Playwright), confere câmeras, cotas, editor de
   móveis, persistência e console. Depois `node tests/e2e/capturar-ambientes.mjs --limpo` e **olhe os PNGs**
   de cada ambiente (e `--celular` quando mexer na interface).
   Mexeu num item que tem foto? `node tests/e2e/capturar-detalhes.mjs [nome]` tira a foto de perto (rack, cadeira,
   eletros, cozinha, banheiro) — compare lado a lado com `docs/referencias/`. Para um item novo, acrescente uma
   linha em `DETALHES` no script (câmera `de → para` em cm; `esconder` e `mover` tiram coisas da frente).
3. Atualize `docs/ARQUITETURA.md` (o que mudou) e `docs/ANALISE_PLANTA.md` (se mexeu em medida).
