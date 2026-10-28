# Preparação para aprovação — GED revisão 4 e Contratos revisão 6

Data da preparação: 24/10/2026. Esta **não** é data de aprovação. Branch: `auditoria-contratos-ged`.

## 1. Processo encontrado no projeto [confirmado por documentação]

- **Regra:** "Qualquer alteração posterior segue o controle de revisão do projeto: **nova revisão no histórico do documento e nova
  aprovação**" (`PREPARACAO_APROVACAO_CONTRATOS_GED_2026-10-24.md`, linha 73).
- **Registro:**
  - decisão (aprovado, reprovado ou pendente);
  - aprovador;
  - data efetiva;
  - observações;
  - **evidência da autorização** (mesmo documento, seções 4 e 5).
- **Precedente:** `APROVACAO_FORMAL_CONTRATOS_GED_2026-10-24.md`. A aprovação expressa do responsável foi registrada na linha
  **Status** e numa entrada do **histórico** de cada especificação.
- **Não há outro procedimento geral** no repositório (busca em `docs/*.md` e `CLAUDE.md`).

**Evidência de aprovação das quatro decisões: nenhuma.** Não há registro de aprovador, data nem autorização. Os pedidos desta etapa
tratam o conteúdo como **recomendação** e pedem expressamente para não marcá-lo como aprovado. Por isso **as revisões 4 e 6 foram
preparadas como minutas**, e as especificações vigentes (GED revisão 3, Contratos revisão 5) **não foram alteradas**.

## 2. Tabela de aprovação

| ID | Decisão proposta | Recomendação técnica | Impacto | Questões pendentes | Aprovador | Data | Evidência | Situação |
|---|---|---|---|---|---|---|---|---|
| **GED-P3** | Conta corporativa dedicada ao GED, OAuth, só leitura | conta dedicada; `drive.readonly`; cliente OAuth **novo** e Interno; refresh token no Vault (padrão 0153); `invalid_grant` gera pendência "Reautorizar"; desconectar só pelo admin geral | migration A0 (`ged_conexao`, `ged_conexao_estados`); Edge Function `nucleo-ged-conectar`; segredos `GED_DRIVE_CLIENT_*`; GED 4.2, 13 e 14.3 (minuta M2, M7, M8) | endereço da conta; dono no Workspace; guarda da recuperação; cliente novo ou existente; destino da pendência de reautorização (PENDENTE 15) | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **GED-P13** | Prévia antes de qualquer persistência | prévia efêmera, só para o admin geral; confirmação explícita; recusa de prévia com erro, incompleta ou vencida (prazo **ou** mudanças desde o `startPageToken`); nada da prévia vira classificação nem vínculo | Edge Function de verificação; função de confirmação; GED 5.2.4.4, 13 e 14.13 (minuta M3, M7, M8) | prazo de validade; gravar ou não o resumo só com contagens | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **GED-P17** | Separação física de dados operacionais e protegidos | tabelas separadas (`ged_pastas_raiz_controle`, `ged_indexacoes_erro`; `ged_conexao` inteira) com `revoke all`; funções `security definer` com checagem; RLS `ged_pode_ler_raiz`; nenhuma permissão por coluna. Evidência: `tests/db/ged-laboratorio.test.ts` | **mudança de arquitetura** nas seções 5.11.10, 8 e 9 (minuta M4 a M6, M9); migrations A0 e A1a | aceitar a troca de "mesma tabela + projeção" por tabelas separadas | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **OP-5.8.1** | Situação calculada da operação | dispensadas e canceladas fora do total exigível; canceladas nunca concluídas; desconhecido ≠ falso; sem regra nunca vira "Pronta"; "Pronta" exige exigíveis concluídas e nenhum impeditivo | Contratos 5.8.1, 10.1 (2a) e 13 (item 34) (minuta N1 a N4); `situacaoOperacao` bloqueada até a aprovação | D1 zero exigível; D2 percentual e denominador; D3 bloqueada por dependência cancelada; D4 condição desconhecida e modelo não configurado | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **PENDENTE 1** (GED) | IDs das raízes `elaboracao` e `dossie_cliente` | não escolher por inferência; cadastro pela tela do admin geral (5.2.1), com verificação (5.2.4) | habilita a A0 (verificação) e a conta dedicada (leitor nas raízes) | ver a seção 4 | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de confirmação externa** |
| **PENDENTE 12** (GED) | Membros do Drive compartilhado | validação pelo administrador do Workspace | sem ela, a restrição da elaboração não vale no Drive (5.11.8); bloqueia a A1b | quem são os membros; se a elaboração precisa de permissões próprias | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de confirmação externa** |

## 3. Perguntas exatas ao responsável

