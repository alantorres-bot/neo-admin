# Apartment Studio 3D — Arquitetura

Aplicativo pessoal para reproduzir, mobiliar e decorar o apartamento em 3D. Projeto **independente** do
Neo Admin (pasta própria, `package.json` próprio, excluído do `tsconfig`, ESLint e Docker da raiz).
Skill do Claude: `.claude/skills/apartment-studio/SKILL.md` (na raiz do repositório).

## Rodar

```bash
cd apartment-studio
npm install
npm run dev          # http://localhost:5180
npm test             # regras de geometria (Vitest)
npm run build && npm run e2e   # verificação visual no Chromium; capturas em tests/e2e/capturas/
```

## Stack

React 19 + TypeScript + Vite · Three.js + React Three Fiber + Drei · Zustand · IndexedDB (idb-keyval) · CSS puro.

## Pastas

```
src/
  modelo/      tipos.ts (modelo paramétrico), geometria.ts (funções puras + testes),
               plantaReal.ts (leitura da planta + cotas conferidas)
  estado/      store.ts (Zustand: projeto, histórico, seleção, visão), persistencia.ts (IndexedDB)
  cena/        Cena (Canvas, sol, terreno), Paredes, Aberturas, Ambientes, Cameras, Referencia, Rotulos
  ui/          BarraFerramentas, PainelLateral, PainelPropriedades, PainelReferencia, campos, nomes
tests/e2e/     verificar-visual.mjs (Playwright)
docs/          ANALISE_PLANTA.md, ARQUITETURA.md
public/referencia/planta-apartamento.webp   imagem original da planta (decalque calibrado)
```

## Modelo de dados (resumo)

- Medidas em **cm**, com `origem`: `cota` | `derivada` | `estimada` | `manual`.
- `Planta`: `vertices` (x, y) → `paredes` ligam 2 vértices (espessura, altura própria opcional) →
  `aberturas` pertencem a uma parede (posição do centro a partir do vértice `a`, largura, altura, peitoril)
  → `ambientes` são polígonos de vértices. Mover um vértice move todas as paredes e pisos ligados.
- `referencia`: imagem da planta (URL ou dataURL) + escala calibrada (cm/px) + posição/rotação/opacidade.
- `cotas`: cotas escritas na planta, cada uma ligada a duas faces de parede (ou vértice). `conferirCotas()`
  mede no modelo e acusa divergência — qualquer edição que quebre uma cota aparece em vermelho.
- `Projeto`: planta + `moveis` (tipo já definido para a Etapa 4, com campos para GLB, loja e preço).
- A cena 3D é **derivada** do modelo: nunca se edita malha diretamente.

## Etapas

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Skill + análise da planta | Feita: planta lida (escala 0,772 cm/px, cotas de vão interno), ver ANALISE_PLANTA.md |
| 2 | Geometria 3D paramétrica | Feita sobre a planta real: 14/16 cotas conferidas, 2 a confirmar; paredes, portas, janelas, porta de correr, shaft, guarda-corpo, pisos, teto; edição de medidas |
| 3 | Navegação e câmeras | Feita: perspectiva orbital 360°, planta (ortográfica), andar por dentro (WASD), paredes inteiras/recortadas/ocultas, teto, sol por hora, luzes artificiais básicas |
| 4 | Editor de móveis e biblioteca | A fazer |
| 5 | Materiais, texturas e iluminação realista | A fazer (hoje: cores e PBR básico) |
| 6 | Persistência completa, versões e exportação | Parcial: salvamento automático + desfazer/refazer. Faltam versões nomeadas e exportar imagem |

### Já disponível além do escopo mínimo (para não retrabalhar depois)
- Importar a imagem da planta e **calibrar a escala por uma cota** (dois cliques + valor em cm).
- Selo de origem em cada medida; validação (abertura fora da parede, sobreposição, área divergente).
- Salvamento automático no IndexedDB (o projeto continua salvo ao fechar o navegador).
- Desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z), até 100 passos.

## Decisões técnicas

- Rótulos (nomes, áreas, cotas) numa camada DOM própria projetada a cada quadro (`cena/Rotulos.tsx`).
  O `<Html>` do drei cria uma raiz React por rótulo e falhou com React 19 (erro de `removeChild`).
- Paredes com aberturas = trechos de caixa (sem CSG): mais leve e previsível.
- Teto com face só para baixo: visto de fora fica invisível (efeito "casa de bonecas"); por dentro aparece.
- Sombras desligadas e paredes escuras na vista de planta (legibilidade, como desenho técnico).
- Projeto salvo com a planta provisória antiga é substituído automaticamente pela planta real ao abrir.
