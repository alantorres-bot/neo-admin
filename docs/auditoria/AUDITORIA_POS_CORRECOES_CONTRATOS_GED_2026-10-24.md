# Auditoria independente pós-correções — Contratos e GED

Data: 24/10/2026 · Branch: `auditoria-contratos-ged` · Modo: somente leitura (nenhum arquivo alterado durante a auditoria).

Objeto:
- `docs/modulos/contratos-operacoes.md` (revisão 5, com as correções pós-auditoria AF-1 a AF-22);
- `docs/modulos/administrativo-ged.md` (revisão 3, com as mesmas correções).

O resultado vem do texto atual dos arquivos e do `git diff`, não do relatório anterior.

**Limitação:** as alterações da revisão 5 e as correções pós-auditoria estão juntas na pasta de trabalho, sem commit, e as duas comparam
com o `0b8508e`. Por isso o git não separa as duas rodadas; a separação foi feita pelo conteúdo (marcas [AF-n] e texto).

## 1. Veredito

**Aprovável com ressalvas:** 15 achados resolvidos e 7 parciais, nenhum não resolvido.
- **O que está coerente:** fases sem ciclo, pendências íntegras, decisões pendentes mantidas como pendentes.
- **O que falta:** sete correções ficaram parciais. Em quatro delas, um trecho normativo continua contradizendo a regra corrigida. O caso
  mais sério é o **AF-2**: a ampliação retirada da 5.5.3 ainda aparece na tabela de pendências da seção 6.
- **Recomendação:** aprovar formalmente só depois das quatro correções documentais da seção 7.
- **Fases:** nenhuma está pronta para implementação.

## 2. Matriz AF-1 a AF-22

