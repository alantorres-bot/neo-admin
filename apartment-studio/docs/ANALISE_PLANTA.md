# Análise da planta baixa

## Situação atual — planta real AINDA NÃO RECEBIDA

A imagem da planta não veio junto com o pedido inicial (13/11/2026). Para a primeira versão funcionar,
o modelo usa uma **planta provisória**: layout genérico de 2 quartos (~60 m²) com a mesma lista de
ambientes pedida (cozinha, sala de estar/jantar, 2 quartos, banheiro, varanda).

**Nenhuma medida da planta provisória é real.** Todas estão com `origem: "estimada"` e aparecem com `≈`
na interface. O app mostra o aviso "Planta provisória" enquanto `planta.provisoria = true`.

## Layout provisório (todas estimadas)

| Elemento | Valor | Origem | Observação |
|---|---|---|---|
| Pé-direito | 260 cm | estimada | padrão residencial |
| Parede externa | 15 cm | estimada | padrão |
| Parede interna | 12 cm | estimada | padrão |
| Guarda-corpo da varanda | 110 cm de altura | estimada | altura usual |
| Cozinha | 280 × 300 (≈ 8,40 m²) | estimada | ligada à sala por vão de 180 |
| Banheiro | 170 × 220 (≈ 3,74 m²) | estimada | janela alta 60 × 50, peitoril 160 |
| Quarto 2 | 310 × 330 (≈ 10,23 m²) | estimada | janela 150 × 120 |
| Quarto principal | 310 × 370 (≈ 11,47 m²) | estimada | janela 180 × 120 |
| Sala estar/jantar (em L, com hall) | ≈ 19,36 m² | estimada | porta de entrada 90 |
| Varanda | 450 × 160 (≈ 7,20 m²) | estimada | porta de correr 300 × 210 |
| Portas internas | 70–80 × 210 | estimada | padrão de mercado |

Áreas pelo **eixo das paredes** (a área útil é um pouco menor).

## Como a planta real será lida (quando chegar)

1. Abrir a imagem no app: aba **Planta** → **Importar imagem da planta**.
2. **Calibrar pela cota**: clicar nas duas pontas da maior cota legível e informar o valor em cm.
   Conferir com uma segunda cota (diferença > 3% = revisar).
3. Transcrever para `src/modelo/plantaInicial.ts` (ou nova função de leitura):
   - vértices e paredes seguindo a distribuição da planta, sem "melhorar" o layout;
   - cada medida com a origem correta: `cota` (escrita na planta), `derivada` (soma/diferença de cotas),
     `estimada` (medida na imagem calibrada ou padrão), `manual` (corrigida pelo Alan);
   - áreas escritas na planta em `areaInformada` (o app compara com a calculada e avisa se diferir > 3%).
4. Preencher a tabela abaixo e marcar `provisoria: false`.

## Leitura da planta real

| Elemento | Valor | Origem | Observação |
|---|---|---|---|
| _(aguardando a planta)_ | | | |

## Dúvidas para o Alan (quando a planta chegar)

- As cotas são de vão interno, eixo ou face externa?
- Onde fica o norte (para a posição real do sol)?
- Pé-direito real (consta no memorial descritivo)?
