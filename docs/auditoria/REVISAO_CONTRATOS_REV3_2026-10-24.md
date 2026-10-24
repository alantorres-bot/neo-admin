# Revisão técnica de consistência: Contratos / Operações, revisão 3

Data: 24/10/2026 · Objeto: `docs/modulos/contratos-operacoes.md` (revisão 3) e as dependências documentais dele:
- `docs/modulos/administrativo-ged.md` (revisão 2);
- `docs/auditoria/AUDITORIA_CONTRATOS_GED_2026-10-24.md`;
- `docs/modulos/financeiro-recebiveis.md`;
- `docs/modulos/administrativo-gestao.md`.

Escopo: só leitura e documentação. Nada foi implementado; nenhuma migration, dado ou integração foi alterado.

**Classificação dos achados**
- **[B]** bloqueador para implementação: a fase que depende do item não pode ser construída como está escrita;
- **[N]** decisão de negócio pendente;
- **[T]** melhoria técnica;
- **[E]** dependência externa: Fiscal, bancos, Financeiro, Comercial, administrador do Workspace.

**Como ler as propostas**
- Toda proposta deste relatório é **proposta, pendente de aprovação interna**.
- Nenhuma foi tratada como decisão.
- As que entraram na especificação estão marcadas lá como **[R4-Pn]**.

Fatos do repositório usados nesta revisão (verificados):

| Fato | Onde |
|---|---|
| Em `unique`, valores NULL são distintos entre si. O projeto não usa `NULLS NOT DISTINCT` em nenhuma migration. | Postgres; migrations |
| `pendencias_ler` = `tem_acesso_modulo(modulo)`; `pendencias_ler_proprias` = responsável ou quem criou; `modulo_exibicao` não muda a permissão | 0002, 0092, 0097 |
| `atividades_ler` = `pode_ver_atividades(usuario_id)`: cada pessoa vê o que é seu, e quem tem `acompanha_equipe` vê tudo, **sem filtro de área** | 0094 |
| `nivel_area()` devolve `sem_acesso` para o usuário com `unidade_restrita`, de modo que `tem_acesso_area()` já o barra | 0152 |
| `rec_contratos`: `unique (empresa_id, numero)`, sem políticas de RLS | 0100 |
| GED revisão 2, tabela de RLS (§9): `ged_documentos` lido por `tem_acesso_area(raiz.area)`. **A tabela não cita `areas_leitura`**, embora a §5.9.1 cite | `administrativo-ged.md` |
| A especificação do GED não define políticas para `ged_pastas`, `ged_pastas_cliente`, `ged_documento_revisoes`, `ged_indexacoes`, `ged_pastas_raiz` e `ged_alvos` | `administrativo-ged.md` §8–9 |
| Faturamento Filial Contagem (`rec_kits`, `rec_remessas`, 0146–0149, módulo `financeiro.filial`): nota fatura, demonstrativo e implantação pelo POP "Implantação de Faturas de Locação" | `financeiro-recebiveis.md` |

---

## 1. Financiamento: contrato, assinatura, autorização e liberação

| # | Problema | Classe |
|---|---|---|
| F-1 | A D-2 torna o contrato de compra e venda obrigatório, mas a liberação (5.8.2) depende **só** dos itens com `trava_faturamento`. A 5.4.3 exige o item `obter_assinaturas` sem exigir a trava nele. **Resultado possível:** a operação aparece "liberada para faturar" com a autorização validada e **sem contrato assinado**, contrariando a D-2. | **B** |
| F-2 | "Modelo da modalidade ou modelo da variante": não está definido se o modelo da variante **substitui** o da modalidade ou **acrescenta** itens a ele. A validação da 5.4.3 pode ser contornada se a variante substituir o modelo sem os itens obrigatórios. | **B** |
| F-3 | "NF existe com a operação `bloqueada`" (5.8.4) dispara alarme falso em dois casos. (a) A liberação volta a `bloqueada` depois de uma NF emitida corretamente, por exemplo com a autorização substituída. (b) A operação foi cadastrada depois do fato, com NFs antigas. A comparação "emissão anterior à liberação" mistura `data_emissao` (data) com o instante da liberação (`timestamptz`): no mesmo dia, o resultado é ambíguo. | **B** |
| F-4 | Não está definido se a autorização bancária pode ser validada **antes** do contrato assinado. A ordem pode variar por banco. | **N** + **E** (bancos) |
| F-5 | O contrato cancelado ou encerrado depois da liberação não tem efeito definido sobre a liberação. | **T** |
| F-6 | `ctr_modalidades.tipo_contrato_exigido` e a validação do modelo repetem a mesma regra em dois lugares; podem divergir. | **T** |
| F-7 | Assinatura da parte `banco`: não está definido se o banco assina o contrato de compra e venda. Não se deve presumir. | **N** + **E** |

