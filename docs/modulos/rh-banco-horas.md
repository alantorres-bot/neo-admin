# Módulo: RH/SST / Banco de horas — saldo e vencimento (`rh.banco_horas`)

Rota `/rh/banco_horas`. Migrations `0518_rh_banco_horas.sql` e `0519_rh_bh_fechamento.sql`; Edge Function `rh-bh-rascunho-gmail`.
Decisões tomadas em 21/10/2026. POP: só depois de concluído o módulo (decisão de 21/10/2026), com a skill `pop-neoformas:gerar-pop`.

## A regra, em uma frase
- **Horas a mais:** folgar até o dia 25 do 6º mês depois do mês em que as fez. O que sobrar, **a empresa paga** na folha daquele mês.
- **Horas a menos:** repor no mesmo prazo. O que sobrar é **descontado** na folha daquele mês.
- **O mais antigo é acertado primeiro**, nos dois sentidos.
- **Exemplos:** 3h a mais em 10/05 → até 25/11 → senão paga na folha de novembro. 2h a menos em 03/06 → até 25/12 → senão desconta na folha de dezembro.

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
- **CSV geral** (todas as pessoas), um ou vários de uma vez (ex.: um por ciclo). O CSV não traz setor: o setor é o do
  **colaborador**, que é o setor do RH > Ponto com o mesmo nome do departamento importado do Control iD em RH > Colaboradores
  (decisão de 21/10/2026, migration 0520). Os campos antigos "seletor por pessoa" e "Setores pelo cadastro" saíram. Sem setor, só o
  RH é avisado. A pessoa liga ao colaborador por CPF ou nº RHiD.
- A prévia avisa **buracos** entre os arquivos e se a cobertura começa depois do início da conta.
- **Empresas:** os CSVs gerais podem vir filtrados por empresa. Em 21/10/2026 a Oeste Formas (1 pessoa com banco) veio em arquivos
  próprios. Importar os dois, porque a pessoa é a mesma pelo CPF.
- **Leitura no navegador:** o CSV é lido com `lerCsv` + `lerBancoHoras` e só os dias com movimento vão ao servidor. O **PIS não é
  guardado**; a pessoa é identificada pelo **CPF**, que também casa com `rh_colaboradores`.
- **Calibração:** `lib/modulos/rh/banco-horas/calibracao.test.ts`, com a env `NEO_AMOSTRAS_BANCO_HORAS`.

## 5. Regras de negócio
1. **Ciclo de 26 a 25**, o mesmo da folha.
2. **Vencimento:** fim do ciclo em que o crédito nasceu + **6 meses** (acordo individual). Exemplo: crédito de 10/05 → ciclo
   26/04–25/05 → vence em **25/11** e entra na folha de novembro.
3. **O mais antigo primeiro, nos dois sentidos** (0519):
   - fila em ordem de data: hora a mais abate primeiro a hora a menos mais antiga e vice-versa; o que sobra fica em aberto com o seu
     vencimento;
   - os acertos na folha entram no dia 25 da competência ("pago" consome créditos; "descontado" consome débitos);
   - fonte única no banco: `rh_bh_em_aberto(pessoa)` e a view `rh_bh_aberto`; espelho em TS: `emAberto` em
     `lib/modulos/rh/banco-horas/modulo.ts`;
   - conferido em 21/10/2026: 432 itens em aberto idênticos entre SQL e TS com os dados reais.
4. **Só os últimos 6 meses:** contam os movimentos a partir do **início da conta** (parâmetro, um dia 26; começa em 26/04/2026).
   - O saldo anterior é **ignorado**: crédito antigo não se cobra, débito antigo não se desconta.
   - A tela mostra o saldo do Control iD ao lado.
5. **Aviso:** 30 dias antes do vencimento (parâmetro). Fica crítico nos últimos 7 dias.
6. **Vencido → fechamento do mês** (0519). Todo mês, depois do dia 25:
   - a operadora importa o CSV até o dia 25 e **emite o fechamento** (foto de quem vence até o dia 25: "a empresa paga" e
     "descontar");
   - o **gestor aprova** (ou devolve, com motivo);
   - a operadora envia o relatório ao **escritório** e marca "Enviado";
   - depois da folha, marca **"Lançado na folha"**: as horas saem do saldo (lançamentos `pago`/`descontado` no dia 25);
   - o gestor pode cancelar com motivo (os lançamentos voltam).
   A emissão é recusada se os dados não chegam até o dia 25.
