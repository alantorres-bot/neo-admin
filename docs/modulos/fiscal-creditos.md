# Módulo: Fiscal/Tributário / Créditos tributários (Fiscal Control)

Status: em construção — primeira versão entregue para avaliação em 22/10/2026 (branch `claude/fiscal-creditos-tributarios`; não publicada).

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
Migrations 0200–0203: `fis_membros`, `fis_estabelecimentos`, `fis_tributos`, `fis_categorias`, `fis_origens`, `fis_tipos_movimento`,
`fis_tipos_documento`, `fis_creditos`, `fis_movimentos`, `fis_periodos`, `fis_periodos_eventos`, `fis_tipos_obrigacao`,
`fis_obrigacoes_aplicaveis`, `fis_obrigacoes`, `fis_obrigacoes_eventos`, `fis_documentos`, `fis_documentos_vinculos`,
`fis_divergencias`, `fis_tarefas`, `fis_comentarios`, `fis_decisoes`, `fis_imp_lotes`, `fis_imp_linhas`; view `fis_creditos_saldos`;
bucket privado `fiscal`.

## 9. Permissões
Nível na área Fiscal → papel: consulta = Leitor, operador = Analista fiscal, gestor = Revisor (ou Contador), administrador =
Administrador. Matriz completa no README do módulo, item 10. Escopo por empresa em `fis_membros.empresas`.

## 10. Pontos em aberto
1. Validar com o contador as categorias (formas, documentos, prazos) e os tipos de obrigação (aplicabilidade e vencimentos, com fonte).
2. Saldos de abertura reais e competência inicial.
3. Testar a leitura da EFD ICMS/IPI com arquivo real.
4. Quem será o *Contador* no sistema (usuário do escritório? escopo por empresa?).
5. Agendamento automático e avisos (próxima fase).