**Regra segura proposta** (R4-P1, pendente de aprovação interna; amplia a D-2):
1. Na modalidade `financiamento`, `ctr_faturamento_liberado` só devolve `liberada` com **as duas** condições:
   - contrato do tipo `venda` em situação `assinado`, com o documento `contrato_assinado` confirmado;
   - autorização bancária `validada`.
   Essa verificação é **fixa na função, para essa modalidade**: não depende de o modelo ter marcado a trava. É uma camada a mais, além
   da validação do modelo.
2. A validação de ativação exige, no financiamento:
   - `obter_assinaturas` e `aguardar_autorizacao_bancaria`, os dois **sem condição** e **com trava**;
   - `obter_assinaturas` não dispensável;
   - `aguardar_autorizacao_bancaria` dispensável só pelo nível do PENDENTE 9, que **começa como "ninguém"** até ser decidido.
3. **Variante = modelo completo** (substitui o da modalidade), e a validação roda em cada modelo. Proposta alternativa: herança. A
   decisão é técnica e de negócio (PENDENTE 20).
4. **Alarme de NF:** compara a data de emissão da NF com a **data local (America/Cuiaba)** da liberação vigente naquela data, pelo
   histórico em `ctr_eventos`:
   - NF de data anterior à 1ª liberação, ou emitida num dia em que não havia liberação vigente: alarme;
   - NF emitida no mesmo dia da liberação: **não** é alarme, mas fica marcada "conferir";
   - NF emitida antes da **data de início do controle** da operação: não gera alarme. Essa data é informada na abertura, para as
     operações cadastradas depois do fato (PENDENTE 21).
5. Contrato cancelado depois da liberação: a liberação volta a `bloqueada` e o evento fica registrado. As NFs já emitidas não geram
   alarme retroativo, porque estavam liberadas na data delas.

**Aprovação interna necessária:** o responsável pelo processo precisa confirmar se a D-2 inclui "o contrato assinado trava o
faturamento". Sem essa confirmação, o item 1 continua proposta. Os bancos precisam informar a ordem contrato × autorização (F-4) e se
o banco assina (F-7).

## 2. PDF da minuta enviada

| # | Problema | Classe |
|---|---|---|
| P-1 | Há só dois estados (`vinculado`, `ausente`). Não se distingue "vinculado no envio" de "regularizado depois", nem existe saída para um PDF que nunca vai existir (ex.: minuta enviada no corpo do e-mail, ou PDF perdido). | **B** |
| P-2 | `regularizar_pdf_minuta` é criada "pelo próprio módulo", mas o motor (5.4.4) só cria obrigações a partir do modelo ou de `informar_condicao`. Falta a regra de origem (sistema), de quem conclui e de como ela fica numa troca de modelo ou modalidade. | **B** |
| P-3 | A conclusão não diz quais PDFs servem: tipo, `mime`, situação no GED, se o mesmo PDF pode servir a duas versões. | **T** |
| P-4 | A especificação não decide se a minuta pode ser marcada `aprovada` antes da regularização. | **N** |
| P-5 | Uma versão `substituida` com o PDF ausente: a pendência continua ou não? | **N** |
| P-6 | "Imutável depois do envio, com uma exceção" precisa ser garantida no banco (gatilho), e não só na tela. | **T** |

**Estados propostos** (`pdf_situacao`, R4-P2, pendente):

