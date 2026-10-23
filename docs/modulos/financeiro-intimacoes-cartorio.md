# Módulo: Financeiro / Intimações de cartório (Agente 01)

Código `financeiro.intimacoes` · rota `/financeiro/intimacoes` · migration `0181_fin_intimacoes.sql` · criado em 23/10/2026.

## 1. Objetivo
Quando um título do Contas a Pagar vai a protesto, o cartório intima a Neo Formas. Para evitar o protesto, o financeiro:
1. passa o vencimento do título para o prazo da intimação;
2. paga ao cartório as custas, por adiantamento a fornecedor;
3. recebe depois a NF de serviço do cartório;
4. consigna (abate) o adiantamento.

O agente reúne isso em uma fila:
- lê as intimações no Gmail;
- localiza o título no Consistem;
- altera o vencimento pela API, com aprovação do gestor;
- encaminha o adiantamento para **lançamento manual** e acompanha a NF e a consignação.

## 2. Como chegam as intimações (análise da caixa em 23/10/2026)

| Fonte | Remetente / assunto | O que o e-mail traz | O que NÃO traz |
|---|---|---|---|
| Intimação do 4º Ofício de Protesto de Cuiabá | `protesto.intimacao@4oficio.com` · "INTIMAÇÃO DE PROTESTO" | Só o **código localizador** (UUID) e o link `app.protestocuiaba.com.br/#/directMail/items/<localizador>/payments` | Título, credor, valor, **custas**, **prazo** |
| Aviso "Avise-me" da CENPROT (IEPTB) | `aviso@pesquisaprotesto.com.br` · "CENPROT: Avise-me" | Tabela por ocorrência: credor (CNPJ e nome), devedor, espécie, número do título, valor a protestar, vencimento, cartório ("CUIABÁ 04"), protocolo e data | **Custas** e **prazo** ("não substitui a intimação") |

**Portal do 4º Ofício** (o link do e-mail; lido pelo agente desde 23/10/2026, a pedido do Alan). A página chama uma API pública:
- `GET api.protestocuiaba.com.br/public/directMail/items/<localizador>` → nome e CPF/CNPJ **mascarado** do intimado ("17.***.***/****-28");
- `GET …/items/<localizador>/payments?naoIntimar=&cpfCnpj=<CNPJ do intimado>` → um registro por título, com protocolo, número, natureza, vencimento, **data limite para pagamento**, valor do título, saldo, **valor total a pagar no cartório**, situação (`intimado`, `pago`, `protestado`), credor (CNPJ mascarado) e boleto/Pix.

O agente lê como a pessoa que clica no link: `naoIntimar` vazio, como na página, sem usar o parâmetro para evitar o registro do acesso. **Um localizador pode trazer vários protocolos** (o de 21/10/2026 trouxe 5). O portal **não mostra a composição das custas**: o agente calcula custas = total no cartório − saldo do título.

Características observadas nas duas fontes:
- **Cópias e reenvios:** a mesma intimação chega a `admcuiaba@` e a `alantorres@`, e às vezes é reenviada horas depois, sempre com o **mesmo localizador**.
- **Aviso cumulativo:** o aviso da CENPROT repete os mesmos protocolos todos os dias.
- **Fora do escopo:** "LIMPE SEU NOME" (`nomelimpo@4oficio.com`) não é intimação e fica de fora.

## 3. Escopo
| Dentro | Fora |
|---|---|
| Ler o Gmail (só leitura), classificar, extrair, deduplicar | Pagar o boleto do cartório, ou usar `naoIntimar=true` para não registrar o acesso |
| **Entrar no link** da intimação (portal do 4º Ofício) e ler prazo, valores e títulos | Deduzir prazo legal (regra global 7): o prazo é o que o cartório informa no portal |
| Localizar o título pela API do Consistem (só leitura) e sugerir | Compor as custas: só o total do cartório é conhecido (custas = total − saldo, marcado como cálculo) |
| Propor e aprovar (gestor) o novo vencimento; alterar **só a data** pela API e conferir | Alterar valor, juros ou qualquer outro campo do título |
| Tarefa de **lançamento manual** do adiantamento, confirmação da pessoa e referência opcional | **Criar adiantamento pela API** (seção 9) |
| Acompanhar NF de serviço e consignação (confirmações da pessoa) | Ler a NF ou consignar no Consistem pelo sistema |

