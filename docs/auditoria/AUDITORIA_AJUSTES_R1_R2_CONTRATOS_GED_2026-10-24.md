# Auditoria independente dos ajustes R-1 e R-2 — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged` · Modo: somente leitura

Objeto: confronto do relatório `docs/auditoria/AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md` com o conteúdo real de:
- `docs/modulos/contratos-operacoes.md`: revisão 5, **rascunho**;
- `docs/modulos/administrativo-ged.md`: revisão 3, **rascunho**.

Durante a auditoria, nenhum arquivo foi alterado e não houve commit. Este arquivo foi gerado depois, a pedido do responsável.

## Resumo

Os ajustes R-1 e R-2 estão corretos no texto real dos arquivos. As oito verificações foram aprovadas, a oitava com duas ressalvas
menores sobre o próprio relatório, que não reprovam os documentos.

## Verificações

| # | Verificação | Evidência real | Resultado | Divergências |
|---|---|---|---|---|
| 1 | **R-1:** reativação e reabertura condicionadas à 15.5 e às regras O-1 a O-4; cancelamento não tratado como resolvido | 10.1 (10a): "**reativação** (**conforme a proposta da seção 15.5, item 4, a validar** junto com as regras O-1 a O-4; não é regra aprovada nem resultado garantido)"; "**reabertura** (**conforme a proposta da seção 15.5, item 6, a validar**…)"; cancelamento: "o efeito sobre as dependentes **não está definido**. O teste não presume que a obrigação cancelada conta como resolvida". Na 15.5, o item 4 é "Voltou a se aplicar" e o item 6 é a reabertura | **APROVADO** | Nenhuma. A 15.5 (3) ainda diz "conta como resolvida", mas é texto de **proposta**, marcado "desenho a validar", e a 5.4.6 diz "**Não** é regra vigente". Sem contradição normativa |
| 2 | **R-2:** nenhuma referência a PENDENTE 17 ambígua | Contagem de cada ocorrência: **Contratos tem 11 e nenhuma ambígua** (10 na forma "PENDENTE 17 (Contratos) / GED PENDENTE 14" e 1 "GED PENDENTE 17" na C3, com "não confundir…"). **GED tem 7 e nenhuma ambígua** (todas "GED PENDENTE 17", e a A1a traz "[GED PENDENTE 14 = Contratos, item 17]") | **APROVADO** | O relatório fala em **10** ocorrências em Contratos e **6** no GED; o real é **11 e 7**, porque a C3 de Contratos e a A0 do GED têm duas ocorrências na mesma linha. É erro de contagem do relatório, não do documento |
| 3 | Referências cruzadas identificam o documento de origem | GED → Contratos: "Contratos, item 17/22/30/32". Contratos → GED: "GED PENDENTE n", "Mesmo item do GED, ponto 14/18/19", "ver GED, ponto 11", "GED, seção 13". Sobram números soltos só para o próprio documento (ex.: "(24 e GED PENDENTE 12)" na matriz, em que o 24 é de Contratos) | **APROVADO** | Na tabela de tipos do GED: "(ver Contratos, **PENDENTE**)" cita o documento **sem o número do item** (é o item 1 de Contratos, papel da NF). O texto vem da revisão 2, não foi introduzido pela R-2 e não é ambíguo quanto ao documento, mas está incompleto. O relatório não o mencionou |
| 4 | Pendências com a mesma numeração e o mesmo estado | Contratos 1 a 33 e GED 1 a 19, em sequência, sem repetição nem lacuna. Os textos alterados só ganharam a identificação do documento; nenhum mudou de estado | **APROVADO** | — |
| 5 | Revisões R5 e R3, em rascunho | Contratos: "Status: **rascunho**" e "**Revisão 5**". GED: "Status: **rascunho**" e "Revisão 3" | **APROVADO** | — |
| 6 | Nenhuma fase liberada | Contratos: "Nenhuma fase está liberada para implementação"; GED: "Nenhuma fase está liberada para implementação só porque a especificação foi corrigida"; A0: "não pode ser executada… A A0 não fica liberada por partes". Nenhum trecho diz "pronta para implementação" | **APROVADO** | — |
| 7 | Decisões aprovadas e pendentes coerentes | Matriz 0.1: R4-P1, P2, P5, P6 e P7 "Aprovada parcialmente"; R4-P3 e P4 "Aprovada" (direção técnica / princípio); R4-P8 "Pendente de validação". É igual à matriz do responsável. Os ajustes R-1 e R-2 não mexeram em status | **APROVADO** | — |
| 8 | O relatório corresponde ao estado real | Os trechos citados no relatório de ajustes existem com a redação declarada: 10a, C1, C3, 0.1, 5.12.7, 7.3, 10.2 (7), 14, 15.4, e no GED a 5.2.4.5, a 5.11.10, a seção 9, a A0, a A1a e os itens 10 e 14 | **APROVADO, com ressalvas** | (a) as contagens 10 e 6, que na verdade são 11 e 7; (b) o relatório não cita a referência incompleta da tabela de tipos do GED |

## Estado do Git

- **Branch:** `auditoria-contratos-ged`.
- **Modificados (sem commit):** `docs/modulos/contratos-operacoes.md` e `docs/modulos/administrativo-ged.md`.
- **Não versionados no momento da auditoria:** os quatro relatórios em `docs/auditoria/`:
  - `AJUSTES_R1_R2_…`;
  - `AUDITORIA_FINAL_ENCERRAMENTO_…`;
  - `AUDITORIA_POS_CORRECOES_…`;
  - `CORRECOES_FINAIS_…`.
- **Último commit:** `0b8508e`.
- **Durante a auditoria:** o `git status` ficou igual do início ao fim. Nada foi alterado.

## Conclusões

**Aptidão para aprovação formal dos documentos: APTOS.**
- As ressalvas R-1 e R-2 estão resolvidas no texto real.
- Não há contradição normativa, decisão inventada nem pendência perdida.
- As duas divergências encontradas são menores e não bloqueiam a aprovação:
  - as contagens do relatório (11 e 7, e não 10 e 6);
  - a referência "(ver Contratos, PENDENTE)" sem número na tabela de tipos do GED, que pode ser completada para "Contratos, item 1".

**Autorização para iniciar implementação: NÃO AUTORIZADA.** A aprovação documental não libera nenhuma fase. Todas continuam bloqueadas
por pendências abertas:
- **GED A0:** GED 1, 3, 13 e 17 e os controles mínimos;
- **GED A1a e A1b:** testes de autorização e validação do Drive compartilhado (GED 12);
- **Contratos C1, C3 e C4:** as pendências de negócio (8, 9, 20 a 27, 29 a 31, entre outras) e as validações externas (Fiscal, bancos,
  Financeiro/Recebíveis, Comercial, administrador do Workspace).

A primeira fase só pode começar com autorização expressa do responsável, depois que os bloqueios dela forem resolvidos.
