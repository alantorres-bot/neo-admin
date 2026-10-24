# Auditoria final de encerramento — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged` · Modo: somente leitura

Documentos auditados:
- `docs/modulos/contratos-operacoes.md`: revisão 5, status **rascunho**;
- `docs/modulos/administrativo-ged.md`: revisão 3, status **rascunho**.

Referências:
- `docs/auditoria/AUDITORIA_POS_CORRECOES_CONTRATOS_GED_2026-10-24.md`;
- `docs/auditoria/CORRECOES_FINAIS_CONTRATOS_GED_2026-10-24.md`.

**Limitação:** todas as rodadas (revisão 5, correções pós-auditoria e correções finais) estão juntas na pasta de trabalho, sem commit,
comparadas com o `0b8508e`. Por isso o git não separa as rodadas; a conferência foi feita pelo conteúdo.

## 1. Veredito executivo

**APROVÁVEL COM RESSALVAS.**
- **Sem bloqueadores:** nenhuma contradição normativa, decisão inventada ou pendência perdida.
- **O que foi conferido:** os oito itens da rodada final, os 33 pendentes de Contratos, os 19 do GED e as referências cruzadas.
- **O que falta:** duas ambiguidades localizadas (seção 4) precisam ser reconhecidas antes da aprovação formal.
- **Alcance:** a aprovação documental não libera nenhuma fase para implementação.

## 2. Os oito itens da rodada final

| Item | Status | Evidência | Conclusão |
|---|---|---|---|
| **AF-2** | RESOLVIDO | Contratos seção 6: "não trava a passagem para `em_assinatura`; efeito na liberação para faturamento: [PENDENTE 29]". A 5.5.3, o teste da seção 10, o item 29 e a 15.2 dizem o mesmo. A busca por "nem a liberação", "nem liberação", "não trava/bloqueia/impede a liberação" não acha nada nos dois arquivos | A decisão ficou restrita a `em_assinatura` |
| **AF-21** | RESOLVIDO | 4.2: "**O id… não é prometido nem devolvido** enquanto o GED PENDENTE 2…"; 5.6.3; teste 10.2 (9); 15.7 (1) | As três interfaces estão coerentes |
| **AF-22** | RESOLVIDO | GED 5.3 (7): "quem pode executá-la está pendente [PENDENTE 16]"; seção 9: linha "**a definir** [PENDENTE 16]"; item 16 com as duas alternativas. "para o gestor." não aparece mais | Nenhum perfil foi definido por padrão |
| **AF-5** | RESOLVIDO | GED 6: módulo, texto, chave e contagem dependem do PENDENTE 15; formatos antigos riscados como "fora de vigência"; "nenhuma pendência pode revelar raiz restrita nem contagem" | Os formatos antigos não podem ser lidos como regra vigente |
| **AF-6** | RESOLVIDO | GED 5.2.4.5 cita os PENDENTES 13 e 17; os bloqueios da A0 incluem o 17 e dizem "a parte… **não pode ser executada**" e "A A0 não fica liberada por partes" | Sem liberação parcial |
| **AF-12** | RESOLVIDO | Contratos 7.3: "exibida só a quem pode ler a raiz `elaboracao`…; a regra vale na tela e nas consultas que a alimentam"; o nível remete ao PENDENTE 17 de Contratos, sem escolha | Coerente com a 5.12.7 e o teste 10.2 (7) |
| **AF-16** | RESOLVIDO, com ressalva R-1 | 5.4.6: "**Não** é regra vigente que a cancelada conta como resolvida"; 10a cita a validação das regras O-1 a O-4 e usa o PENDENTE 25 só para o reaproveitamento | O caso do cancelamento está correto; ver R-1 |
| **N-1** | RESOLVIDO | Só restam duas menções sem tema: na seção 0.1 e no item 28. As duas são **citações históricas**, e a 0.1 deixa claro: "**Vale a numeração da seção 15 desta especificação**, citada sempre com o tema". O GED não tem nenhuma menção sem tema | Sem risco de confusão; não é ressalva |

## 3. AF-1 a AF-22

- **AF-1, 3, 4, 7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19 e 20:** continuam **RESOLVIDOS**. A rodada final não tocou nessas seções, e as
  buscas não acharam reintrodução. Isso inclui:
  - AF-1: só a regra antiga riscada;
  - AF-3, AF-17 e AF-18: seção 8 sem mudança;
  - AF-8 e AF-9: a ordem A0 → A1a → A1b → A2 básica → C1 → C3 → A2 completa foi mantida;
  - AF-20: continua inferência a confirmar.
- **AF-2, 5, 6, 12, 16, 21 e 22:** eram parciais e agora estão **RESOLVIDOS** (tabela acima).
- O que está **especificado** não foi **testado nem implementado**. Os testes descritos são planejados.

## 4. Achados novos (ressalvas)

