# Respostas pendentes — Contratos e GED

Data: 24/10/2026. Para o **responsável** preencher. Nada aqui foi respondido em nome dele.

As recomendações técnicas estão em `PREPARACAO_APROVACAO_REV4_REV6_CONTRATOS_GED_2026-10-24.md` e nas minutas
`MINUTA_GED_REV4_2026-10-24.md` e `MINUTA_CONTRATOS_REV6_2026-10-24.md`. Basta responder no espaço de cada item. "Sim" aceita a
recomendação indicada.

## Bloco A — GED

| # | Pergunta | Recomendação técnica | Resposta |
|---|---|---|---|
| 1 | Conta corporativa **dedicada** ao GED, por OAuth, só leitura (`drive.readonly`)? | sim | ☐ sim ☐ não · ______ |
| 2 | Endereço da conta; dono no Workspace; quem guarda a recuperação | — (não há evidência no repositório) | conta: ______ · dono: ______ · recuperação: ______ |
| 3 | Cliente OAuth **novo** ou o existente do Gmail ("Neo Admin Gmail (rascunhos)")? | novo (isola revogação e escopos) | ☐ novo ☐ existente |
| 4 | Prévia da verificação **só para o admin geral**, com confirmação explícita? | sim | ☐ sim ☐ não · ______ |
| 5 | Prazo de validade da prévia | — (decisão do responsável) | ______ minutos/horas |
| 6 | Ao confirmar, gravar **só** o cadastro e as contagens, **sem** nomes de arquivos ou pastas? | sim (a especificação já proíbe nomes até a A1a) | ☐ sim ☐ não · ______ |
| 7 | **Tabelas separadas** para os dados protegidos (substitui "mesma tabela + projeção")? | sim (evidência: `tests/db/ged-laboratorio.test.ts`) | ☐ sim ☐ não |

## Bloco B — Contratos (situação da operação)

| # | Pergunta | Recomendação técnica | Resposta |
|---|---|---|---|
| 8 | Dispensadas **e** canceladas fora do total exigível; canceladas **nunca** contam como concluídas? | sim | ☐ sim ☐ não · ______ |
| 9 | Operação com **zero** obrigações exigíveis pode ficar "Pronta para encerrar"? | sim só para modalidade sem modelo (avulsa); nas demais, só com ao menos uma concluída | ☐ sim ☐ não ☐ como recomendado · ______ |
| 10 | Haverá **percentual** de conclusão? Denominador = total exigível? | se houver, sobre o total exigível | ☐ não ☐ sim, sobre o exigível ☐ outro: ______ |
| 11 | Como mostrar a obrigação **bloqueada por dependência cancelada** (até as regras O-1 a O-4)? | "Sem regra — conferir", nunca "Pronta" | ☐ como recomendado ☐ outro: ______ |
| 12 | Condição desconhecida ou modelo não configurado **impedem** "Pronta"? | sim ("Aguardando configuração do modelo") | ☐ sim ☐ não |

## Bloco C — Drive e aprovação formal

| # | Pergunta | Observação | Resposta |
|---|---|---|---|
| 13 | Raiz de **elaboração**: `02 - COMERCIAL / 02 - CONTRATOS` ou só a subpasta `Contratos`? | os dois IDs candidatos estão na GED 2.2; não escolhidos por inferência | ☐ `02 - CONTRATOS` ☐ subpasta `Contratos` |
| 14 | Raiz do **dossiê** = `02 - COMERCIAL / 01 - CLIENTES`? A pasta `ALUTEC / 04 - CONTRATOS E CLIENTES` entra? | ID candidato na GED 2.2 | dossiê: ☐ sim ☐ outra: ______ · ALUTEC: ☐ entra ☐ fora |
| 15 | Quem é o **aprovador formal** e qual **evidência** registra a aprovação? | precedente: mensagem expressa do responsável, registrada na linha Status e no histórico | aprovador: ______ · evidência: ______ · data: ___/___/______ |
| 16 | Quem, no Workspace, valida os **membros e as permissões** do Drive compartilhado (PENDENTE 12)? | bloqueia a A1b, não a A0 | ______ |

## Bloco D — Conexão do GED (decisões novas da revisão de segurança)

Origem: `REVISAO_SEGURANCA_A0_GED_2026-10-24.md`. Desenho completo em `PLANO_FASE_A0_GED_2026-10-24.md`, seções 3, 5 e 6.

| # | Decisão | Recomendação técnica e justificativa | Opções | Depende de | Resposta |
|---|---|---|---|---|---|
| 17 | **D-REV:** ao desconectar, revogar o acesso também no Google? | **Sim.** O acesso morre na hora, sem depender de alguém lembrar de revogar em myaccount.google.com. É uma chamada externa com efeito (POST ao OAuth do Google, não ao Drive): se falhar, a desconexão local acontece mesmo assim, e a falha fica registrada com aviso para revogar manualmente | ☐ sim, revogar ☐ não, só local (revogação manual) | 1 e 3 (conta e cliente) | ______ |
| 18 | **D-TROCA:** trocar a conta conectada exige desconectar antes? | **Sim.** Evita que uma reconexão com outra conta substitua a atual sem um ato explícito. A troca fica: desconectar, alterar `administrativo.ged.conta`, conectar | ☐ sim ☐ não (permitir substituir direto) | 1 e 2 | ______ |
| 19 | **D-URL:** qual é a URL pública oficial do Neo Admin (`NEO_ADMIN_URL`)? | Obrigatória e sem valor padrão: é a única origem aceita para a volta da conexão. Não existe hoje nenhuma variável com essa URL nas funções | URL: ______ | — | ______ |
| 20 | **D-INVALID:** apagar o segredo do Vault quando o Google responder `invalid_grant`? | **Sim.** O token já não serve; guardá-lo só aumenta o que há para proteger. A linha fica `com_erro`, e a reconexão cria um segredo novo | ☐ sim ☐ não (manter até reconectar ou desconectar) | — | ______ |

**Autorização da fase A0 (requisito separado).** Aprovar a revisão 4 (aprovação documental) **não** autoriza a implementação. A GED 13
exige **autorização expressa da fase A0**, além das respostas acima.

| # | Pergunta | Resposta |
|---|---|---|
| 21 | Autoriza a implementação da **A0-conexão** (migration `0801_ged_conexao.sql`, funções, Edge Function e testes; aplicação em produção e primeira conexão feitas pelo responsável)? | ☐ sim ☐ não · data: ___/___/______ |

## O que cada resposta libera

- **1 a 3, 7, 15, 17 a 19 e 21:** criar a **A0-conexão** (migration, funções, Edge Function e testes), depois de aplicar a minuta da
  revisão 4. A 20 pode ficar para depois: o plano funciona com as duas opções.
- **4 a 6, 13 e 14:** A0-verificação (prévia das raízes).
- **1 a 7, 13 a 15:** aplicar a minuta da revisão 4 do GED (`PLANO_FASE_A0_GED_2026-10-24.md` é o plano de referência da A0).
- **8 a 12 e 15:** aplicar a minuta da revisão 6 de Contratos e implementar `situacaoOperacao` (regra pura e testes).
- **16:** necessária antes da A1b (indexação). Não bloqueia a A0.
