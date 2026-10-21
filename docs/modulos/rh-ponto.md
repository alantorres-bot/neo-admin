# Módulo: RH/SST / Ponto — inconsistências por quinzena (`rh.ponto`)

Rota `/rh/ponto` (RH) e `/ponto/justificar` (líder do setor). Migration `0516_rh_ponto.sql`; Edge Function `rh-ponto-rascunho-gmail`.
Decisões tomadas em 21/10/2026, a partir do e-mail "1ª Quinzena Inconsistência 26/09 a 11/10/2026 - Fábrica".

## 1. Objetivo
Organizar a justificativa das inconsistências do ponto (Control iD). Cada setor recebe o relatório de cada quinzena; o líder do setor
justifica ocorrência por ocorrência num formulário. O RH ajusta no Control iD e marca o que ajustou. Tudo fica registrado como prova.

## 2. Como é feito hoje
1. A cada quinzena (**26 a 11** e **12 a 25**), a Graziele emite no Control iD o relatório "Inconsistências" de cada setor.
2. Ela reimprime o relatório com o "Microsoft Print to PDF" e manda por e-mail ao líder (Fábrica → Guilherme).
3. O líder responde em texto livre, por exemplo "ALDOMIRO - 30/09 - ESQUECEU DE BATER A SAÍDA (TRABALHOU NORMALMENTE)".
4. A Graziele ajusta o ponto no Control iD. O escritório recebe só o cartão fechado.

## 3. Escopo
- **Dentro:** importar o PDF; cadastrar setor e líder; e-mail ao líder (rascunho); formulário do líder; devolução; lembrete; ajuste e
  conclusão; atestado anexado pelo RH; pendências.
- **Fora (por enquanto):**
  - API do Control iD;
  - lembrete automático;
  - envio ao escritório;
  - ligação com o checklist da Folha (`rh-folha.md`, regra 11).

## 4. Entradas
- **PDF "Inconsistências" do Control iD, salvo direto do sistema** (`relatorio_AAAAMMDD_HHMM.PDF`).
  - O reimpresso pelo "Microsoft Print to PDF" **não serve**: as letras viram desenho e o PDF fica sem texto. O importador recusa e explica.
  - Layout:
    - período "DE dd/mm/aaaa ATÉ dd/mm/aaaa";
    - por pessoa, "NOME - NÚMERO DE MATRÍCULA: n - NOME DO CARGO: …";
    - por dia: DIA, PREVISTO, ENT./SAÍ. 1–3, TOTAL NORMAIS, TOTAL NOTURNO, DIA FALTA, FALTA E ATRASO, ABONO, EXTRA 50%D, EXTRA DIURNA, EXTRA NOTURNA, BANCO TOTAL, BANCO SALDO;
    - "*hh:mm*" é marcação incluída ou ajustada no Control iD.
  - O leitor (`lib/modulos/rh/ponto/leitor-inconsistencias.ts`) monta as colunas pelos títulos do cabeçalho.
- **Calibração:** `calibracao.test.ts` lê os PDFs reais da pasta da env `NEO_AMOSTRAS_PONTO`.
  - Calibrado em 21/10/2026 com `relatorio_20261021_1447.PDF` (gerado pelo wkhtmltopdf do Control iD; Fábrica, 26/09 a 12/10;
    5 pessoas, 7 dias).
  - Esse arquivo tem só 2 entradas e 2 saídas; o leitor aceita 2 ou 3, pelas colunas que o cabeçalho trouxer.

## 5. Regras de negócio
1. **Setores:** cadastro de setor com **líder titular** e **substituto** opcional (perfis do Neo Admin). Começa pela Fábrica.
2. **Acesso do líder:**
   - entra pelo link do e-mail, com a conta Google `@neoformas.com.br`; o admin cria o usuário;
   - **não ganha a área RH**: lê e grava só pelas funções `rh_pt_lotes_do_lider`, `rh_pt_ocorrencias_do_lider`,
     `rh_pt_justificar` e `rh_pt_enviar_justificativas`, que conferem se ele é titular ou substituto do setor do lote;
   - vê nome, cargo, dia, previsto, marcações e falta/atraso. **Saldo do banco e extras ficam só com o RH.**
3. **E-mail:**
   - é um rascunho no Gmail de quem clica ("Conectar meu Gmail"), para o titular e com cópia ao substituto. Nada sai sozinho;
   - os modos são envio, lembrete e devolução;
   - termina em "Atenciosamente,".
4. **Tipos de justificativa** e ação sugerida ao RH (`lib/modulos/rh/ponto/modulo.ts`):

   | Tipo | Ação sugerida |
   |---|---|
   | Esqueceu de bater (trabalhou normalmente) | Incluir a marcação. Horário **opcional**; em branco, o previsto |
   | Batida indevida (trabalhou normalmente) | Desconsiderar a marcação |
   | Saída antecipada, atraso ou meio período | Banco de horas se o saldo do PDF cobre; senão desconto (ou parte de cada) |
   | Falta sem justificativa | Descontar |
   | Falta ou atraso justificado | Abonar; o **RH** anexa o atestado (o líder não anexa, por LGPD) |
   | Outro | Observação obrigatória |

   A ação é só **sugestão**: não há regra de desconto, DSR ou abono calculada aqui.
