# Módulo: Administrativo geral / Central de Gestão (`administrativo.gestao`)

Status: construído (Fases 2 a 8 entregues em 22 e 23/10/2026), **não publicado em produção**. O envio real pelo Slack e
pelo ClickUp depende de credenciais (seção 14, Fase 7). Para publicar, siga o roteiro único da seção 14, Fase 8. Especificação aprovada em 22/10/2026; **Fases 2 e 3 entregues em 22/10/2026** (migrations 0092 e
0093: tela `/gestao`, criação e distribuição de tarefas, ações, comentários e histórico), aguardando avaliação. O que foi construído e como testar estão na seção 14.

Decisões já tomadas por Alan (22/10/2026):
- **Alan e Rodrigo veem tudo.** Alan é `admin_geral`. Rodrigo será **gestor em todas as áreas** pelo cadastro de permissões
  que já existe (Configurações > Usuários), sem administrar usuários e configurações. Os demais veem só a própria área.
- **Quem distribui tarefas** é o gestor da área. É a regra que já vale no banco: Alan e Rodrigo em tudo, cada gestor na
  sua área. O operador só cria para si.
- **"Precisam distribuir"** conta só o que de fato precisa de dono: tarefas manuais sem responsável e as marcadas como
  "precisa distribuir". As pendências automáticas sem dono continuam como fila da área.
- **Sugestões:** todos veem o título e a situação. O conteúdo completo fica para o autor e os avaliadores, que são Alan e
  Rodrigo.
- **Atividades da equipe** (o que cada pessoa fez e viu no Neo Admin):
  - só Alan e Rodrigo veem as dos outros, inclusive um do outro;
  - cada funcionário vê só as próprias;
  - os acessos (telas e registros abertos) ficam guardados por 12 meses.

## 1. Objetivo
Transformar as pendências do núcleo numa visão gerencial única. A tela responde:
- o que exige intervenção agora;
- quem está com atraso;
- o que vence hoje;
- o que está bloqueado;
- quem aguarda uma decisão do gestor;
- o que ainda precisa de dono.

Ela não substitui as telas dos módulos: cada item leva ao registro original. Inclui a criação e distribuição de tarefas
manuais e o canal "Sugerir melhoria" para a equipe.

## 2. Como é feito hoje
- **Pendências automáticas:** cada módulo publica as suas na tabela `pendencias` (ver a seção 6.3). Elas aparecem na Fila
  do dia (`/financeiro/recebiveis/fila`).
- **Limites da Fila do dia:**
  - só entra quem tem acesso ao Financeiro;
  - mostra no máximo 500 linhas, sem paginação;
  - não tem bloqueio, decisão do gestor, histórico nem visão por funcionário.
- **Tarefas avulsas** ficam no ClickUp, no WhatsApp ou na memória. **Melhorias** chegam por conversa e não têm registro.

## 3. Escopo
| Entra (v1) | Fica fora (v1) |
| --- | --- |
| Tela `/gestao` com indicadores, "Exige minha intervenção", equipe e fila consolidada | Substituir as telas operacionais dos módulos |
| Tarefas manuais: criar, atribuir, prazo, prioridade, situação, bloqueio, pedido de decisão, comentários, histórico | Recorrência de tarefas manuais (fica para depois) |
| Destaque gerencial calculado, com regra e motivo visíveis, e ajuste manual pelo gestor | Pontuação ou ranking de funcionários |
| Sugestões de melhoria com fluxo de avaliação | Anexos em sugestões (ver o ponto em aberto 4) |
| Atividades da equipe: o que cada pessoa fez (ações) e viu (acessos), com linha do tempo, resumo e exportação | Nota, ranking ou rótulo de produtividade; ferramentas externas de analytics |
| Contrato de publicação no núcleo (`publicar_pendencia`) e adoção pelo Fiscal (obrigações e divergências) | Reescrever os publicadores atuais (continuam como estão) |
| Registro de notificações e Slack preparado; critério do ClickUp | Envio real antes de configurar e validar |

## 4. Entradas
- **Tabela `pendencias`**, alimentada pelos módulos:
  - recebíveis, filial, contas a pagar, cartão, comercial;
  - RH: vale-transporte, folha, ponto e banco de horas;
  - fiscal: tarefas.
- **Cadastros manuais:** tarefas e sugestões.
- **Permissões e perfis** do núcleo (`perfis`, `permissoes`, `usuarios_da_area()`).
- **Parâmetros** em `configuracoes`, com chaves `administrativo.gestao.*` (seção 5.6).

## 5. Regras de negócio

### 5.1 Três informações que não se confundem
1. **Prioridade:** a importância que a origem ou o gestor atribuiu. É a coluna `criticidade` que já existe, com os valores
   `critica`/`alta`/`normal`. Na tela ela aparece como **Prioridade: Crítica / Alta / Normal**. A coluna não é
   renomeada, porque todos os módulos já gravam nela.
2. **Situação:** o andamento.
   - Valores: `aberta`, `em_andamento`, `concluida`, `cancelada` (enum atual).
   - Duas **marcas** independentes: **bloqueada** e **aguardando gestor**.
   - O bloqueio **não** vira status novo. Os cerca de 30 publicadores procuram pendências `aberta`/`em_andamento` para não
     duplicar. Um status `bloqueada` faria cada sincronização criar outra pendência igual.
3. **Destaque gerencial:** calculado na hora da consulta pelas regras da seção 5.3. Tem quatro níveis:
   - **Intervir:** entra em "Exige minha intervenção".
   - **Acompanhar.**
   - **Avaliar:** faltam dados para julgar.
   - **Normal.**

   Prioridade alta não vira "Intervir" sozinha.

### 5.2 Prazos (fuso America/Cuiaba, datas dd/mm/aaaa)
- **Hoje:** a data de Cuiabá (`hojeEmCuiaba()` de `lib/nucleo/fila.ts`, que já é testada).
- **Atrasada:** `prazo < hoje`.
- **Vence hoje:** `prazo = hoje`.
- **Prazo próximo:** `hoje < prazo ≤ hoje + dias_prazo_proximo`.
- **Sem prazo:** nunca fica atrasada.
- **Encerradas** (`concluida`/`cancelada`) ficam fora de todos os indicadores.

### 5.3 Regras do destaque gerencial
Cada regra que se aplica gera um **motivo**, com código, texto e os dados usados. O nível final é o mais alto entre os
motivos (Intervir > Avaliar > Acompanhar > Normal). A tela mostra **todos** os motivos e o momento do cálculo.

| Código | Quando | Nível | Motivo exibido (exemplo) |
| --- | --- | --- | --- |
| `AGUARDA_GESTOR` | Marca "aguardando gestor" ligada | Intervir | "Aguarda sua decisão desde 20/10/2026: <motivo>" |
| `ATRASO_RELEVANTE` | Atraso > `dias_atraso_relevante`, **ou** atrasada com prioridade crítica | Intervir | "Atrasada há 8 dias (limite 5)" |
| `IMPACTO_REGISTRADO` | Impacto financeiro ou fiscal registrado **com fundamento** e prazo atrasado, de hoje ou próximo | Intervir | "Impacto fiscal: <fundamento>, vence hoje" |
| `BLOQUEIO_RELEVANTE` | Bloqueada há mais de `dias_bloqueio_relevante` | Intervir | "Bloqueada há 3 dias (limite de 2 dias): <motivo>" |
| `IMPEDE_OUTRA` | Indicada como dependência no bloqueio de outra pendência aberta | Intervir | "Impede outra pendência de avançar" |
| `PRECISA_DISTRIBUIR` | Precisa distribuir e (prioridade alta/crítica, ou prazo de hoje, atrasado ou próximo) | Intervir | "Sem responsável, prioridade alta, vence em 2 dias" |
| `PRECISA_DISTRIBUIR` | Precisa distribuir nos demais casos | Acompanhar | "Sem responsável" |
| `ATRASO_SIMPLES` | Atrasada, sem cair em `ATRASO_RELEVANTE` | Acompanhar | "Atrasada há 2 dias" |
| `VENCE_HOJE` | Vence hoje | Acompanhar | "Vence hoje" |
| `PRAZO_PROXIMO` | Prazo próximo | Acompanhar | "Vence em 3 dias (25/10/2026)" |
| `BLOQUEADA` | Bloqueada há menos tempo que o limite | Acompanhar | "Bloqueada desde ontem: <motivo>" |
| `SEM_MOVIMENTACAO` | Aberta e sem movimentação humana há mais de `dias_sem_movimentacao` | Acompanhar | "Sem movimentação há 9 dias" |
| `SEM_PRAZO_IMPORTANTE` | Prioridade alta/crítica e sem prazo (manual ou, desde a Fase 6, de módulo) | Avaliar | "Prioridade alta sem prazo definido" |
| `IMPACTO_SEM_PRAZO` | Impacto registrado com fundamento, mas sem prazo (Fase 4) | Avaliar | "Impacto fiscal registrado sem prazo: avaliar a urgência" |
| `IMPACTO_SEM_FUNDAMENTO` | (não acontece: o banco exige fundamento para registrar impacto) | — | — |