**GED-P3:**
1. Aprova a conta corporativa **dedicada** ao GED, por OAuth e com escopo só de leitura (`drive.readonly`)?
2. Qual é o endereço da conta? Quem é o dono no Workspace? Quem guarda o acesso de recuperação?
3. O cliente OAuth será **novo** (recomendado) ou o "Neo Admin Gmail (rascunhos)" com mais um URI?

**GED-P13:**

4. Aprova a prévia efêmera, só para o admin geral, com confirmação explícita e recusa de prévia vencida?
5. Qual é o prazo de validade da prévia?
6. Ao confirmar, grava-se também o resumo **só com contagens**, sem nomes?

**GED-P17:**

7. Aprova a troca do desenho atual ("mesma tabela, com leitura direta só do admin, mais projeção") por **tabelas separadas** para os
   campos protegidos?

**OP-5.8.1:**

8. Aprova: dispensadas e canceladas fora do total exigível, e canceladas nunca contadas como concluídas?
9. **D1:** uma operação com zero obrigações exigíveis pode ficar "Pronta para encerrar"? (A proposta técnica está no item 34 da minuta.)
10. **D2:** deve haver percentual de conclusão? Sobre o total exigível?
11. **D3:** enquanto as regras O-1 a O-4 não forem aprovadas, que situação mostrar para a obrigação bloqueada por dependência cancelada?
    (Proposta: "Sem regra — conferir".)