5. **Prazo do líder:**
   - **1 dia útil** a partir do e-mail, ajustável em Parâmetros (de 1 a 10);
   - conta segunda a sexta, sem feriados.
6. **Fluxo do lote:** `importado → enviado → justificado → concluido`.
   - `devolvido`: o RH devolve com motivo; o líder corrige e envia de novo.
   - `cancelado`: só o gestor, com motivo.
   - Nada é apagado; tudo passa por auditoria.
7. **Correção:** o RH **não altera** a justificativa do líder, só devolve com motivo. A justificativa enviada é prova, com autoria.
8. **Reimportação** do mesmo setor e período:
   - substitui o lote enquanto ele está "importado" (o anterior fica cancelado, "substituído");
   - depois do envio, é recusada até o gestor cancelar.
9. **Pessoa sem cadastro:** entra com o nome do PDF. O RH vincula a `rh_colaboradores` na tela da quinzena (todas as ocorrências da pessoa).
   O casamento automático é pelo nome sem acento, ou por primeiro + último nome com um único candidato.
10. **Ajuste:**
    - o RH marca por linha ou em lote ("Ajustado no Control iD"), com quem e quando;
    - quando todas as ocorrências estão marcadas, o lote fica **concluído**.

## 6. Saídas e automações
- **Pendências (`rh.ponto`):**
  - "Justificar ponto — <setor> <período>": responsável o titular e o substituto (uma pendência para cada); prazo do líder;
  - "Cobrar líder — …": criada pelo job `rh-ponto-verificar-prazos` (pg_cron, 07h e 13h de Cuiabá, dias úteis) quando o prazo vence;
    a pendência do líder fica crítica;
  - "Ajustar no Control iD — …": quando o líder envia; encerrada na conclusão.
- **Início:** o líder vê um aviso "Justificar o ponto — …" com o link, mesmo sem nenhuma área liberada. A pendência dele fica
  visível para o RH, mas o líder não a lê: a política de `pendencias` é por módulo e não foi mexida.
- **Documentos:** o PDF do Control iD é anexo do lote (`relatorio_ponto`); os atestados são anexos das ocorrências (`atestado`).

## 7. Telas
- **RH > Ponto > Quinzenas:**
  - lotes do ano por setor e período, com situação, prazo e contagens;
  - "Importar relatório".
- **Quinzena** (`/rh/ponto/lote/<id>`):
  - grade com previsto, marcações, falta/atraso, extras, saldo do banco, justificativa, ação sugerida, documento e ajustado;
  - botões: E-mail ao líder / Lembrete / E-mail da devolução, Devolver ao líder, Cancelar (gestor), PDF do Control iD.
- **Setores e líderes** (gestor edita).
- **Parâmetros:** prazo do líder (gestor).
- **Líder:**
  - `/ponto/justificar`: histórico dos lotes do setor;
  - `/ponto/justificar/<id>`: formulário com tipo, horário e observação; "Salvar e continuar depois" e "Enviar justificativas".

## 8. Dados (prefixo `rh_pt_`)
- **`rh_pt_setores`:** nome, `lider_id`, `substituto_id`, ativo.
- **`rh_pt_lotes`:** setor, período, status, arquivo, prazo, e quem e quando importou, enviou, lembrou, devolveu (motivo), justificou,
  concluiu e cancelou (motivo).
- **`rh_pt_ocorrencias`:** lote, colaborador (nulo = sem cadastro), nome, matrícula, cargo, data, dia, previsto, marcações, falta,
  falta/atraso, total normal, extras, saldo do banco, tipo, horário, observação, quem e quando justificou, quem e quando ajustou.
- **Prazo:** `configuracoes.rh.ponto.prazo_dias_uteis`.

## 9. Permissões
- **RH (área `rh`):**
  - consulta lê;
  - **operador** importa, gera os rascunhos, devolve, vincula, anexa atestado e marca o ajuste;
  - **gestor** faz o mesmo e ainda cadastra setores, altera o prazo e cancela.
- **Líder e substituto:** só o próprio setor, pelas funções do item 5.2, sem área nenhuma.

## 10. Pontos em aberto
1. ~~Amostra original do relatório~~: recebida e calibrada em 21/10/2026.
2. **Usuário do Guilherme** no Neo Admin, e o setor Fábrica cadastrado com ele como líder.
3. **Outros setores** e seus líderes.
4. **Gmail da Graziele** conectado ("Conectar meu Gmail") para gerar os rascunhos.
5. **Ligação com a Folha:** marcar "ponto da 1ª e da 2ª quinzena" no checklist do mês quando as quinzenas estiverem concluídas
   (quando o checklist da Folha existir).