| Estado | Significado | Quem registra | Saídas |
|---|---|---|---|
| `vinculado_no_envio` | O PDF enviado foi vinculado ao registrar o envio | operador | — (final) |
| `pendente` | O PDF ainda não está disponível. Motivo obrigatório. A obrigação `regularizar_pdf_minuta` é aberta | operador | `regularizado`, `sem_pdf_justificado` |
| `regularizado` | O PDF foi vinculado depois (uma vez, com data e autor) | operador | — (final) |
| `sem_pdf_justificado` | O envio não teve PDF, ou ele não pode ser recuperado. Justificativa e outra evidência (e-mail, anotação) | **gestor** | — (final) |

Regras propostas:
- **Conclusão de `regularizar_pdf_minuta`:** acontece só pela passagem para `regularizado` ou `sem_pdf_justificado`. Para
  `regularizado`, o documento tem de:
  - estar confirmado no GED como `contrato_minuta` (ou `aditamento`, no caso de aditivo), com `mime` `application/pdf`;
  - estar em situação `vigente`;
  - não estar vinculado como PDF enviado de outra versão.
  A origem da obrigação é `sistema`: não vem do modelo e não é cancelada por troca de modelo ou de modalidade.
- **Aprovação antes da regularização** (decisão necessária, PENDENTE 22). Alternativas:
  - **(a) Bloquear** a aprovação até a regularização. Mais segura, mas atrasa o registro de um fato real.
  - **(b) Recomendada:** permitir registrar a aprovação (é um fato do cliente), com o selo "aprovada — evidência do PDF pendente".
    Nesse caso:
    - `aguardar_aprovacao_cliente` só **conclui** depois da regularização ou da justificativa;
    - o contrato não passa a `em_assinatura` enquanto isso.
  - **(c) Permitir sem restrição:** não recomendada.
- **Versão substituída com PDF pendente:** a obrigação continua, porque registra o que foi enviado ao cliente. Pode ser encerrada só
  por `sem_pdf_justificado` (PENDENTE 22).
- **Garantia no banco:** gatilho em `ctr_minutas` que só aceita, depois de `enviada`:
  - mudança de `situacao` e do retorno;
  - transição `pendente` → `regularizado` | `sem_pdf_justificado`, preenchendo `pdf_documento_id` uma única vez.

## 3. Aditivos: integridade do modelo de dados

| # | Problema | Classe |
|---|---|---|
| A-1 | `ctr_minutas`: `unique (contrato_id, aditivo_id, versao)` **não impede** duas "v1" da minuta do contrato, porque `aditivo_id` é NULL e, no `unique`, NULLs são distintos. O mesmo acontece com "uma `aprovada` por contrato ou aditivo". | **B** |
| A-2 | Nada garante que `ctr_minutas.contrato_id` seja o contrato do aditivo indicado em `aditivo_id`. Falta FK composta. O mesmo vale para `ctr_assinaturas`. | **B** |
| A-3 | "O contrato fica `assinado` quando todas as partes cadastradas estão `assinada`" não filtra `aditivo_id is null`. Uma assinatura pendente de aditivo "desassinaria" o contrato. A aprovação da minuta de aditivo pode concluir `aguardar_aprovacao_cliente` do contrato. A mudança do contrato para `em_negociacao` pode ser disparada por minuta de aditivo. | **B** |
| A-4 | "Um contrato não cancelado por operação" e "no máximo um vigente" são termos diferentes e não têm índice definido. | **B** |
| A-5 | Não está definido se o aditivo exige o contrato original `assinado`, nem o que acontece com aditivos quando o contrato é cancelado ou encerrado. | **N** |
| A-6 | `unique (contrato_id, identificacao)` sem normalização: "1º Aditivo" e "1o aditivo" passam como diferentes. | **T** |
| A-7 | O histórico depende de `fn_auditoria` e de `ctr_eventos`; os campos de identificação do aditivo não são imutáveis depois do envio. | **T** |