**Ajuste manual.** O gestor pode **subir** um item para Intervir ou **baixar** para Acompanhar/Normal.
- O motivo é obrigatório e o banco registra quem ajustou e quando.
- A tela mostra "Ajuste manual de <nome> em dd/mm/aaaa: <motivo>" ao lado das regras calculadas, que continuam visíveis.
- O ajuste vale até a pendência ser encerrada ou até o gestor retirá-lo.

**Fonte única.** O cálculo fica numa função SQL do núcleo (`pendencia_destaque`), testada em PGlite. A tela só formata os
textos. Assim o número do indicador e a lista nunca divergem.

**O que não se presume:**
- atraso não vira crítico só por ser atraso;
- impacto fiscal ou financeiro só existe quando o módulo ou o gestor o registra, com fundamento escrito;
- nenhum prazo legal é calculado aqui: o prazo vem do módulo de origem.

### 5.4 Indicadores (sobre as pendências abertas da visão selecionada)
| Indicador | Regra | Ao clicar |
| --- | --- | --- |
| Em aberto | `aberta` + `em_andamento` | fila filtrada |
| Atrasadas | prazo < hoje | idem |
| Vencem hoje | prazo = hoje | idem |
| Exigem intervenção | destaque = Intervir | a área "Exige minha intervenção" |
| Aguardando gestor | marca ligada | idem |
| Bloqueadas | marca ligada | idem |
| Precisam distribuir | regra 5.5 | idem |

**Sobreposição.** "Em aberto" é o total. Os outros são **recortes** dele e podem se sobrepor: uma pendência atrasada e
bloqueada conta nos dois. A tela diz isso e **nunca soma os recortes**. "Exige minha intervenção" mostra cada pendência
**uma só vez**, com todos os motivos.

### 5.5 Precisa distribuir
Uma pendência aberta **sem responsável** entra aqui quando:
- é tarefa manual (`origem = manual`); **ou**
- tem a marca `precisa_distribuir`, ligada pelo gestor ou pelo módulo que a publicou.

As automáticas sem dono e sem a marca (por exemplo, "Anexar boleto") são a fila da área: o operador assume.

### 5.6 Parâmetros (`configuracoes`, só o `admin_geral` altera)
| Chave | Valor inicial proposto | Situação |
| --- | --- | --- |
| `administrativo.gestao.dias_prazo_proximo` | 3 | **aprovar**: alinhado ao "alta se faltar 3 dias ou menos" do Contas a pagar e do Cartão |
| `administrativo.gestao.dias_atraso_relevante` | 5 | **aprovar** |
| `administrativo.gestao.dias_bloqueio_relevante` | 2 | **aprovar** |
| `administrativo.gestao.dias_sem_movimentacao` | 5 | **aprovar** |
| `administrativo.gestao.itens_por_pagina` | 50 | técnico |

Os dias são corridos. Dias úteis exigiriam um calendário de feriados, que o núcleo ainda não tem.

### 5.7 Tarefas manuais
**Campos**

| Campo | Regra |
| --- | --- |
| Título | Obrigatório |
| Área | Obrigatória |
| Módulo | Obrigatório. Só aparecem os módulos da área em que o usuário tem nível operador ou acima. "Tarefas gerais" (`administrativo.gestao`) só aparece para quem tem acesso ao Administrativo, como Alan e Rodrigo |
| Descrição | Opcional |
| Responsável | Opcional. Sem responsável, a tarefa vai para "Precisam distribuir" |
| Prazo | Opcional |
| Prioridade | Padrão Normal |
| Categoria | Opcional: tarefa, conferência, lançamento, entrega, cobrança, decisão, fechamento, outro |
| Observações | Opcional. Gravadas como primeiro comentário |
| Origem | O sistema grava `manual` |
| Empresa | Opcional |

O banco carimba quem criou e quando.

**Validação** na tela, na ação do servidor (zod) e no banco (`check` e gatilho).

**Quem cria e atribui**

| Situação | Quem pode |
| --- | --- |
| Criar para si | Operador do módulo ou acima |
| Criar sem responsável | Operador do módulo ou acima |
| Atribuir a outra pessoa, reatribuir | Gestor da área do módulo (regra atual do gatilho `fn_pendencias_regras`). Candidatos: `usuarios_da_area()` |
| Alterar título, descrição, prazo, prioridade, categoria | Gestor (regra atual) |

**Fluxo**

| De → para | Quem | Registro |
| --- | --- | --- |
| aberta → em_andamento ("Iniciar") | responsável ou gestor | histórico |
| em_andamento → aberta | responsável ou gestor | histórico |
| → concluída | responsável ou gestor (regra atual) | o banco carimba quem e quando |
| → cancelada (tarefa **manual**) | gestor ou quem criou | **motivo obrigatório** (comentário) |
| → cancelada (pendência **automática**) | segue a regra do módulo de origem, sem mudança | — |
| reabrir encerrada | gestor (regra atual) | histórico |

**Bloqueio**
- Quem pode: o responsável ou o gestor.
- Motivo obrigatório. A dependência é opcional: outra pendência que a pessoa possa ver.
- O banco carimba quem e quando.
- Desbloquear limpa a marca e mantém o registro no histórico.
- Uma observação não vira dependência estruturada: a dependência só é registrada quando a pessoa escolhe a pendência.

**Aguardando gestor**
- O responsável liga a marca escrevendo o que precisa decidir.
- Só o gestor desliga, com a resposta registrada como comentário.

**Comentários**
- Quem pode: quem enxerga a pendência.
- Vão para `interacoes` (`tipo = comentario`, canal `interno`), que não tem edição nem exclusão.
- Os acionamentos do gestor ("cobrar andamento") são `tipo = cobranca_gestor`.

**Movimentação**
- `movimentado_em` muda só em ação humana: status, responsável, prazo, prioridade, bloqueio, decisão, comentário.
- A reescrita automática de título e descrição pelas sincronizações **não** conta.

### 5.8 Sugestões de melhoria
**Formulário**
- Obrigatórios: título, área e melhoria sugerida.
- Opcionais: módulo, problema observado, como é feito hoje e resultado esperado.
- Ao abrir o formulário dentro de um módulo, área e módulo já vêm preenchidos.

**Situações:** `nova` → `em_avaliacao` → `aprovada` | `nao_aprovada` → `em_desenvolvimento` → `concluida`.
- Não aprovada e concluída encerram a sugestão.
- "Planejada" e "Em espera" **não** entram na v1. A prioridade e a ligação com uma tarefa já indicam o planejamento, e uma
  sugestão parada fica em avaliação.

**Avaliadores:** `admin_geral` ou **gestor da área Administrativo**. Com a decisão de 22/10, são Alan e Rodrigo.
Os avaliadores podem:
- mudar a situação;
- registrar a prioridade (alta, normal, baixa);
- comentar;
- justificar a decisão (obrigatório para aprovar e para não aprovar);
- ligar a sugestão a uma tarefa de implementação: uma pendência manual ou, na Fase 7, uma tarefa do ClickUp.

Aprovar não muda nada no sistema: a melhoria segue o fluxo normal de especificação, construção, testes e validação.

**Visibilidade**

| Quem | O que vê |
| --- | --- |
| Todos com alguma área | Número, título, área, módulo, situação, data e a justificativa da decisão |
| Autor e avaliadores | Também problema, como é hoje, resultado esperado, comentários e autor |

**Histórico:** autor, datas, módulo de origem e cada mudança de situação, pela `auditoria`. Nada é apagado.

### 5.9 Atividades da equipe (Fase 3B)
Objetivo: o gestor saber o que cada pessoa **fez** e **viu** no Neo Admin. Exemplos:
- Karina confirmou pagamentos e anexou boletos;
- Aelso transmitiu obrigações fiscais;
- Rodrigo abriu a Central e acompanhou pendências;
- o RH fechou a folha e o ponto.

**Diagnóstico (22/10/2026)**
- A `auditoria` cobre cerca de 75 tabelas, com antes e depois, usuário e horário, desde a criação de cada tabela.
- Há mais de 30 colunas de autoria (`aprovado_por`, `fechado_por`, `enviado_por`, `concluido_por`…).
- `interacoes` e `anexos` já guardam o usuário.

