# Aprovação formal das especificações — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged`

## Resumo

A aprovação documental está formalizada nos dois documentos, com a data **24/10/2026**, seguindo o padrão do projeto (linha Status da
própria especificação). A implementação continua **não autorizada**. Não foi criada ata separada e não houve commit.

## Verificações prévias

Tudo conferido antes de alterar:
- **branch:** `auditoria-contratos-ged`;
- **hashes dos dois documentos:** iguais aos do saneamento (`D14662666D2F059B` e `172952FB2DD7E514`);
- **R-1:** 2 marcas na 10a;
- **R-2:** Contratos com 11 ocorrências (10 + 1) e GED com 7;
- **saneamento:** "ver Contratos, item 1" presente;
- **revisões:** R5 e R3, as duas em **rascunho**;
- **relatório de preparação:** `docs/auditoria/PREPARACAO_APROVACAO_CONTRATOS_GED_2026-10-24.md` presente.

Nenhuma divergência.

## Data registrada

**24/10/2026.** É a data do sistema e a data da autorização do responsável. Nenhuma outra data foi inventada.

## Status

| Documento | Antes | Depois |
|---|---|---|
| `docs/modulos/contratos-operacoes.md` | "Status: **rascunho** (Fase 0), aguardando validações internas e as decisões pendentes da seção 13." | "Status: **aprovada em 24/10/2026** (aprovação documental da revisão 5, pelo responsável). As decisões pendentes da seção 13 continuam abertas, e a aprovação não libera nenhuma fase (seção 12)." O item Implementação passou a dizer "nenhuma, e **não autorizada**…" |
| `docs/modulos/administrativo-ged.md` | "Status: **rascunho** (Fase 0, 24/10/2026), aguardando aprovação. Nada implementado." | "Status: **aprovada em 24/10/2026** (aprovação documental da revisão 3, pelo responsável). Nada implementado; implementação **não autorizada**…" |

O padrão seguido é "Status: aprovada em DD/MM/AAAA", como em `administrativo-gestao-aplicativos.md`. Nenhuma regra documentada exige
nova revisão por mudança de status, então as revisões ficaram em **5 e 3**: não há "Revisão 6" nem "Revisão 4".

## Histórico de revisões

- **Contratos**, nova entrada ao fim do histórico: "**Aprovação documental, 24/10/2026:** a **revisão 5** foi aprovada pelo responsável
  como especificação. Não houve mudança de conteúdo funcional nem de número de revisão." A entrada diz ainda que:
  - propostas não viram regra vigente e pendências não se encerram (R4-P1 a P8 conforme a 0.1; itens 1 a 33);
  - a aprovação **não autoriza a implementação**;
  - o Status é "aprovada em 24/10/2026".
- **GED**, novo bloco depois das correções pós-auditoria: "**Aprovação documental (24/10/2026):** a **revisão 3** foi aprovada…", com as
  mesmas ressalvas (itens 1 a 19 inalterados; bloqueios da seção 13 valendo).

## Três frases de estado atual ajustadas

Elas diziam "continua em rascunho" e passariam a contradizer a aprovação:
- **Contratos 0.1:** "A especificação continua em **rascunho**." virou "A especificação foi aprovada documentalmente em 24/10/2026
  (revisão 5). Isso não muda o estado de nenhuma proposta desta matriz."
- **Contratos 12 e GED 13 (bloqueios):** o texto que dizia "…dependem também da aprovação formal… que continua em rascunho" virou "A
  especificação foi aprovada documentalmente em 24/10/2026, mas essa aprovação **não libera** fase alguma: cada uma depende dos bloqueios
  abaixo e de autorização expressa posterior do responsável."

As entradas antigas do histórico que dizem "rascunho" (revisões 3, 4 e 5 e as correções) ficaram como estavam, porque registram o
estado de cada momento.

## Preservação conferida

- **Decisões R4-P1 a R4-P8:** mesmos estados na matriz 0.1 (P1, P2, P5, P6 e P7 aprovadas parcialmente; P3 e P4 aprovadas; P8
  pendente de validação).
- **Pendências:** Contratos 1 a 33 e GED 1 a 19, mesmos números e conteúdo.
- **R-1, R-2 e saneamento:** presentes (contagens 11/10/1 e 7/7; 2 marcas R-1; "Contratos, item 1").
- **Bloqueios:** as tabelas de bloqueio das fases GED A0 a A2 completa e Contratos C1 a C4 não foram tocadas; só a frase introdutória
  mudou.

## Arquivos e diff

- **Alterados nesta tarefa:** só `docs/modulos/contratos-operacoes.md` e `docs/modulos/administrativo-ged.md`. Contra o HEAD, o diff
  foi de +574/−128 para +584/−130 em Contratos e de +319/−51 para +328/−52 no GED. As linhas acrescentadas são as de status, histórico
  e as três frases.
- **Relatórios** em `docs/auditoria/`: não tocados durante a formalização. O hash do `AUDITORIA_AJUSTES_R1_R2_…` continua
  `CBE5885DBF0F24EC`. Nenhuma ata foi criada.
- **Git:** sem commit (último `0b8508e`), push, merge, rebase, reset, checkout nem stash. Nada foi descartado.
- Este arquivo foi gerado depois da formalização, a pedido do responsável, para registrar o resultado.

## Conclusões

**Aprovação documental:** **formalizada nos dois documentos.** Contratos revisão 5 e GED revisão 3 estão com o status "aprovada em
24/10/2026".

**Autorização para implementação:** **continua NÃO AUTORIZADA.** Cada fase (GED A0, A1a, A1b, A2 básica e A2 completa; Contratos C1, C3
e C4) depende da resolução dos próprios bloqueios e de uma decisão posterior do responsável, específica para aquela fase.

**Próximo passo sugerido:** fazer o commit e o push dos documentos e dos relatórios, para não perder o trabalho. Depende de autorização
do responsável.
