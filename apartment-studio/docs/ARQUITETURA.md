# Apartment Studio 3D — Arquitetura

Aplicativo pessoal do Alan para reproduzir, mobiliar e decorar o apartamento em 3D. Projeto **independente**
do Neo Admin (pasta própria, `package.json` próprio, excluído do `tsconfig`, ESLint e Docker da raiz).
Skill do Claude: `.claude/skills/apartment-studio/SKILL.md` (na raiz do repositório).

Leia também: `docs/PREFERENCIAS.md` (o que o Alan tem, quer e decidiu) e `docs/ANALISE_PLANTA.md` (medidas).

## Rodar

```bash
cd apartment-studio
npm install
npm run dev            # http://localhost:5180
npm test               # regras de geometria, móveis e catálogo (Vitest)
npm run build && npm run e2e                      # verificação visual e funcional no Chromium
node tests/e2e/capturar-ambientes.mjs --limpo     # galeria de perspectivas (--celular / --escuro / --nitido / --hora=20 / --so=10-sala,10-suite)
node tests/e2e/capturar-detalhes.mjs [nome...]    # fotos de perto dos itens com foto de referência (--nitido / --hora=20 / --luzes / --sem-realismo)
node tests/e2e/medir-desempenho.mjs               # chamadas de desenho e triângulos por vista (comparar antes/depois de mexer na cena)
npm run artefato && node tests/e2e/verificar-artefato.mjs   # página única publicável + teste em tela de celular
```

## Página publicada (abre no celular)

- Endereço: https://claude.ai/artifact/VUR55xAmwntHzhc96f3que (privada; só o Alan abre).
- `npm run artefato` gera `dist-artefato/apartment-studio.html`: CSS, JavaScript e a imagem da planta embutidos
  (≈1,8 MB). O Claude publica esse arquivo com a ferramenta Artifact, sempre no mesmo endereço
  (de outra conversa: ler o artefato primeiro e passar `url`). Capacidades declaradas: `db` (salvar na conta) e
  `downloads` (entregar a imagem exportada ao aparelho, com confirmação). Ao republicar, não passe `capabilities`:
  as duas são mantidas; passar só uma apagaria a outra.
- **Salvamento**: na página publicada o projeto vai para o banco de dados da própria página, documento
  `projetos/principal` (`{ app, base, atualizadoEm, projeto }`, ≈30 KB; limite 256 KiB), e continua indo
  para o IndexedDB como reserva. Abre primeiro o que está no navegador e, quando o banco responde, fica
  valendo o mais recente. Cópias de segurança em `copias/<data>`. Fora da página publicada só o IndexedDB.
- **Versões da decoração**: um documento por versão em `versoes/<id>` (`{ app, nome, criadaEm, versao }`,
  ≈ 40 KB com a miniatura) e, no navegador, a chave `versao:<id>`. Ao abrir, a lista do aparelho é juntada com a
  da conta (vale a alterada por último) e o que faltar de um lado é copiado para o outro.
- O Claude lê o projeto atual do Alan com a ferramenta ArtifactData (`get`, coleção `projetos`,
  documento `principal`): é assim que se enxerga o que ele mudou no app antes de propor alterações.
- A imagem importada pelo usuário (data URI) não vai para o banco; a planta original é referenciada pelo
  marcador `@planta-original`.

## Stack

React 19 + TypeScript + Vite · Three.js + React Three Fiber + Drei · postprocessing (sombreamento de cantos, brilho,
curva de tons) · Zustand · IndexedDB (idb-keyval) · CSS puro.

## Pastas

