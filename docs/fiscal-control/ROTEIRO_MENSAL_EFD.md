# Roteiro mensal: lançar a EFD no Fiscal > Créditos

Objetivo: depois que o escritório transmite as EFDs do mês, o saldo de cada crédito no sistema tem de ficar **igual ao declarado**.
Vale para a matriz (CNPJ 17.209.767/0001-28), com um crédito por tributo:

| Tributo | Crédito | Arquivo |
| --- | --- | --- |
| ICMS | CR-2021-00004 | EFD ICMS/IPI (registro E110) |
| PIS | CR-2024-00006 | EFD-Contribuições (M100, M200 e 1100) |
| Cofins | CR-2024-00007 | EFD-Contribuições (M500, M600 e 1500) |
| IPI | ainda não implantado | EFD ICMS/IPI (E520). Quando existir, acrescente `--credito IPI=<código>` |

Como foi feita a implantação dos saldos: `docs/modulos/fiscal-creditos.md`, item 11.

## Quando
Assim que o escritório transmitir a EFD do mês. Os dois arquivos podem ser lançados em dias diferentes, mas **sempre em ordem**: um mês
só entra depois que o anterior foi lançado e aprovado.

## Passo a passo

**1. Baixar os arquivos no ReceitanetBX** (matriz, mês que vai ser lançado) e salvar em `Documentos\Arquivos ReceitanetBX`.
- EFD-Contribuições: se houver original e retificadora, use a de **data/hora de transmissão mais recente**, que aparece no nome do arquivo.
- EFD ICMS/IPI: o nome do arquivo não mostra a data. Se houver mais de uma versão do mês, pergunte ao escritório qual está vigente.

**2. Gerar a planilha.** Peça ao Claude ("lança a EFD de MM/AAAA") ou rode, na pasta do projeto, com a Supabase CLI logada:
```
node scripts/fiscal-efd-mensal.mjs --ref chdszjpbtfpstjrqnmmm ^
  --icms "<caminho da EFD ICMS/IPI>.txt" --contribuicoes "<caminho da EFD-Contribuições>.txt" ^
  --credito ICMS=CR-2021-00004 --credito PIS=CR-2024-00006 --credito COFINS=CR-2024-00007 --saida "%USERPROFILE%\Downloads"
```
(No Git Bash troque `^` por `\`.) O script lê o saldo de cada crédito no fim do mês anterior (só lançamentos efetivos) e mostra,
por tributo, o saldo do sistema, o saldo anterior declarado, o saldo final declarado e as linhas geradas. Não grava nada no banco.

**3. Ler o resumo.**
- Linha com **✗**: pare e veja "Problemas" abaixo. Nada foi gerado para aquele tributo.
- Linha com **ajuste**: o saldo anterior declarado não é igual ao do sistema. Anote o mês e o valor para perguntar ao contador.
  O ajuste é o que faz o sistema seguir o declarado.

**4. Importar** em Fiscal > Créditos > **Importação**, sempre no tipo **Movimentações**.
- Sem ajuste: uma planilha só (`efd-MM-AAAA-movimentos.xlsx`).
- Com ajuste: primeiro `…-etapa1-creditos-e-ajustes.xlsx`. Depois **aprove os ajustes** no razão de cada crédito (botão Aprovar,
  com justificativa). Só então importe `…-etapa2-deducoes.xlsx`. Se a etapa 2 entrar antes, a dedução que depende do ajuste é recusada.
- Na prévia, todas as linhas devem estar "válidas" antes de confirmar.

**5. Guardar os arquivos** em Fiscal > Créditos > **Documentos**: a EFD do mês como "Arquivo de declaração" e o recibo como
"Recibo de transmissão", vinculados ao crédito.

**6. Conferir.**
- O saldo de cada crédito (ficha do crédito, "Saldo remanescente") tem de ser igual ao **saldo final declarado** mostrado no passo 2.
- ICMS/IPI: em **Apuração**, envie a EFD ICMS/IPI para registrar o saldo oficial do mês. A coluna "Diferença" tem de ficar zerada.
- Ou peça ao Claude: "confere os saldos de MM/AAAA contra a EFD".

## Problemas
| Mensagem | O que fazer |
| --- | --- |
| "já tem N lançamento(s) em AAAA-MM" | O mês já foi lançado. Não lance de novo. Se o escritório **retificou** o mês, não mexa nele: no mês seguinte a diferença aparece sozinha como ajuste. |
| "N lançamento(s) pendente(s) antes de AAAA-MM" | Há ajuste ou lançamento antigo sem aprovação. Aprove (ou rejeite) antes de importar, senão o saldo de partida fica errado. |
| "saldo anterior + créditos − deduções ≠ saldo final declarado" | A própria EFD não fecha: os números do arquivo não batem entre si. Mande ao contador; não importe esse tributo. |
| Dedução recusada na confirmação | Algum ajuste do mês ainda está pendente. Aprove e importe a planilha da etapa 2 de novo. |
| Mês sem EFD na pasta | Lance os meses em ordem. Se o arquivo não existir, fale com o escritório antes de pular o mês. |

## Observações
- Quem importa e quem aprova deveria ser pessoa diferente. Enquanto só o Administrador tem acesso, a chave
  `fiscal.creditos.permitir_autoaprovacao` fica ligada (aprovação com justificativa "[autoaprovação]"). Desligue quando houver outro aprovador.
- A regra de cálculo está em `lib/modulos/fiscal/creditos/efd-mensal.ts` e tem teste em `efd-mensal.test.ts`. Ela não interpreta notas,
  ajustes de apuração nem outros blocos: só usa os totais e o controle de créditos declarados.