**Lacunas**

| Lacuna | Detalhe |
| --- | --- |
| Formato técnico | A auditoria está em JSON, sem índice por usuário, e só o `admin_geral` lê |
| Mistura com sincronizações | Ela mistura as gravações das sincronizações automáticas, a cada 30 minutos |
| Sem usuário nas funções automáticas | Ações executadas pelas Edge Functions a pedido de uma pessoa ficam **sem usuário**, porque rodam com service role. Exemplos: lançar no Consistem, rascunho no Gmail, Slack |
| Tabelas sem auditoria | `anexos`, `interacoes`, `contrapartes` (estas já têm autor próprio), cadastros do Contas a pagar e pedidos comerciais |
| Visualização | Nenhum registro do que foi visto |
| Justificativa de ponto | É feita pelo link público, sem conta: guarda só o nome digitado, o IP e o horário |

**Ferramenta: nativa no Neo Admin.** Usa o login, as permissões e o banco que já existem.

| Alternativa descartada | Motivo |
| --- | --- |
| Logs do Supabase | Retenção de 1 a 7 dias, conteúdo técnico |
| Analytics externo (PostHog, Google Analytics) | Envia dados de funcionários a terceiros e não conhece as ações de negócio |
| BI externo (Metabase, Looker Studio) | Lê o banco fora das permissões do sistema. Fica para depois, se houver demanda |
| Console do Google Workspace | Mostra só os logins |

**Registro de atividades (ações)**
- Tabela do núcleo `atividades`, uma linha por ação de negócio, em linguagem de gestão:
  - quem e quando, área, módulo;
  - ação, a partir de um catálogo como `rec.confirmou_pagamento`, `rec.anexou_boleto`, `rh.fechou_folha`, `rh.fechou_ponto`,
    `fis.transmitiu_obrigacao`;
  - descrição ("Confirmou o pagamento de <cliente> — venc. 25/10/2026"), registro de origem e link;
  - origem do registro: `direto`, `servico_a_pedido` ou `historico`.
- **Como é alimentada (decisão da construção, 22/10/2026):** sem mexer nas telas nem nas funções dos módulos. Um catálogo
  (`atividade_regras`) diz que alteração vira qual ação, por exemplo: "em `rh_fp_competencias`, status passou para `paga`"
  vira "Marcou como paga a folha de 09/2026".
  - Um gatilho classifica cada linha nova da `auditoria`, de `interacoes` e de `anexos`.
  - `atividades_reprocessar()` classifica o histórico uma vez; rodar de novo não duplica.
  - Uma regra com defeito não impede as outras nem a gravação do módulo.
- **Autor:**
  - quem estava logado;
  - quando a gravação veio de uma Edge Function a pedido de alguém, a coluna `_por` do próprio registro
    (ex.: `enviado_por` no envio do ponto, `solicitada_por` na AKF, `slack_enviada_por` no Contas a pagar). Essas
    atividades aparecem como "por rotina a pedido";
  - sem pessoa por trás, não há atividade.
- **Cada área declara as regras das próprias tabelas, na sua faixa de migrations:**

  | Faixa | Migration |
  | --- | --- |
  | Núcleo | `0094` |
  | Financeiro | `0179` |
  | Fiscal | `0205` |
  | RH | `0522` |
  | Comercial | `0704` |

  Módulo novo acrescenta as suas regras do mesmo jeito.
- **Fica fora:** as gravações de sincronização e rotina agendada sem pessoa por trás.
- **Imutável:** sem edição nem exclusão. É prova (regra global 4).
- **Catálogo inicial:**
  - Recebíveis e Cobrança: confirmou pagamento, sem resposta, anexou boleto, enviou boleto, registrou cobrança, baixa,
    rascunho no Gmail;
  - RH: fechou, aprovou e pagou folha; fechou VT; enviou e concluiu ponto; fechamento do banco de horas;
  - Fiscal: transmitiu e conferiu obrigação, registrou crédito, fechou competência, tratou divergência;
  - Pendências: assumiu, concluiu, bloqueou, comentou.

  Os demais módulos ampliam o catálogo quando forem revistos.

**Registro de acessos (o que viu)**
- Tabela do núcleo `acessos`, com quem, tela (rota), registro aberto (quando a rota identifica um) e quando.
- É gravada no servidor ao abrir a página; não usa rastreador no navegador.
- Agrupamento: uma linha por pessoa, tela e registro a cada 30 minutos (`administrativo.gestao.acessos_agrupar_minutos`).
- **Retenção de 12 meses** (`administrativo.gestao.acessos_reter_meses`): uma rotina do pg_cron apaga o que passou do prazo.
  É a exceção documentada à regra de não apagar, porque acesso não é prova de ação.

**Relatórios** (aba "Atividades da equipe" na Central)

| Relatório | Conteúdo |
| --- | --- |
| Linha do tempo por pessoa | O que fez e o que viu, com filtros de período, área, módulo e tipo de ação |
| Resumo por pessoa e período | Ações por tipo; pendências concluídas, no prazo × atrasadas; tempo médio até a conclusão; dias com atividade; último acesso |
| Por processo | Quem fez cada etapa (por exemplo: fechamento da folha de setembro, obrigação X, ciclo do cartão Y) |
| Exportação | Excel (`exceljs`, que já está no projeto) |

**Produtividade com cuidado**
- Sem nota única, ranking ou rótulo.
- Os números aparecem com o volume e o tipo de trabalho da área.
- Pessoas de áreas diferentes não são comparadas lado a lado.

**Quem vê**

| Quem | O que vê |
| --- | --- |
| Quem tem `perfis.acompanha_equipe` | Atividades e acessos de todos, inclusive um do outro. Hoje são Alan e Rodrigo |
| Cada funcionário | Só os próprios |
| Gestores de área sem a marca | Não veem os dos outros |

- `perfis.acompanha_equipe` só é ligada pelo `admin_geral` e é sempre verdadeira para ele.
- Quem consulta o registro de outra pessoa também fica registrado em `acessos`.

**Atenção (LGPD e relação de trabalho; validar com o jurídico ou o RH, isto não é parecer):**
- comunicar à equipe, antes de ligar o registro de acessos, que ações e acessos são registrados, para quê e por quanto
  tempo;
- o registro de acessos só começa a gravar depois que o admin ligar `administrativo.gestao.registrar_acessos`, que vem
  desligado.

### 5.10 Contrato de publicação (para os módulos)
**Função do núcleo `publicar_pendencia(...)`**
- Parâmetros: `modulo`, `chave_origem`, `titulo`, `descricao`, `prazo`, `prioridade`, `responsavel_id`, `empresa_id`,
  `contraparte_id`, `referencia_tabela`, `referencia_id`, `link`, `categoria`, `precisa_distribuir`, `impacto` +
  `impacto_fundamento`.
- Se já existe uma pendência aberta com o mesmo `modulo + chave_origem`, ela é **atualizada**; se não existe, é criada.
- O título pode mudar sem duplicar.
- O responsável definido por pessoa na Central não é sobrescrito pelo módulo.

**Função `encerrar_pendencias(modulo, chaves_ativas[] | chave, status)`**
- Encerra o que deixou de valer na origem.
- Só alcança pendências com `origem = modulo` daquele módulo e chave. Uma tarefa manual nunca é encerrada por
  semelhança de texto.

**Adoção e compatibilidade**
- `chave_origem` tem índice único entre as pendências abertas, por módulo, quando preenchida.
- Os publicadores atuais continuam com a deduplicação de hoje e passam a usar o contrato quando forem revistos.
- Módulo novo deve usar o contrato. O módulo publica pela função do núcleo e não lê tabelas de outros módulos.

## 6. Saídas e automações

### 6.1 Notificações (Fase 7)
**Eventos possíveis**
- tarefa atribuída;
- prazo próximo;
- atraso;
- passou para Intervir;
- aguardando gestor;
- resumo diário.

**Tabela `notificacoes`** guarda:
- evento, pendência, destinatário e canal;
- chave contra duplicidade (pendência + evento + data);
- tentativas, resultado e erro;
- link para a pendência.

**Regras de envio**
- Nada sai enquanto `modo_rascunho` estiver ligado e o evento não estiver habilitado em `configuracoes`.
- A mesma pendência não gera o mesmo aviso duas vezes no dia.
- A cobrança mais firme ao funcionário só sai por clique do gestor.