## 4. Etapas (status) e o que cada uma significa
| Status | Etapa (como a tela mostra) | Quem age | Sai para |
|---|---|---|---|
| `identificada` | Intimação identificada | operador: confere/informa os dados, procura o título | `titulo_localizado`, `descartada` |
| `titulo_localizado` | Título localizado | operador: propõe o prazo como novo vencimento | `aguardando_aprovacao` |
| `aguardando_aprovacao` | Vencimento aguardando aprovação | gestor: aprova (altera no Consistem) ou devolve | `adiantamento_pendente`, `revisao`, `titulo_localizado` |
| `adiantamento_pendente` | Adiantamento aguardando lançamento manual | operador: lança **na tela do Consistem** e confirma | `nf_pendente` |
| `nf_pendente` | Nota fiscal pendente | operador: registra o nº da NF do cartório | `consignacao_pendente` |
| `consignacao_pendente` | Consignação pendente | operador: confirma a consignação | `concluida` |
| `concluida` | Processo concluído | — | — |
| `revisao` | Revisão necessária | operador: retoma (volta à conferência) ou descarta | `identificada`/`titulo_localizado`, `descartada` |
| `descartada` | Descartada (motivo obrigatório; inclui "juntada a outro apontamento") | — | — |

Duas etapas do pedido original são fatos registrados, não status de espera:
- **"Alteração de vencimento concluída"** = `vencimento_alterado_em` mais a alteração `concluido` em `fin_intimacao_vencimentos`, com o título lido antes e depois.
- **"Adiantamento confirmado pelo usuário"** = `adiantamento_confirmado_em`/`_por` mais a referência opcional.

Ao acontecer cada um desses fatos, a intimação passa para a etapa seguinte. A confirmação do adiantamento é **sempre da pessoa**: o Consistem não confirma nada e a tela diz isso.

## 5. Regras de negócio
1. **Leitura:** a busca é `from:(protesto.intimacao@4oficio.com OR aviso@pesquisaprotesto.com.br) newer_than:30d` e lê até 60 mensagens novas por rodada.
   - Cada mensagem é classificada pelo remetente e pelo assunto.
   - **4º Ofício:** do e-mail sai o localizador. O agente entra no portal (uma vez por localizador por rodada) e acha a empresa intimada entre as empresas ativas pela máscara do CNPJ.
   - **Uma intimação por protocolo `intimado`:** os protocolos `pago` e `protestado` só são contados no resumo da leitura.
   - **Portal falhou:** fica uma intimação "só localizador" para a pessoa abrir o link.
   - **CENPROT:** sai uma intimação por linha **"Apontamento"**; as outras ocorrências são contadas e ignoradas.
2. **Duplicidade, em três camadas:**
   - **E-mail:** um `message_id` é lido uma vez só (`fin_intimacao_emails`).
   - **Intimação:** a chave `protocolo:<cartório>:<protocolo>` é a **mesma no portal e na CENPROT**, e cópias e repetições só ganham o e-mail como origem. `localizador:<uuid>` só existe quando o portal falhou.
   - **Título:** um `cod_lancamento` não fica em duas intimações em andamento (índice único). Depois de concluída ou descartada, o título fica livre de novo.
3. **Mesmo protesto nas duas fontes:** vira uma intimação só, e a segunda fonte **completa** o que falta sem sobrescrever o que a pessoa informou:
   - o portal traz localizador, link, prazo, total e custas;
   - a CENPROT troca o CNPJ mascarado do credor pelo completo.

   A junção manual (`fin_int_mesclar`) continua para a intimação "só localizador".