**Desenho proposto** (R4-P3, pendente):
- **`ctr_aditivos`:** `unique (id, contrato_id)`, que serve de alvo da FK composta.
- **`ctr_minutas` e `ctr_assinaturas`:**
  - `foreign key (aditivo_id, contrato_id) references ctr_aditivos (id, contrato_id)`. Com `aditivo_id` nulo, a FK não se aplica, o
    que é o comportamento padrão do `MATCH SIMPLE`;
  - `contrato_id` sempre obrigatório.
- **Índices únicos parciais** (portáveis, sem depender de `NULLS NOT DISTINCT`):
  - `ctr_minutas (contrato_id, versao) where aditivo_id is null`;
  - `ctr_minutas (aditivo_id, versao) where aditivo_id is not null`;
  - `ctr_minutas (contrato_id) where aditivo_id is null and situacao = 'aprovada'`;
  - `ctr_minutas (aditivo_id) where aditivo_id is not null and situacao = 'aprovada'`;
  - `ctr_contratos (operacao_id) where situacao <> 'cancelado'`: um contrato não cancelado por operação. O termo "vigente" sai da
    especificação; o encerrado continua contando;
  - `ctr_aditivos (contrato_id, identificacao_normalizada)`, com a identificação normalizada (sem acento, minúscula, espaços
    colapsados).
- **Toda regra que olha minutas ou assinaturas "do contrato"** filtra `aditivo_id is null`: situação do contrato, `obter_assinaturas`,
  `aguardar_aprovacao_cliente`.
- **Os eventos do aditivo** não concluem obrigações da operação (já previsto) e vão para `ctr_eventos` com a referência do aditivo.
- **Proposta para A-5** (PENDENTE 23): o aditivo só pode ser criado com o contrato `assinado`. O contrato `cancelado` ou `encerrado`
  não aceita aditivo novo, e os aditivos em andamento vão para a conferência do gestor; não são cancelados automaticamente.
- **Sem `delete`** e com auditoria em todas as tabelas; `identificacao` e `objeto` imutáveis depois de `enviado`.

## 4. Segurança do GED e da raiz `elaboracao`

Princípio: **ocultar na tela não é controle.** A restrição da D-6 precisa valer nas políticas do banco, nas funções SQL, nas Edge
Functions, nas rotas do Next, na busca, nas sugestões e no acesso direto por id.

| # | Problema | Classe |
|---|---|---|
| G-1 | A restrição depende da **configuração** da raiz: `area` e `areas_leitura` editáveis pelo admin. Nada impede, no desenho, que a raiz `elaboracao` ganhe `areas_leitura = {comercial}`, contrariando a D-6. | **B** |
| G-2 | Tabela de RLS do GED (§9) incompleta: falta `areas_leitura` em `ged_documentos`, e faltam as políticas de `ged_pastas`, `ged_pastas_cliente`, `ged_documento_revisoes`, `ged_indexacoes` e `ged_pastas_raiz`. **Nomes de pastas e resumos de indexação também são metadados.** | **B** |
| G-3 | O modo de segurança das funções públicas do GED (`ged_documentos_do_alvo`, `ged_buscar_trabalho`, `ged_modelos`, `ged_tipos_presentes`…) não está definido. Se forem `security definer`, ignoram a RLS. | **B** |
| G-4 | `ctr_alvos_por_numero` é chamada pelo GED para sugerir vínculos: sem checagem, expõe números de contrato e clientes a usuários do GED **sem a área Contratos**. | **B** |
| G-5 | **Atividades** (0094): regras como "Vinculou {nome} a …" gravam o **nome do arquivo** na descrição, e quem tem `acompanha_equipe` lê todas as atividades **sem filtro de área**. Vazamento de nomes de arquivos de elaboração. O mesmo risco vale para títulos de pendência e mensagens do Slack, que vão para canais. | **B** |
| G-6 | A conclusão de obrigações por documento (`ged_tipos_presentes`) avaliada com a RLS de quem clica dá resultados diferentes conforme a pessoa: um operador sem leitura em `elaboracao` não conclui `elaborar_minuta`. | **T** |
| G-7 | Edge Functions do GED (service role): a resposta de "Atualizar índice agora" e os registros de erro podem levar nomes ou ids. | **T** |
| G-8 | **Drive:** as duas raízes estão no mesmo **Drive compartilhado**. Se os membros desse Drive incluem pessoas de outras áreas, o Drive dá acesso direto aos arquivos de elaboração, e o Neo Admin não consegue impedir isso. O `webViewLink` não é segredo de acesso, mas o Drive é a última barreira. | **E** (admin do Workspace) |
| G-9 | Rotas por id (`/documentos/<id>`, componentes que recebem `documento_id`): devem responder "não encontrado" quando a RLS não devolve a linha, sem distinguir "não existe" de "sem acesso". | **T** |

