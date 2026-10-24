# Implementação inicial — Contratos e GED (regras puras)

Data: 24/10/2026 · Branch: `auditoria-contratos-ged` (HEAD `d30ed80`) · **Sem commit e sem push.**

## 1. O que foi implementado

Só **regras de negócio puras**, com testes. Nada de banco, tela, Edge Function ou chamada externa. Os dados de teste são fictícios.

**Contratos** (`lib/modulos/contratos/operacoes/`):

| Arquivo | Regra | Base na especificação |
|---|---|---|
| `condicoes.ts` | `avaliarCondicao`: os 8 operadores, `todas`/`alguma` e três resultados possíveis (o campo não informado dá desconhecido, nunca falso). Campo inexistente gera erro de configuração | 5.4.2, 5.4.4, 10.1.1 |
| `obrigacoes.ts` | `planejarObrigacoes`: cria, mantém, cancela a obrigação aberta com motivo, e manda o item esperar com `informar_condicao`. `situacaoDependencias`: concluída e dispensada contam como resolvidas. `validarModelo`: ciclo, tipo inativo, contrato exigido, e as duas exigências do financiamento | 5.4.3, 5.4.4, 5.4.6, 10.1.2, 10.1.3, 10.1.6 |
| `liberacao.ts` | `faturamentoLiberado`: no financiamento, exige contrato de venda assinado com o documento confirmado **e** autorização validada, independentemente do modelo. `avaliarNfPorHistorico`: o alerta segue o histórico de liberações, pela data local de Cuiabá; no mesmo dia, devolve "conferir" | 5.8.2, 5.8.4, R4-P1, 10.1.5, 10.1.5a |
| `numeracao.ts` | `normalizarNumeroContrato`: tira os zeros à esquerda. `conferirNumeroUnico`: o número é único por empresa, qualquer que seja o tipo | 5.5.2, R4-P6, 10.1.15 |
| `minuta-pdf.ts` | Ciclo do `pdf_situacao`. Um PDF serve a uma versão só (AF-10). O PDF tem de estar confirmado no GED. O pendente exige motivo, e sai do pendente uma vez só. O PDF só aparece como vinculado com a evidência efetiva | 5.5.3, R4-P2, 10.1.9 |
| `remessas.ts` | "Realizadas X de Y", contando só as remessas com NF; previstas nulo = "não informado" | 5.9.4, D-5, 10.1.11 |

**GED** (`lib/nucleo/ged/`):

| Arquivo | Regra | Base na especificação |
|---|---|---|
| `clientes.ts` | `normalizarNomeCliente`, `cnpjsNoTexto` (usa `validarCnpj` do núcleo) e `sugerirCliente`: até 3 candidatos, nota de 0 a 100, com o motivo. Nada é confirmado automaticamente | 5.4.2, 5.4.3, 11.1.1, 11.1.2 |
| `tipos.ts` | `prepararRegras` e `classificarTipo`: prioridade, primeira regra que casa, `sem_tipo`. O tipo confirmado nunca muda. Pasta de modelos dá `modelo_contrato` não avaliado. A finalidade da raiz limita a sugestão | 5.5, 11.1.3, 11.1.4a |
| `arquivos.ts` | `ehArquivoTemporario` (`~$`, `~WRL`, `.tmp`) e `sugerirSubstituicoes`: mesma raiz e mesma pasta; a sugestão nunca é aplicada sozinha | 5.2.7, 5.6.3, 5.6.4, 11.1.4 |
| `raizes.ts` | `raizSobreposta` e `podeIndexar` (só a raiz `ativa`) | 5.2.4, 5.3.0 |
| `drive-http.ts` | Cliente da Drive API **só GET**: outro método ou endereço é recusado antes do fetch, e o token nunca aparece no erro. O teste também varre o código da pasta procurando chamadas de escrita | 4.1, 5.1, 11.1.6 |

## 2. Fases e critérios atendidos

Nenhuma fase foi concluída. Foram atendidos os testes Vitest planejados nas especificações (Contratos 10.1, itens 1, 2, 3, 5, 5a, 6, 9, 11 e 15; GED 11.1, itens 1, 2, 3, 4, 4a e 6), na parte que não depende de banco. As fases C0–C4 e A0–C dependem de migrations, RLS e integrações que continuam bloqueadas.

## 3. Arquivos

São 22 arquivos novos, nenhum modificado: 11 de código e 11 de teste.
- `lib/modulos/contratos/operacoes/`: `condicoes`, `obrigacoes`, `liberacao`, `numeracao`, `minuta-pdf` e `remessas` (cada um com `.ts` e `.test.ts`).
- `lib/nucleo/ged/`: `clientes`, `tipos`, `arquivos`, `raizes` e `drive-http` (cada um com `.ts` e `.test.ts`).
- Este relatório (`docs/auditoria/`).

## 4. Migrations

**Nenhuma.**

## 5. Testes