4. **Empresa:** é a devedora, achada pelo CNPJ (`empresas.cnpj`). Sem CNPJ, quem escolhe é a pessoa.
5. **Prazo e custas:** vêm do portal (`dados_portal_em`).
   - Prazo = `dataLimitePagamento`.
   - Custas = total no cartório − saldo do título, sempre exibidas como **cálculo**.
   - A pessoa confere e pode corrigir (`dados_informados_*`).
   - Sem os dois não se propõe o vencimento. Prazo no passado é recusado.
6. **Título:**
   - **Fornecedor:** o credor é achado com a função pública `cap_fornecedores_por_documento` (espelho do Contas a Pagar). Com CNPJ completo, pelos dígitos; com CNPJ **mascarado** do portal, pelos dígitos visíveis **e** pelo nome (um começa pelo outro).
   - **Consulta:** os títulos dele vêm do `GET financeiro/v10/contasPagar` (filtro `codFornecedor` e vencimento ±120 dias), só tipo C com saldo.
   - **Sugestão:** o sistema sugere apenas quando há **um único** título com número e valor conferindo, ou um único com o número. Na dúvida, a pessoa escolhe.
   - **Número:** a comparação ignora pontuação e zeros à esquerda; prefixo só vale com 4 ou mais caracteres.
7. **Alteração do vencimento:** novo vencimento = prazo da intimação.
   - **Aprovação:** só o **gestor** aprova, e só com a chave `financeiro.intimacoes.alterar_vencimento_no_erp` ligada.
   - **Rotina:** a mesma das correções do Cartão (0176, já usada em produção): GET `lancamentoContasPagar/{id}` → recusa tipo ≠ C, título com data de pagamento e complemento acima de 60 caracteres → PUT com **só** `{ dataVencimento }` → GET de novo.
   - **Conferência:** só a data mudou (o `diasPrazo` acompanha; o **valor não muda**).
   - **Sem repetição automática:** uma tentativa só. Erro ou dúvida leva a `revisao`, com o antes e o depois guardados.
8. **Adiantamento:** a tarefa mostra:
   - o fornecedor (cartório) e o código dele no Consistem, quando cadastrado em `financeiro.intimacoes.cartorios`;
   - o **valor exato das custas** e a referência;
   - a instrução de lançar **pela tela do Consistem**.

   A pessoa confirma (caixa "Confirmo que lancei…") e informa o código do lançamento, se tiver. O sistema não considera lançado sem essa confirmação.
9. **NF e consignação:** registro do número da NF e confirmação da consignação, ambos pela pessoa.
10. **Prova:** nada é apagado (`fn_bloquear_delete`). Toda mudança passa por `auditoria`. As alterações no ERP guardam o antes e o depois, e as aprovações guardam quem e quando.

## 6. Saídas e automações
- **Fila do dia** (`pendencias`, módulo `financeiro.intimacoes`), uma pendência aberta por etapa e por intimação:
  - "Intimação de protesto: …" (alta);
  - "Aprovar novo vencimento: …" (alta);
  - "Lançar adiantamento ao cartório: …" (alta, com valor e cartório);
  - "NF do cartório: …" (normal);
  - "Consignar adiantamento: …" (normal);
  - "Revisar intimação: …" (crítica).
- **Leitura agendada:** pg_cron `fin-intimacoes-ler-gmail-30min` (dias úteis, 07:05–18:35 de Cuiabá). Só chama a função com `financeiro.intimacoes.ler_gmail` ligada. Usa o mesmo Vault da sincronização (`rec_sincronizar_url`/`rec_sincronizar_segredo`).
- **Botão "Ler o Gmail agora"** (operador) na lista.