**Slack**
- Usa o mesmo segredo `SLACK_BOT_TOKEN` do Contas a pagar, só na função do servidor.
- Precisa saber quem é cada pessoa no Slack (ponto em aberto 5).
- O resumo diário tem horário configurável no fuso de Cuiabá. Proposta: 07:30, a aprovar.
- Os testes automáticos nunca enviam.

### 6.2 ClickUp (Fase 7)
- Só vão para o ClickUp:
  - as sugestões aprovadas (tarefa de implementação);
  - as tarefas manuais que o gestor marcar "enviar ao ClickUp".
- O vínculo fica em `pendencias.clickup_task_id`, coluna que já existe, para não duplicar.
- Mudança no ClickUp **não** encerra pendência sem regra explícita. Na v1 o vínculo é só de ida.
- Não existe token do ClickUp no projeto (ponto em aberto 6).

### 6.3 Integração com os módulos prioritários (Fase 6)

**Fechamentos e encerramentos que já existem**

| Processo | Publica pendência? | Fonte |
| --- | --- | --- |
| Fatura do cartão | Sim ("Importar", "Conciliar", "Fechar"…) | `crt_*` |
| Vale-transporte e folha | Sim ("Fechar", "Aprovar", "Pagar") | `rh_vt_*`, `rh_fp_*` |
| Banco de horas | Sim | `rh_bh_*` |
| Comissões (comercial) | **Não** | `fin_com_fechamentos` |
| Competência fiscal (`fis_periodos`) | **Não** | `fis_periodo_fechar` |

Nenhuma rotina nova de fechamento é inventada. Publicar Comissões e Competência fiscal depende de decisão (ponto em
aberto 3).

**Recebíveis e Cobrança**
- Já publicam: anexar boleto, confirmar pagamento, ligar para confirmar, cobrar D+n, possível baixa, cadastro de contato e
  falha de sincronização.
- Todas aparecem como `financeiro.recebiveis`.
- A Central mostra o grupo "Cobrança" para os títulos que começam com "Cobrar D+", "Confirmar pagamento", "Ligar para
  confirmar pagamento" e "Possível baixa". É uma regra de exibição documentada; nenhum dado é copiado.
- **Não existem hoje** "divergência de pagamento" nem "processo de cobrança bloqueado". Ficam como limitação; não há
  segunda carteira.

**Fiscal / Créditos**
- As tarefas (incluindo pedidos de documento ao contador e "Analisar divergência") já publicam.
- **Novo:** as obrigações e as divergências passam a publicar pelo contrato.
- **Obrigação pendente:**
  - entra quando o status não é transmitida, entregue/conferida, retificada ou dispensada e o vencimento está a até
    `fiscal.creditos.dias_alerta_obrigacao` dias (proposta: 10, **aprovar**);
  - vencimento "a confirmar" vira a pendência "Confirmar vencimento", com destaque **Avaliar**;
  - o prazo é o vencimento registrado no módulo, nunca calculado pela Central.
- **Divergência aberta sem tarefa** vira pendência com "precisa distribuir".
- A simples existência de crédito não gera pendência.
- **Notas fiscais** a conferir ou lançar **não têm módulo** (Análise de entradas ainda não foi construída). Ficam como
  limitação.

## 7. Telas

**`/gestao` — "Central de Gestão"**
- Item fixo no trilho, logo após "Início", para todo usuário ativo com alguma área.
- Não depende de linha na tabela `modulos`, porque é do núcleo, como o Início.
- Segue `docs/VISUAL.md`, sem paleta própria.

**Cabeçalho**
- Título, data de hoje por extenso (Cuiabá) e a visão.
- Visões: **"Gestão"**, para quem é gestor em alguma área (as áreas que gerencia; para Alan e Rodrigo, todas), e **"Minhas
  pendências"**, a padrão de quem não é gestor.
- Filtros: área, módulo, responsável, situação, prioridade, destaque, origem e período do prazo (de/até). O período
  vale sobre o prazo, inclusive quando a situação filtrada é concluída ou cancelada.
- Botão "Nova tarefa" (Fase 3), para quem é operador ou acima em alguma área. "Sugestões" entra na Fase 5: a tela não
  tem botão sem efeito.

**Blocos**
1. **Indicadores:** os da seção 5.4, clicáveis, com a nota de sobreposição.
2. **Exige minha intervenção:** os itens Intervir, cada um com descrição, módulo, responsável, prazo, **motivos**, situação,
   ação recomendada e "Abrir".
   - A ação recomendada só aparece quando a regra a define:
     - aguardando gestor → "Decidir";
     - precisa distribuir → "Atribuir";
     - bloqueio → "Ver bloqueio";
     - atraso → "Cobrar andamento".
3. **Acompanhamento da equipe:** por pessoa, mostra área, abertas, atrasadas, vencem hoje, bloqueadas e última
   movimentação.
   - Fica em ordem alfabética, sem ranking, nota ou rótulo de produtividade.
   - Ao clicar, abre a fila filtrada pela pessoa.
   - Só conta pendências que quem consulta pode ver.
4. **Fila consolidada:** `Table` de `components/ui/table.tsx` com título, módulo, área, responsável, prazo, prioridade,
   situação, destaque, origem e última movimentação.
   - Paginação no servidor (50 por página), busca por texto e os filtros do cabeçalho.
   - A classificação e o filtro do componente valem dentro da página.
5. **Detalhe da pendência** (painel lateral `Sheet`):
   - os dados e os motivos do destaque;
   - "Abrir no módulo" (link interno da origem);
   - as ações permitidas ao usuário: iniciar, concluir, bloquear/desbloquear, pedir decisão/decidir, atribuir, alterar
     prazo e prioridade, ajustar destaque, cancelar;
   - comentários, anexos (regra do módulo) e histórico.
6. **Estados:** carregando, vazio ("Nenhuma pendência em aberto…"), erro, mensagens de sucesso e falha. Cancelar e
   ajustar destaque pedem confirmação.

**`/gestao/sugestoes`**
- Lista com filtros de situação, área e módulo.
- Botão "Sugerir melhoria".
- Detalhe com as ações de avaliação para Alan e Rodrigo.
- O botão "Sugerir melhoria" também fica disponível nos módulos (componente único, que recebe área e módulo).

A Fila do dia atual continua no Recebíveis, sem mudanças.

## 8. Dados

Migrations do núcleo: `0092_nucleo_central_gestao.sql` (Fase 2), `0093_nucleo_central_acoes.sql` (Fase 3),
`0094_nucleo_atividades.sql` (Fase 3B), `0095_nucleo_central_criticidade.sql` (Fase 4), `0096_nucleo_sugestoes.sql`
(Fase 5), `0097_nucleo_central_publicacao.sql` (Fase 6), `0098_nucleo_notificacoes.sql` (Fase 7) e
`0099_nucleo_central_revisao.sql` (Fase 8, correções da revisão de segurança).
Na Fase 6, `0180_fin_pendencias_cobranca.sql` (Financeiro) e `0206_fis_pendencias.sql` (Fiscal). O Fiscal ganha uma migration na faixa 0200 (Fase 6).

**`pendencias`: colunas novas (nada é removido nem renomeado)**

| Coluna | Tipo | Uso |
| --- | --- | --- |
| `origem` | text `modulo`/`manual`, padrão `modulo` | a tela grava `manual` |
| `criado_por` | uuid | carimbado pelo banco (`auth.uid()`; nulo quando a origem é de serviço) |
| `categoria` | text com `check` | seção 5.7 |
| `movimentado_em` | timestamptz | seção 5.7. Para as linhas atuais, `coalesce(concluido_em, criado_em)` |
| `bloqueada_em`, `bloqueada_por`, `bloqueio_motivo`, `bloqueio_dependencia_id` | — | bloqueio |
| `aguarda_gestor_em`, `aguarda_gestor_por`, `aguarda_gestor_motivo` | — | decisão pedida |
| `precisa_distribuir` | boolean, padrão false | seção 5.5 |
| `impacto` (`financeiro`/`fiscal`/`operacional`), `impacto_fundamento` | — | `check`: impacto exige fundamento |
| `destaque_manual` (`intervir`/`acompanhar`/`normal`), `destaque_motivo`, `destaque_por`, `destaque_em` | — | ajuste manual |
| `chave_origem` | text | índice único (`modulo`, `chave_origem`) entre as abertas |

**Funções do núcleo**
- `pendencia_destaque()`: o cálculo da seção 5.3.
- `central_pendencias(visao, filtros)`, `central_resumo`, `central_equipe` e `central_por_area`: leitura da Central, sujeita à RLS.
- `pendencia_comentar()`, `pendencia_historico()`.
- `publicar_pendencia()`, `encerrar_pendencia()` e `encerrar_pendencias_exceto()` (só rotinas do sistema).