| AF | Status | Evidência | Justificativa |
|---|---|---|---|
| 1 | **RESOLVIDO** | Contratos 5.8.4: "Regra única vigente… pelo histórico dos eventos de liberação"; regra antiga riscada e "fora de vigência". Coerente com 10.1 (5a), 10.2 (8) e 15.1 (4) | Uma só regra normativa, que trata reversão e mesmo dia |
| 2 | **PARCIAL** | A 5.5.3 foi corrigida ("não trava a passagem para `em_assinatura`"), mas a **seção 6** ainda diz: "não trava assinatura **nem liberação**" | A ampliação continua num trecho normativo e contradiz o pendente 29 |
| 3 | **RESOLVIDO** | Seção 8: `contrato_id` obrigatório e com chave estrangeira simples nas duas tabelas; explicação do `MATCH SIMPLE`; o mesmo na 15.3 (1) | Tudo como desenho a validar, sem afirmar que existe no banco |
| 4 | **RESOLVIDO** | GED 5.11.10 (linha × coluna × superfície), nota da seção 9, leitura direta só pelo admin geral nas tabelas sensíveis, testes 9 e 10; mecanismo no pendente 17 | Não atribui mais à RLS a proteção de colunas |
| 5 | **PARCIAL** | GED 6: a regra nova e as alternativas estão lá (pendente 15), mas a tabela ainda define "Classificar **N** documentos sem tipo" com a chave `ged:sem_tipo:<raiz>`, publicada no módulo `administrativo.ged` | A tabela normativa continua com o formato que a regra proíbe; deveria depender do pendente 15 |
| 6 | **PARCIAL** | GED 5.2.4.5 traz a tabela de controles da A0 e os testes 13 e 14; mas a linha A0 dos bloqueios **não cita o pendente 17**, enquanto o próprio item 17 diz "bloqueia a A1a **e a parte da A0 que depende dela**" | A projeção sem `segredo_id` para o admin depende do mecanismo de colunas |
| 7 | **RESOLVIDO** | GED 13: a tabela de fases (A0, A1a, A1b, A2 básica, A2 completa, B, C) está separada da tabela de bloqueios | Nenhuma fase perdida |
| 8 | **RESOLVIDO** | GED 13: A1a sem indexar, A1b só depois de a A1a ser aprovada; critérios separados na seção 12; 5.11.9 fala em "etapa A1b" | Ordem explícita, descrita como subdivisão só no documento |
| 9 | **RESOLVIDO** | GED 13 traz a A2 básica, a A2 completa depois da C3 e a ordem sem ciclo; Contratos 12 (C1 = "GED A2 básica") e pendente 33 | Ressalva baixa: a GED 5.4.8 descreve a sugestão sem dizer que ela é da A2 completa |
| 10 | **RESOLVIDO** | Contratos 5.5.3 ("Um PDF, uma versão"), seção 8 (índice proposto, não implementado), 10.1 (9) | Regra normativa e teste coerentes |
| 11 | **RESOLVIDO** (como pendência) | Contratos 5.5.3 + pendente 30; GED 5.6.1 + pendente 18, que bloqueia a A2 básica | Proposta sem escolha, igual nos dois documentos |
| 12 | **PARCIAL** | Contratos 5.12.7 e o teste 10.2 (7) existem, mas a **tela 7.3 (aba Contrato)** mostra "revisão do DOCX" sem restringir a quem lê a raiz | A tela contradiz a proteção da revisão |
| 13 | **RESOLVIDO** | GED 5.10: checagem pelo módulo do alvo (`tem_acesso_modulo`, que existe nas migrations 0002 e 0152) e por `ged_alvos`; "ou a área do módulo chamador" foi retirado; pendente 19; teste 15 | Ressalva baixa: Contratos 15.4 (3) mantém o texto original da R4, marcado como histórico |
| 14 | **RESOLVIDO** | Contratos 5.4.8: "dispensar a obrigação não libera o faturamento"; pendente 9 mantido | Coerente com a 5.8.2 |
| 15 | **RESOLVIDO** | Contratos 5.8.4: "recomendação… ainda **não foi aprovada**"; pendente 31; sem datas nem critério | Nenhuma decisão presumida |
| 16 | **PARCIAL** | A 5.4.6 está correta ("**Não** é regra vigente que a cancelada conta como resolvida"), mas o **teste 10.1 (10a)** afirma que as dependentes "não ficam bloqueadas para sempre" e atribui o resultado ao **pendente 25** | O teste presume uma regra não aprovada e cita a pendência errada; deveria citar a validação das regras de dependência |
| 17 | **RESOLVIDO** | Seção 8: as unicidades antigas estão riscadas e marcadas como obsoletas, tanto em `ctr_minutas` quanto em `ctr_aditivos` | Nenhuma regra antiga em vigor |
| 18 | **RESOLVIDO** | `identificacao_normalizada` está na lista de campos, com o significado e a regra de normalização marcada "a validar" | — |
| 19 | **RESOLVIDO** | 5.5.1, 5.5.3, 5.5.4, 8.1 e seção 8 tratam o contrato principal pelas linhas sem aditivo; "vigente" não aparece mais como regra | Ressalva baixa: a tabela da 5.4.1 (`aguardar_aprovacao_cliente`) e a 8.2 ("1ª minuta enviada") não repetem o filtro, mas o texto normativo da 5.5 decide |
| 20 | **RESOLVIDO** | Contratos 5.5.3: "inferência pendente de confirmação"; pendentes 18 e 22; matriz 0.1 | Não declara a aprovação permitida nem bloqueada |
| 21 | **PARCIAL** | A 5.6.3 e o teste 10.2 (9) trazem a ressalva, mas a **4.2** e a **15.7 (1)** ainda prometem "o id do `contrato_assinado` quando estiver no dossiê", sem a dependência do pendente 2 do GED | A interface pública contradiz a regra corrigida |
| 22 | **PARCIAL** | Os logs estão tratados (5.11.11, teste 11) e a seção 9 deixa a permissão pendente (16), mas a **GED 5.3 (7)** ainda afirma: "botão 'Atualizar índice agora' **para o gestor**" | Afirma como fato o que está pendente |

## 3. Novos achados