```
src/
  modelo/      tipos.ts            modelo paramétrico (planta, móveis, vistas, projeto)
               geometria.ts        funções puras: paredes, áreas, cotas, encontros de parede
               plantaReal.ts       leitura da planta + cotas conferidas
               geometria.ts (cont.) lados da parede, faixas de face por ambiente, pintura/revestimento, linha de visão
               moveis.ts           área ocupada, conflitos (parede, porta, outro móvel), encaixe ao arrastar
               mobilia.ts          móveis do Alan posicionados em cm + vistas por ambiente
               projetoBase.ts      junta planta + mobília + vistas + pintura escolhida; BASE_ATUAL identifica a revisão
               versoes.ts          versões nomeadas da decoração (criar, abrir, duplicar, renomear, juntar) — pura, testada
  catalogo/    formas.ts           formas paramétricas (peças em cm a partir de L × P × A e opções)
               catalogo.ts         biblioteca (78 itens em 5 categorias), paleta do projeto, cores por parte, luz de cada item
               luzes.ts            luzes que os móveis emitem (plafon, pendente, abajur, fitas de LED) e "o ambiente tem luz de teto?"
  estado/      store.ts            Zustand: projeto, histórico, versões, seleção, visão, painel
               persistencia.ts     IndexedDB (navegador): projeto e versões
               nuvem.ts            banco de dados da página publicada (capacidade db do Artifact): projeto e versões
               arquivos.ts         entregar um arquivo gerado (capacidade downloads na página; link fora dela)
  cena/        Cena, Paredes, Aberturas, Ambientes, Moveis, Cameras, Referencia, Rotulos, materiais
               luz.ts              luz conforme a hora (sol, céu, difusa, noite) — pura, testada
               Luzes.tsx           luzes dos móveis e claridade das janelas · Ceu.tsx céu e horizonte vistos pelas janelas
               PosProcesso.tsx     acabamento realista da imagem + vigia de desempenho (desempenho.ts)
               geometriaParede.ts  faces da parede agrupadas por material (pintura por lado, topo, rodapé) — pura, testada
               Espelho.tsx         espelho que reflete o ambiente (areaEspelho.ts junta as portas num espelho só)
               exportar.ts         tamanho e nome da imagem exportada (puro, testado) · Exportador.tsx desenha em alta resolução
  ui/          BarraFerramentas, PainelLateral, PainelMoveis, PainelPropriedades, PropMovel, Vistas, …
               acabamentos.tsx     paletas de tons prontos, nomes de acabamento/revestimento/piso, seletor de cor
               PainelVersoes.tsx   aba Versões: versões guardadas, exportar imagem e histórico da visita
scripts/       gerar-artefato.mjs  página única para publicar
tests/e2e/     verificar-visual.mjs (93 verificações), verificar-artefato.mjs (celular, 21), capturar-ambientes.mjs (galeria),
               capturar-detalhes.mjs (item de perto, para comparar com a foto), medir-desempenho.mjs
docs/          ARQUITETURA.md, ANALISE_PLANTA.md, PREFERENCIAS.md
docs/referencias/   fotos enviadas pelo Alan (reduzidas) + LEIAME.md com o que cada uma mostra
public/referencia/planta-apartamento.webp   imagem original da planta (decalque calibrado)
```

## Modelo de dados (resumo)

- Medidas em **cm**; cena em metros. X da planta = X da cena; Y da planta (para baixo) = Z da cena.
- `Planta`: `vertices` → `paredes` (ligam 2 vértices) → `aberturas` (pertencem a uma parede) → `ambientes`
  (polígonos de vértices). Cada medida tem `origem`: `cota` | `derivada` | `estimada` | `manual`.
- `cotas`: cotas escritas na planta, ligadas a faces de parede; `conferirCotas()` acusa divergência.
- `Movel`: `catalogoId` + centro `x, y`, `elevacao`, `rotacao` (graus, anti-horário visto de cima; 0 = frente
  para +y), `largura × profundidade × altura`, e opcionalmente `cores`, `acabamentos`, `opcoes`, `grupo`,
  `situacao` (`tenho` | `comprar` | `sob-medida` | `sugestao`), `obs`, `travado`, `modelo` (GLB futuro), `loja`.
- `grupo`: peças do mesmo conjunto planejado (ex.: `cozinha`) podem se sobrepor sem aviso.
- `Vista`: ponto de vista interno salvo (de → para, em cm) — os botões Entrada, Sala, Cozinha, Suíte…
- `Projeto`: planta + móveis + vistas + `base` (revisão do projeto-base) + `alteradoPeloUsuario`.
- A cena 3D é **derivada** do modelo: nunca se edita malha diretamente.

### Projeto-base e projeto salvo
O app abre o projeto salvo no navegador. Quando o Claude muda o layout em código, **aumenta `BASE_ATUAL`**:
quem não alterou nada recebe a versão nova direto; quem alterou vê um aviso para escolher entre carregar a
versão nova (uma cópia da sua fica guardada) ou manter a sua.

### Móveis: formas, catálogo e materiais
- `formas.ts` gera peças (`caixa`, `cilindro`, `esfera`, `cone`, `onda`, `plano`) no referencial do móvel:
  x ∈ [−L/2, L/2], y ∈ [0, A], z ∈ [−P/2, P/2], **frente em +z**. Redimensionar recalcula as peças.
  Teste garante que as peças cabem na caixa do móvel (exceto as marcadas `fora`: puxadores, torneiras…).
