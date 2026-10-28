# Ajustes finais R-1 e R-2 — Contratos e GED

Data: 24/10/2026 · Projeto: NeoAdmin · Branch: `auditoria-contratos-ged`

Documentos ajustados:
- `docs/modulos/contratos-operacoes.md`: revisão 5, status **rascunho**;
- `docs/modulos/administrativo-ged.md`: revisão 3, status **rascunho**.

Referência: `docs/auditoria/AUDITORIA_FINAL_ENCERRAMENTO_CONTRATOS_GED_2026-10-24.md` (ressalvas R-1 e R-2).

## Resumo

As duas ressalvas foram corrigidas. Toda menção a "PENDENTE 17" nos dois documentos agora diz a qual documento pertence. Só os dois
arquivos autorizados mudaram, e não houve commit.

## R-1: Contratos, teste 10.1 (10a)

| Trecho | Evidência do texto final |
|---|---|
| reativação | "**reativação** (**conforme a proposta da seção 15.5, item 4, a validar** junto com as regras O-1 a O-4; não é regra aprovada nem resultado garantido) [R-1]: o resultado esperado proposto é criar uma obrigação nova…" |
| reabertura | "**reabertura** (**conforme a proposta da seção 15.5, item 6, a validar** junto com as regras O-1 a O-4; não é regra aprovada nem resultado garantido) [R-1]: o resultado esperado proposto é que as dependentes não concluídas voltem a `bloqueada`…" |

**Coerência:**
- O cabeçalho do 10a já dizia que os resultados de cancelamento, reativação e reabertura dependem da validação das regras O-1 a O-4.
- O item de cancelamento continua igual: "não presume que a obrigação cancelada conta como resolvida".
- Os números da 15.5 conferem: item 4 é "voltou a se aplicar" (reativação) e item 6 é a reabertura.

## R-2: desambiguação das pendências

**Contratos** (formato "PENDENTE 17 (Contratos) / GED PENDENTE 14" e "GED PENDENTE N"):
- **C3** (seção 12): "proteção das colunas de elaboração em `ctr_minutas` (AF-12), que depende do nível mínimo de acesso à elaboração,
  **PENDENTE 17 (Contratos) / GED PENDENTE 14**; não confundir com o GED PENDENTE 17, mecanismo de proteção por coluna das tabelas do
  GED [R-2]".
- **C1:** "PENDENTE 24 (Contratos) / GED PENDENTE 12", "PENDENTE 14 (Contratos)", "PENDENTE 17 (Contratos) / GED PENDENTE 14" e "ver
  GED, **seção** 13". Antes estava "GED 13", que podia ser lido como o pendente 13 do GED.
- **Também ajustado:**
  - 0.1 (matriz);
  - 5.12.7 (três ocorrências);
  - tela 7.3;
  - seção 9;
  - teste 10.2 (7);
  - 14 (I-4 e dependências externas);
  - 15.4: "PENDENTE 24 (Contratos) / GED PENDENTE 12", "GED PENDENTE 13".

**GED** (o pendente próprio vira "GED PENDENTE 17"; as citações a Contratos usam "Contratos, item N"):
- **5.2.4.5, 5.11.10, nota da seção 9 e linhas A0 e A1a dos bloqueios:** "GED PENDENTE 17" (mecanismo de proteção por coluna). Na A0
  também ficou "GED PENDENTE 13".
- **A1a:** "[GED PENDENTE 14 = Contratos, item 17] nível mínimo na elaboração".
- **Item 14:** "(mesmo item que Contratos, item 17; não confundir com o GED PENDENTE 17, mecanismo de proteção por coluna)".
- **Item 10:** "(Contratos, item 22)". Antes estava "`contratos-operacoes.md`, item 22".

## Busca por referências ambíguas

- **"PENDENTE 17":**
  - em Contratos, são **11 ocorrências**: 10 na forma "PENDENTE 17 (Contratos) / GED PENDENTE 14" e 1 na forma "GED PENDENTE 17"
    (na linha da C3, junto do aviso "não confundir…"). A linha da C3 tem duas ocorrências;
  - no GED, são **7 ocorrências**, todas na forma "GED PENDENTE 17". A linha da A0 nos bloqueios tem duas ocorrências;
  - nenhuma ficou com o número solto.
- **Referências a outro documento só com o número:** as do tipo "GED 12" e "GED 13" foram trocadas. Restam só referências a **seções**,
  como "GED 5.7.3" e "GED 5.10", que não são ambíguas, e as frases "Mesmo item do GED, ponto N", que já citavam o documento.
- **Uma lista não alterada:** em Contratos, seção 14, a lista "PENDENTES 3, 4, 9, 14, 15, 16, 17, 18 e 19" (responsável pelo processo)
  ficou como estava. Ela só lista pendências do próprio Contratos e não é ambígua.

## Verificações

- **Pendências:** Contratos de 1 a 33 e GED de 1 a 19, os mesmos números e estados. Nenhuma foi aprovada, apagada ou renumerada.
- **R4:** continuam só as duas citações históricas de propósito (seção 0.1 e item 28), que trazem a numeração usada na solicitação do
  responsável. As demais aparecem com número e tema.
- **Revisões e status:** Contratos na revisão 5 e GED na revisão 3, os dois em **rascunho**. Nenhuma fase foi liberada.
- **Git:** modificados só `docs/modulos/contratos-operacoes.md` e `docs/modulos/administrativo-ged.md`. Os três relatórios em
  `docs/auditoria/` já estavam fora do git no início da rodada e não foram tocados. Último commit `0b8508e`, sem commit novo.

## O que continua aberto

- **Pendências:** todas continuam abertas: Contratos 1 a 33 (as parcialmente decididas, como estavam) e GED 1 a 19.

| Fase | Bloqueios |
|---|---|
| GED A0 | 1, 3, 13 e 17 do GED; controles mínimos |
| GED A1a | 15, 16, 17, 19, 14 e 2 do GED |
| GED A1b | A1a aprovada; 12 do GED |
| GED A2 básica | 18 do GED |
| GED A2 completa | C3 de Contratos |
| Contratos C1 | A2 básica do GED; views; 14 de Contratos |
| Contratos C3 | 8, 22, 23, 26, 29 e 30 de Contratos; 17 de Contratos (= GED 14); 2 do GED; constraints; especificação do Recebíveis |
| Contratos C4 | 20, 21, 31, 9, 27, 25, 1, 3, 4 e 6 de Contratos; validação das regras O-1 a O-4 |

## Conclusão

As duas ressalvas da auditoria final (R-1 e R-2) estão tratadas. Pelo critério daquela auditoria, os documentos podem seguir para
aprovação formal. Isso não libera nenhuma fase para implementação.