**Regras propostas** (R4-P4, pendente; afetam o GED, que **não** foi editado — ver a seção 9):
1. **Restrição fixa:** a raiz `finalidade = 'elaboracao'` tem `area = 'contratos'`, `area_operacao = 'contratos'` e `areas_leitura` vazio,
   garantido por `check`/gatilho. Mudar isso exige uma migration, e não uma tela de configuração.
2. **Uma função de acesso**, `ged_pode_ler_raiz(raiz_id)` (`security definer`, `stable`), usada por **todas** as políticas das tabelas
   `ged_*` que trazem `raiz_id`, inclusive pastas, revisões, vínculos e indexações. Leitura de `ged_pastas_raiz`: admin geral, e para os
   demais só as raízes que podem ler.
3. **Funções de leitura do GED são `security invoker`**, ou seja, vale a RLS. Exceção: a função que responde ao motor de obrigações
   (`ged_tipos_presentes`) é `security definer`, devolve **só booleanos ou códigos de tipo**, nunca nome, link ou id de documento, e
   checa `tem_acesso_area('contratos', 'operador')`.
4. **`ctr_alvos_por_numero`:** `security definer` com `tem_acesso_area('contratos', 'consulta')`. Para os demais, devolve vazio.
5. **Busca e sugestões:** calculadas na hora, com o cliente do usuário (RLS), sem gravar sugestões em tabela. Se for preciso gravar, a
   tabela segue a mesma política dos documentos.
6. **Atividades, pendências e Slack:** descrições e títulos **sem nome de arquivo**. Usar "Vinculou um documento (minuta v2) à
   operação 0042" e o tipo, não o nome. A regra vale para qualquer documento das raízes restritas, a ser seguida no catálogo
   `atividade_regras`.
7. **Next e Edge Functions:**
   - as telas usam o cliente do usuário (`lib/supabase/servidor.ts`), nunca a service role, como já manda o CLAUDE.md;
   - as Edge Functions do GED devolvem só contagens e mensagens genéricas;
   - erros com detalhe ficam em `ged_indexacoes.erro`, legível por quem pode ler a raiz.
8. **Acesso direto por id:** "não encontrado" padronizado.
9. **Drive (dependência externa):** o admin do Workspace confere os membros do Drive compartilhado e decide se a elaboração precisa de
   permissões próprias no Drive, por exemplo uma pasta com herança restrita. **Sem isso, a D-6 vale no Neo Admin, mas não no Drive**
   (PENDENTE 24).

## 5. Integração com o Financeiro: pendência de encargos

| # | Problema | Classe |
|---|---|---|
| E-1 | A pendência publicada em `contratos.contratos` não é visível a quem é só do Financeiro (I-1 da revisão 3). | **B** |
| E-2 | A `ctr_vw_contratos_sem_encargos` foi descrita como "leitura liberada ao Financeiro". Se for `security_invoker`, exige que o Financeiro leia `ctr_contratos` pela RLS, ou seja, **acesso à tabela inteira** (minutas, ids, todas as operações): acesso indevido. | **B** |
| E-3 | Para resolver, o Financeiro precisa ler a cláusula no contrato assinado. Se o documento estiver na raiz `elaboracao`, o Financeiro não o vê (D-6). | **N** |
| E-4 | Usuários com `unidade_restrita` (Filial) não podem ver contratos da Matriz. `tem_acesso_area` já os barra (0152), mas qualquer função nova precisa usar essa checagem, e não `tem_acesso_modulo('financeiro.filial')`. | **T** |
| E-5 | Exposição de clientes: o Financeiro já lê todos os títulos e clientes (`rec_titulos`, área). Mostrar a ele número, cliente e data de assinatura dos contratos sem encargos **não amplia** o que ele já vê, desde que só esses campos sejam expostos. | — (conclusão) |

