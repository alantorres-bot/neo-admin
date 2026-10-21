# Módulo: RH/SST / Banco de horas — saldo e vencimento (`rh.banco_horas`)

Rota `/rh/banco_horas`. Migration `0518_rh_banco_horas.sql`; Edge Function `rh-bh-rascunho-gmail`. Decisões tomadas em 21/10/2026.

## 1. Objetivo
Saber o saldo de banco de horas de cada pessoa, o que vence e quando, avisar o RH e o líder do setor a tempo de compensar,
apontar o que venceu para pagar na folha e alertar saldo negativo.

## 2. Como é feito hoje
O Control iD calcula o banco (saldo por dia), mas ninguém acompanha o vencimento. As colunas do Control iD "Total Compensado",
"Descontar Folha" e "Pagar Folha" vêm vazias, porque o fechamento do banco não está configurado lá.

## 3. Escopo
- **Dentro:** importação do CSV; saldo dos últimos 6 meses; vencimento por ciclo; avisos; e-mail ao líder; pagamento na folha;
  alerta de negativo.
- **Fora:**
  - pedido e aprovação de folga;
  - valor em R$ (fica com o escritório);
  - envio ao escritório;
  - API do Control iD;
  - feriados.

## 4. Entradas
- **CSV de banco de horas do Control iD** (calibrado com `relatorio_20261021_1647.CSV`):
  - separador `;`, UTF-8 com BOM, uma linha por pessoa e dia;
  - colunas: `Id;Nome;CPF;PIS;Data;Banco Negativo;Banco Positivo;Saldo Banco;Total Compensado;A Compensar;Descontar Folha;Pagar Folha;Detalhes`;
  - "A Compensar" só repete o movimento do dia.
- **Conferência na leitura:** o saldo do dia tem de ser o saldo anterior + positivo − negativo. Se não for, o leitor avisa (por
  exemplo, ajuste manual no Control iD).
- **CSV geral** (todas as pessoas), um ou vários de uma vez (ex.: um por ciclo). O CSV não traz setor: o RH escolhe o
  setor de cada pessoa uma vez, na grade de Saldos (decisão de 21/10/2026). Os setores são os do RH > Ponto. Sem setor, só o RH é avisado.
- A prévia avisa **buracos** entre os arquivos e se a cobertura começa depois do início da conta.
- **Setor pelo cadastro do Control iD** (`person_AAAAMMDDhhmmss.csv`): o botão "Setores pelo cadastro" lê o arquivo no navegador e
  manda só **CPF e Departamento**. O arquivo tem senha, PIN, endereço e filiação, e nada disso é enviado nem guardado. O departamento
  vira setor quando há setor do RH > Ponto com o mesmo nome (sem acento e caixa); os demais são listados para cadastrar no Ponto.
- **Empresas:** os CSVs gerais podem vir filtrados por empresa. Em 21/10/2026 a Oeste Formas (1 pessoa com banco) veio em arquivos
  próprios. Importar os dois, porque a pessoa é a mesma pelo CPF.
- **Leitura no navegador:** o CSV é lido com `lerCsv` + `lerBancoHoras` e só os dias com movimento vão ao servidor. O **PIS não é
  guardado**; a pessoa é identificada pelo **CPF**, que também casa com `rh_colaboradores`.
- **Calibração:** `lib/modulos/rh/banco-horas/calibracao.test.ts`, com a env `NEO_AMOSTRAS_BANCO_HORAS`.

## 5. Regras de negócio
1. **Ciclo de 26 a 25**, o mesmo da folha.
2. **Vencimento:** fim do ciclo em que o crédito nasceu + **6 meses** (acordo individual). Exemplo: crédito de 10/05 → ciclo
   26/04–25/05 → vence em **25/11** e entra na folha de novembro.
3. **O mais antigo primeiro:** cada débito e cada pagamento na folha consome o crédito mais antigo. Crédito em aberto de um dia =
   `clamp(créditos acumulados até ele − (débitos + pagos), 0, crédito do dia)`.
   - Fonte única no banco: view `rh_bh_creditos`.
   - Espelho em TS para testes e documentação: `creditosEmAberto` em `lib/modulos/rh/banco-horas/modulo.ts`.