## 7. Telas
- **Lista** (`/financeiro/intimacoes`):
  - filtros "Em andamento", etapas e "Todas";
  - colunas: recebida, etapa, credor, título, valor, prazo, custas, origem;
  - botão "Ler o Gmail agora".
- **Ficha** (`/financeiro/intimacoes/[id]`):
  1. Dados: link da intimação, que a pessoa abre; formulário com empresa, credor, número, valor, vencimento, prazo e custas; "Juntar a um apontamento da CENPROT".
  2. Título: "Procurar o título no Consistem", com a lista de candidatos e o "É este".
  3. Novo vencimento:
     - proposta;
     - "Aprovar e alterar no Consistem", que mostra a data atual → a nova e "só a data muda";
     - "Devolver";
     - histórico das alterações.
  4. Adiantamento (manual): fornecedor, código, valor exato, referência, instrução e "Confirmar que lancei o adiantamento", com caixa de confirmação e código opcional.
  5. NF e consignação.

  Além disso: "Voltar para a conferência" (revisão), "Descartar" (motivo) e a lista de e-mails de origem.

## 8. Dados (prefixo `fin_int_` / `fin_intimac…`)
| Objeto | Uso |
|---|---|
| `fin_intimacoes` | Uma linha por intimação: chave, origem, dados lidos e informados, título (foto), proposta, aprovação, confirmações, status, motivo |
| `fin_intimacao_emails`, `fin_intimacao_origens` | E-mails lidos (prova) e o vínculo e-mail ↔ intimação (um aviso da CENPROT traz várias) |
| `fin_intimacao_vencimentos` | Alterações de vencimento no ERP: `{dataVencimento}` (CHECK: só essa chave), situação, antes, depois, resposta, erro, quem aprovou; imutável |
| `fin_int_vw_intimacoes` | Lista com empresa, nomes e nº de e-mails |
| Funções da pessoa | `fin_int_informar_dados`, `_escolher_titulo`, `_propor_vencimento`, `_devolver_proposta`, `_aprovar_vencimento`, `_confirmar_adiantamento`, `_registrar_nf`, `_confirmar_consignacao`, `_descartar`, `_mesclar`, `_retomar` |
| Funções da service role | `fin_int_registrar_leitura`, `fin_int_iniciar_vencimento`, `fin_int_concluir_vencimento` (sucesso só com o "depois"), `fin_int_chamar_leitura` (cron) |
| Função pública do Contas a Pagar | `cap_fornecedores_por_documento(empresa, documento)` (o módulo não lê `cap_fornecedores` direto) |
| Configuração | `financeiro.intimacoes.ler_gmail` (false), `financeiro.intimacoes.alterar_vencimento_no_erp` (false), `financeiro.intimacoes.cartorios` (`{"CUIABÁ 04": {"nome": "4º Ofício…", "codFornecedor": null}}`) |

## 8a. Validação com dados reais e prática observada (23/10/2026)
- **Portal:** as 6 intimações de outubro foram lidas no portal.
  - O localizador de 21/10 trouxe 5 protocolos `intimado` com prazo **23/10/2026**: FM do Brasil 0921310 e MT Corte e Dobra 24827-2, 24827-3, 24823-3 e 24933-2. Total no cartório: R$ 45.227,42; custas calculadas: R$ 2.213,78.
  - Os demais protocolos de outubro estavam `pago` ou `protestado`: Barraforte 12766/0-02 e 12410/4, FM do Brasil 0973504.
- **Casamento com o Consistem:** `lerPortal4Oficio` + `casarTitulos` sobre a listagem real (fornecedores 588 e 721) sugeriram 17070, 17117, 17118, 14830 e 15255, todos com número e valor conferindo.
- **Como a equipe fazia à mão até então:** nesses 5 títulos o Consistem já estava com vencimento = prazo, complemento "CARTORIO - VENC ORIGINAL dd/mm", **juros = total do cartório − valor do documento**, portador 237 e histórico 74. As custas entravam como juros no título.
- **Decisão do Alan (23/10/2026):** o agente segue o **fluxo do pedido**: altera só o vencimento, e as custas vão como adiantamento manual ao cartório, com NF e consignação depois. A prática dos juros não é reproduzida.