| ID | Classe | Evidência | Problema | Ação documental |
|---|---|---|---|---|
| **R-1** | Ressalva documental | Contratos 10.1 (10a): "**reativação:** cria uma obrigação nova…" e "**reabertura:** as dependentes não concluídas voltam a `bloqueada`…" | O cabeçalho do 10a diz que os resultados dependem da validação das regras O-1 a O-4, mas esses dois itens descrevem como resultado esperado o desenho **proposto** da 15.5 (itens 4 e 6), que não foi aprovado | Marcar os dois itens como "conforme a proposta 15.5, a validar", como já foi feito no item do cancelamento |
| **R-2** | Ressalva documental | Contratos C3 (seção 12): "proteção das colunas… (AF-12, **PENDENTE 17**)"; o GED usa "**PENDENTE 17**" para outra coisa | "PENDENTE 17" quer dizer coisas diferentes nos dois documentos: em Contratos é o nível mínimo de acesso à elaboração (o mesmo item que o GED 14); no GED é o mecanismo de proteção por coluna. Nas referências entre documentos, o texto usa "GED PENDENTE n", mas o número solto pode confundir quem lê os dois | Na linha da C3, escrever "PENDENTE 17 (Contratos) / GED 14", e no GED usar sempre "Contratos, item n" |

Não foi encontrada referência quebrada, campo ausente nem nova decisão implícita.

## 5. Pendências e referências cruzadas

- **Contratos:** itens 1 a 33, em sequência, sem repetição nem lacuna.
- **GED:** itens 1 a 19, em sequência, sem repetição nem lacuna.
- **Correspondências conferidas no texto:**

  | Contratos | GED |
  |---|---|
  | 17 | 14 |
  | 24 | 12 |
  | 30 | 18 |
  | 32 | 19 |

  Contratos 22 é o item citado pelo GED 10.
- Nenhuma pendência foi aprovada, apagada ou renumerada.
- As propostas R4-P1 a R4-P8 aparecem com número, tema e estado coerentes com a matriz 0.1.

## 6. Bloqueios por fase

| Fase | Bloqueios (todos abertos) |
|---|---|
| GED A0 | pendentes 1, 3, 13 e 17; controles mínimos e testes 13 e 14 |
| GED A1a | A0; pendentes 15, 16, 17, 19, 14 e 2 |
| GED A1b | A1a aprovada; pendente 12 |
| GED A2 básica | A1b; pendente 18 |
| GED A2 completa | A2 básica; C3 de Contratos |
| Contratos C1 | A2 básica do GED; views do Comercial e do Financeiro; pendente 14 |
| Contratos C3 | pendentes 8, 22, 23, 26, 29 e 30; constraints; pendente 17; GED 2; especificação do Recebíveis |
| Contratos C4 | pendentes 20, 21, 31, 9, 27, 25, 1, 3, 4 e 6; validação das regras O-1 a O-4 |

A sequência não tem ciclo, e nenhuma fase foi liberada, nem de forma implícita.

## 7. Git

- **Branch:** `auditoria-contratos-ged`, em dia com `origin` quanto aos commits.
- **Modificados (sem commit):** `docs/modulos/administrativo-ged.md` e `docs/modulos/contratos-operacoes.md`.
- **Não versionados no momento da auditoria:**
  - `docs/auditoria/AUDITORIA_POS_CORRECOES_CONTRATOS_GED_2026-10-24.md`;
  - `docs/auditoria/CORRECOES_FINAIS_CONTRATOS_GED_2026-10-24.md`.
- **Último commit:** `0b8508e`. Nenhum stash.
- **Revisões e status:** Contratos na revisão 5 e GED na revisão 3, os dois em **rascunho**.
- **Durante a auditoria:** nenhuma alteração. O `git status` ficou igual do início ao fim. Este arquivo foi gerado depois da auditoria,
  a pedido do responsável.

## 8. Ações restantes

**Correções documentais (antes da aprovação formal):**
- R-1: condicionar os itens de reativação e reabertura do teste 10a à proposta 15.5;
- R-2: deixar claro a qual documento cada "PENDENTE 17" se refere.

**Decisões de negócio:** pendentes 2, 3, 4, 6, 8, 9, 12, 14, 15, 16, 19, 20, 21, 22 (inclui a inferência AF-20), 23, 25, 26, 27, 28,
29 e 31 de Contratos; pendentes 1, 2, 3, 5 a 8, 11 e 13 a 16 do GED.

**Validações técnicas futuras:**
- constraints dos aditivos e índice único do PDF;
- mecanismo de proteção por coluna (GED 17);
- fonte de verdade do PDF (Contratos 30 / GED 18);
- assinatura técnica da checagem por módulo (GED 19);
- regras O-1 a O-4;
- normalização da numeração e compatibilidade com o Financeiro;
- todos os testes da 11.5 do GED e da seção 10 de Contratos, que estão só especificados, nenhum executado.

**Validações externas:**
- **Fiscal:** item 1;
- **Bancos:** itens 6 e 27;
- **Financeiro e Recebíveis:** itens 2, 8 e 26, e as políticas de `rec_contratos`;
- **Comercial:** views públicas de pedidos e NFs;
- **Administrador do Workspace:** item 24 / GED 12.

**Git:** decidir se os relatórios em `docs/auditoria/` vão para o repositório ou saem dele, e quando fazer o commit do conjunto.

## Conclusão

Os documentos podem ir para aprovação formal depois das duas correções pontuais, R-1 e R-2. Se o responsável preferir, podem ir já,
com as duas ressalvas declaradas. Em qualquer caso, nenhuma fase fica liberada para implementação.
