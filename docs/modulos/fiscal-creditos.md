# Módulo: Fiscal/Tributário / Créditos tributários (Fiscal Control)

Status: publicado em 22/10/2026 (migrations 0200–0204). Saldos de ICMS, PIS e Cofins da matriz implantados; IPI pendente (ver item 11).

Documentação completa: `docs/fiscal-control/README.md` (uso, instalação, permissões, backup, limitações), `ARCHITECTURE.md`
(entidades e regras) e `STATUS.md` (progresso e testes).

## 1. Objetivo
Controlar créditos tributários (registro, validação, disponibilidade, utilização, compensação, ressarcimento), com razão imutável,
apuração mensal com transporte de saldo, fechamento de competências, consolidado anual, obrigações acessórias com prova da entrega,
documentos fiscais privados e conciliação rastreável, num fluxo entre o departamento fiscal e o contador.

## 2. Como é feito hoje
Planilhas de controle de créditos e saldos, arquivos da EFD e recibos em pastas, agenda de obrigações com o escritório contábil.
(Detalhar com o Alan: quais planilhas, quem confere, frequência.)

## 3. Escopo
| Entra | Fica fora (por ora) |
| --- | --- |
| Créditos, razão, apuração, fechamento, consolidado, obrigações, documentos, conciliação, tarefas, relatórios, importação de planilhas, leitura do saldo da EFD ICMS/IPI | Cálculo de tributos e de créditos a partir de notas; transmissão a órgãos; importadores EFD-Contribuições/XML/PER-DCOMP; atualização monetária automática; avisos por e-mail/WhatsApp |

## 4. Entradas
Cadastro manual; planilhas XLSX/CSV no modelo do módulo (créditos e movimentações); arquivo da EFD ICMS/IPI (saldo credor a transportar).
Amostras reais ainda não recebidas (`docs/amostras/`).

## 5. Regras de negócio
Ver `docs/fiscal-control/ARCHITECTURE.md`, seção 3. Resumo:
1. Saldo = soma do razão efetivo; saldo inicial do mês = saldo final do mês anterior do mesmo crédito.
2. Registrado ≠ validado ≠ disponível; crédito pendente nunca é disponível; quem lança não valida.
   Exceção (0204): com `fiscal.creditos.permitir_autoaprovacao = true`, o Administrador do módulo valida/aprova o que ele mesmo
   lançou, com justificativa obrigatória (mín. 10 caracteres) gravada na trilha como "[autoaprovação] …". Começa desligada; foi
   ligada em 22/10/2026 porque só o Alan tem acesso ao Fiscal. Desligar quando houver outro aprovador.
3. Saídas exigem saldo em todas as competências seguintes, crédito validado, sem bloqueio, no prazo e forma permitida na categoria.
4. Nada se apaga: estorno, correção ligada ao original, arquivamento lógico, documentos versionados.
5. Competência fechada não recebe lançamento; reabertura com motivo; competências seguintes ficam a reconciliar.
6. Obrigação só "transmitida" com data, recibo e recibo anexado; conferência por outra pessoa.
7. **Fundamentos legais, prazos e formas de aproveitamento não estão definidos**: são parâmetros a validar pelo contador.

## 6. Saídas e automações
Excel (créditos, movimentações, apuração, consolidado, obrigações, conciliação), impressão/PDF do consolidado, tarefas na Fila do dia
(`pendencias`, módulo `fiscal.creditos`). Sem envio externo e sem agendamento nesta versão.

## 7. Telas
`/fiscal/creditos/`: painel, creditos (+ ficha), movimentos, apuracao, consolidado, obrigacoes (+ ficha), documentos, conciliacao,
tarefas, relatorios, configuracoes, importacao. Impressão: `/imprimir/fiscal/consolidado`.

