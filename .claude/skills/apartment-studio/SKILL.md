---
name: apartment-studio
description: Especialista do projeto Apartment Studio 3D (pasta apartment-studio/) — interpretar plantas baixas, modelar o apartamento em 3D, posicionar e dimensionar móveis, iluminação, materiais, renderização e otimização de cena em React Three Fiber. Use em qualquer pedido sobre o apartamento 3D, planta, paredes, portas, janelas, ambientes, móveis, decoração, materiais, luzes, câmeras, versões ou exportação de imagens do apartamento.
---

# Apartment Studio 3D

Aplicativo pessoal do Alan para reproduzir, mobiliar e decorar o próprio apartamento em 3D.
Projeto independente do Neo Admin: fica em `apartment-studio/` (Vite + React + TS), com `package.json`
próprio. Não usa nada do Neo Admin e o Neo Admin não o enxerga (excluído do `tsconfig`, ESLint e Docker da raiz).

Antes de mexer, leia:
- `apartment-studio/docs/ANALISE_PLANTA.md` — leitura da planta, cotas reais × estimadas, pendências.
- `apartment-studio/docs/ARQUITETURA.md` — modelo de dados, pastas, etapas e o que já existe.

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

## Móveis e decoração (Etapa 4+)

- Catálogo em `src/catalogo/` com dimensões reais de mercado (L × P × A em cm) e categoria. Medidas de
  referência: sofá 3 lug. 210×90×85; cama casal 138×188 (queen 158×198, king 193×203); criado 45×35×55;
  guarda-roupa P 60; mesa jantar 4 lug. 120×80×75; banqueta altura assento 65 (bancada 90) ou 75 (bar 105);
  geladeira 70×70×185; fogão 4 bocas 50×60×85; bancada cozinha P 60, A 90; box 80–90 de largura.
- Circulação mínima: 60 cm ao lado da cama, 80–90 cm em passagem principal, 75 cm na frente de armário.
  Avisar (sem impedir) quando o móvel colide com parede, porta (raio de giro) ou outro móvel.
- Móvel = `{ id, catalogoId, posicao (cm), rotacao (graus), dimensoes (cm), material, ambienteId }`.
  Preparado para `modelo: { tipo: 'primitivo' | 'gltf', url }`, `loja`, `preco` (orçamento futuro).

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

## Verificação (obrigatória ao fim de cada etapa)

1. `npm run typecheck && npm test` em `apartment-studio/`.
2. `npm run build && npm run e2e` — abre o app no Chromium (Playwright), tira screenshots de cada câmera,
   confere que o canvas não está em branco e que não há erro no console. Olhe os PNGs gerados.
3. Atualize `docs/ARQUITETURA.md` (o que mudou) e `docs/ANALISE_PLANTA.md` (se mexeu em medida).
