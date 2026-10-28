# Preparação da aprovação documental — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged`

Este arquivo registra as **verificações** feitas para preparar a aprovação. **Não é o registro de aprovação e não aprova nada.** A
aprovação **ainda não ocorreu**.

Como o projeto já tem um padrão de aprovação (a linha **Status** da especificação), o arquivo de registro separado **não foi criado**,
para não duplicar o processo. A minuta dele está na seção 4, para avaliação do responsável.

## 1. Estado real

- **Branch:** `auditoria-contratos-ged`. Último commit `0b8508e`, sem commit novo.
- **Documentos:**
  - `docs/modulos/contratos-operacoes.md`: revisão 5, "Status: **rascunho**". Hash `D14662666D2F059B`, igual ao do saneamento.
  - `docs/modulos/administrativo-ged.md`: revisão 3, "Status: **rascunho**". Hash `172952FB2DD7E514`, igual ao do saneamento.
- **Pasta de trabalho:** os dois documentos alterados e sem commit; seis relatórios fora do git em `docs/auditoria/`, todos presentes:
  - `AUDITORIA_POS_CORRECOES_…`;
  - `CORRECOES_FINAIS_…`;
  - `AUDITORIA_FINAL_ENCERRAMENTO_…`;
  - `AJUSTES_R1_R2_…`;
  - `AUDITORIA_AJUSTES_R1_R2_…`;
  - `SANEAMENTO_FINAL_…`.
- **Pendências:** Contratos de 1 a 33 e GED de 1 a 19, em sequência e sem lacunas.
- **Divergência entre os relatórios e o estado real:** nenhuma encontrada.

## 2. As correções finais continuam no texto

| Correção | Evidência |
|---|---|
| R-1 | Contratos, teste 10.1 (10a): "conforme a proposta da seção 15.5, item 4 / item 6, a validar" |
| R-2 | Contratos: 11 ocorrências de "PENDENTE 17" (10 "PENDENTE 17 (Contratos) / GED PENDENTE 14" + 1 "GED PENDENTE 17"). GED: 7, todas "GED PENDENTE 17" |
| Saneamento A | `AJUSTES_R1_R2_…md`: "11 ocorrências" e "7 ocorrências" |
| Saneamento B | GED: "ver Contratos, item 1" presente; nenhuma "ver Contratos, PENDENTE)" restante |

## 3. Padrão de aprovação do projeto

- **Como é feito hoje:** a aprovação é registrada **na própria especificação**, na linha Status:
  - `_MODELO.md`: "Status: rascunho | aprovado | em construção | concluído";
  - `administrativo-gestao-aplicativos.md`: "Status: aprovada em 23/10/2026…";
  - `administrativo-gestao.md`: "Especificação aprovada em 22/10/2026".
- **O que não existe:** nenhum arquivo de ata ou registro de aprovação em `docs/`.
- **O CLAUDE.md** pede que a especificação seja "aprovada antes do código" e que não se avance de fase sem a aprovação do responsável.

**Proposta:** seguir o padrão existente. Depois da decisão expressa do responsável, a linha Status de cada especificação passa de
"rascunho" para "aprovada em <data>", com uma entrada no histórico de revisões. Isso exige editar as duas especificações, o que esta
tarefa não autorizou.

## 4. Minuta do registro de aprovação (não criada como arquivo)

Se o responsável quiser um registro separado, além da linha Status, a minuta abaixo pode virar
`docs/auditoria/REGISTRO_APROVACAO_CONTRATOS_GED.md`.