7. **Negativo:** saldo abaixo de −10:00 (parâmetro) gera alerta. O desconto só acontece pelo fechamento, com horas vencidas.
8. **Reimportação:** atualiza os dias do período; dia que tinha movimento e não veio no arquivo fica zerado. A auditoria guarda o
   anterior.

## 6. Saídas e automações
- **Pendências (`rh.banco_horas`):**
  - "Banco de horas vencendo — <setor ou "sem setor"> (<data>)";
  - "Emitir fechamento do banco de horas — <mês>" (há horas vencidas sem fechamento), "Aprovar…", "Enviar ao escritório…",
    "Marcar lançado…";
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
- **Fechamento do mês:** lista, "Emitir fechamento", passos (aprovar, enviado, lançado) e o **Relatório** impresso
  (`/imprimir/rh/banco-horas/fechamento/<id>`): "A empresa paga", "Descontar na folha", "Precisa compensar até…" e "Como ler".
- **Extrato do funcionário** (`/imprimir/rh/banco-horas/extrato/<pessoa>`): saldo, horas a folgar e a repor com prazos,
  movimentos e linha de assinatura.
- **Ajuda na tela:** caixa "O que fazer aqui" em cada aba (textos em `lib/modulos/rh/banco-horas/ajuda.ts`, base do futuro POP).
- **Importações:** histórico e "Importar CSV" (um ou vários arquivos, com prévia por arquivo).
- **Parâmetros** (gestor): início da conta, validade, aviso e limite negativo.

## 8. Dados (prefixo `rh_bh_`)
- **`rh_bh_pessoas`:** CPF, nome, id do Control iD, colaborador (setor vem dele), último saldo do Control iD.
- **`rh_bh_movimentos`:** pessoa, dia, positivo e negativo (minutos), importação. Um por pessoa e dia.
- **`rh_bh_importacoes`:** período, arquivo, contagens, quem e quando.
- **`rh_bh_lancamentos_folha`** (era `rh_bh_pagamentos`): pessoa, tipo (`pago`/`descontado`), minutos, mês da folha,
  fechamento; cancelamento com motivo.
- **`rh_bh_fechamentos`** e **`rh_bh_fechamento_itens`** (foto por pessoa: pagar, descontar, ciclos de origem).
- **Views:** `rh_bh_aberto` e `rh_bh_saldos` (`security_invoker`); `rh_bh_saldos` traz `pagar_min`, `descontar_min`,
  `folgar_min`, `repor_min` e `proximo_vencimento`. Parâmetros em `configuracoes` (`rh.banco_horas.*`).

## 9. Permissões
- Área `rh`:
  - consulta lê;
  - **operador** importa, emite o fechamento, marca enviado e lançado e gera o e-mail;
  - **gestor** faz o mesmo e ainda aprova, devolve e cancela fechamento e altera parâmetros.

## 10. Pontos em aberto
1. **Carga inicial (21/10/2026):** a Neo foi coberta de 26/03 a 21/10, sem buracos. A Oeste (1 pessoa) foi coberta de 26/04 a 25/09;
   falta o ciclo atual dela.
   - Setores no Ponto: só a FABRICA existe. As pessoas do banco são da FABRICA (40), ESCRITÓRIO (5), LOGISTICA (5), ENGENHARIA (4) e
     SUPERVISÃO (3).
2. **Setores:** cadastrar no RH > Ponto os setores que faltam (ESCRITÓRIO, LOGISTICA, ENGENHARIA, SUPERVISÃO), com o e-mail do
   líder. As pessoas entram sozinhas, pelo departamento do colaborador.
3. **Configurar o fechamento no Control iD?** As colunas "Pagar/Descontar Folha" existem lá e estão vazias.
4. **Convenção coletiva (cláusula 25):** a CCT 2024/2025 da construção prevê o banco de horas "mediante ACORDO COLETIVO DE
   TRABALHO", e a regra adotada usa acordo individual de 6 meses. A CCT também está vencida desde 30/04/2025. Validar com o
   escritório ou o jurídico: CCT vigente, se há acordo coletivo de banco de horas e o prazo dele. A validade é parâmetro.