| Execução | Resultado |
|---|---|
| `npx vitest run lib/modulos/contratos lib/nucleo/ged` | 11 arquivos, **71 testes, todos passaram** |
| `npm run verificar` (typecheck, lint e suíte completa) | typecheck ok; lint ok; **185 arquivos passaram, 4 pulados; 1.845 testes passaram, 1 pulado**. Os 4 arquivos e o teste pulados já existiam antes desta etapa |

## 6. Problemas corrigidos

- Um teste do alerta de NF esperava `alerta` num caso em que, pela data de Cuiabá, a liberação foi na véspera. **A expectativa estava errada, não a regra:** o teste foi corrigido para `sem_alerta`, e agora comprova justamente o uso da data local.
- Dois erros de tipo nos testes (um tipo auxiliar confuso e um argumento faltando) foram corrigidos antes da execução.
- **Revisão antes do commit** (mesmo dia):
  - **Reativação.** `planejarObrigacoes` recriava (`criar`) um item cancelado que voltava a valer, e um teste validava isso. Esse é o
    caso da reativação, que não tem regra aprovada (15.5, item 4; O-1 a O-4). Agora devolve `sem_regra`, e o teste foi ajustado.
  - **Lista cadastral.** A lista de "documentação cadastral" virou a constante própria `TIPOS_CADASTRAIS_PROVISORIOS`. O teste dos
    limites da raiz agora usa só os tipos citados na especificação (`boleto` e `modelo_contrato`). O teste da lista provisória ficou
    separado e com o rótulo "PROVISÓRIO [PENDENTE 6]".
  - **Resultado:** 72 testes nos 11 arquivos, todos passaram.

## 7. Decisões provisórias, todas marcadas no código

| Ponto | O que foi feito | Pendência |
|---|---|---|
| Número composto (`137/2026`) | Fica como foi digitado, com a marca `composto: true`; nenhuma normalização foi inventada | PENDENTE 8 |
| Obrigação **bloqueada** que deixa de valer, condição que passa a desconhecida com a obrigação já criada, dependência **cancelada**, item cancelado que volta a valer (reativação) | Devolvem `sem_regra`, sem decidir o que acontece | O-1 a O-4, AF-16 |
| Marco das operações antigas no alerta de NF | Não implementado. A rotina continua desligada (`conferir_erp = false`) | PENDENTES 21 e 31 |
| "Mesmo dia = conferir" | Implementado como requisito derivado a validar | R4-P1, item 4 |
| Quem regulariza ou justifica o PDF, o prazo, e o contrato `assinado` com PDF pendente | Não é verificado; a função valida só os dados | PENDENTE 22 |
| Efeito do PDF pendente no faturamento | Nenhuma função o considera | PENDENTE 29 |
| Exigências extras do item 2 da R4-P1 (trava em `obter_assinaturas`, não dispensável) | Não entraram em `validarModelo` | a validar |
| Conectivos (e, de, da…) retirados na normalização do nome | Detalhe técnico, para cumprir o teste 11.1.1 | — |
| Nota da sugestão de cliente (90 para nome igual, até 80 por semelhança, corte em 40) | Constantes técnicas, marcadas com `shortcut:` | calibrar com dados reais |
| "Documentação cadastral" que a raiz `elaboracao` não sugere | Lida como `cartao_cnpj`, `contrato_social` e `procuracao`, marcada com `shortcut:` | PENDENTE 6 (GED) |
| Regras de nome dos tipos | **Não fixadas no código**; as da 5.5 aparecem só no teste, como ilustrativas | PENDENTE 6 (GED) |

## 8. Incompleto / não iniciado

- Migrations `ctr_*` (0300+) e `ged_*` (0801+), RLS, funções SQL, testes PGlite e de autorização (11.5).
- Edge Functions de indexação e de OAuth do Drive (A0): bloqueadas pelos PENDENTES 3, 13 e 17 do GED.
- Telas.
- `planejarObrigacoes` na troca de modelo, reaproveitamento e reabertura (PENDENTE 25 e O-1 a O-4).
- Aplicação das mudanças do Drive e paginação (GED 11.1, itens 5 e 7): dependem do formato do índice no banco.
- Chave de operação por proposta (10.1.13) e papel da NF (10.1.14): dependem das tabelas.
- Especificações não atualizadas: o módulo não terminou.

## 9. Riscos

- O código está em TypeScript (`lib/`). A Edge Function do GED roda em Deno e vai precisar reaproveitar o `drive-http.ts`, copiando-o ou importando-o de `_shared`. Isso ainda não foi decidido.
- A varredura de escrita olha só a pasta `lib/nucleo/ged`; a Edge Function, quando existir, precisa de varredura própria.
- As notas da sugestão de cliente não foram calibradas com dados reais.

## 10. Próxima etapa

1. O responsável revisa e decide o commit destes 22 arquivos (sugestão: um commit "Contratos e GED: regras puras e testes (sem banco)").
2. Decidir os PENDENTES 13 e 17 do GED (exibição da verificação e proteção por coluna) e o PENDENTE 3 (conta técnica). Isso destrava a A0.
3. Depois disso, a migration `0801_ged_nucleo.sql`, com RLS e testes PGlite, que usa as funções puras desta etapa.