**Alternativas**

| Alternativa | Como | Prós | Contras |
|---|---|---|---|
| **A. Recomendada** | Função `ctr_contratos_sem_encargos()` (`security definer`, checa `tem_acesso_area('financeiro','operador')`), que devolve **só** empresa, cliente, número, tipo, data de assinatura e o id do documento `contrato_assinado` **quando ele está na raiz `dossie_cliente`**. O **Financeiro** publica a pendência no módulo dele (`financeiro.recebiveis` ou outro a definir) e a resolve numa tela dele, chamando `rec_registrar_contrato` | Sem acesso ao Contratos; campos mínimos; a pendência mora onde o Financeiro trabalha; a regra "o módulo publica as suas pendências" é respeitada | Exige construção no Financeiro (faixa 01xx) e uma rotina que leia a função |
| B | O Contratos publica com `responsavel_id` = uma pessoa do Financeiro | Simples | Depende de uma pessoa; o link leva ao dossiê, que ela não pode abrir; troca de pessoa exige republicar |
| C | Dar `consulta` em Contratos ao Financeiro | Nenhuma construção | Acesso indevido a tudo do Contratos, inclusive a elaboração, se o nível mínimo for consulta |
| D | Pendência no núcleo com `modulo` do Financeiro, publicada pelo Contratos | Visível | O Contratos publicaria no módulo de outro, o que fere a regra de arquitetura |

**Decisão necessária** (PENDENTE 10, ampliado): escolher a alternativa, o módulo do Financeiro que recebe a pendência, o prazo e o que
acontece se o contrato assinado não estiver no dossiê do cliente (E-3). Proposta: a pendência informa "contrato assinado não está no
arquivo do cliente", sem link.

## 6. Integridade das obrigações

| # | Problema | Classe |
|---|---|---|
| O-1 | **Dependência cancelada** ("deixou de se aplicar") não conta como resolvida: as dependentes ficam `bloqueadas` para sempre. | **B** |
| O-2 | **A condição volta a valer:** não está definido se se cria uma obrigação nova ou se a cancelada é reaberta. Sem índice, podem surgir duas obrigações ativas do mesmo item. | **B** |
| O-3 | **Troca de modalidade ou variante:** não está definido o que acontece com as concluídas, as dispensadas e as manuais (`fora_do_modelo`, `regularizar_pdf_minuta`), nem se uma concluída do mesmo tipo é aproveitada. | **B** |
| O-4 | **Reabertura** de uma concluída: as dependentes já abertas ou concluídas não têm regra; a liberação pode ficar incoerente. | **B** |
| O-5 | `informar_condicao`: vários itens dependem do mesmo campo e podem gerar várias obrigações iguais. | **T** |
| O-6 | O responsável aparece em dois lugares: `ctr_obrigacoes.responsavel_id` e `pendencias.responsavel_id`, que a Central pode mudar sem que o módulo sobrescreva (0099). | **T** |
| O-7 | Concorrência: duas mudanças simultâneas na mesma operação podem gerar planos divergentes. | **T** |
| O-8 | **"Aplicar a versão nova do modelo"** tem os mesmos problemas de O-1 a O-4. | **B** |
| O-9 | Uma liberação recalculada depois de uma mudança pode virar `bloqueada` e cair no alarme de NF (ver F-3). | coberto por R4-P1 |

**Regras propostas** (R4-P5, pendente):
1. **Origem da obrigação:** `modelo` (com `modelo_item_id` e versão), `sistema` (`informar_condicao`, `regularizar_pdf_minuta`) ou
   `manual` (fora do modelo). Só as de origem `modelo` são afetadas por condição, modalidade, variante ou versão.
2. **Uma ativa por item:** índice único parcial `(operacao_id, modelo_item_id) where estado in ('bloqueada','aberta')`, e
   `(operacao_id, campo_condicao) where obrigacao_tipo = 'informar_condicao' and estado in ('bloqueada','aberta')`.