## 8. Dados (prefixo `fis_`)
Migrations 0200–0204 (0204: chave da autoaprovação e funções `fis_credito_validar`/`fis_movimento_decidir`): `fis_membros`, `fis_estabelecimentos`, `fis_tributos`, `fis_categorias`, `fis_origens`, `fis_tipos_movimento`,
`fis_tipos_documento`, `fis_creditos`, `fis_movimentos`, `fis_periodos`, `fis_periodos_eventos`, `fis_tipos_obrigacao`,
`fis_obrigacoes_aplicaveis`, `fis_obrigacoes`, `fis_obrigacoes_eventos`, `fis_documentos`, `fis_documentos_vinculos`,
`fis_divergencias`, `fis_tarefas`, `fis_comentarios`, `fis_decisoes`, `fis_imp_lotes`, `fis_imp_linhas`; view `fis_creditos_saldos`;
bucket privado `fiscal`.

## 9. Permissões
Nível na área Fiscal → papel: consulta = Leitor, operador = Analista fiscal, gestor = Revisor (ou Contador), administrador =
Administrador. Matriz completa no README do módulo, item 10. Escopo por empresa em `fis_membros.empresas`.

## 10. Pontos em aberto
1. Validar com o contador as categorias (formas, documentos, prazos) e os tipos de obrigação (aplicabilidade e vencimentos, com fonte).
2. ~~Saldos de abertura reais e competência inicial.~~ Feito para ICMS, PIS e Cofins (item 11).
3. ~~Testar a leitura da EFD ICMS/IPI com arquivo real.~~ Testado em 22/10/2026 com as EFD de 09/2021 a 09/2026: bate com o E110/E520.
4. Quem será o *Contador* no sistema (usuário do escritório? escopo por empresa?).
5. Agendamento automático e avisos (próxima fase).
6. IPI: o contador precisa explicar por que as retificadoras de 2024 zeraram o saldo credor (chegou a R$ 145 mil nas versões
   anteriores) e de onde vem o saldo anterior de R$ 39.808,36 de 01/2025.
7. Diferenças declaradas a conferir com o contador: PIS/Cofins 11/2024 (−29.201,81 / −134.505,29), EFD-Contribuições 02/2025
   zerada, ICMS 04/2025 (−13.286,90). EFD-Contribuições de 01/2026 não baixada (valores deduzidos da EFD 02/2026).

## 11. Implantação dos saldos (22/10/2026, matriz CNPJ 17.209.767/0001-28)
Fonte: EFD baixadas no ReceitanetBX. Filial 17.209.767/0002-09 fora (decisão do Alan). Um crédito por tributo; o razão reproduz a
escrituração mês a mês e qualquer diferença entre o saldo transportado num mês e o saldo anterior declarado no seguinte vira ajuste
descrito. Conferência: saldo do razão = saldo declarado em todos os meses.

| Tributo | Crédito | Desde | Fonte | Saldo |
| --- | --- | --- | --- | --- |
| ICMS | CR-2021-00004 | 09/2021 (saldo inicial 146.261,23) | EFD ICMS/IPI E110: créditos (campos 6–9) e débitos abatidos | 561.834,32 em 09/2026 |
| PIS | CR-2024-00006 | 01/2024 (regime não cumulativo) | EFD-Contribuições M100 e 1100 (soma das origens) | 6.779,33 em 08/2026 |
| Cofins | CR-2024-00007 | 01/2024 | EFD-Contribuições M500 e 1500 | 31.225,98 em 08/2026 |

- Meses de 2024 com várias versões da EFD ICMS/IPI: usada a sequência que fecha 12/2023 → 10/2024 sem quebra (vigência não confirmada).
  EFD-Contribuições: versão de transmissão mais recente (data/hora no nome do arquivo).
- Importação em duas etapas: créditos do mês e ajustes; aprovar os ajustes; depois as utilizações. Utilização que depende de ajuste
  ainda pendente é recusada na confirmação.
- Créditos arquivados na implantação (testes e versões descartadas): CR-2026-00001, CR-2021-00002, CR-2024-00003, CR-2025-00005.