> **Registro de aprovação documental — Contratos e GED**
> - **Projeto:** NeoAdmin · **Branch de referência:** `auditoria-contratos-ged` (último commit `0b8508e`; alterações ainda não
>   commitadas).
> - **Registro preparado em:** 24/10/2026. Esta **não** é a data de aprovação.
>
> **Documentos:**
>
> | Documento | Revisão | Status atual |
> |---|---|---|
> | `docs/modulos/contratos-operacoes.md` | 5 | rascunho |
> | `docs/modulos/administrativo-ged.md` | 3 | rascunho |
>
> **Referências:**
> - `docs/auditoria/AUDITORIA_FINAL_ENCERRAMENTO_CONTRATOS_GED_2026-10-24.md`;
> - `docs/auditoria/AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md`;
> - `docs/auditoria/AUDITORIA_AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md`;
> - `docs/auditoria/SANEAMENTO_FINAL_CONTRATOS_GED_2026-10-24.md`.
>
> **Escopo proposto:** aprovação documental da especificação de Contratos (revisão 5) e da especificação do GED (revisão 3), no
> conteúdo identificado acima. Qualquer alteração posterior segue o controle de revisão do projeto: nova revisão no histórico do
> documento e nova aprovação.
>
> **Decisão do responsável** (campos não preenchidos):
> - Contratos, revisão 5: ☐ aprovado ☐ reprovado ☐ pendente
> - GED, revisão 3: ☐ aprovado ☐ reprovado ☐ pendente
> - Aprovador (nome ou função): ____________________
> - Data efetiva da decisão: ___/___/______
> - Observações, ressalvas ou condições: ____________________
> - Evidência da autorização (conforme o processo interno): ____________________
>
> **IMPORTANTE:** *"A aprovação documental não constitui autorização para iniciar a implementação. Cada fase permanece bloqueada até
> que seus pré-requisitos técnicos, funcionais e externos sejam resolvidos e haja autorização expressa do responsável."*

## 5. Campos que aguardam decisão humana

- Decisão sobre Contratos e sobre o GED (aprovado, reprovado ou pendente).
- Aprovador.
- Data efetiva.
- Observações ou condições.
- Evidência da autorização.
- A forma de registro: só a linha Status (padrão do projeto), ou a linha Status mais o arquivo separado.

## 6. Bloqueios de implementação (conferidos nos documentos atuais)

| Fase | Bloqueios no texto atual |
|---|---|
| GED A0 | GED PENDENTE 1, 3, 13 e 17; controles mínimos da 5.2.4.5 |
| GED A1a | A0 concluída; GED PENDENTE 15, 16, 17, 19, 14 (= Contratos, item 17) e 2 |
| GED A1b | A1a cumprida e aprovada; GED PENDENTE 12 |
| GED A2 básica | A1b concluída; GED PENDENTE 18 |
| GED A2 completa | A2 básica; C3 de Contratos |
| Contratos C1 | GED A2 básica; views do Comercial e do Financeiro; PENDENTE 14 (Contratos) |
| Contratos C3 | PENDENTES 8, 22, 23, 26, 29 e 30; constraints a validar; PENDENTE 17 (Contratos) / GED PENDENTE 14; GED PENDENTE 2; especificação do Recebíveis |
| Contratos C4 | PENDENTES 20, 21, 31, 9, 27, 25, 1, 3, 4 e 6; validação das regras O-1 a O-4 |

## 7. Arquivos alterados

**Nenhum durante a preparação.** Os hashes dos dois documentos são os mesmos do saneamento final. Este arquivo foi gerado depois, a
pedido do responsável, para registrar o resultado.

## 8. Commit e implementação

Não houve commit, push, implementação ou alteração em código, banco ou integrações.

## Conclusões

**Aptidão documental:** as duas especificações **continuam aptas** para aprovação formal. As correções R-1, R-2 e as duas do saneamento
estão no texto real, as pendências estão íntegras e não há divergência com os relatórios.

**Aprovação efetiva e implementação:** a aprovação **ainda não ocorreu**. Ela depende da decisão expressa do responsável: aprovar,
reprovar ou deixar pendente cada documento, mais a forma de registro. **Nenhuma fase está autorizada** a iniciar implementação por causa
desta tarefa.