12. **D4:** condição comercial desconhecida e modelo ainda não configurado impedem "Pronta"? (Proposta: sim, "Aguardando configuração
    do modelo".)

**Raízes e formalização:**

13. **PENDENTE 1:** qual pasta é a raiz `elaboracao`: `02 - COMERCIAL / 02 - CONTRATOS` ou só a subpasta `Contratos`? A
    `dossie_cliente` é `02 - COMERCIAL / 01 - CLIENTES`? A pasta `ALUTEC / 04 - CONTRATOS E CLIENTES` entra ou fica fora?
14. **Formalização:** quem é o aprovador e qual é a evidência (por exemplo, a mensagem do responsável nesta conversa com "aprovo",
    datada)?

## 4. Raízes do Google Drive (PENDENTE 1)

| Ponto | Situação |
|---|---|
| O que a documentação identifica | GED 2.2 e item 1 da seção 14: **candidatos** lidos pelo conector do Drive em 24/10/2026, todos num Drive compartilhado. **elaboração:** `02 - COMERCIAL / 02 - CONTRATOS` ou só a subpasta `Contratos` (dois IDs candidatos). **dossiê:** `02 - COMERCIAL / 01 - CLIENTES` (um ID candidato). Os IDs estão na especificação e não são repetidos aqui |
| O que continua sem confirmação | qual das duas pastas é a elaboração; se o candidato do dossiê está certo; se a ALUTEC entra |
| Configuração existente | **nenhuma**: nenhum ID em código, variável de ambiente, migration ou tabela [confirmado por código] |
| Quem confirma | o **responsável** (escolha das pastas). Os membros do Drive compartilhado ficam com o **administrador do Workspace** (PENDENTE 12) |
| Como registrar | (1) A resposta do responsável entra na revisão 4 (ou seguinte) como linha "Rev. n: confirmado …" no item 1 da seção 14, com data e evidência. (2) Os IDs **não** vão para o código: o admin geral cadastra cada raiz na tela (5.2.1), que começa em `em_verificacao` e só fica `ativa` depois da verificação e da confirmação (5.2.4 / GED-P13) |

## 5. Divergências entre a documentação anterior e as propostas

| Onde | Texto vigente | Proposta |
|---|---|---|
| GED 5.11.10, 8 e 9 | "mesma tabela, com leitura direta só do admin geral, mais projeção, permissão por coluna ou equivalente" | **tabelas separadas**, sem permissão por coluna (mudança de arquitetura, GED-P17) |
| GED 5.2.4.4 | lacuna "exibir sem persistir" não decidida | prévia efêmera e confirmação. **Mantém** a proibição de gravar nomes de pastas até a A1a |
| `PROPOSTAS_DECISOES…`, seção 3.2 | impressão digital como mecanismo principal | `startPageToken` + prazo como principal; a impressão digital fica como alternativa (atualizado) |
| Contratos 5.8.1 | "todas concluídas" | "todas as **exigíveis** concluídas e nenhum impeditivo"; dispensadas e canceladas fora do total |
| Contratos | não prevê percentual | percentual só se D2 for aprovada |

A GED-P3 não diverge do texto vigente: escolhe a opção A, que a 4.2 já recomendava.

## 6. Próximo passo mais seguro

**Para liberar a migration A0:**
1. O responsável responde às perguntas 1 a 7, 13 e 14.
2. A minuta da revisão 4 é aplicada à especificação, preenchendo os ⟦PENDENTE⟧ respondidos e mantendo como pendente o que não foi
   respondido. Entram a entrada no histórico e a linha Status.
3. Autorização expressa da fase A0 (GED 13).
4. Só então: `0801_ged_conexao.sql` (tabelas separadas desde o início), os testes da 11.5 (itens 13 e 14) e a Edge Function de conexão
   com fetch simulado. A primeira conexão real fica com o responsável, em produção, sem indexar.

**Depois, para a A1a:**
- decisões dos PENDENTES 15, 16, 19, 14 e 2;
- migrations A1a com as tabelas operacionais e protegidas separadas;
- os testes de laboratório (`tests/db/ged-laboratorio.test.ts`) convertidos em testes reais da 11.5.

**Contratos:** a aprovação da OP-5.8.1 (perguntas 8 a 12) libera a implementação de `situacaoOperacao` (regra pura e testes),
independentemente das fases de banco.

## 7. Atualização depois da revisão de segurança da A0 (24/10/2026)

Origem: `REVISAO_SEGURANCA_A0_GED_2026-10-24.md`, consolidada em `PLANO_FASE_A0_GED_2026-10-24.md`, que é o plano de referência. Esta
seção **acrescenta** itens; nada do que está acima foi apagado.

**Decisões adicionais** (formulário, perguntas 17 a 21):

| ID | Decisão proposta | Recomendação | Impacto | Aprovador | Data | Evidência | Situação |
|---|---|---|---|---|---|---|---|
| **D-REV** | revogar no Google ao desconectar | sim; falha remota não deixa o estado local ambíguo | desconexão passa pela Edge Function (`service_role`); coluna `revogacao_remota` | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **D-TROCA** | trocar a conta exige desconectar antes | sim | `ged_concluir_conexao` recusa outro `google_sub` com conexão ativa | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** |
| **D-URL** | URL pública oficial do Neo Admin | — (informação do responsável) | `NEO_ADMIN_URL` obrigatória na Edge Function | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de confirmação externa** |
| **D-INVALID** | apagar o segredo ao receber `invalid_grant` | sim | `ged_registrar_erro_conexao` | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente de aprovação** (não bloqueia a A0) |
| **AUT-A0** | autorização expressa da fase A0-conexão | — | libera migration, funções e Edge Function | ⟦pendente⟧ | ⟦pendente⟧ | ⟦pendente⟧ | **Pendente**. É separada da aprovação documental (GED 13) |

**Bloqueadores de segurança identificados e já corrigidos no plano consolidado** (precisam constar da revisão 4 antes da migration):

| Achado | Correção no plano | Na minuta |
|---|---|---|
| `id smallint` incompatível com o `fn_auditoria` [lab] | `id uuid` + `unica` (linha única comprovada no Postgres) | M5 |
| `fn_auditoria` vazaria `segredo_id` [lab] | sem `fn_auditoria` na conexão; auditoria saneada pelas funções | M5, M10 (item 9) |
| destino aceitava `//host` [lab] | `check` com lookahead (comprovado no Postgres) + origem conferida contra `NEO_ADMIN_URL` | M5, M10 (item 7) |
| funções executáveis por `anon`/`authenticated` por padrão [lab] | `revoke … from public, anon, authenticated` em todas + teste de matriz de privilégios | M10 (item 8) |
| identidade e escopo fracos; e-mail na URL de erro; `state` consumido tarde; sem PKCE [código do Gmail] | conferência completa do `id_token`, conjunto exato de escopos, códigos fixos na URL, consumo atômico antecipado, PKCE S256 | M10 (itens 3 a 7, 11) |

**Testes que precisam passar antes de a migration ser aplicada:** grupos 1 a 17 do plano consolidado (seção 8), em PGlite e Vitest, e
`npm run verificar`.

**Verificações reservadas ao Supabase real** (depois da autorização, pelo responsável):
- grupo 18 (primeira conexão);
- cifragem e transação do Vault;
- concorrência real do consumo do `state`;
- registro da query string do callback nos logs da plataforma;
- `create` em `public` para `authenticated`;
- consentimento granular do Google.

**Bloqueadores restantes da A0-conexão:**
1. Respostas 1 a 3, 7, 15, 17, 18 e 19, e a minuta da revisão 4 aplicada (com M5 e M10).
2. Autorização expressa (pergunta 21).
3. Implementação e testes 1 a 17 verdes. Só então a migration pode ser aplicada, pelo responsável.

**Acompanhamento separado (fora deste escopo, nada alterado):** os problemas do `nucleo-gmail-conectar` em uso estão na seção 10 do
plano consolidado. Pedem uma tarefa própria, com autorização.
