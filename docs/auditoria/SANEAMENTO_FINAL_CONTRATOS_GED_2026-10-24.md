# Saneamento documental final — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged`

Referências:
- `docs/auditoria/AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md`;
- `docs/auditoria/AUDITORIA_AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md` (auditoria independente que apontou as duas divergências).

## Resumo

As duas correções estão feitas e conferidas no conteúdo real dos arquivos. Nenhum outro conteúdo mudou e não houve commit.

## A. Correções executadas

| Correção | Arquivo | Trecho anterior | Trecho final | Verificação |
|---|---|---|---|---|
| **A** | `docs/auditoria/AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md` | "em Contratos, as **10** ocorrências estão como 'PENDENTE 17 (Contratos) / GED PENDENTE 14'"; "no GED, as **6** ocorrências estão como 'GED PENDENTE 17' ou ligadas ao nome do documento" | "em Contratos, são **11 ocorrências**: 10 na forma 'PENDENTE 17 (Contratos) / GED PENDENTE 14' e 1 na forma 'GED PENDENTE 17' (na linha da C3…). A linha da C3 tem duas ocorrências"; "no GED, são **7 ocorrências**, todas na forma 'GED PENDENTE 17'. A linha da A0 nos bloqueios tem duas ocorrências" | Recontagem nos arquivos: Contratos tem **11** no total, sendo **10** na forma Contratos e **1** na forma GED; o GED tem **7**, todas na forma GED. A explicação ao redor bate com os números. "5.12.7 (três ocorrências)" já estava correto e não mudou |
| **B** | `docs/modulos/administrativo-ged.md`, tabela de tipos | "a distinção depende do Fiscal (ver Contratos, PENDENTE)" | "a distinção depende do Fiscal (ver Contratos, item 1)" | Contratos item 1 é "**Papel da NF — Fiscal**". O `git diff` dessa linha mostra só essa troca |

## B. Integridade documental

- **Contratos:** o hash do arquivo é **idêntico** antes e depois (`D14662666D2F059B`), então ele não foi tocado. Isso confirma que
  continuam iguais:
  - a revisão 5 e o status **rascunho**;
  - as pendências 1 a 33 e seus estados;
  - as decisões R4-P1 a R4-P8 da matriz 0.1;
  - a R-1 e a parte da R-2 em Contratos.
- **GED:** só a linha da tabela de tipos mudou. O diff do arquivo contra o HEAD passou de +318/−50 para +319/−51, ou seja, uma linha
  trocada. Continuam iguais:
  - a revisão 3 e o status **rascunho**;
  - as pendências 1 a 19, recontadas na mesma sequência;
  - as 7 referências "GED PENDENTE 17" da R-2.
- **Bloqueios de implementação:** mantidos. Nenhum trecho de fases ou bloqueios foi tocado, e nenhuma fase foi liberada.

## C. Git

- **Branch:** `auditoria-contratos-ged`.
- **Arquivos alterados nesta rodada:**
  - `docs/modulos/administrativo-ged.md`: rastreado, mudou 1 linha;
  - `docs/auditoria/AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md`: não versionado, então sem `git diff`. A comparação foi feita pelo hash
    (`ED350C92…` → `B681A733…`) e pelo conteúdo: mudaram só as linhas das contagens.
- **Limitação:** os arquivos não versionados não aparecem no `git diff`. Para eles, a comparação foi feita pelos hashes de antes e
  depois.
- **Relatório independente** `AUDITORIA_AJUSTES_R1_R2_CONTRATOS_GED_2026-10-24.md`: **inalterado** (hash `CBE5885DBF0F24EC` igual antes e
  depois).
- **Outros arquivos:** os relatórios restantes de `docs/auditoria/` e `contratos-operacoes.md` não foram tocados.
- **Commit:** **não houve**. O último continua sendo `0b8508e`. Nada foi descartado do que já estava na pasta de trabalho.
- Este arquivo foi gerado depois do saneamento, a pedido do responsável.

## D. Conclusão

1. **Saneamento documental: CONCLUÍDO.** As duas correções estão nos arquivos reais, e as 12 verificações foram feitas.
2. **Aptidão para aprovação formal:** continua como a auditoria independente concluiu, documentos **aptos**. As duas divergências que
   ela apontou foram corrigidas.
3. **Autorização para implementação: continua NÃO AUTORIZADA.** Todas as fases (GED A0 a A2 e Contratos C1 a C4) seguem bloqueadas
   pelas pendências e validações externas registradas.