**Outras tabelas**
- Módulo `administrativo.gestao` ("Tarefas gerais"), cadastrado como inativo para não criar um item vazio no menu.
- `sugestoes` (Fase 5): número, título, área, módulo, problema, como é hoje, melhoria, resultado esperado, situação,
  prioridade, justificativa, avaliada por/em, pendência ligada, autor, criada em.
  - Sem exclusão; com auditoria.
  - A leitura parcial é feita por uma função que devolve só as colunas públicas.
- `atividades` e `acessos` (Fase 3B, seção 5.9).
  - Índices por pessoa + data e por módulo + data.
  - Índice novo em `auditoria (usuario_id, em)` para o conversor do histórico.
  - Coluna nova `perfis.acompanha_equipe`.
- `notificacoes` (Fase 7).

**Auditoria:** o gatilho `fn_auditoria` que já existe em `pendencias` e um novo em `sugestoes`. O histórico na tela lê a
`auditoria` por uma função que confere o acesso à pendência e mostra só os campos relevantes. As reescritas da
sincronização são omitidas.

## 9. Permissões
| Ação | Quem | Onde é garantido |
| --- | --- | --- |
| Ver a pendência | `consulta` na área do módulo (atual) **ou** ser o responsável **ou** quem criou | RLS |
| Criar | operador do módulo | RLS + gatilho |
| Atribuir a terceiros, editar dados, reabrir, ajustar destaque, marcar "precisa distribuir", desligar "aguardando gestor" | gestor da área (Alan e Rodrigo em todas) | gatilho |
| Iniciar, concluir, bloquear, pedir decisão | responsável ou gestor | gatilho |
| Cancelar tarefa manual | gestor ou quem criou, com motivo | gatilho |
| Comentar | operador da área, o responsável ou quem criou (nível consulta só lê) | função `pendencia_comentar` (`security definer`, confere antes) |
| Iniciar, concluir, bloquear, pedir decisão sendo responsável **fora da área** | o responsável | política `pendencias_alterar_proprias` + gatilho |
| Ver o histórico | quem vê a pendência | função `security definer` |
| Mudar a pendência de módulo | gestor nos dois módulos | gatilho `fn_pendencias_guarda` (0099) |
| Ser escolhido como responsável de pendência de módulo | quem tem a área como operador ou acima (Tarefas gerais: qualquer pessoa ativa); rotinas de serviço (ex.: líder no ponto) ficam livres | gatilho `fn_pendencias_guarda` |
| Gravar `chave_origem` | só as rotinas do módulo (`publicar_pendencia`); a da pessoa é descartada | gatilho `fn_pendencias_guarda` |
| Marcar "Enviar ao ClickUp" e escolher onde a pendência aparece (`modulo_exibicao`) | gestor da área | gatilhos (0098 e 0099) |
| Tratar a pendência "Avaliar sugestão" | avaliadores | gatilho `fn_pendencias_guarda` |
| Anexos | regra do módulo (atual) | RLS + Storage |
| Enviar sugestão | qualquer usuário ativo com alguma área | RLS |
| Ver sugestão completa | autor e avaliadores | RLS |
| Avaliar sugestão | `admin_geral` ou gestor do Administrativo | gatilho |
| Parâmetros | `admin_geral` | RLS atual de `configuracoes` |
| Ver atividades e acessos dos outros | quem tem `perfis.acompanha_equipe` (Alan e Rodrigo) | RLS |
| Ver as próprias atividades e acessos | o próprio usuário | RLS |
| Ligar `acompanha_equipe` | `admin_geral` | RLS atual de `perfis` |
| Gravar atividades e acessos | só as funções do núcleo (`security definer`); ninguém edita nem apaga | RLS + gatilho |

As restrições da unidade Contagem (migrations 0152 e 0158) continuam valendo. Áreas sensíveis (RH, Jurídico) continuam
visíveis só a quem tem a área, mais o responsável de uma tarefa atribuída.

## 10. Testes de aceitação
**Regras (PGlite, migrations reais)**
- atrasada, vence hoje, prazo próximo e sem prazo, na virada do dia em Cuiabá;
- cada regra do destaque, com o nível, o motivo e o ajuste manual;
- os indicadores sem dupla contagem;
- "precisa distribuir" conforme a seção 5.5;
- `movimentado_em` não muda com a reescrita da sincronização;
- bloqueio não altera o status e não duplica pendência publicada.

**Permissões**
- operador não atribui a terceiros, nem por chamada direta à API;
- gestor de outra área não reatribui;
- quem não tem a área não lê a pendência, mas o responsável lê a tarefa atribuída a ele;
- operador não ajusta destaque nem desliga "aguardando gestor";
- não avaliador não avalia sugestão; não autor não lê o conteúdo completo;
- nada é apagado;
- funcionário não vê atividades nem acessos de outra pessoa;
- gestor de área sem `acompanha_equipe` também não vê;
- ninguém altera nem apaga atividade.

**Atividades**
- cada ação do catálogo inicial gera uma única atividade, com o autor certo, inclusive quando executada por função automática
  a pedido de alguém;
- a sincronização não gera atividade;
- o conversor do histórico é idempotente: rodar duas vezes não duplica;
- o acesso é agrupado na janela de 30 minutos;
- a retenção apaga só acessos com mais de 12 meses;
- com `registrar_acessos` desligado, nada é gravado.

**Integração**
- `publicar_pendencia` repetida atualiza e não duplica; a troca de título não duplica;
- `encerrar_pendencias` não toca em tarefa manual;
- obrigação fiscal transmitida encerra a pendência;
- **regressão:** toda a suíte existente (Recebíveis, Cobrança, Contas a pagar, Cartão, RH, Fiscal, núcleo).

**Interface (Playwright)**
- abrir a Central, clicar num indicador, filtrar, abrir o detalhe;
- criar e atribuir uma tarefa, iniciar, bloquear e concluir;
- enviar uma sugestão e avaliá-la como avaliador.

O teste de interface com login exige o banco local (`scripts/local-sem-docker`); se ele não puder rodar no ambiente, isso
será informado.

## 11. Limitações da v1
- Sem recorrência de tarefas manuais e sem dias úteis (falta calendário de feriados).
- Cobrança agrupada por regra de exibição; o código de módulo das pendências continua `financeiro.recebiveis`.
- Sem pendências de notas fiscais (não há módulo de entradas) e sem "divergência de pagamento" (não existe dado).
- Slack e ClickUp dependem de configuração (seção 6). A integração só é considerada concluída depois de configurada e
  validada.
- Os publicadores antigos com deduplicação só pelo título (vale-transporte, folha, banco de horas) continuam como estão.
- **Atividades:**
  - as ações anteriores à Fase 3B feitas por função automática podem aparecer como "autor não registrado";
  - a justificativa de ponto pelo link público fica atribuída ao nome digitado, não a uma conta;
  - os acessos só existem a partir do dia em que o registro for ligado.

## 12. Pontos em aberto
Resolvidos: o alerta fiscal de 10 dias (aprovado em 23/10/2026) e o campo do usuário do Slack no perfil (Fase 7).

1. **Aprovar os limites** da seção 5.6 (3 / 5 / 2 / 5 dias), na página `/gestao/regras`.
2. **Rodrigo:** confirmar o e-mail dele (`@neoformas.com.br`) e se o perfil já existe. As permissões são dadas por você
   em Configurações > Usuários. Nenhum dado real é alterado por mim.
3. **Fechamentos sem pendência** (Comissões, Competência fiscal): publicar na Central? Com que prazo? Recomendo deixar
   para depois da v1.
4. **Anexos em sugestões** (por exemplo, captura de tela): exigem uma regra de Storage própria, porque o autor pode não
   ter acesso ao módulo. Recomendo a v2.
5. **Slack:** canal do resumo diário e como ligar cada pessoa ao usuário do Slack (campo no perfil, preenchido pelo admin).
6. **ClickUp:** token de API e a lista de destino das tarefas de melhoria.
7. **Comunicado à equipe** sobre o registro de atividades e acessos, antes de ligar `registrar_acessos`. Texto a validar com o
   jurídico ou o RH.
8. **Justificativa de ponto:** manter o link público sem login (como hoje) ou exigir login do líder para atribuir a uma conta?
   Recomendo manter e registrar o nome digitado.
9. **Aelso e Karina:** confirmar que já têm usuário com as áreas Fiscal e Financeiro.