3. **Deixou de se aplicar:**
   - a obrigação `bloqueada` ou `aberta` vai para `cancelada`, com o motivo `nao_aplicavel`;
   - **conta como resolvida** para as dependentes, que são reavaliadas;
   - as `concluida` e `dispensada` **não mudam**: são histórico.
4. **Voltou a se aplicar:** cria-se uma **obrigação nova** (`substitui_obrigacao_id` aponta para a cancelada). A cancelada não é reaberta.
5. **Troca de modalidade, variante ou versão do modelo** (gestor, motivo), numa transação só:
   1. cancela as de origem `modelo` ainda `bloqueada` ou `aberta`;
   2. mantém as `concluida` e `dispensada`;
   3. cria as do modelo novo;
   4. se houver uma `concluida` do **mesmo tipo de obrigação**, o gestor escolhe, item a item, "aproveitar a conclusão" (a obrigação nova
      nasce `concluida`, com referência) ou "refazer". **Não há aproveitamento automático** [N, PENDENTE 25];
   5. mantém as de origem `sistema` e `manual`.
6. **Reabertura** (gestor, motivo):
   - as dependentes **não concluídas** voltam a `bloqueada`;
   - as dependentes **concluídas** não mudam, mas ganham a marca "dependência reaberta em dd/mm" para conferência;
   - a liberação é recalculada e a mudança fica registrada.
7. **Responsável:** a fonte é `ctr_obrigacoes.responsavel_id`. Uma troca feita na Central é refletida de volta por gatilho, e a
   publicação usa o valor da obrigação [T].
8. **Concorrência:** toda mudança de plano roda em uma função que trava a operação (`select … for update` em `ctr_operacoes`).
9. **Pendências:**
   - estado final (concluída, dispensada, cancelada): `encerrar_pendencia`;
   - nova obrigação: nova chave (`ctr:obrigacao:<id novo>`);
   - nenhuma chave é reaproveitada entre obrigações.

## 7. Numeração: `ctr_contratos` × `rec_contratos`

A regra do Financeiro **não foi alterada**. Riscos da divergência (`(empresa, tipo, numero)` × `(empresa, numero)`):

| # | Risco | Classe |
|---|---|---|
| N-1 | Dois contratos de tipos diferentes com o mesmo número são aceitos no Contratos. No segundo, `rec_registrar_contrato` acha o `rec_contratos` do outro tipo e recusa (como especificado). A pendência de encargos **nunca se resolve**. | **B** (para a fase C3) |
| N-2 | Sem a recusa, os dois contratos operacionais apontariam para o mesmo contrato financeiro, mas `rec_contrato_id` é único: o segundo falha do mesmo jeito. | — |
| N-3 | Sem normalização, "137/2026", "137" e "0137" convivem. Duplicidade aparente ou ligação errada com o Financeiro. Número digitado à mão (D-8) aumenta o risco. | **T** |
| N-4 | Não se sabe o formato usado em `rec_contratos.numero`, nem se a tabela tem dados em produção. Ela não tem política de RLS e nada a preenche pelo app. | **E** (Financeiro) |
| N-5 | A amostra mostra formatos diferentes por tipo (venda "229", locação "137/2026"), o que **sugere**, sem provar, sequências separadas. | **N** |

**Proposta** (R4-P6, pendente):
- gravar `numero` como digitado **e** `numero_normalizado` (sem espaços nas pontas, maiúsculo, sem zeros à esquerda na parte numérica, a
  validar);
- enquanto a decisão não sair, especificar a chave **mais restritiva**, `(empresa_id, numero_normalizado)`, alinhada ao Financeiro;
- se se confirmar que tipos diferentes podem repetir número, só então mudar para incluir o tipo, **e** o Financeiro decide como fica
  `rec_contratos`;
- a decisão continua no PENDENTE 8.

## 8. Locação × faturamento existente

Conclusão: **o escopo da especificação não duplica o fluxo de faturamento existente.**
- **O que o Contratos faz:** só operação e ciclo contratual (D-1). O papel de NF `fatura_locacao` serve para **ligar e consultar** uma
  fatura já emitida; nenhuma obrigação de faturamento mensal, aluguel, kit, demonstrativo, boleto ou implantação é especificada.
