# Correções finais pós-auditoria — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged`

Documentos corrigidos:
- `docs/modulos/contratos-operacoes.md`: revisão 5, status **rascunho**;
- `docs/modulos/administrativo-ged.md`: revisão 3, status **rascunho**.

Referência: relatório `docs/auditoria/AUDITORIA_POS_CORRECOES_CONTRATOS_GED_2026-10-24.md`.

## Resumo

- **Itens:** os oito do relatório de auditoria foram corrigidos: quatro principais (AF-2, AF-21, AF-22 e AF-5) e quatro adicionais
  (AF-6, AF-12, AF-16 e N-1).
- **Nada novo decidido:** nenhuma decisão de negócio foi tomada, nenhuma pendência foi aprovada, apagada ou renumerada, e nenhuma fase
  foi declarada pronta para implementação.
- **Git:** nenhum commit.

## Itens tratados

| Item | Arquivo e seção | Correção | Evidência do texto final | Contradições |
|---|---|---|---|---|
| **AF-2** | Contratos, seção 6 (tabela de pendências) | Retirei "nem liberação"; ficou só o que foi aprovado | "não trava a passagem para `em_assinatura`; efeito na liberação para faturamento: [PENDENTE 29]" | Busca por "nem a liberação", "nem liberação", "não trava/bloqueia/impede/afeta a liberação" nos dois arquivos: **nenhuma ocorrência** |
| **AF-21** | Contratos 4.2, 5.6.3 e 15.7 (1) | As três seções agora prometem só o indicador sim/não. O id do contrato assinado depende do GED PENDENTE 2 | 4.2: "**O id do documento `contrato_assinado` não é prometido nem devolvido** enquanto o GED PENDENTE 2… não for decidido"; a 5.6.3 e a 15.7 dizem o mesmo | As menções restantes ao id falam só da condição; nenhuma o promete sem ela |
| **AF-22** | GED 5.3 (7) e seção 9 | Texto neutro na 5.3; a ação "Atualizar índice agora" saiu da linha `gestor`, e criei a linha "**a definir** [PENDENTE 16]" | "quem pode executá-la está pendente [PENDENTE 16, AF-22]"; "o perfil e a área autorizados ainda não foram escolhidos" | "para o gestor." não aparece mais; o teste 7 da 11.5 e o item 16 estão coerentes |
| **AF-5** | GED, seção 6 | A tabela passou a dizer "o que vira pendência", com texto, chave e módulo "**a definir** [PENDENTE 15]"; os formatos antigos foram riscados. O parágrafo de introdução já não fixa o módulo `administrativo.ged` | "Até a decisão, nenhuma pendência pode revelar raiz restrita nem contagem"; "Se o texto mostra ou não a contagem depende do PENDENTE 15" | Os formatos antigos só aparecem riscados; nenhuma alternativa foi escolhida |
| **AF-6** | GED 5.2.4.5 e bloqueios da A0 (seção 13) | Incluí o PENDENTE 17 nos bloqueios e no critério de liberação da A0 | "a parte da A0 que depende dele… **não pode ser executada** antes da decisão"; "A A0 não fica liberada por partes" | Agora coerente com o item 17 ("bloqueia… a parte da A0") |
| **AF-12** | Contratos 7 (tela do dossiê, aba Contrato) | A revisão do DOCX passa a aparecer só para quem lê a raiz `elaboracao`, na tela e nas consultas que a alimentam | "exibida só a quem pode ler a raiz `elaboracao` pelo GED… não indica se ele existe. O nível exigido é o do [PENDENTE 17]" | Coerente com a 5.12.7 e com o teste 10.2 (7); nenhum nível foi escolhido |
| **AF-16** | Contratos 10.1 (10a) | O teste deixou de presumir o resultado; cita a validação das regras de dependência O-1 a O-4, e o PENDENTE 25 só para o reaproveitamento | "o efeito sobre as dependentes **não está definido**. O teste não presume que a obrigação cancelada conta como resolvida" | "não ficam bloqueadas para sempre" não aparece mais; coerente com a 5.4.6 |
| **N-1** | Contratos (12 linhas: 0.1, 5.4.3, 5.4.6, 5.5.6, 5.12.7, seção 8 três vezes, 12, 13 item 26) | Acrescentei o tema a cada menção, sem mudar número, conteúdo nem status | ex.: "Proposta: **R4-P1 — Financiamento** (seção 15.1)"; "[R4-P6 — Numeração]" | Restam 2 menções sem tema, de propósito (seção seguinte) |

## Ponto não corrigido de propósito

As linhas 85 (aviso da seção 0.1) e 1379 (pendente 28) citam a numeração que o **responsável usou na solicitação**, diferente da
oficial ("R4-P5 foi usado para Encargos…"). Pôr o tema oficial ali inverteria o sentido do aviso, por isso ficaram como estão. As duas
frases podem ser reescritas para evitar a citação direta, se o responsável preferir.

## Verificações finais

- **Afirmações antigas:** nenhuma ocorrência ativa de "não trava assinatura nem", "para o gestor.", "Classificar N documentos sem tipo"
  sem risco, "o id do `contrato_assinado` quando" ou "não ficam bloqueadas para sempre".
- **Pendentes citados nas seções alteradas:** apontam para o item certo:
  - Contratos 29 = efeito na liberação;
  - GED 2 = áreas do dossiê;
  - GED 15 = formato das pendências;
  - GED 16 = "Atualizar índice agora";
  - GED 17 = proteção por coluna;
  - Contratos 25 = critério de reaproveitamento.
- **Numeração das pendências:** Contratos de 1 a 33 e GED de 1 a 19, em sequência, sem lacunas, sem números novos e nenhuma marcada
  como aprovada.
- **Status e revisões:** Contratos na revisão 5 e GED na revisão 3, os dois em **rascunho**. Nenhuma fase foi declarada pronta.

## Arquivos

| Arquivo | Situação |
|---|---|
| `docs/modulos/contratos-operacoes.md` | modificado nesta rodada |
| `docs/modulos/administrativo-ged.md` | modificado nesta rodada |
| `docs/auditoria/AUDITORIA_POS_CORRECOES_CONTRATOS_GED_2026-10-24.md` | já estava no estado inicial, não versionado, **sem alteração** |

Nenhum commit (o último continua sendo `0b8508e`), push, merge, rebase, stash, reset ou checkout.

## Pendências e bloqueios que continuam

- **Contratos:** os itens 1 a 33 continuam abertos (ou parcialmente decididos, como estavam), sem mudança de conteúdo.
- **GED:** os itens 1 a 19 continuam abertos.

| Fase | Bloqueios |
|---|---|
| **GED A0** | pendentes 1, 3, 13 e **17**; controles mínimos |
| **GED A1a** | pendentes 15, 16, 17, 19, 14 e 2 |
| **GED A1b** | A1a aprovada; pendente 12 |
| **GED A2 básica** | pendente 18 |
| **GED A2 completa** | C3 de Contratos |
| **Contratos C1** | A2 básica do GED; views do Comercial e do Financeiro; pendente 14 |
| **Contratos C3** | pendentes 8, 22, 23, 26, 29 e 30; constraints a validar; GED 2 e 17; especificação do Recebíveis |
| **Contratos C4** | pendentes 20, 21, 31, 9, 27, 25, 1, 3, 4 e 6; validação das regras O-1 a O-4 |

Nenhum dos oito itens exigiu decisão de negócio nova. Onde havia escolha, o texto aponta para a pendência existente (15, 16, 17, 29 e
GED 2), sem escolher alternativa.