## 13. Fases
| Fase | Entrega |
| --- | --- |
| 1 | Esta especificação |
| 2 | Migration 0092 + tela de leitura (indicadores, "Exige minha intervenção", equipe, fila consolidada) |
| 3 | Criar e distribuir tarefas, situação, bloqueio, decisão do gestor, comentários, histórico |
| 3B | Atividades e acessos (seção 5.9): migration 0094, catálogo inicial, autoria nas funções automáticas, conversor do histórico, aba "Atividades da equipe" |
| 4 | Destaque gerencial configurável e ajuste manual |
| 5 | Sugestões de melhoria |
| 6 | Contrato de publicação + Fiscal (obrigações e divergências); grupo Cobrança |
| 7 | Notificações, Slack e ClickUp |
| 8 | Testes de interface, regressão final, documentação |

Cada fase começa com um plano curto e termina com o relatório; a seguinte só começa com aprovação.

## 14. Entregas

### Fase 2 (22/10/2026): base no banco e tela de leitura
| Item | Onde |
| --- | --- |
| Colunas, regras do gatilho, leitura pelo responsável, módulo "Tarefas gerais", parâmetros, destaque e funções da Central | `supabase/migrations/0092_nucleo_central_gestao.sql` |
| Textos dos motivos, ação recomendada, leitura e validação dos filtros da URL | `lib/nucleo/gestao/destaque.ts`, `lib/nucleo/gestao/filtros.ts` |
| Tela `/gestao` (indicadores, "Exige minha intervenção", equipe, fila paginada com filtros) e detalhe `/gestao/<id>` | `app/(plataforma)/gestao/` |
| Item "Central" no trilho (todos com alguma área, menos o restrito à unidade) | `components/plataforma/casca.tsx`, `app/(plataforma)/layout.tsx` |
| Testes de banco (regras, permissões, destaque, indicadores, equipe, preenchimento das linhas antigas) | `tests/db/central-gestao.test.ts` |
| Testes de interface com banco local e dados fictícios | `e2e/central-gestao.spec.ts`, `playwright.central.config.ts`, `scripts/local-sem-docker/central-demo.sh` |

**Decisões tomadas na construção**
- **Numeração:** a migration é a `0092`, a próxima livre da faixa do núcleo depois da `0091`, e não a `0008`.
- **Fonte única do cálculo:** o destaque é calculado em SQL (`pendencia_destaque`). A tela só monta as frases.
  Indicador, lista e detalhe sempre concordam.
- **`movimentado_em` das linhas existentes:** recebe a data de conclusão ou de criação. O preenchimento roda com a
  auditoria desligada só nesse comando, para não gravar milhares de linhas técnicas. Daqui para frente, só ação humana
  atualiza.
- **Visão "Gestão":** mostra as pendências dos módulos em que a pessoa é gestora, mais as atribuídas a ela. Quem não é
  gestor fica sempre em "Minhas pendências".
- **Ações:** nenhuma nesta fase. A pendência é tratada na tela do módulo ("Abrir no módulo"). Criar, atribuir, bloquear,
  pedir decisão e concluir pela Central entram na Fase 3, que vai usar os campos e as regras já gravados no banco pela
  0092.

**Como testar localmente (sem dados reais)**
```
sudo bash scripts/local-sem-docker/iniciar.sh         # Supabase local; anote a chave anon para o .env.local
sudo bash scripts/local-sem-docker/central-demo.sh    # usuários *.teste@neoformas.com.br e pendências [DEMO]
npm run dev                                           # entrar com gestor.teste@neoformas.com.br / Teste-local-123 e abrir /gestao
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium npx playwright test -c playwright.central.config.ts
```

**Publicação (só Alan):** aplicar a `0092` em produção e registrá-la em `supabase_migrations.schema_migrations`
(`docs/PUBLICACAO.md`, seção 2). Ela não depende de nenhuma Edge Function.

### Fase 3 (22/10/2026): criação, distribuição e andamento
| Item | Onde |
| --- | --- |
| Responsável fora da área atualiza a própria pendência; título obrigatório nas manuais; índices do histórico | `supabase/migrations/0093_nucleo_central_acoes.sql` |
| `pendencia_criar`, `pendencia_acao` (15 ações), `pendencia_comentar`, `pendencia_historico` | idem |
| Ações de servidor (validação com zod; quem pode é decidido no banco) | `app/(plataforma)/gestao/acoes.ts` |
| Nova tarefa, ações do detalhe, comentários e histórico | `app/(plataforma)/gestao/formularios.tsx`, `app/(plataforma)/gestao/[id]/page.tsx` |
| Frases do histórico | `lib/nucleo/gestao/historico.ts` |
| Testes | `tests/db/central-acoes.test.ts` (16), `lib/nucleo/gestao/historico.test.ts`, `e2e/central-gestao.spec.ts` (3 fluxos novos) |

**Ações disponíveis** (`pendencia_acao`): iniciar, voltar para aberta, concluir (observação opcional), cancelar (motivo
obrigatório), reabrir (gestor), assumir, atribuir (gestor), alterar dados (gestor), bloquear (motivo; dependência
opcional), desbloquear, pedir decisão (responsável), responder decisão (gestor; a resposta vai para o histórico),
ajustar destaque (gestor, com motivo), cobrar andamento (gestor; fica no histórico) e comentar.

**Decisões tomadas na construção**
- **Uma transação por ação:** a alteração e o comentário que a justifica (motivo, resposta) gravam juntos ou nenhum.
- **Candidatos a responsável:** nas "Tarefas gerais", qualquer pessoa ativa; nos módulos, quem atua na área
  (`usuarios_da_area`). O operador só escolhe "eu" ou "sem responsável".
- **Cancelar pela Central:** só as tarefas manuais. As pendências de módulo continuam encerradas pelo próprio módulo,
  senão a sincronização as recriaria.
- **Prazo de tarefa nova:** não pode ser anterior a hoje. A alteração feita pelo gestor depois aceita qualquer data.
- **Histórico:** reescritas de título e descrição feitas pela sincronização ficam de fora. As mudanças de situação feitas
  pelas rotinas aparecem como "Sistema".

**Ainda não entra:** anexos na pendência pela Central (seguem nas telas dos módulos) e recorrência de tarefas manuais.

**Publicação (só Alan):** aplicar a `0093` depois da `0092` e registrar as duas em `schema_migrations`.

### Fase 3B (22/10/2026): atividades e acessos da equipe
| Item | Onde |
| --- | --- |
| Tabelas `atividade_regras`, `atividades`, `acessos`; `perfis.acompanha_equipe`; classificação, reprocessamento, registro e retenção de acessos; relatórios | `supabase/migrations/0094_nucleo_atividades.sql` |
| Catálogo: 27 regras do Financeiro (Recebíveis, Cobrança, Filial, Contas a pagar, Cartão, AKF), 12 do Fiscal, 23 do RH (folha, VT, ponto, banco de horas), 2 do Comercial e 8 do núcleo (pendências e tarefas) | `0179_fin_atividades.sql`, `0205_fis_atividades.sql`, `0522_rh_atividades.sql`, `0704_com_atividades.sql` |
| Registro de acessos a cada navegação (no servidor, depois da resposta) | `proxy.ts` |
| Tela `/gestao/atividades` (resumo por pessoa, linha do tempo, "quem mais atuou" num registro, exportação Excel) | `app/(plataforma)/gestao/atividades/` |
| Marca "Acompanha a equipe" | Configurações > Usuários > Permissões |
| Testes | `tests/db/central-atividades.test.ts` (17, inclui a conferência de todas as regras contra o banco), `lib/nucleo/gestao/atividades.test.ts`, `e2e/central-gestao.spec.ts` (4 fluxos) |

**Fica sem autor no sistema (limitações conhecidas)**
- Justificativa do ponto pelo link público: é anônima; só o nome digitado fica no lote.
- Fatura do cartão marcada como paga pela sincronização do Contas a pagar: é automática, não é ação de pessoa.
- Gravações anteriores a esta fase feitas por Edge Function que não gravava a coluna `_por`.

**Publicação (só Alan), nesta ordem**
1. Aplicar `0094`, `0179`, `0205`, `0522` e `0704` e registrá-las em `schema_migrations` (`docs/PUBLICACAO.md`).
2. Rodar uma vez `select atividades_reprocessar();`, que monta o histórico a partir da auditoria. Pode demorar alguns
   minutos, conforme o tamanho da auditoria.
3. Publicar o código. Ele lê `perfis.acompanha_equipe`: publicar antes da migration quebra a tela de usuários e a de
   atividades.
4. Marcar "Acompanha a equipe" para o Rodrigo em Configurações > Usuários.
5. **Só depois de comunicar a equipe**, ligar o registro de acessos na própria tela de atividades (botão do
   administrador).

