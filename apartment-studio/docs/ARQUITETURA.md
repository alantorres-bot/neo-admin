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
node tests/e2e/capturar-ambientes.mjs --limpo     # galeria de perspectivas (use --celular / --escuro)
```

## Stack

React 19 + TypeScript + Vite · Three.js + React Three Fiber + Drei · Zustand · IndexedDB (idb-keyval) · CSS puro.

## Pastas

```
src/
  modelo/      tipos.ts            modelo paramétrico (planta, móveis, vistas, projeto)
               geometria.ts        funções puras: paredes, áreas, cotas, encontros de parede
               plantaReal.ts       leitura da planta + cotas conferidas
               moveis.ts           área ocupada, conflitos (parede, porta, outro móvel), encaixe ao arrastar
               mobilia.ts          móveis do Alan posicionados em cm + vistas por ambiente
               projetoBase.ts      junta planta + mobília + vistas; BASE_ATUAL identifica a revisão
  catalogo/    formas.ts           formas paramétricas (peças em cm a partir de L × P × A e opções)
               catalogo.ts         biblioteca (76 itens em 5 categorias), paleta do projeto, cores por parte
  estado/      store.ts            Zustand: projeto, histórico, seleção, visão, painel
               persistencia.ts     IndexedDB
  cena/        Cena, Paredes, Aberturas, Ambientes, Moveis, Cameras, Referencia, Rotulos, materiais
  ui/          BarraFerramentas, PainelLateral, PainelMoveis, PainelPropriedades, PropMovel, Vistas, …
tests/e2e/     verificar-visual.mjs (36 verificações), capturar-ambientes.mjs (galeria)
docs/          ARQUITETURA.md, ANALISE_PLANTA.md, PREFERENCIAS.md
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
- `catalogo.ts` liga cada item a uma forma, medidas padrão e partes coloríveis (cor + acabamento).
- `materiais.ts` cria materiais e texturas por código (madeira com veio, granilite, granito, palhinha,
  arte do quadro, remos); sem arquivos de imagem.

## Etapas

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Skill + análise da planta | Feita |
| 2 | Geometria 3D paramétrica | Feita: 14/16 cotas conferidas, 2 a confirmar |
| 3 | Navegação e câmeras | Feita: 3D orbital, planta, por dentro (teclado e toque), vistas por ambiente |
| 4 | Editor de móveis e biblioteca | **Feita**: 76 itens; adicionar, selecionar, arrastar com encaixe, girar, redimensionar em cm, cores, duplicar, excluir, travar; avisos de conflito; apartamento montado com as coisas do Alan |
| 5 | Materiais, texturas e iluminação realista | Parcial: acabamentos e texturas por código, luz ambiente com reflexo, porcelanato, estofado arredondado, plafons. Falta: troca de acabamento pela interface, cores de parede, oclusão de ambiente, luminárias reais |
| 6 | Persistência, versões e exportação | Parcial: salvamento automático, desfazer/refazer, aviso de base nova. Faltam versões nomeadas e exportar imagem |

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