| ID | Sev. | Evidência | Natureza |
|---|---|---|---|
| N-1 | Baixo | Contratos tem **14 menções** a R4-Pn sem o tema (ex.: "Proposta: **R4-P1** (seção 15.1)" na 5.4.3, e as linhas de `ctr_obrigacoes` e `ctr_contratos` da seção 8). No GED, nenhuma | Erro documental: contraria a regra "número e tema juntos" |

Não foi encontrada referência quebrada nas seções conferidas, nem campo usado em restrição sem estar no modelo (o caso do AF-18 foi
resolvido).

## 4. Pendências

- **Contratos:** os itens 1 a 33 são sequenciais e únicos, sem lacunas nem repetição. Os itens 1 a 28 continuam presentes, e os novos
  29 a 33 batem com o relatório anterior.
- **GED:** os itens 1 a 19 são sequenciais e únicos. Os novos 15 a 19 batem.
- **Referências cruzadas conferidas:**

  | Contratos | GED |
  |---|---|
  | 17 | 14 |
  | 24 | 12 |
  | 30 | 18 |
  | 32 | 19 |

  Contratos 22 é o mesmo item citado pelo GED 10.
- **Nenhuma pendência foi marcada como aprovada.** As propostas aparecem como proposta ou "a validar", e nada é descrito como
  implementado.

## 5. Bloqueios por fase

| Fase | Bloqueios atuais |
|---|---|
| **GED A0** | pendentes 1, 3 e 13; controles mínimos da 5.2.4.5 e testes 13 e 14; **também o pendente 17** (AF-6, ainda não listado na linha da A0) |
| **GED A1a** | A0 concluída; pendentes 15, 16, 17, 19, 14 e 2 |
| **GED A1b** | A1a aprovada com todos os testes da 11.5 passando; pendente 12 (Drive compartilhado) |
| **GED A2 básica** | A1b; pendente 18 |
| **GED A2 completa** | A2 básica; Contratos C3 |
| **Contratos C1** | GED A2 básica; views públicas do Comercial e do Financeiro; pendente 14 |
| **Contratos C3** | pendentes 8, 22, 23, 26, 29 e 30; constraints a validar; pendente 17; pendente 2 do GED; especificação do Recebíveis |
| **Contratos C4** | pendentes 20, 21, 31, 9, 27, 25, 1, 3, 4 e 6; validação das regras de dependência |

A ordem A0 → A1a → A1b → A2 básica → C1 → C3 → A2 completa não tem ciclo. Nenhuma fase está pronta.

## 6. Integridade do Git

- **Branch:** `auditoria-contratos-ged`.
- **Arquivos modificados:** só `docs/modulos/administrativo-ged.md` e `docs/modulos/contratos-operacoes.md`, sem commit.
- **Commits:** o último continua sendo `0b8508e`; nenhum commit novo. Nenhum stash.
- **Revisões e status:** Contratos na revisão 5 e GED na revisão 3, os dois com status **rascunho**.
- **Durante a auditoria:** nenhum arquivo foi criado, alterado ou excluído, e não houve operação externa nem comando de escrita no git.

## 7. Próximo passo recomendado

Antes da aprovação formal, quatro correções pontuais e documentais, sem decisão nova:
1. **AF-2:** na seção 6 de Contratos, trocar "não trava assinatura nem liberação" por "não trava a assinatura; efeito na liberação:
   PENDENTE 29".
2. **AF-21:** na 4.2 e na 15.7 (1), condicionar o id do documento ao pendente 2 do GED, como já está na 5.6.3.
3. **AF-22:** na GED 5.3 (7), trocar "para o gestor" por "quem executa: PENDENTE 16".
4. **AF-5:** na tabela de pendências da GED 6, dizer que o formato e o módulo dependem do pendente 15.

Também recomendado, de baixo esforço:
- **AF-6:** incluir o pendente 17 na linha da A0;
- **AF-12:** restringir "revisão do DOCX" na tela 7.3 a quem lê a raiz;
- **AF-16:** corrigir o teste 10a para citar a validação das regras de dependência;
- **N-1:** completar as menções R4-Pn com o tema.