### Fase 4 (23/10/2026): criticidade e priorização
| Item | Onde |
| --- | --- |
| Regra `IMPACTO_SEM_PRAZO` (avaliar); impacto com fundamento em "alterar" (gestor); `central_salvar_parametros` (admin, faixas validadas, aprovação registrada); `central_por_area` | `supabase/migrations/0095_nucleo_central_criticidade.sql` |
| Página "Como a Central classifica": regras, níveis e limites em vigor; o admin revisa e aprova | `app/(plataforma)/gestao/regras/` |
| Bloco "Áreas e módulos que precisam de atenção" na Central (visão Gestão) | `app/(plataforma)/gestao/componentes.tsx` |
| Campo de impacto e fundamento em "Alterar dados" | `app/(plataforma)/gestao/formularios.tsx` |
| Testes | `tests/db/central-criticidade.test.ts` (4), `lib/nucleo/gestao/destaque.test.ts`, `e2e/central-gestao.spec.ts` (2 fluxos) |

**Limites:**
- **Faixas aceitas:** prazo próximo 0–30, atraso relevante 1–90, bloqueio relevante 0–30, sem movimentação 1–90 dias.
- **Aprovação:** fica gravada em `administrativo.gestao.limites_aprovados` (quem, quando e os valores) e aparece na página.
  Enquanto não houver aprovação, a página informa que os valores são os propostos.

**Publicação (só Alan):** aplicar a `0095` depois da `0094` e registrá-la em `schema_migrations`. Depois, revisar e
aprovar os limites em Central de Gestão > "Como a Central classifica".

### Fase 5 (23/10/2026): sugestões de melhoria
| Item | Onde |
| --- | --- |
| Tabelas `sugestoes` e `sugestoes_comentarios`; regras de situação e de conteúdo; RLS; lista pública; histórico; tarefa de implementação; pendência "Avaliar sugestão"; regras de atividade | `supabase/migrations/0096_nucleo_sugestoes.sql` |
| Botão "Sugerir melhoria" na barra de navegação de todas as telas (área e módulo da tela já preenchidos) | `components/plataforma/sugerir-melhoria.tsx`, `components/plataforma/casca.tsx` |
| Lista `/gestao/sugestoes` (filtros por situação e "só as minhas") e detalhe `/gestao/sugestoes/<id>` (avaliar, comentar, criar tarefa) | `app/(plataforma)/gestao/sugestoes/` |
| Testes | `tests/db/central-sugestoes.test.ts` (11), `lib/nucleo/gestao/sugestoes.test.ts`, `e2e/central-gestao.spec.ts` (3 fluxos) |

**Decisões tomadas na construção**
- **Avaliadores:** `pode_avaliar_sugestoes()`, ou seja, admin geral ou gestor da área Administrativo (Alan e Rodrigo).
- **Comentários em tabela própria:** a leitura de `interacoes` depende do módulo, e o autor pode não ter acesso ao
  módulo da sugestão.
- **Autor carimbado pelo banco:** um autor informado por outra pessoa é trocado por quem está logado.
- **Correção pelo autor:** ele corrige o conteúdo só enquanto a sugestão está "nova"; depois, só por comentário.
- **Justificativa:** obrigatória para aprovar e para não aprovar. Fica pública, na lista, depois da decisão.
- **Na Central:** a sugestão nova abre "Avaliar sugestão nº N" em Tarefas gerais (`chave_origem = sugestao:<id>`). Fica
  em andamento durante a avaliação e é concluída com a decisão.
- **Tarefa de implementação:** pendência manual em Tarefas gerais, ligada à sugestão, uma aberta por vez. Aprovar não
  muda o sistema: a melhoria segue o fluxo de especificação.
- **Fora da v1:** anexos em sugestões (ponto em aberto 4).

**Publicação (só Alan):** aplicar a `0096` depois da `0095` e registrá-la em `schema_migrations`.

### Fase 6 (23/10/2026): integração com os módulos prioritários
| Item | Onde |
| --- | --- |
| Contrato: `publicar_pendencia`, `encerrar_pendencia`, `encerrar_pendencias_exceto`; coluna `modulo_exibicao`; prioridade alta sem prazo pede avaliação também nas pendências de módulo | `supabase/migrations/0097_nucleo_central_publicacao.sql` |
| Fiscal: obrigações a vencer (janela `fiscal.creditos.dias_alerta_obrigacao` = 10 dias, aprovado em 23/10/2026), vencimento a confirmar, divergências sem tarefa; rotina diária e carga inicial | `supabase/migrations/0206_fis_pendencias.sql` |
| Financeiro: pendências de cobrança do Recebíveis exibidas no módulo Cobrança | `supabase/migrations/0180_fin_pendencias_cobranca.sql` |
| Testes | `tests/db/central-publicacao.test.ts` (12), `e2e/central-gestao.spec.ts` (2 fluxos) |

**Contrato de publicação (como um módulo adota)**
- **Publicar:** a função SQL do módulo, `security definer`, chama `publicar_pendencia` com `modulo`, `chave_origem` estável
  (ex.: `obrigacao:<id>`), `titulo` e os campos opcionais.
  - Publicar de novo atualiza a pendência aberta, sem duplicar.
  - O responsável escolhido por uma pessoa é mantido.
- **Encerrar:** `encerrar_pendencia` com `concluida` quando a ação foi feita e `cancelada` quando deixou de valer.
  `encerrar_pendencias_exceto` serve para rotinas que recalculam a lista inteira.
- **Age como o sistema:** a publicação não conta como ação da pessoa que disparou a rotina. Por isso só a service role
  e as funções dos módulos executam essas funções; usuário logado não executa.
- **Falha isolada:** uma falha na publicação vira aviso no log do banco e não derruba a gravação do módulo. Por isso cada
  publicador precisa de teste de banco: foi o teste que revelou um erro de tipo que o aviso teria escondido.

**Fechamentos e encerramentos (levantamento, sem rotina nova)**

| Processo | Na Central |
| --- | --- |
| Fatura do cartão | Já publica ("Importar", "Conciliar", "Fechar") |
| Folha | Já publica |
| Vale-transporte | Já publica |
| Banco de horas | Já publica |
| Competência fiscal | Não publica (decisão pendente, ponto em aberto 3) |
| Comissões | Não publica (decisão pendente, ponto em aberto 3) |

**Ficam como limitação:** notas fiscais a conferir ou lançar (não há módulo de entradas), divergência de pagamento e
cobrança bloqueada no Recebíveis (não existem como dado).

**Publicação (só Alan):**
1. Aplicar `0097`, `0180` e `0206`, nesta ordem e depois da `0096`, e registrar em `schema_migrations`.
2. A `0206` depende das migrations do Fiscal Control (`0200` a `0205`) e roda a carga inicial das pendências fiscais.

### Fase 7 (23/10/2026): avisos pelo Slack e ClickUp (preparados; envio real depende de configuração)
| Item | Onde |
| --- | --- |
| Fila `notificacoes`, eventos, interruptores (tudo desligado), lembretes de prazo e atraso, resumo diário, `perfis.slack_usuario_id`, `pendencias.clickup_enviar`, rotina a cada 15 min | `supabase/migrations/0098_nucleo_notificacoes.sql` |
| Envio pelo Slack (`chat.postMessage`, até 3 tentativas, motivo registrado) | `supabase/functions/nucleo-notificacoes-enviar/` |
| Criação de tarefas no ClickUp (só ida, vínculo em `clickup_task_id`) | `supabase/functions/nucleo-clickup-enviar/` |
| Regras puras (destino, texto, tentativas, corpo da tarefa) | `supabase/functions/_shared/notificacoes.ts` |
| Tela "Avisos da Central" (admin), "Enviar ao ClickUp" na pendência (gestor), usuário do Slack em Configurações > Usuários | `app/(plataforma)/gestao/notificacoes/`, `app/(plataforma)/gestao/[id]/page.tsx`, `app/(plataforma)/configuracoes/usuarios/` |
| Testes | `tests/db/central-notificacoes.test.ts` (10), `lib/nucleo/gestao/notificacoes.test.ts`, `e2e/central-gestao.spec.ts` (2 fluxos) |

**Regras de envio**
- **Interruptores:** nada sai sem o interruptor geral ligado e sem o evento ligado. Os testes nunca enviam.
- **Sem repetição:** cada aviso tem uma chave. A atribuição gera um aviso por atribuição; prazo e atraso, um por prazo
  (mudou o prazo, novo lembrete); o pedido de decisão, um por pedido; o resumo, um por dia.