## 9. Dependência externa: adiantamento pela API do Consistem (limitação conhecida)
Teste de 23/10/2026, com o fornecedor 877 e R$ 100,00, acompanhado pelo Alan:
- **`PUT /lancamentoContasPagar`** (a rota usada pelo Cartão e pelo VT) não tem `tipoLancamento`: só cria título tipo C.
- **`PUT /contasPagar`** (`ContaPagarPut`, que o Swagger marca como "Não Gera Contabilização") aceita o tipo A:
  - sem `dataVencimento`, quebra com HTTP 500 `<ILLEGAL VALUE> CadastrarContaPagarApi+17^CCFFBRG001API`;
  - com a data, cria o lançamento (34214).
- **Diferenças do 34214** para um adiantamento feito pela tela (13146): ficou com vencimento, **sem data de pagamento**, **valor pago zero**, sem fluxo de caixa e sem contabilização.
- **Consequência:** o 34214 **não aparece no CCFFB720** (Consulta de Antecipações por Fornecedor). Foi excluído (`DELETE /contasPagar/34214`).
- **Sem correção pela API:** `LancamentoContaPagarPut` não tem `dataPagamento`, então o pagamento não pode ser completado depois.

**Decisão:** até a Consistem oferecer uma inclusão de antecipação **paga e contabilizada**, o adiantamento é lançado à mão. O agente:
- não tem rota, ação nem botão de inclusão;
- não usa escrita direta no banco nem automação de tela;
- tem testes que conferem isso (`leitura.test.ts`, bloco "nenhuma rota de criação de adiantamento").

Chamado a abrir, com o texto da conversa de 23/10/2026: "como incluir uma antecipação paga e contabilizada pela API, como a tela faz".

**Evolução futura:** quando houver a rota, ela entra como uma etapa a mais entre `adiantamento_pendente` e `nf_pendente`, atrás de chave própria e com conferência pela leitura do lançamento. A confirmação manual continua como alternativa.

## 10. Permissões (área Financeiro)
| Nível | Pode |
|---|---|
| consulta | ver lista e ficha |
| operador | ler o Gmail, informar dados, procurar e escolher título, propor, confirmar adiantamento, NF e consignação, juntar, retomar, descartar |
| gestor | tudo do operador + aprovar (altera no Consistem) e devolver proposta |

## 11. Critérios de aceitação
1. **Leitura:**
   - um e-mail do 4º Ofício vira, pelo portal, uma intimação `identificada` por protocolo `intimado`, já com prazo, total e custas;
   - o mesmo protocolo vindo da CENPROT não duplica e completa o CNPJ do credor;
   - um aviso da CENPROT sozinho também vira intimação `identificada`, e toda intimação nova gera pendência na Fila do dia;
   - "LIMPE SEU NOME" não entra;
   - linhas que não são "Apontamento" não entram.
2. **Duplicidade:**
   - ler de novo o mesmo e-mail, a cópia em outra caixa ou o aviso do dia seguinte não cria intimação;
   - o mesmo título não entra em duas intimações em andamento.
3. **Proposta:** não se propõe sem título, prazo e custas, nem com prazo vencido; trocar credor ou número desfaz a escolha do título.
4. **Aprovação:**
   - só o gestor aprova, e só com a chave ligada;
   - o envio é só `{ dataVencimento }`, uma vez;
   - o sucesso exige a leitura do título depois, com tudo igual fora a data e o `diasPrazo`;
   - recusa ou diferença levam a `revisao`, com o antes e o depois.
5. **Adiantamento:**
   - depois do vencimento a ficha mostra fornecedor, valor exato, referência e instrução;
   - nada avança sem a confirmação explícita da pessoa;
   - nenhuma chamada de inclusão existe no código do agente.