- Opções do `armario` usadas para chegar perto das fotos: `cava` (puxador cava: rebaixo escuro no topo da
  frente), `ripado` (portas de ripas), `nichoCentral` (vão aberto com fundo e prateleira), `recuoCorpo` (corpo
  mais estreito que o tampo), `estiloPes: "palito"` (pés inclinados nas pontas e retos sob o nicho), `moldura`
  e `soleira` (quadro aparente em volta das frentes).
- `catalogo.ts` liga cada item a uma forma, medidas padrão e partes coloríveis (cor + acabamento).
- Conferência com fotos: `main.tsx` expõe o estado em `window.__estudio` **só** com `?teste` na URL; o script
  `capturar-detalhes.mjs` usa isso para apontar a câmera para um item (na página publicada não há o parâmetro).
- `materiais.ts` cria materiais e texturas por código (madeira com veio, granilite, granito, palhinha,
  arte do quadro, remos); sem arquivos de imagem.

## Etapas

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Skill + análise da planta | Feita |
| 2 | Geometria 3D paramétrica | Feita: 14/16 cotas conferidas, 2 a confirmar |
| 3 | Navegação e câmeras | Feita: 3D orbital, planta, por dentro (teclado e toque), vistas por ambiente |
| 4 | Editor de móveis e biblioteca | **Feita**: 76 itens; adicionar, selecionar, arrastar com encaixe, girar, redimensionar em cm, cores, duplicar, excluir, travar; avisos de conflito; apartamento montado com as coisas do Alan; rack, cadeira, eletros, cozinha e banheiro conferidos de perto com as fotos dele (`docs/referencias/`) |
| 5 | Materiais, texturas e iluminação realista | **Feita** (ver "Luz e materiais"): hora do dia com sol entrando pelas janelas, noite com as luzes da casa e fitas de LED, sombreamento de cantos, espelhos que refletem, materiais com relevo e brilho, rodapé, portas e esquadrias; troca de acabamento e cor de cada parte do móvel, pintura por face de parede ou por ambiente, revestimentos e piso pela interface. Não entrou: foto com traçado de raios (fica com as "imagens fotorrealistas" previstas para depois) |
| 6 | Persistência, versões e exportação | **Feita** (ver "Versões e exportação"): salvamento automático (navegador e conta), desfazer/refazer, histórico da visita com volta a qualquer passo, versões nomeadas (salvar, abrir, duplicar, renomear, excluir) e exportação de imagem até 4K |

## Luz e materiais (Etapa 5)

**Hora do dia** (`cena/luz.ts`, relógio de 6h a 22h na barra): sol em arco de leste a oeste passando pelo lado da
varanda (o norte da planta não foi informado), cor quente perto do horizonte, noite depois das 18h30. À noite as
luzes da casa acendem sozinhas; de dia, pelo botão Luzes. Na vista de planta vale sempre o meio-dia, sem sombra.

**Por dentro** o teto faz sombra: o sol só entra pelas janelas e pela porta da varanda (manchas de sol no piso).
A claridade do céu entra por uma luz de área em cada vão voltado para fora (`LuzDasJanelas`), que não faz sombra;
a luz difusa fica baixa para haver contraste. A cortina é tecido leve: não barra o sol e brilha um pouco de dia.

**Luzes da casa** (`catalogo/luzes.ts` + `cena/Luzes.tsx`): cada item do catálogo pode declarar `luz` — "ponto"
(plafon, pendente, abajur, luminária de piso) ou "fita" (LED, luz de área para um lado). Brilho, tom e
"apagada" são opções do móvel. Ambiente sem luminária de teto ganha um plafon automático no centro. Nenhuma luz
artificial faz sombra (custaria um desenho da cena por luz); o sombreamento de cantos compensa.
Calibração: `SOL_PLENO` (1,55) e `FORCA_PLAFON` (3,2). `verificar-artefato.mjs` exige que a casa acesa à noite
fique, na média, mais escura que de dia — se mexer nas forças, esse teste avisa.

**Acabamento da imagem** (`PosProcesso.tsx`, botão Realista): oclusão de ambiente (N8AO, meia resolução, sem o
modo "transparência", que redesenhava a cena duas vezes), brilho suave nas luzes (bloom) e curva de tons ACES.
Desligado na vista de planta. Um vigia (`desempenho.ts`) mede o tempo entre quadros enquanto a cena está em
movimento: se a mediana de 24 quadros seguidos passa de 125 ms, desliga o modo realista uma vez por visita e
mostra um aviso (a pessoa pode religar no botão).

**Espelhos** (`Espelho.tsx`): as frentes com acabamento "espelho" de um móvel viram um espelho só, que desenha a
cena de novo do ponto de vista do reflexo — apenas com a câmera por dentro, a menos de 5 m, de frente e sem
parede no meio (`haParedeEntre`). Fora disso aparece o acabamento simples.

