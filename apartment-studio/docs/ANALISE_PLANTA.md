# Análise da planta baixa

Fonte: imagem enviada pelo Alan em 13/11/2026 (planta humanizada, 1536 × 864 px), guardada em
`public/referencia/planta-apartamento.webp`. Modelo em `src/modelo/plantaReal.ts`.

## 1. Escala e leitura das cotas

- As cotas foram lidas como **vão interno** (de face a face das paredes). Lidas assim, as 14 cotas legíveis
  concordam entre si em **≈ 129,5 px/m (0,772 cm/px)**, com variação de ±1,5%. Lidas como eixo ou face
  externa, elas não fecham.
- Calibração principal: cota **3,86** (largura do jantar) = 498 px.
- Origem (0, 0) = canto externo superior esquerdo (pixel 169, 80). X para a direita, Y para baixo.
- Paredes detectadas pelos pixels escuros da imagem. Posição e espessura medidas, depois os eixos foram
  ajustados para que cada vão interno seja **exatamente** a cota (origem `derivada`).

## 2. Cotas da planta × modelo (conferidas automaticamente)

| Cota | Onde | Modelo | Situação |
|---|---|---|---|
| 3,77 | Varanda, largura | 3,77 | ✓ |
| 0,60 | Varanda, profundidade | 0,60 | ✓ (na imagem o vão mede ≈ 0,67; valeu a cota escrita) |
| 1,50 | Cozinha, largura | 1,50 | ✓ |
| 3,87 | Cozinha, do nicho/shaft até a parede do fundo | 3,87 | ✓ |
| 2,40 | Sala de estar, largura | 2,40 | ✓ |
| 4,52 | Sala de estar + jantar, profundidade | 4,52 | ✓ |
| 2,30 | Parede da TV | 2,30 | ✓ |
| 2,40 | Quarto 2, largura | 2,40 | ✓ |
| 2,87 | Quarto 2, profundidade | 2,87 | ✓ |
| 2,51 | Quarto principal, largura | 2,51 | ✓ |
| 3,92 | Quarto principal, profundidade | 3,92 | ✓ |
| 2,40 | Banheiro, largura | 2,40 | ✓ |
| 1,20 | Banheiro, profundidade | 1,20 | ✓ |
| 3,86 | Jantar, da parede da cozinha ao hall | 3,86 | ✓ |
| **2,52** | Corredor? | 2,55 | **? a confirmar**: não está claro a que trecho se refere |
| **1,32** | Hall de entrada? | 1,27 | **? a confirmar**: lida como do corredor até a parede da porta |

O teste `geometria.test.ts` falha se alguma cota confirmada deixar de bater (tolerância 0,5 cm). Na
interface, aba **Planta**, a lista mostra ✓ / ! / ? e a vista de planta pinta as cotas (verde = confere,
vermelho = divergente após edição, tracejado = a confirmar).

## 3. Medidas que NÃO constam na planta (estimadas)

| Elemento | Valor adotado | Origem | Observação |
|---|---|---|---|
| Pé-direito | 260 cm | estimada | conferir no memorial descritivo |
| Parede externa | 10 cm | estimada | medida na imagem (13 px); obra real costuma ter 14–19 cm |
| Parede interna | 7 cm | estimada | medida na imagem (9 px) |
| Varanda lateral / pilar | 18,5 cm | estimada | trecho mais grosso na imagem (estrutura/shaft) |
| Parede hall/banheiro | 18 cm | estimada | trecho mais grosso na imagem (estrutura/shaft) |
| Guarda-corpo da varanda | 110 cm de altura, 4 cm | estimada | traço fino na planta |
| Shaft da área de serviço | 22 × 65 cm | estimada | retângulo no canto da janela; o comprimento sai da cota 3,87 |
| Shaft do banheiro | ≈ 92 × 25 cm | estimada | retângulo ao lado do box, medido na imagem |
| Pontos de ar-condicionado | 3 (sala, quarto 2, suíte) | estimada | símbolo rosa de floco de neve na planta; posição medida na imagem |
| Divisória cozinha/sala | termina em y = 316 cm | estimada | medida na imagem |
| Alturas de porta | 210 cm | estimada | padrão |
| Janelas dos quartos | 120 cm de altura, peitoril 100 | estimada | larguras medidas: 124 e 123,5 |
| Janela do banheiro | 55 × 60, peitoril 150 | estimada | largura medida |
| Janela área de serviço → varanda | 65 cm de largura (100 × peitoril 110) | estimada | é janela: o Alan pediu a pedra da bancada "abaixo da janela". Largura medida na planta (≈63 cm, à direita, encostada na divisória). A foto do decorado confirma a posição e um peitoril ≈25–30 cm acima do tanque; nela a janela parece um pouco mais larga — **medir no local** |

