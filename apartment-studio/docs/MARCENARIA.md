# Caderno de marcenaria (projeto executivo para orçamento)

Pedido do Alan em 13/11/2026: projeto detalhado da **cozinha** e do **guarda-roupa da suíte**, com medidas em
milímetros, peça por peça, materiais, ferragens, pranchas técnicas, planilha e imagens 3D, para enviar a pelo menos
três marceneiros e comparar orçamentos dos mesmos móveis.

## O que é entregue

| Arquivo | O que é |
|---|---|
| `docs/marcenaria/caderno-marcenaria.pdf` | 28 pranchas em A3 paisagem: capa e índice, notas gerais, plantas, elevações externas e internas, cortes, detalhamento de cada módulo (com balões e lista de peças), imagens 3D, quantitativos, quadro de orçamento e pendências |
| `docs/marcenaria/planilha-marcenaria.xlsx` | Abas: Leia-me, Orçamento (para o marceneiro preencher), Módulos, Peças, Ferragens, Ferragens por módulo, Materiais, Aparelhos, Pendências |
| `docs/marcenaria/imagens/*.jpg` | Imagens 3D usadas no caderno |

## Como gerar de novo

```
npm run build
node tests/e2e/capturar-detalhes.mjs marc-cozinha-frontal cozinha-referencia marc-cozinha-servico geladeira \
  marc-suite-frontal marc-suite-guarda-roupa marc-suite-canto marc-suite-ponte --formato=jpg --escala=1.5 --saida=docs/marcenaria/imagens
npm run marcenaria            # PDF + XLSX (+ HTML, que não vai para o repositório)
node scripts/gerar-marcenaria.mjs --previa [--so=C-02,G-07]   # PNG de cada prancha em docs/marcenaria/previa/
```

As imagens só precisam ser refeitas quando o 3D mudar. O gerador carrega o TypeScript pelo Vite (`ssrLoadModule`),
imprime o PDF com o Chromium do Playwright e grava a planilha com um escritor próprio (`scripts/xlsx.mjs`, sem dependências).

## De onde vêm as medidas (regra do projeto: nada inventado)

- **Envoltória de cada módulo** (largura, altura, profundidade, posição): do modelo 3D (`src/modelo/mobilia.ts`), pela
  função `caixaDoMovel`. O teste "cada módulo tem a envoltória dos móveis que executa" quebra se o caderno e o 3D divergirem.
- **Faces das paredes**: da planta (`criarQuadros`). Os quadros `coz-a`, `coz-b`, `sui-a`, `sui-b` medem cada conjunto a
  partir de uma parede: `s` ao longo dela, `d` profundidade, `z` altura, tudo em mm.
- **Marcas nas cotas**: `P` cota da planta · `E` estimada pela escala da imagem · `A` aparelho com medida típica ·
  `T` proposta técnica (interior) · sem marca = medida do móvel no 3D aprovado.
- **Interior dos armários, espessuras, folgas e ferragens**: não existem no 3D. São o *sistema construtivo de referência*
  (`construtor.ts`) e a proposta de interior (`cozinha.ts`, `suite.ts`), sempre identificados como proposta.

## Como o código está organizado (`src/marcenaria/`)

| Arquivo | Papel |
|---|---|
| `tipos.ts` | `Solido` (peça = caixa alinhada aos eixos), `Modulo`, `LinhaPeca`, `Pendencia`, `Quadro` |
| `quadros.ts` | Quadros de referência a partir da planta; conversão entre quadros |
| `construtor.ts` | Sistema construtivo: `caixa`, `frente`, `gaveta`, `prateleira`, constantes (15/18/6 mm, folga 3, cava 24…) |
| `cozinha.ts`, `suite.ts` | Módulos peça por peça, ferragens e notas |
| `projeto.ts` | `criarMarcenaria`, lista de peças, resumos de materiais, fitas e ferragens, aparelhos, pendências, lotes |
| `desenho.ts` | Desenho em escala (SVG): cotas em cadeia, balões, chamadas |
| `vistas.ts` | Elevação, corte e balões gerados dos sólidos (algoritmo do pintor) |
| `pranchas-cozinha.ts`, `pranchas-suite.ts`, `cartoes.ts` | Plantas, elevações, cortes e detalhamento por módulo |
| `caderno.ts` | Monta o HTML das pranchas e os dados da planilha |

Vistas, cortes, lista de peças, fitas e áreas saem **dos mesmos sólidos**: mudar uma peça muda tudo junto.
Os testes (`marcenaria.test.ts`, `caderno.test.ts`) garantem: peças não se atravessam, não saem do módulo, cabem na
chapa, espessuras válidas, cotas da planta fecham (3,87 e 3,92 m), gavetas cabem com as corrediças.

## Sistema construtivo de referência

Caixa em MDF 15 mm branco TX; frentes e peças aparentes em 18 mm no padrão; fundo de 6 mm sobreposto; prateleira de
18 mm acima de 800 mm de vão; folga de 3 mm entre frentes; rodapé de 100 mm (cozinha) e 80 mm (guarda-roupa), recuado
60 mm; puxador cava de 24 mm no topo das frentes de baixo da cozinha; fecho toque nos aéreos (sem puxador, como no 3D).
É um padrão único para os orçamentos serem comparáveis; alternativas são cotadas à parte.

## Decisões de projeto que o Alan precisa confirmar

1. **Interior do guarda-roupa** (não havia definição): G2 com cabideiro duplo (varões a 1.040 e 2.040) e maleiro; G4 com
   4 gavetas internas, 3 prateleiras e maleiro à esquerda; sapateira, cabideiro longo (1.800) e maleiro alto à direita,
   contínuos com o canto de 570 × 570.
2. **Canto do L da cozinha**: régua fixa de 40 mm + porta de 237 mm no módulo do tanque (o 3D mostrava 2 portas, quase
   todas encobertas pelo gaveteiro).
3. **Puxador cava**: perfil de alumínio escuro (proposto) ou cava usinada e pintada.
4. **Aéreo superior**: 4 portas de 769,5 mm (aprovado) com 3 dobradiças, ou 6 portas menores.
5. **Portas de espelho**: puxador barra furando o espelho, ou perfil na borda.
6. **Complementos da suíte** (armário-ponte, painel, cabeceira, criados): entraram como lotes opcionais C1–C4.

## Pendências que mudam o orçamento

Pé-direito (2.600 estimado), medidas do shaft, modelos dos aparelhos (todos com medida típica) e padrões de MDF sem
marca. Lista completa na prancha P-01 e na aba Pendências. **Nenhuma peça deve ser cortada sem medição no local.**

## Privacidade

O caderno não traz nome, endereço nem o nome do edifício: vai para terceiros.