**Paredes** (`geometriaParede.ts` + `Paredes.tsx`): uma malha por parede, com um grupo de faces por material.
Cada face é dividida pelo ambiente para o qual está voltada (`faixasDaFace`), e cada trecho pode ter cor e
revestimento próprios (`Parede.acabamentos`: pintura, azulejo, cimento queimado, tijolinho). Rodapé de 7 cm nas
faces internas pintadas (não no banheiro nem em face revestida). Selecionada, a parede ganha só um realce: a cor
escolhida continua à vista. Pisos: porcelanato, madeira em réguas ou cimento, com cor (`Ambiente.pisoMaterial`).

**Portas** (`Aberturas.tsx`): folha, batente e guarnição no mesmo acabamento — madeira com veio (padrão, como as
portas do apartamento; `COR_PORTA_PADRAO` no catálogo) ou pintada (`Abertura.acabamento` e `.cor`). A folha gira
na face interna do batente; maçaneta de alavanca dos dois lados.

**Móveis**: as peças de cada móvel são unidas numa malha por material. Madeira com relevo do veio, estofado com
trama e brilho aveludado, inox escovado, pedra e louça polidas, LED que apaga quando as luzes estão apagadas.

**Custo de desenho** (`medir-desempenho.mjs`, vista 3D com paredes baixas): 990 chamadas antes da Etapa 5 →
≈ 480 depois, já com os efeitos; por dentro, 950 → ≈ 450 (≈ 190 à noite, sem a sombra do sol; +200 a 300 com um
espelho à vista). Trocar a combinação de luzes (acender, anoitecer, entrar na vista por dentro) recompila os
materiais na primeira vez — um instante de preparo, depois fica guardado. O tempo por quadro medido aqui é de um
navegador sem placa de vídeo: vale para comparar antes/depois, não como previsão do celular.

## Versões e exportação (Etapa 6)

**Versões** (`modelo/versoes.ts`, aba Versões): uma versão é uma cópia do projeto inteiro — planta, pintura, móveis e
vistas — com nome, data e uma miniatura da cena. Abrir uma versão troca o projeto em edição por uma cópia dela
(entra no histórico: Ctrl+Z desfaz) e não prende o projeto à versão; a lista marca qual é "a que está aberta"
comparando a decoração. Limite de 30 versões. A imagem de planta importada pelo usuário não entra na versão.
A exclusão pede confirmação na própria lista (a página publicada não pode usar `confirm`).

**Histórico** (`voltarNoHistorico`): lista os passos desta visita; voltar para antes de um passo desfaz também os
seguintes, que ficam disponíveis para refazer. O histórico não é guardado: o que deve ficar, salva-se como versão.

**Exportar imagem** (`cena/exportar.ts`, `Exportador.tsx`): a cena é redimensionada por um instante para o tamanho
pedido (o canvas continua do mesmo tamanho na tela), desenhada duas vezes — a segunda já com o sombreamento no
tamanho novo — e devolvida em JPEG. Formatos: como na tela, 16:9, 1:1 e 9:16; lado maior de 1920, 2560 ou 3840
pontos (4K só em computador; nunca acima do que a placa desenha). A prévia abre por cima de tudo (portal na página)
com a imagem embutida. Salvar: na página publicada, pela capacidade `downloads` (o aparelho pede confirmação;
a página nunca baixa sozinha); fora dela, download comum. Sem como salvar, a prévia orienta a tocar e segurar.

## Decisões técnicas

- Rótulos numa camada DOM própria projetada a cada quadro (o `<Html>` do drei falhou com React 19).
- Paredes com aberturas = trechos de caixa (sem CSG). Encontros: canto em L estende meia espessura da
  outra parede; ponta livre ou em T não estende (`extensoesParede`) — por isso o shaft tem a medida exata.
- Topo das paredes escuro (corte de maquete); teto com face só para baixo (some visto de fora).
- `frameloop="demand"`: a cena só redesenha quando algo muda (bateria no celular). Quem altera algo fora
  do React Three Fiber chama `invalidate()`.
- Arrastar: só o móvel já selecionado se move (o primeiro toque seleciona); durante o arraste o histórico
  não cresce, e ao soltar entra um único passo. Alterações repetidas em sequência também viram um passo.
- Nos modos de parede baixa/oculta, itens pendurados acima de 1 m somem para dar visão de cima.
- Interface com tokens de cor (tema claro e escuro) e folha inferior no celular.