6. **NF e consignação:** NF exige número; a consignação conclui e fecha as pendências.
7. **Prova:** nada é apagado, e toda mudança está na `auditoria`.

Testes:
- `tests/db/fin-intimacoes.test.ts` (18), cobrindo os critérios 1 a 7 no banco, incluindo a junção portal + CENPROT e o fornecedor por CNPJ mascarado;
- `lib/modulos/financeiro/intimacoes/leitura.test.ts` (19), com classificação, extração de trechos reais, leitura do portal (resposta real reduzida; só GET, `naoIntimar` vazio, empresa pela máscara), Gmail só leitura, escolha do título, alteração com o fetch registrando cada chamada (só GET/PUT em `lancamentoContasPagar/{id}`) e varredura do código contra rotas de inclusão;
- `intimacoes.test.ts` (3), com as etapas e a tarefa do adiantamento.

## 12. Plano de implementação (fases)
| Fase | Conteúdo | Situação (23/10/2026) |
|---|---|---|
| A | Banco: tabelas, etapas, funções, pendências, auditoria, chaves | **feito** (0181, não aplicada) |
| B | Leitura do Gmail: classificação, extração, deduplicação, Edge Function, cron desligado | **feito no código**; falta autorizar a caixa |
| C | Título: função pública de fornecedor, consulta à API, sugestão | **feito no código** |
| D | Vencimento: proposta, aprovação, alteração conferida | **feito no código**; chave desligada |
| E | Adiantamento manual, NF, consignação, telas | **feito no código** |
| F | Publicação e primeiro uso acompanhado | **pendente (Alan)**, seção 13 |

## 13. Publicação e o que falta (dependências)
1. **Migration** `0181_fin_intimacoes.sql`: aplicar e registrar `(0181, fin_intimacoes)` em `supabase_migrations.schema_migrations` (`docs/PUBLICACAO.md`, seção 2).
2. **Gmail (leitura):**
   - no Google Cloud, adicionar o escopo `https://www.googleapis.com/auth/gmail.readonly` ao cliente "Neo Admin Gmail" (público Interno);
   - rodar `node scripts/gmail-autorizar.mjs --leitura --ref chdszjpbtfpstjrqnmmm`, que grava `GMAIL_LEITURA_CLIENT_ID`, `GMAIL_LEITURA_CLIENT_SECRET`, `GMAIL_LEITURA_REFRESH_TOKEN` e `GMAIL_LEITURA_CAIXA`;
   - decidir a caixa: `admcuiaba@` recebe as duas fontes.

   Sem os segredos, a função responde 503 dizendo quais faltam.
3. **Funções** (rodar `npx -y deno check` antes de publicar):
   ```
   npx supabase functions deploy fin-intimacoes-ler-gmail --project-ref chdszjpbtfpstjrqnmmm
   npx supabase functions deploy fin-intimacoes-consistem --project-ref chdszjpbtfpstjrqnmmm
   ```
4. **Cartório como fornecedor:** informar o código do 4º Ofício no Consistem em `financeiro.intimacoes.cartorios`. Hoje está `null`; não foi inventado.
5. **Primeiro uso acompanhado:**
   - "Ler o Gmail agora" e conferir as intimações de outubro;
   - escolher um título e ligar `alterar_vencimento_no_erp`;
   - aprovar e conferir no Consistem que **só** o vencimento mudou.

   Depois disso, ligar `ler_gmail`.
6. **A confirmar com o Alan:**
   - o novo vencimento é a **data limite para pagamento** do portal (interpretação de "data da intimação");
   - custas = total no cartório − saldo do título: conferir com a NF do cartório se é o valor do adiantamento;
   - quem aprova (hoje: qualquer gestor do Financeiro, inclusive quem propôs);
   - o histórico e a categoria do adiantamento manual (o agente só orienta; não preenche o Consistem).