### Acabamentos que também não constam na planta (adotados na Etapa 5, trocáveis na interface)

| Elemento | Adotado | De onde veio |
|---|---|---|
| Portas, batentes e guarnições | Madeira com veio, um pouco mais escura que os armários de madeira da cozinha; maçaneta de alavanca cromada; guarnição de 6 cm | **informado pelo Alan** (cor); tom exato, maçaneta e largura da guarnição estimados |
| Esquadrias (janelas e porta da varanda) | Alumínio branco | fotos do decorado (banheiro e área de serviço) |
| Paredes do banheiro | Azulejo branco 60 × 30 até o teto | decorado: box azulejado até o teto; no trecho da pia lá é meia parede |
| Rodapé | Branco, 7 cm, nas paredes pintadas | padrão — conferir |
| Piso | Porcelanato claro 60 × 60 | cor da planta; formato estimado |
| Vista pelas janelas | Céu e uma linha de prédios ao longe | cenário genérico: o andar e a vista real não são conhecidos |
| Sol | Arco de leste a oeste pelo lado da varanda | o norte não foi informado (pergunta 4) |

## 4. Portas e aberturas (larguras medidas na imagem calibrada)

| Abertura | Largura (vão com batente) | Abre para |
|---|---|---|
| Entrada (parede inferior do jantar) | ≈ 92 | dentro, folha encostando na parede do hall |
| Porta de correr sala → varanda | ≈ 153 | — |
| Banheiro | ≈ 73 | dentro do banheiro |
| Quarto 2 | ≈ 83 | dentro do quarto, folha junto ao armário |
| Quarto principal | ≈ 83 | dentro do quarto |

## 5. Ambientes (área pelo eixo das paredes)

| Ambiente | Vão interno (cotas) | Área pelo eixo |
|---|---|---|
| Quarto principal | 2,51 × 3,92 = 9,84 m² | 10,45 m² |
| Quarto 2 | 2,40 × 2,87 = 6,89 m² | 7,31 m² |
| Banheiro | 2,40 × 1,20 = 2,88 m² | 3,25 m² |
| Varanda | 3,77 × 0,60 = 2,26 m² | 2,59 m² |
| Cozinha e área de serviço | 1,50 de largura | 7,30 m² |
| Sala de estar / jantar / corredor | (sem cota de área) | 5,99 + 5,19 + 2,58 m² |
| **Total** | | **≈ 44,7 m²** pelo eixo |

A planta não traz áreas escritas. Se o contrato ou o memorial informar a área privativa, dá para conferir.
O anúncio do decorado fala em unidades de 48 a 64 m² (2 e 3 quartos): esta planta, de 2 quartos, é coerente com
a menor — os ≈44,7 m² pelo eixo viram ≈47–48 m² com paredes externas de obra (14–19 cm, mais grossas que os
10 cm lidos na imagem).

## 6. Mobiliário

O mobiliário genérico da planta humanizada foi substituído pelas coisas do Alan e pela marcenaria pedida
(ver `PREFERENCIAS.md` e `src/modelo/mobilia.ts`). Ficaram como sugestão da planta: cama de solteiro,
escrivaninha e guarda-roupa do quarto 2, duas banquetas na varanda e os três aparelhos de ar-condicionado
nos pontos indicados. A planta desenha os móveis menores que o real (a cama de casal aparece com ≈1,58 m
de comprimento); no modelo eles têm medida de mercado.

## 7. Dúvidas para o Alan

1. A cota **2,52** (abaixo do quarto 2) se refere a qual trecho?
2. A cota **1,32** (ao lado da porta de entrada) se refere a qual trecho?
3. **Pé-direito** real (memorial descritivo)? Define a altura do guarda-roupa, do armário-ponte e dos aéreos.
4. Onde fica o **norte** (para a posição real do sol)?
5. As marcações rosa (quarto 2, suíte, parede da TV) foram lidas como pontos de ar-condicionado — confirmar com a construtora.
6. Shafts da cozinha e do banheiro: conferir as medidas no local.
7. Largura e peitoril da janela da área de serviço (define a pedra e o frontão sob ela).