- **Cobrança firme:** a cobrança ao responsável só sai pelo clique do gestor em "Cobrar andamento", um aviso por clique.
- **Sem destino:** pessoa sem usuário do Slack ou canal não configurado fazem o aviso ficar "ignorado", com o motivo.
  Uma falha é tentada de novo até 3 vezes e registrada.
- **ClickUp:** vão só as pendências marcadas pelo gestor e as tarefas de implementação de sugestões. Mudança no ClickUp
  não altera nem encerra a pendência.

**Implementado, mas não testado de verdade:** as duas Edge Functions (Slack e ClickUp). O código foi escrito no padrão de
`cap-enviar-slack`; as regras delas estão testadas, mas o envio real só pode ser validado com as credenciais.

**Configuração pendente (só Alan)**
1. Aplicar a `0098` depois da `0206` e registrá-la.
2. Publicar as funções:
   ```
   npx supabase functions deploy nucleo-notificacoes-enviar --project-ref chdszjpbtfpstjrqnmmm
   npx supabase functions deploy nucleo-clickup-enviar --project-ref chdszjpbtfpstjrqnmmm
   ```
3. Gravar os segredos com `node scripts/gravar-segredo.mjs NOME --ref chdszjpbtfpstjrqnmmm`:
   - `NOTIFICACOES_SEGREDO` (32+ caracteres);
   - `CLICKUP_TOKEN`, se for usar o ClickUp.

   O `SLACK_BOT_TOKEN` já existe (Contas a pagar). Para mensagens diretas, o aplicativo do Slack precisa do escopo
   `chat:write` e poder conversar com as pessoas.
4. No Vault do banco, gravar:
   - `notificacoes_url` (URL da função `nucleo-notificacoes-enviar`);
   - `notificacoes_segredo` (o mesmo valor do segredo);
   - `clickup_url`, se for usar o ClickUp.
5. Em Configurações > Usuários, preencher o usuário do Slack de cada pessoa.
6. Em Central de Gestão > Avisos, informar o canal e a lista, ligar os eventos desejados e, por último, o envio.
   Validar com "Gerar lembretes e enviar agora".

### Fase 8 (23/10/2026): revisão final, testes e roteiro de publicação
**Revisão de segurança.** Uma revisão independente das migrations 0092 a 0098, das telas e das Edge Functions encontrou
10 pontos. Cada correção tem um teste que falha sem ela (`tests/db/central-revisao.test.ts`, 12 testes; 10 falham sem a 0099).

| # | Problema | Correção |
| --- | --- | --- |
| 1 | O responsável que é gestor de outra área mudava a pendência para o módulo dele e passava a alterar tudo | Mudar de módulo exige ser gestor nos dois (0099) |
| 2 | Operador gravava `chave_origem` numa pendência manual e travava a publicação do módulo (ex.: alerta de obrigação fiscal) | A chave da pessoa é descartada; só `publicar_pendencia` grava (0099) |
| 3 | A pendência "Avaliar sugestão" copiava o texto da sugestão, visível a quem lê o Administrativo | Sem o texto; só os avaliadores tratam a pendência (0099; as já criadas foram limpas) |
| 4 | O autor gravava "avaliada por" na própria sugestão | Campo mantido pelo banco (0099) |
| 5 | Gestor atribuía, por chamada direta, pendência de módulo a quem não tem a área (inclusive RH e Jurídico) | O responsável precisa ter a área, como operador ou acima (0099) |
| 6 | Operador marcava "Enviar ao ClickUp" na inclusão e mudava onde a pendência aparece | Só o gestor (0099) |
| 7 | Texto digitado ia cru ao Slack (menção `<!channel>`, link falso); pedido de decisão de RH/Jurídico mostrava título e motivo no canal | Texto escapado; área sensível vai ao canal só com a área e o link (0099 e `_shared/notificacoes.ts`) |
| 8 | Envio agendado e "Enviar agora" ao mesmo tempo mandavam o mesmo aviso; falha ao gravar o vínculo do ClickUp gerava tarefa duplicada | Reserva do lote (`central_reservar_avisos`, situação "enviando", volta à fila após 10 min); o ClickUp para o lote e avisa |
| 9 | Publicar de novo apagava impacto, categoria e "precisa distribuir" registrados pelo gestor | Só mudam quando o módulo informa o campo (0099) |
| 10 | O registro de acessos guardava a busca da tela (podia ter nome, CPF ou CNPJ) e aceitava chamadas sem limite | Só o caminho da tela; até 60 registros por minuto por pessoa (0099 e `proxy.ts`) |

Conferido e correto: funções `security definer` com `search_path` fixo; funções do sistema sem permissão para usuário
logado; RLS em todas as tabelas novas; nada para `anon`; sem SQL dinâmico; registros de prova sem exclusão; as Edge
Functions conferem o segredo (comparação de tempo constante) ou o admin logado; a exportação respeita a RLS.

**Também corrigido:** dois testes antigos (`akf-solicitacao` e `entrada-esteira`) falhavam entre 20h e 24h de Cuiabá porque
usavam a data UTC. Passaram a usar a data de Cuiabá, como as regras do sistema. O código do sistema não mudou.

**Resultado dos testes (23/10/2026)**
| Bateria | Resultado |
| --- | --- |
| `npm run verificar` (tipos, lint, 1702 testes) | 1701 passaram, 1 pulado, nenhuma falha |
| Banco da Central (`tests/db/central-*.test.ts`, 8 arquivos) | 111 passaram |
| Interface da Central (`playwright.central.config.ts`, banco local) | 20 passaram |
| Interface, rotas sem login (`playwright.config.ts`) | 15 passaram |

**Não validado de verdade:** o envio pelo Slack e pelo ClickUp (faltam as credenciais). O teste de interface do Fiscal
Control não rodou neste ambiente: os usuários de teste do Fiscal não estavam no banco local.

**Roteiro único de publicação (só Alan; nada disto foi feito por mim)**
Pré-requisito: as migrations do Fiscal Control (`0200` a `0204`) já aplicadas e registradas, porque a `0206` depende delas.

1. **Cópia de segurança antes:** `node scripts/banco-copia.mjs exportar --ref chdszjpbtfpstjrqnmmm`.
2. **Migrations, nesta ordem**, cada uma seguida do registro em `schema_migrations` (`docs/PUBLICACAO.md`, seção 2). Em
   PowerShell, parando no primeiro erro:
   ```powershell
   $ref = "chdszjpbtfpstjrqnmmm"
   $lista = "0092_nucleo_central_gestao","0093_nucleo_central_acoes","0094_nucleo_atividades","0179_fin_atividades",
            "0205_fis_atividades","0522_rh_atividades","0704_com_atividades","0095_nucleo_central_criticidade",
            "0096_nucleo_sugestoes","0097_nucleo_central_publicacao","0180_fin_pendencias_cobranca","0206_fis_pendencias",
            "0098_nucleo_notificacoes","0099_nucleo_central_revisao"
   foreach ($m in $lista) {
     $v, $n = $m -split "_", 2
     npx supabase db query --linked --project-ref $ref --agent no -f "supabase/migrations/$m.sql"
     if ($LASTEXITCODE -ne 0) { Write-Host "ERRO em $m. Pare aqui e envie a mensagem completa."; break }
     npx supabase db query --linked --project-ref $ref --agent no "insert into supabase_migrations.schema_migrations (version, name) values ('$v','$n') on conflict do nothing"
   }
   ```
3. **Histórico de atividades:** uma vez, `select atividades_reprocessar();`.
4. **Publicar o código** (só depois das migrations: as telas leem as colunas novas).
5. **Na aplicação:**
   - aprovar os limites em `/gestao/regras`;
   - marcar Rodrigo como gestor em todas as áreas e "Acompanha a equipe" (Configurações › Usuários).
6. **Registro de acessos:** comunicar a equipe (texto a validar com o jurídico ou o RH) e só então ligar
   `administrativo.gestao.registrar_acessos`.
7. **Slack e ClickUp (opcional):** seguir a lista "Configuração pendente" da Fase 7. Ligar primeiro um evento só, com o
   próprio usuário, e conferir antes de ligar os demais.

**Conferência depois de publicar**
- `/gestao` abre para Alan e Rodrigo com todas as áreas, e para um operador só com a área dele.
- Uma tarefa de teste em "Tarefas gerais": criar, atribuir, concluir e ver o histórico.
- `select count(*) from pendencias where chave_origem like 'obrigacao%';` mostra as obrigações fiscais na janela de 10 dias.
- `select status, count(*) from notificacoes group by 1;` fica vazio enquanto os avisos estiverem desligados.