4. **Só os últimos 6 meses:** contam os movimentos a partir do **início da conta** (parâmetro, um dia 26; começa em 26/04/2026).
   - O saldo anterior é **ignorado**: crédito antigo não se cobra, débito antigo não se desconta.
   - A tela mostra o saldo do Control iD ao lado.
5. **Aviso:** 30 dias antes do vencimento (parâmetro). Fica crítico nos últimos 7 dias.
6. **Vencido:**
   - aparece em "A pagar na folha";
   - o RH registra "Pago na folha de <mês>" com as horas (até o vencido), e elas saem do saldo;
   - o gestor cancela um pagamento com motivo.
7. **Negativo:** saldo abaixo de −10:00 (parâmetro) gera alerta. Nada é descontado sozinho.
8. **Reimportação:** atualiza os dias do período; dia que tinha movimento e não veio no arquivo fica zerado. A auditoria guarda o
   anterior.

## 6. Saídas e automações
- **Pendências (`rh.banco_horas`):**
  - "Banco de horas vencendo — <setor ou "sem setor"> (<data>)";
  - "Banco de horas a pagar na folha — <pessoa>";
  - "Banco negativo — <pessoa>".
- **Atualização das pendências:** na importação, no pagamento, nos parâmetros e pelo job `rh-banco-horas-pendencias` (06h30 de
  Cuiabá). O que deixa de valer é encerrado.
- **E-mail ao líder:** rascunho no Gmail de quem clica, para o e-mail do setor (o do RH > Ponto) com as cópias. Lista só quem tem
  crédito vencendo, as horas e a data.

## 7. Telas
- **Saldos:**
  - cartões por setor com crédito vencendo e o botão "E-mail ao líder";
  - grade com pessoa, setor, saldo (6 meses), saldo do Control iD, vencendo, próximo vencimento, vencido e situação.
- **Pessoa:** créditos com o que está em aberto e o vencimento, movimentos do Control iD e pagamentos na folha.
- **A pagar na folha:** vencidos por pessoa, com horas pagas, mês da folha e observação.
- **Importações:** histórico e "Importar CSV" (um ou vários arquivos, com prévia por arquivo).
- **Parâmetros** (gestor): início da conta, validade, aviso e limite negativo.

## 8. Dados (prefixo `rh_bh_`)
- **`rh_bh_pessoas`:** CPF, nome, id do Control iD, colaborador, setor (escolhido pelo RH), último saldo do Control iD.
- **`rh_bh_movimentos`:** pessoa, dia, positivo e negativo (minutos), importação. Um por pessoa e dia.
- **`rh_bh_importacoes`:** período, arquivo, contagens, quem e quando.
- **`rh_bh_pagamentos`:** pessoa, minutos, mês da folha, observação; cancelamento com motivo.
- **Views:** `rh_bh_creditos` e `rh_bh_saldos` (`security_invoker`). Parâmetros em `configuracoes` (`rh.banco_horas.*`).

## 9. Permissões
- Área `rh`:
  - consulta lê;
  - **operador** importa, registra pagamento e gera o e-mail;
  - **gestor** faz o mesmo e ainda altera parâmetros e cancela pagamento.

## 10. Pontos em aberto
1. **Carga inicial (21/10/2026):** a Neo foi coberta de 26/03 a 21/10, sem buracos. A Oeste (1 pessoa) foi coberta de 26/04 a 25/09;
   falta o ciclo atual dela.
   - Setores no Ponto: só a FABRICA existe. As pessoas do banco são da FABRICA (40), ESCRITÓRIO (5), LOGISTICA (5), ENGENHARIA (4) e
     SUPERVISÃO (3).
2. **Setores:** cadastrar no RH > Ponto os setores que faltam, com o e-mail do líder, e aplicar "Setores pelo cadastro".
3. **Configurar o fechamento no Control iD?** As colunas "Pagar/Descontar Folha" existem lá e estão vazias.
