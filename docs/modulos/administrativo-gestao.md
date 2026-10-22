# Módulo: Administrativo geral / Central de Gestão (`administrativo.gestao`)

Status: rascunho (Fase 1, 22/10/2026), aguardando aprovação de Alan Torres. Nada foi construído.

Decisões já tomadas por Alan (22/10/2026):
- **Alan e Rodrigo veem tudo.** Alan é `admin_geral`. Rodrigo será **gestor em todas as áreas** pelo cadastro de permissões
  que já existe (Configurações > Usuários), sem administrar usuários e configurações. Os demais veem só a própria área.
- **Quem distribui tarefas** é o gestor da área. É a regra que já vale no banco: Alan e Rodrigo em tudo, cada gestor na
  sua área. O operador só cria para si.
- **"Precisam distribuir"** conta só o que de fato precisa de dono: tarefas manuais sem responsável e as marcadas como
  "precisa distribuir". As pendências automáticas sem dono continuam como fila da área.
- **Sugestões:** todos veem o título e a situação. O conteúdo completo fica para o autor e os avaliadores, que são Alan e
  Rodrigo.

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
| `BLOQUEIO_RELEVANTE` | Bloqueada há mais de `dias_bloqueio_relevante`, **ou** indicada como dependência de outra pendência aberta | Intervir | "Bloqueada há 3 dias: <motivo>" / "Impede: <título>" |
| `PRECISA_DISTRIBUIR` | Precisa distribuir e (prioridade alta/crítica, ou prazo de hoje, atrasado ou próximo) | Intervir | "Sem responsável, prioridade alta, vence em 2 dias" |
| `PRECISA_DISTRIBUIR` | Precisa distribuir nos demais casos | Acompanhar | "Sem responsável" |
| `ATRASO_SIMPLES` | Atrasada, sem cair em `ATRASO_RELEVANTE` | Acompanhar | "Atrasada há 2 dias" |
| `VENCE_HOJE` | Vence hoje | Acompanhar | "Vence hoje" |
| `PRAZO_PROXIMO` | Prazo próximo | Acompanhar | "Vence em 3 dias (25/10/2026)" |
| `BLOQUEADA` | Bloqueada há menos tempo que o limite | Acompanhar | "Bloqueada desde ontem: <motivo>" |
| `SEM_MOVIMENTACAO` | Aberta e sem movimentação humana há mais de `dias_sem_movimentacao` | Acompanhar | "Sem movimentação há 9 dias" |
| `SEM_PRAZO_IMPORTANTE` | Tarefa manual sem prazo e com prioridade alta/crítica | Avaliar | "Prioridade alta sem prazo definido" |
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

### 5.9 Contrato de publicação (para os módulos)
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
- Filtros: área, módulo, responsável, situação, prioridade, destaque, origem e período do prazo (de/até).
- Botões "Nova tarefa" e "Sugestões".

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

Migrations do núcleo: `0008_nucleo_central_gestao.sql` (Fase 2), `0009_nucleo_sugestoes.sql` (Fase 5) e
`0010_nucleo_notificacoes.sql` (Fase 7). O Fiscal ganha uma migration na faixa 0200 (Fase 6).

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
- `central_resumo(filtros)` e `central_lista(filtros, pagina)`: `security invoker`, sujeitas à RLS.
- `pendencia_comentar()`, `pendencia_historico()`.
- `publicar_pendencia()`, `encerrar_pendencias()`.

**Outras tabelas**
- Módulo `administrativo.gestao` ("Tarefas gerais"), cadastrado como inativo para não criar um item vazio no menu.
- `sugestoes` (Fase 5): número, título, área, módulo, problema, como é hoje, melhoria, resultado esperado, situação,
  prioridade, justificativa, avaliada por/em, pendência ligada, autor, criada em.
  - Sem exclusão; com auditoria.
  - A leitura parcial é feita por uma função que devolve só as colunas públicas.
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
| Comentar | quem vê a pendência | função `security definer` com a mesma checagem |
| Ver o histórico | quem vê a pendência | função `security definer` |
| Anexos | regra do módulo (atual) | RLS + Storage |
| Enviar sugestão | qualquer usuário ativo com alguma área | RLS |
| Ver sugestão completa | autor e avaliadores | RLS |
| Avaliar sugestão | `admin_geral` ou gestor do Administrativo | gatilho |
| Parâmetros | `admin_geral` | RLS atual de `configuracoes` |

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
- nada é apagado.

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

## 12. Pontos em aberto
1. **Aprovar os limites** da seção 5.6 (3 / 5 / 2 / 5 dias) e o alerta fiscal de 10 dias.
2. **Rodrigo:** confirmar o e-mail dele (`@neoformas.com.br`) e se o perfil já existe. As permissões são dadas por você
   em Configurações > Usuários. Nenhum dado real é alterado por mim.
3. **Fechamentos sem pendência** (Comissões, Competência fiscal): publicar na Central? Com que prazo? Recomendo deixar
   para depois da v1.
4. **Anexos em sugestões** (por exemplo, captura de tela): exigem uma regra de Storage própria, porque o autor pode não
   ter acesso ao módulo. Recomendo a v2.
5. **Slack:** canal do resumo diário e como ligar cada pessoa ao usuário do Slack (campo no perfil, preenchido pelo admin).
6. **ClickUp:** token de API e a lista de destino das tarefas de melhoria.