- **O que já existe no Financeiro:** o Faturamento Filial Contagem (`rec_kits`, `rec_remessas`, `financeiro.filial`) cuida da nota
  fatura, do demonstrativo, do boleto e da implantação (POP "Implantação de Faturas de Locação"), e continua sendo o dono disso.

| # | Ponto de atenção | Classe |
|---|---|---|
| L-1 | Um modelo de locação pode, por configuração, incluir obrigações como `emitir_nf_venda` ou `acompanhar_titulos`, recriando no Contratos um acompanhamento que já existe no Faturamento Filial. Proposta: a validação do modelo de `locacao` recusa tipos de faturamento (`emitir_nf_*`); `acompanhar_titulos` só com aprovação (PENDENTE 2). | **T** |
| L-2 | `rec_remessas` (remessa de **kits** da filial) e `ctr_remessas` (remessa de **mercadoria**) têm nomes parecidos e significados diferentes. Documentar para não confundir. | **T** |
| L-3 | Não se sabe se o faturamento de locação da **Matriz** (Cuiabá) usa o mesmo fluxo da filial. Definir antes do "módulo próprio" (I-5). | **E** (Financeiro) |
| L-4 | Os kits têm `cliente_nome` em texto (0146), não `contraparte_id`. Uma ligação futura operação ↔ kit precisaria de interface pública do Financeiro. | **E** |

## 9. Alterações documentais

**Feitas nesta revisão:**
- `docs/modulos/contratos-operacoes.md`:
  - histórico com a **revisão 4**, e o status continua **rascunho**;
  - nova seção **15**, com as propostas R4-P1 a R4-P6 e a remissão a este relatório;
  - marcas **[R4]** nas linhas afetadas;
  - correção, como **proposta**, dos índices de unicidade que não funcionam (A-1);
  - novos pendentes 20 a 25.
- Este relatório.

**Propostas para o GED** (`docs/modulos/administrativo-ged.md`), **não aplicadas**, para a próxima revisão dele:
1. Restrição fixa da raiz `elaboracao` (R4-P4, item 1).
2. Função `ged_pode_ler_raiz()` e políticas para **todas** as tabelas `ged_*` (G-2), corrigindo a §9 para incluir `areas_leitura`.
3. Modo de segurança de cada função pública (G-3).
4. Descrições sem nome de arquivo nas `atividade_regras`, pendências e Slack (G-5).
5. Atualizar os pontos 10 (D-4) e 2 (D-6) com as decisões preliminares (I-3, I-4).
6. Dependência externa: membros do Drive compartilhado (G-8).

**Propostas para o Financeiro** (para a especificação dele, não aplicadas):
- função ou rotina que leia `ctr_contratos_sem_encargos()` e publique a pendência no módulo dele;
- políticas de RLS de `rec_contratos`;
- formato de `rec_contratos.numero`.

## 10. Resumo por classe

| Classe | Itens |
|---|---|
| **Bloqueadores** | F-1, F-2, F-3, P-1, P-2, A-1, A-2, A-3, A-4, G-1, G-2, G-3, G-4, G-5, E-1, E-2, O-1, O-2, O-3, O-4, O-8, N-1 |
| **Decisões de negócio** | F-4, F-7, P-4, P-5, A-5, E-3, N-5, a escolha da alternativa de encargos, aproveitamento de conclusões (O-3) |
| **Melhorias técnicas** | F-5, F-6, P-3, P-6, A-6, A-7, G-6, G-7, G-9, E-4, O-5, O-6, O-7, N-3, L-1, L-2 |
| **Dependências externas** | F-4/F-7 (bancos), G-8 (admin do Workspace), N-4, L-3, L-4 (Financeiro), PENDENTE 1 (Fiscal), views do Comercial |

Nenhum bloqueador impede a **Fase 1 do GED** (conexão e verificação, só leitura). Eles impedem as fases A1/A2 do GED (G-1 a G-5) e
C1 a C4 do Contratos, até as propostas serem aprovadas e incorporadas.
