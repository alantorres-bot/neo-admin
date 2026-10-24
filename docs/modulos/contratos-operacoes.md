# Módulo: Contratos / Operações comerciais e dossiê

Status: **rascunho** (Fase 0, 24/10/2026), aguardando aprovação. Nada implementado.
Origem: `docs/auditoria/AUDITORIA_CONTRATOS_GED_2026-10-24.md`, seções B, D, F e G.
Depende de: `docs/modulos/administrativo-ged.md` (documentos e vínculos).

Código: `contratos.contratos` [EXISTE, inativo, 0001: "Contratos de venda/locação"; propõe-se renomear para "Operações e contratos"]
· área `contratos` [EXISTE, não sensível] · rota proposta `/contratos/operacoes` · migrations **0300–0399** · prefixo **`ctr_`**
(o `crt_` já é do Cartão de crédito, 0131) · regras puras em `lib/modulos/contratos/operacoes/`.

Marcação: **[EXISTE]** verificado no repositório · **[PROPOSTA]** a construir · **[PENDENTE n]** decisão do responsável (seção 13).

> Regra deste módulo: **nenhuma condição comercial, regra fiscal, prazo ou gatilho de faturamento é presumido.** Tudo o que decide
> uma obrigação vem de um modelo configurado e aprovado ou de um campo informado por uma pessoa. Os exemplos deste documento são
> ilustrativos e estão marcados como tal.

---

## 1. Objetivo
Acompanhar cada operação comercial da proposta fechada ao arquivamento, num **dossiê** único que reúne:
- cliente e proposta;
- solicitação e elaboração do contrato, minutas, aprovação e assinatura;
- autorização bancária;
- pedido e NFs do Consistem;
- títulos e boletos;
- remessas e documentos de entrega;
- obrigações, responsáveis, prazos e histórico.

O módulo **não emite NF, não gera boleto e não altera o Consistem**. Ele organiza, cobra as etapas e **impede que a operação conste
como liberada para faturar** sem as validações exigidas pela modalidade.

## 2. Como é feito hoje (auditoria, amostra de 24/10/2026)
- O CEO ou o representante envia ao administrativo um e-mail com a proposta anexada. O assunto segue o padrão
  `Contrato Locação 26.177 L - <cliente> <obra>` ou `Orçamento 26.199 V Rev03 - <cliente> - <obra> - <cidade>`.
  O corpo traz condições soltas ("Prazo 13 meses", "Antecipação 1 mês").
- O administrativo elabora a minuta. Hoje usa as skills `contrato-neoformas` no Claude, fora do Neo Admin.
- A minuta vai ao cliente por e-mail. Ajustes geram novas versões, salvas com outro nome (`… V2.pdf`).
- O contrato assinado volta na mesma conversa, junto com os dados da 1ª parcela. Na amostra, a 1ª parcela era um título
  `Z00029A` com vencimento antes da NF, ou seja, título sem NF.
- No financiamento, há tratativas com bancos (CAIXA com contrato BNDES; BNB). Num caso da CAIXA:
  1. a prévia da NF foi enviada ao banco;
  2. o banco pediu ajustes;
  3. o banco autorizou;
  4. a NF definitiva foi emitida.
  Outro banco pediu a NF "tão logo as formas sejam enviadas", e apareceu o "termo de entrega assinado".
- Os documentos ficam na pasta do cliente no Drive (ver o GED). O acompanhamento das etapas está na memória de quem faz.

## 3. Escopo
| Entra | Fica fora |
|---|---|
| Operação comercial (com ou sem contrato) e o dossiê | Emitir NF, boleto ou MDF-e; alterar pedido ou título no Consistem |
| Solicitação de elaboração de contrato (fila) | Redigir a minuta no Neo Admin na v1 (segue nas skills; integração na fase 8) |
| Contrato operacional: minutas, versões, aprovação, assinaturas (registro e evidência) | API de plataforma de assinatura (ForSign) na v1 |
| Autorização bancária: registro, documento, validação humana | Regras específicas de cada banco codificadas no programa |
| Ligação a pedidos, NFs (Comercial) e títulos (Recebíveis) por interfaces públicas | Ler tabelas internas de outros módulos |
| Remessas previstas × NFs de remessa ligadas | Cálculo fiscal, CFOP, tributação |
| Modelos de obrigações por modalidade e variante, configuráveis e versionados | Inferir obrigação ou condição a partir de texto |
| Trava de faturamento e alerta "NF sem liberação" | Bloquear a emissão no Consistem |
| Ligação com `rec_contratos` (contrato financeiro), sem duplicar | Novo cadastro paralelo de encargos ou cessão |
| Locação: operação e contrato | Controle REM × RET de equipamento (módulo `contratos.rem_ret`, planejado) e faturas mensais da locação [PENDENTE 2] |

## 4. Entradas e estruturas reaproveitadas

### 4.1 O que existe e como será usado
| Estrutura | Onde | Uso aqui | Como é acessada |
|---|---|---|---|
| `contrapartes`, `contatos` | núcleo, 0001/0114 | cliente da operação; contatos com finalidade `contrato` | direto (núcleo) |
| `empresas` (`codigo_erp`) | núcleo, 0001/0101 | empresa vendedora | direto (núcleo) |
| `pendencias`, `publicar_pendencia(jsonb)`, `encerrar_pendencia(modulo, chave, status)`, `encerrar_pendencias_exceto(...)` | núcleo, 0097/0099 | obrigações na Fila do dia e na Central de Gestão | funções do núcleo, chamadas por funções `security definer` do módulo (são `grant` só à `service_role`) |
| Bloqueio de pendência (`bloqueada_em`, `bloqueio_motivo`, `bloqueio_dependencia_id`) | núcleo, 0092 | mostrar a dependência na Central | colunas do núcleo |
| `auditoria` + `fn_auditoria()` | núcleo, 0001 | antes/depois de toda alteração | gatilho |
| `atividades` + `atividade_regras` | núcleo, 0094 | "quem fez o quê" legível | regras novas no catálogo |
| `interacoes`, `mensagens` | núcleo, 0001 | contatos com o cliente e rascunhos de e-mail | direto (núcleo) |
| GED (`ged_documentos`, `ged_vinculos`, `ged_documentos_do_alvo`, `ged_tipos_presentes`) | núcleo estendido, **proposto** | documentos do dossiê e evidências | funções públicas do GED |
| `rec_contratos` | Financeiro, 0100 | contrato financeiro (encargos, cessão) | **interface pública a criar no Financeiro** (5.6) |
| `rec_titulos` / `rec_vw_titulos` | Financeiro, 0100/0116 | títulos e boletos da operação | interface pública (4.2) |
| `rec_notas_saida` | Financeiro, 0103 | NF ↔ títulos, `pedidos text[]`, `cod_cliente` | interface pública (4.2) |
| `com_pedidos`, `com_notas`, `com_nota_parcelas`, `com_mdfes` | Comercial, 0701/0702 | pedido, NFs, parcelas, MDF-e | interface pública a criar no Comercial (4.2) |

Fatos verificados que afetam o desenho:
- `rec_contratos` tem RLS ligada e **nenhuma política** (0100). Usuários logados não leem nem gravam a tabela; só a service role.
  **Nenhum código preenche `rec_titulos.contrato_id`.** Por isso a `rec_vw_titulos` aplica a multa e os juros padrão de 2% pelo
  `coalesce` (0116).
- `com_pedidos.contraparte_id` só é preenchido quando o cliente existe no núcleo. `numeroUltimaNF` vem sempre vazio. As NFs do
  tipo 12 não trazem `codPedido` (`docs/modulos/comercial-pedidos.md`).
- O MDF-e não informa as NFs (0702), então não liga à operação de forma automática.
- RLS existente: `com_*` exige `tem_acesso_modulo('comercial.pedidos')`; `rec_titulos` e `rec_notas_saida` exigem
  `tem_acesso_area('financeiro')`.

### 4.2 Interfaces públicas que precisam ser criadas nos outros módulos [PROPOSTA]
Regra do projeto: um módulo não lê as tabelas internas de outro. Cada interface abaixo é construída **pelo módulo dono**, na faixa
dele, e documentada na especificação dele.

| Interface (nome proposto) | Módulo e faixa | Retorna | Segurança |
|---|---|---|---|
| `com_vw_pedidos_publico` | Comercial, 07xx | empresa, `cod_pedido`, situação, cliente (`contraparte_id`, código, nome), representante, datas (emissão, previsão de faturamento, último faturamento), valores (total, faturado, saldo) | `security_invoker`: exige acesso ao Comercial |
| `com_vw_notas_publico` | Comercial, 07xx | empresa, `cod_pedido`, nota, série, `chave_acesso`, situação, `cod_tipo_nota`, emissão, saída, valor | idem |
| `rec_vw_titulos_publico` | Financeiro, 01xx | empresa, cliente, documento, parcela, vencimento, valor, estágio, `nota_fiscal`, `chave_nfe`, boleto enviado em, data e valor pagos | `security_invoker`: exige o Financeiro |
| `rec_registrar_contrato(...)` / `rec_vincular_titulos_contrato(...)` | Financeiro, 01xx | ver 5.6 | `security definer`, checa o nível no Financeiro |

**Quem não tem a área de origem** vê no dossiê o bloco "Pedidos e NFs" ou "Títulos" com o aviso "Sem acesso ao Comercial/Financeiro".
O dossiê não contorna a permissão. Alternativa: funções `security definer` que devolvam um resumo mínimo aos usuários de Contratos
[PENDENTE 12].

## 5. Regras de negócio

### 5.1 A operação é a entidade central
1. Toda proposta fechada que o administrativo precisa acompanhar vira **uma operação** (`ctr_operacoes`).
2. Na operação ficam:
   - empresa;
   - cliente (`contraparte_id`, obrigatório);
   - modalidade e variante;
   - número da proposta e revisão vigente;
   - obra ou descrição;
   - responsável;
   - origem (manual ou captura de e-mail, fase 4).
3. **Contrato é opcional.** A modalidade diz se ele é exigido (`ctr_modalidades.exige_contrato`). Na proposta avulsa, nenhuma tabela
   de contrato é criada e nenhuma obrigação de contrato aparece.
4. **Uma operação por proposta:** a chave é `(empresa_id, proposta_numero)`, sem a revisão. Revisão nova (Rev02 → Rev03) atualiza a
   revisão vigente e registra o documento novo como versão no GED. Não abre outra operação.
5. Cliente sem cadastro em `contrapartes`: a operação não é criada. A tela leva ao cadastro do cliente, que segue o fluxo do núcleo.
   O Contratos não cria `contrapartes` sozinho.
6. A situação da operação é **calculada** (5.8), não editada.

### 5.2 Modalidades e variantes
1. Catálogo `ctr_modalidades` (o gestor da área edita; a v1 vem com as quatro abaixo):

   | Código | Nome | Exige contrato | Observação |
   |---|---|---|---|
   | `entrega_futura` | Venda para entrega futura | sim | cerca de 60% das operações (informado) |
   | `financiamento` | Financiamento sujeito à autorização bancária | **[PENDENTE 5]** | exige autorização bancária |
   | `avulsa` | Proposta avulsa (sem contrato) | não | segue para o faturamento |
   | `locacao` | Locação | sim | escopo a confirmar [PENDENTE 2] |

2. **Variante** (`ctr_variantes`): uma subdivisão da modalidade com obrigações próprias, por exemplo um banco ou uma linha de
   financiamento. A v1 **não traz variantes cadastradas**: elas são criadas quando o responsável descrever as regras de cada banco
   [PENDENTE 6].
3. A modalidade e a variante são escolhidas **por uma pessoa** na abertura. Trocar depois exige gestor e motivo, e reavalia as
   obrigações (5.4.6).

### 5.3 Condições comerciais (estruturadas, sem inferência)
1. As condições que mudam o fluxo são **campos de um catálogo** (`ctr_condicao_campos`), e não texto livre nem JSON aberto. Cada campo tem:
   - código;
   - rótulo;
   - tipo (`sim_nao`, `numero`, `moeda`, `data`, `lista`, `texto`);
   - opções (quando é lista);
   - ajuda;
   - modalidades em que aparece.
2. Os valores da operação ficam em `ctr_operacao_condicoes`: campo, valor, quem informou, quando e o documento de origem (opcional,
   ex.: o contrato assinado). Toda alteração passa pela auditoria e é registrada na linha do tempo.
3. A v1 **não traz campos de condição pré-cadastrados com efeito**. Exemplos possíveis, só para ilustrar e todos a confirmar
   [PENDENTE 3]:
   - "há sinal antes da NF" (`sim_nao`);
   - "NF somente após assinatura" (`sim_nao`);
   - "quantidade de remessas previstas" (`numero`);
   - "prazo da locação em meses" (`numero`).
4. Condição não informada é **desconhecida**, não "não". Um item de modelo que depende de condição desconhecida gera a obrigação
   "Informar condição: <rótulo>", e as obrigações dependentes ficam bloqueadas (5.4.4).
5. O texto livre das condições (ex.: o corpo do e-mail) fica como observação, sem efeito no fluxo.

### 5.4 Motor de obrigações
1. **Tipos de obrigação** (`ctr_obrigacao_tipos`, catálogo). Cada tipo tem:
   - código e nome;
   - área responsável padrão;
   - **como conclui**:
     - `manual`: a pessoa confirma;
     - `documento`: precisa de um documento confirmado no GED com um dos tipos exigidos;
     - `evento`: um fato registrado no módulo, como contrato assinado, autorização validada ou NF ligada com o papel X;
   - tipos de documento exigidos (`ged_tipos`);
   - se pode ser dispensada.

   Tipos iniciais propostos (só nomes; quando e se aplicam vem do modelo):

   | Código | Nome | Conclui por |
   |---|---|---|
   | `arquivar_proposta` | Arquivar proposta comercial | documento `proposta_comercial` |
   | `elaborar_minuta` | Elaborar minuta | documento `contrato_minuta` |
   | `aguardar_aprovacao_cliente` | Aguardar aprovação do cliente | evento: minuta aprovada |
   | `obter_assinaturas` | Obter assinatura de todas as partes | evento: contrato assinado + documento `contrato_assinado` |
   | `aguardar_autorizacao_bancaria` | Aguardar autorização bancária | evento: autorização validada + documento `autorizacao_bancaria` |
   | `emitir_nf_venda` | Emitir NF de venda | evento: NF ligada com o papel `venda` |
   | `emitir_nf_entrega_futura` | Emitir NF de venda para entrega futura | evento: NF ligada com o papel `entrega_futura` |
   | `acompanhar_titulos` | Acompanhar títulos e boletos | manual (com os títulos ligados à vista) |
   | `programar_remessas` | Programar remessas | evento: cronograma cadastrado |
   | `acompanhar_remessas` | Acompanhar remessas | evento: todas as remessas previstas com NF de remessa ligada |
   | `enviar_documentos_banco` | Enviar documentos ao banco | manual + documento (tipos da variante) |
   | `arquivar_finais` | Arquivar documentos finais | todos os documentos exigidos da operação presentes |
   | `informar_condicao` | Informar condição comercial | evento: condição informada (criada pelo próprio motor, 5.3.4) |

2. **Modelos** (`ctr_modelos`): um por modalidade, ou por modalidade + variante. Cada um tem versão e situação:
   - `rascunho`: editável;
   - `vigente`: só um por modalidade/variante;
   - `encerrado`.

   Os itens (`ctr_modelo_itens`) definem:
   - o tipo de obrigação;
   - a **condição de aplicação**, uma expressão sobre os campos de 5.3 no formato fechado
     `{"todas":[{"campo":"x","op":"=","valor":true}]}`, com os operadores `=`, `≠`, `>`, `≥`, `<`, `≤`, `informado` e
     `nao_informado`, combinados por `todas`/`alguma`; sem campo, o item se aplica sempre;
   - as **dependências** (outros itens do mesmo modelo);
   - o **prazo** relativo (N dias a partir da abertura, da conclusão de uma dependência ou de uma data da operação) ou nenhum;
   - se **trava o faturamento**;
   - o responsável padrão (pessoa ou "responsável da operação");
   - o papel do vínculo esperado.
3. **Só um modelo `vigente`** cria obrigações. Ativar um modelo exige gestor e fica na auditoria.
   **A v1 entrega os modelos em rascunho**, montados com o responsável na Fase 0 de configuração [PENDENTE 4]. Nenhum é ativado
   sem aprovação.
4. **Criação das obrigações**, ao abrir a operação ou ao mudar uma condição, a modalidade ou a variante. Para cada item do modelo vigente:
   - a condição dá **verdadeiro**: a obrigação é criada (ou mantida);
   - dá **falso**: não é criada; se já existia aberta, é cancelada com o motivo "deixou de se aplicar: <condição>";
   - é **desconhecida**: cria-se `informar_condicao` para o campo, e o item espera.
   A avaliação é uma função pura (`avaliarCondicao`, `planejarObrigacoes`) testada, chamada pela função SQL que grava.
5. Cada obrigação guarda o **modelo e a versão** que a criaram. Mudar o modelo não altera as operações em andamento. Elas só migram
   por ação explícita do gestor ("aplicar a versão nova"), com antes/depois.
6. **Dependências:** a obrigação com dependência não concluída fica `bloqueada`. Quando todas as dependências se resolvem
   (concluída ou dispensada), ela passa a `aberta`, ganha prazo (se relativo) e é publicada como pendência.
7. **Obrigação manual extra:** o operador pode acrescentar uma obrigação de qualquer tipo a uma operação (exceção da negociação),
   com motivo. Ela fica marcada como "fora do modelo".
8. **Dispensa:** só o gestor dispensa, com motivo, e só se o tipo permitir. A dispensa entra na linha do tempo e conta como resolvida
   para as dependências. **Uma obrigação que trava o faturamento só pode ser dispensada pelo nível definido em [PENDENTE 9].**
9. **Conclusão:**
   - `manual`: confirmação da pessoa, com observação opcional;
   - `documento`: só conclui se `ged_tipos_presentes` tiver pelo menos um dos tipos exigidos **confirmado** e vinculado à operação
     (ou ao contrato dela); a pessoa confirma;
   - `evento`: o próprio fato conclui, e a tela mostra qual foi;
   - concluir não apaga nada: reabrir exige gestor e motivo.

### 5.5 Contrato operacional, minutas e assinatura
1. `ctr_contratos`: no máximo um contrato **vigente** por operação. Aditivos ficam ligados ao contrato, e não como contrato novo
   [PENDENTE 7]. Campos:
   - número;
   - tipo (`venda`, `locacao`, `servico`, `outro`, o mesmo domínio de `rec_contratos.tipo`);
   - situação;
   - assinado em;
   - meio de assinatura.
2. **Número do contrato:** informado pela pessoa na v1. A numeração automática por tipo e ano depende do [PENDENTE 8]. Unicidade:
   `(empresa_id, tipo, numero)`.
3. **Minutas** (`ctr_minutas`): versão sequencial, documento no GED (`contrato_minuta`), enviada em, retorno do cliente (`ajustes`,
   `aprovada`), data e observação. A versão nova marca a anterior como substituída. A minuta aprovada conclui
   `aguardar_aprovacao_cliente`.
4. **Partes e assinaturas** (`ctr_assinaturas`):
   - parte (`contratante`, `contratada`, `interveniente`, `testemunha`, `banco`);
   - signatário (nome, e-mail; opcional: `contato_id`);
   - meio (`plataforma`, com o nome da plataforma; `certificado_digital`; `fisica`);
   - situação (`pendente`, `assinada`, `recusada`);
   - data;
   - documento de evidência no GED.
   O contrato fica `assinado` quando **todas** as partes cadastradas estão `assinada` e há um documento `contrato_assinado` confirmado.
5. Comunicação com o cliente: o envio da minuta segue a regra global, **rascunho no Gmail** (`modo_rascunho`) com o padrão de
   `gmail_contas` [EXISTE, 0153], e é registrado em `mensagens`/`interacoes`. Na v1 basta registrar "Enviada em" à mão.

### 5.6 Relação com `rec_contratos` (sem cadastro duplicado)
Papéis diferentes, um registro de cada lado e uma ligação 1:1:
- **`ctr_contratos` (Contratos):** o ciclo de vida do documento — minutas, partes, assinatura, obrigações.
- **`rec_contratos` (Financeiro):** os parâmetros financeiros que a cobrança usa — multa, juros, cessão/cessionário — e a ligação
  com `rec_titulos.contrato_id`.

Regras:
1. `ctr_contratos.rec_contrato_id` (único, nulo até ligar) aponta para `rec_contratos.id`. O Contratos **não grava** em `rec_contratos`.
2. A ligação é feita pela função do Financeiro `rec_registrar_contrato(p_empresa, p_contraparte, p_numero, p_tipo, p_multa_pct,
   p_juros_mes_pct, p_cedido, p_cessionario)` [PROPOSTA, faixa do Financeiro]:
   - procura `rec_contratos` por `(empresa_id, numero)`, que é a chave única existente;
   - se achar, devolve o id (e confere cliente e tipo, recusando divergência);
   - se não achar, cria;
   - exige `operador` no Financeiro.
3. **Multa e juros vêm da cláusula do contrato assinado, informados por uma pessoa do Financeiro.** Nunca são lidos do texto nem
   herdados do padrão de 2,00% da tabela: a função recebe os valores explicitamente. Enquanto não forem informados, o contrato
   financeiro não é criado e o dossiê mostra a pendência "Informar encargos do contrato" para o Financeiro [PENDENTE 10].
4. A ligação dos títulos ao contrato (`rec_titulos.contrato_id`) é feita pelo Financeiro, por uma função própria
   (`rec_vincular_titulos_contrato`) a partir dos títulos que o dossiê mostrar. O Contratos não altera `rec_titulos`.
5. Antes da ligação, o Financeiro precisa criar políticas de RLS para `rec_contratos`, que hoje não tem nenhuma. Sugestão, igual a
   `rec_titulos`: leitura com `financeiro` e escrita só pelas funções.

### 5.7 Autorização bancária
1. `ctr_autorizacoes_bancarias`. Campos:
   - operação;
   - banco (texto ou `contraparte_id` do tipo `banco`, que já existe no enum `tipo_contraparte`);
   - referência do banco (ofício, proposta, contrato de financiamento);
   - recebida em;
   - documento no GED (`autorizacao_bancaria`);
   - situação;
   - validada por/em;
   - ressalvas.
2. **Situações:**
   - `aguardando`: esperada, sem documento;
   - `recebida`: documento vinculado, ainda não validado;
   - `validada`;
   - `recusada`: o banco negou, ou a pessoa julgou o documento insuficiente;
   - `substituida`: chegou uma nova.
3. **Validar** exige:
   - o documento confirmado no GED;
   - uma pessoa com o nível definido em [PENDENTE 9] (proposta: gestor de Contratos);
   - uma observação.
   Quem registrou o recebimento pode ser quem valida? [PENDENTE 9]
4. Só uma autorização **validada** conclui `aguardar_autorizacao_bancaria`.
5. As etapas que alguns bancos exigem antes da autorização (ex.: prévia da NF) ou depois (envio da NF, termo de entrega) entram como
   **itens do modelo da variante**, e não como regra fixa [PENDENTE 6].

### 5.8 Situação da operação e liberação para faturamento
1. **Situação da operação** (`ctr_situacao_operacao(id)`, calculada):
   - `cancelada` ou `encerrada` (estados explícitos);
   - senão, o **rótulo da obrigação aberta de menor ordem no modelo**, por exemplo "Em elaboração da minuta", "Aguardando
     assinatura" ou "Aguardando autorização bancária";
   - sem obrigações abertas e com todas concluídas: "Pronta para encerrar".
2. **Liberação para faturamento** (`ctr_faturamento_liberado(id)` → `nao_se_aplica` | `bloqueada` (com a lista de motivos) | `liberada`):
   - `liberada` quando todas as obrigações da operação marcadas `trava_faturamento` estão concluídas ou dispensadas pelo nível autorizado;
   - na modalidade **financiamento**, o modelo **tem de ter** um item `aguardar_autorizacao_bancaria` com trava, garantido pela
     validação ao ativar o modelo. Assim, **sem autorização validada a operação nunca aparece como liberada**;
   - modalidade sem item de trava: `nao_se_aplica`, e a tela não exibe a liberação [PENDENTE 4].
3. A passagem para `liberada` é registrada na linha do tempo, com quem concluiu a última obrigação de trava. Voltar para `bloqueada`
   (ex.: autorização substituída) também é registrado.
4. **"NF emitida sem liberação"**: quando uma NF ligada à operação (5.9) tiver emissão anterior à liberação, ou existir com a operação
   `bloqueada`, abre-se uma pendência de prioridade `critica`. Chave `ctr:nf_sem_liberacao:<operacao>:<chave_nfe>`, para o gestor de
   Contratos. Nada é desfeito no Consistem; a pendência registra o fato para análise.
5. O Neo Admin **não impede a emissão no Consistem**. O que ele faz é deixar a situação visível e alertar [PENDENTE 11].

### 5.9 Pedidos, NFs, títulos e remessas
1. **Pedidos:** `ctr_operacao_pedidos (operacao_id, empresa_id, cod_pedido)`. O operador escolhe numa lista dos pedidos do cliente
   (pela `com_vw_pedidos_publico`). **Sugestão automática:** pedido do mesmo cliente digitado após a data da proposta. Nunca se liga
   automaticamente.
2. **NFs:** `ctr_operacao_notas (operacao_id, empresa_id, nota, serie, chave_acesso, papel, papel_confirmado_por/em)`.
   - **Origem:** NFs dos pedidos ligados (`com_vw_notas_publico`) ou informadas pela chave de acesso de 44 dígitos (para as NFs sem
     pedido, como as do tipo 12).
   - **Papel:** `venda`, `entrega_futura`, `remessa`, `fatura_locacao`, `outra`. **É confirmado por uma pessoa.** A sugestão
     automática só existe se o Fiscal configurar a tabela `ctr_papel_por_tipo_nota (cod_tipo_nota → papel)` [PENDENTE 1].
     Sem essa tabela, todas as NFs entram como "papel a confirmar".
   - NF cancelada (`situacao = 3` no espelho) aparece riscada e não conclui obrigação.
3. **Títulos:** vistos pela `rec_vw_titulos_publico`, de duas formas:
   - **pelas NFs ligadas** (`chave_nfe` ou empresa + `nota_fiscal`);
   - **por vínculo direto** (`ctr_operacao_titulos (operacao_id, empresa_id, documento, parcela)`), para títulos sem NF, como o sinal
     da amostra. A chave `(empresa, documento, parcela)` é a mesma `unique` de `rec_titulos`.
   O dossiê mostra vencimento, valor, estágio, boleto enviado e pago. O Contratos **não altera** título.
4. **Remessas previstas** (`ctr_remessas`):
   - número;
   - data prevista;
   - descrição/quantidade (texto na v1);
   - situação: `prevista`, `em_separacao`, `remetida` (com a NF de papel `remessa` ligada), `entregue` (com o documento
     `termo_entrega`, se o modelo exigir), `cancelada`.
   O cronograma é informado por uma pessoa: não se deduz do contrato. MDF-e: só exibido quando o operador ligar um manifesto à
   remessa, porque a API não informa as NFs dele (0702).
5. **Saldo a remeter:** a v1 não calcula quantidades, só a contagem de remessas previstas × remetidas. Calcular por item depende de
   ligar itens do pedido a remessas [PENDENTE 13].

### 5.10 Solicitação de elaboração de contrato
1. `ctr_solicitacoes`: pedido de trabalho do comercial ao administrativo. Campos:
   - origem (`manual`, `email`);
   - solicitante (perfil ou e-mail);
   - recebida em;
   - assunto;
   - observações (o texto das condições como veio);
   - proposta;
   - cliente (sugerido ou confirmado);
   - operação (depois de aberta);
   - responsável;
   - prazo;
   - situação.
2. **Situações:**
   - `recebida`;
   - `em_conferencia`: cliente ou modalidade ainda não confirmados;
   - `aceita`: operação aberta;
   - `atendida`: a minuta foi enviada ao cliente (é o primeiro envio de `ctr_minutas`);
   - `cancelada` (com motivo);
   - `duplicada` (aponta a original).
3. Na v1 a solicitação é cadastrada à mão. A captura pelo Gmail (fase 4 do plano) preenche a mesma tabela com `origem = email`, a
   referência da `ged_capturas` e o `message_id` (único).
4. A fila de solicitações fica na tela 7.2 e é publicada como pendência agregada "N solicitações de contrato aguardando".

### 5.11 Linha do tempo e auditoria
1. `ctr_eventos`: registro **imutável** (`fn_bloquear_alteracao`) do que aconteceu na operação, legível por quem tem a área. Campos:
   - tipo;
   - descrição;
   - autor;
   - quando;
   - referência (tabela e id).
   Exemplos de eventos:
   - operação aberta;
   - condição informada;
   - obrigação criada, aberta, concluída, dispensada ou cancelada;
   - minuta enviada ou aprovada;
   - assinatura registrada;
   - autorização validada;
   - faturamento liberado ou bloqueado;
   - NF ligada;
   - remessa remetida.
   A `auditoria` (só admin geral) guarda o antes/depois técnico.
2. Todas as tabelas `ctr_*`:
   - `fn_auditoria` e `fn_bloquear_delete` (regra global 4: prova não se apaga);
   - cancelamento por situação.
3. Regras em `atividade_regras` para as ações principais ("Abriu a operação {proposta_numero}", "Validou a autorização bancária…").

## 6. Saídas e automações
1. **Pendências** (`publicar_pendencia`, módulo `contratos.contratos`):

   | Pendência | Chave | Responsável | Prazo |
   |---|---|---|---|
   | uma por obrigação `aberta` | `ctr:obrigacao:<id>` | o da obrigação | o da obrigação |
   | "N solicitações de contrato aguardando" | `ctr:solicitacoes` | gestor de Contratos | — |
   | "Informar encargos do contrato <n>" | `ctr:encargos:<contrato>` | área `financeiro` (`modulo_exibicao` a definir) | — |
   | "NF emitida sem liberação" | `ctr:nf_sem_liberacao:<operacao>:<chave>` | gestor | `critica` |

   - O `link` é `/contratos/operacoes/<id>`.
   - Ao concluir, dispensar ou cancelar a obrigação: `encerrar_pendencia('contratos.contratos', chave, 'concluida' | 'cancelada')`.
   - A obrigação `bloqueada` **não** vira pendência. Ela só aparece no dossiê, para não poluir a Fila do dia.
2. **Rotina de conferência** (pg_cron, desligada por `contratos.operacoes.conferir_erp = false`):
   - lê, pelas interfaces públicas, as NFs dos pedidos ligados;
   - sugere novas NFs para confirmação;
   - abre "NF emitida sem liberação" (5.8.4).
   Sem escrita no ERP.
3. Notificações e ClickUp: os da Central de Gestão [EXISTE, 0098], sem nada próprio.

## 7. Telas [PROPOSTA]
Todas as grades usam `components/ui/table.tsx`.

1. **Operações** (`/contratos/operacoes`):
   - grade com operação, cliente, proposta/revisão, modalidade/variante, situação calculada, faturamento (selo bloqueado/liberado/não
     se aplica), próxima obrigação, prazo, responsável e valor;
   - filtros por modalidade, situação, responsável, cliente e "faturamento bloqueado";
   - "Nova operação": cliente (busca em `contrapartes`), proposta, modalidade, variante, responsável e obra.
2. **Solicitações** (`/contratos/solicitacoes`): fila com aceitar (abrir a operação), marcar duplicada e cancelar.
3. **Dossiê** (`/contratos/operacoes/[id]`), em abas:
   1. **Resumo:** cliente, modalidade/variante, situação, faturamento (com os motivos do bloqueio), responsável, condições informadas
      e a pendência de condição.
   2. **Obrigações:** lista em ordem do modelo, com estado, dependências, responsável, prazo, documento exigido (ok/faltando/aguardando
      conferência) e as ações concluir, dispensar e incluir.
   3. **Documentos:** `<DocumentosDoRegistro>` do GED, agrupado por tipo e com os faltantes destacados.
   4. **Contrato:** número, minutas (versões, enviada, retorno), partes e assinaturas, ligação com o contrato financeiro.
   5. **Banco:** autorizações bancárias (só aparece quando a modalidade ou variante prevê).
   6. **Pedidos e NFs:** pedidos ligados, NFs com papel e confirmação, aviso de NF sem liberação.
   7. **Títulos:** os da `rec_vw_titulos_publico` (ou o aviso de sem acesso).
   8. **Remessas:** cronograma e situação.
   9. **Histórico:** `ctr_eventos`.
4. **Modelos** (`/contratos/modelos`, gestor):
   - modalidades e variantes;
   - campos de condição;
   - tipos de obrigação;
   - modelos com itens, condições, dependências, prazos e trava;
   - o botão "Simular" mostra quais obrigações uma combinação de condições geraria, sem gravar;
   - ativar a versão.

## 8. Dados [PROPOSTA] (migrations 0300+, prefixo `ctr_`)
Todas as tabelas:
- RLS por `tem_acesso_area('contratos', …)`;
- `fn_auditoria` e `fn_bloquear_delete`;
- `atualizado_em` com `fn_atualizado_em` onde couber;
- escrita das transições só por funções `security invoker` que checam o nível (como `rec_registrar_baixa`, 0107), ou `security definer`
  quando precisam publicar pendência.

| Tabela | Campos principais | Restrições |
|---|---|---|
| `ctr_modalidades` | `codigo` pk, `nome`, `exige_contrato`, `ativa`, `ordem` | — |
| `ctr_variantes` | `id`, `modalidade`, `codigo`, `nome`, `banco_contraparte_id`, `ativa` | único `(modalidade, codigo)` |
| `ctr_condicao_campos` | `codigo` pk, `rotulo`, `tipo`, `opcoes jsonb`, `ajuda`, `modalidades text[]`, `ativo` | — |
| `ctr_obrigacao_tipos` | `codigo` pk, `nome`, `area`, `conclui_por` (`manual`/`documento`/`evento`), `evento`, `documentos_exigidos text[]` (→ `ged_tipos`), `dispensavel`, `ativo` | — |
| `ctr_modelos` | `id`, `modalidade`, `variante_id`, `versao`, `situacao` (`rascunho`/`vigente`/`encerrado`), `ativado_por/em`, `observacao` | um `vigente` por `(modalidade, variante_id)` |
| `ctr_modelo_itens` | `id`, `modelo_id`, `ordem`, `obrigacao_tipo`, `condicao jsonb`, `prazo_dias`, `prazo_base` (`abertura`/`dependencias`/`campo:<codigo>`), `trava_faturamento`, `responsavel_padrao`, `papel_documento` | imutável depois de `vigente` |
| `ctr_modelo_dependencias` | `item_id`, `depende_de_item_id` | sem ciclos (checado ao ativar) |
| `ctr_operacoes` | `id`, `numero` (sequencial interno), `empresa_id`, `contraparte_id`, `modalidade`, `variante_id`, `proposta_numero`, `proposta_revisao`, `descricao`/`obra`, `valor_referencia numeric(14,2)` (informativo), `responsavel_id`, `origem`, `solicitacao_id`, `situacao_base` (`ativa`/`encerrada`/`cancelada`), `encerrada_por/em`, `cancelada_por/em`, `motivo_cancelamento`, `criado_por/em`, `atualizado_em` | único `(empresa_id, proposta_numero)`; `contraparte_id` obrigatório |
| `ctr_operacao_condicoes` | `operacao_id`, `campo`, `valor jsonb`, `informado_por/em`, `documento_id` | pk `(operacao_id, campo)`; histórico pela auditoria e por `ctr_eventos` |
| `ctr_obrigacoes` | `id`, `operacao_id`, `obrigacao_tipo`, `modelo_item_id`, `modelo_versao`, `fora_do_modelo`, `ordem`, `estado` (`bloqueada`/`aberta`/`concluida`/`dispensada`/`cancelada`), `responsavel_id`, `prazo`, `trava_faturamento`, `campo_condicao` (para `informar_condicao`), `concluida_por/em`, `conclusao_obs`, `dispensada_por/em`, `dispensa_motivo`, `cancelada_motivo`, `pendencia_chave` | — |
| `ctr_obrigacao_dependencias` | `obrigacao_id`, `depende_de_id` | — |
| `ctr_solicitacoes` | ver 5.10; `message_id` único quando `origem = email` | — |
| `ctr_contratos` | `id`, `operacao_id`, `empresa_id`, `numero`, `tipo`, `situacao` (`em_elaboracao`/`em_negociacao`/`aprovado`/`em_assinatura`/`assinado`/`encerrado`/`cancelado`), `assinado_em`, `rec_contrato_id` (único) | único `(empresa_id, tipo, numero)`; um não cancelado por operação |
| `ctr_minutas` | `id`, `contrato_id`, `versao`, `documento_id`, `enviada_em`, `retorno` (`ajustes`/`aprovada`), `retorno_em`, `observacao`, `situacao` (`em_elaboracao`/`enviada`/`ajustes_solicitados`/`aprovada`/`substituida`) | único `(contrato_id, versao)` |
| `ctr_assinaturas` | `id`, `contrato_id`, `parte`, `nome`, `email`, `contato_id`, `meio`, `plataforma`, `situacao`, `assinado_em`, `documento_id` | — |
| `ctr_autorizacoes_bancarias` | ver 5.7 | — |
| `ctr_operacao_pedidos` | `operacao_id`, `empresa_id`, `cod_pedido`, `ligado_por/em`, `removido_por/em/motivo` | único ativo `(empresa_id, cod_pedido)`: um pedido em uma operação só [PENDENTE 14] |
| `ctr_operacao_notas` | ver 5.9.2 | único ativo `(empresa_id, nota, serie)` |
| `ctr_operacao_titulos` | `operacao_id`, `empresa_id`, `documento`, `parcela`, `ligado_por/em`, `removido_*` | único ativo `(empresa_id, documento, parcela)` |
| `ctr_papel_por_tipo_nota` | `empresa_id`, `cod_tipo_nota`, `papel`, `definido_por/em` | vazia até o Fiscal preencher |
| `ctr_remessas` | ver 5.9.4 | — |
| `ctr_eventos` | `id` bigserial, `operacao_id`, `tipo`, `descricao`, `referencia_tabela`, `referencia_id`, `usuario_id`, `em` | imutável |

Os documentos não têm tabela própria no Contratos: são **vínculos do GED** com `modulo = 'contratos.contratos'` e `tabela` igual a
`ctr_operacoes`, `ctr_contratos`, `ctr_minutas`, `ctr_assinaturas`, `ctr_autorizacoes_bancarias`, `ctr_remessas` ou `ctr_obrigacoes`
(registradas em `ged_alvos`).

### 8.1 Relacionamentos
```
contrapartes 1─N ctr_operacoes N─1 ctr_modalidades / ctr_variantes
ctr_solicitacoes 0..1─1 ctr_operacoes
ctr_operacoes 1─N ctr_operacao_condicoes N─1 ctr_condicao_campos
ctr_operacoes 1─N ctr_obrigacoes N─1 ctr_modelo_itens N─1 ctr_modelos ; ctr_obrigacoes N─N (dependências)
ctr_obrigacoes 1─0..1 pendencias (chave_origem 'ctr:obrigacao:<id>')
ctr_operacoes 1─0..1 ctr_contratos (vigente) 1─N ctr_minutas / ctr_assinaturas
ctr_contratos 0..1─0..1 rec_contratos (rec_contrato_id; criado pelo Financeiro) 1─N rec_titulos.contrato_id
ctr_operacoes 1─N ctr_autorizacoes_bancarias
ctr_operacoes 1─N ctr_operacao_pedidos ─(com_vw_pedidos_publico)→ com_pedidos
ctr_operacoes 1─N ctr_operacao_notas   ─(com_vw_notas_publico)→ com_notas
ctr_operacoes 1─N ctr_operacao_titulos ─(rec_vw_titulos_publico)→ rec_titulos   (+ títulos pelas NFs)
ctr_operacoes 1─N ctr_remessas 0..1─1 ctr_operacao_notas (papel remessa)
qualquer ctr_* ←ged_vinculos─ ged_documentos (Drive)
ctr_operacoes 1─N ctr_eventos
```

### 8.2 Estados e transições
| Entidade | Estados | Quem muda |
|---|---|---|
| Operação (`situacao_base`) | `ativa` → `encerrada` (sem obrigação aberta/bloqueada; gestor ou operador) · `ativa` → `cancelada` (gestor, motivo; cancela as obrigações e encerra as pendências) | — |
| Obrigação | `bloqueada` → `aberta` (sistema, dependências resolvidas) → `concluida` (operador/evento) · `aberta`/`bloqueada` → `dispensada` (gestor) · qualquer não final → `cancelada` (sistema: deixou de se aplicar / operação cancelada) · `concluida` → `aberta` (reabrir, gestor) | — |
| Contrato | `em_elaboracao` → `em_negociacao` (1ª minuta enviada) → `aprovado` (minuta aprovada) → `em_assinatura` → `assinado` (5.5.4) → `encerrado` (gestor; ex.: termo de quitação) · qualquer → `cancelado` (gestor) | — |
| Minuta | `em_elaboracao` → `enviada` → `ajustes_solicitados` \| `aprovada`; versão nova → anterior `substituida` | — |
| Autorização bancária | `aguardando` → `recebida` → `validada` \| `recusada`; nova → anterior `substituida` | validar: nível do PENDENTE 9 |
| Solicitação | `recebida` → `em_conferencia` → `aceita` → `atendida`; → `cancelada`/`duplicada` | — |
| Remessa | `prevista` → `em_separacao` → `remetida` → `entregue`; → `cancelada` | — |
| Faturamento (calculado) | `nao_se_aplica` · `bloqueada` ↔ `liberada` | — |

## 9. Permissões (área `contratos`)
| Nível | Pode |
|---|---|
| `consulta` | ver operações, dossiê e histórico (os blocos de Comercial e Financeiro seguem a permissão dessas áreas) |
| `operador` | criar operação e solicitação; informar condições; concluir obrigação; incluir obrigação fora do modelo; registrar minutas, assinaturas, autorização recebida, remessas; ligar pedidos, NFs e títulos; confirmar o papel da NF; vincular documentos |
| `gestor` | trocar modalidade ou variante; dispensar e reabrir obrigação; validar autorização bancária [PENDENTE 9]; cancelar e encerrar operação; editar e ativar modelos, catálogos e `ctr_papel_por_tipo_nota` [PENDENTE 1] |
| `admin_geral` | tudo; ativar o módulo |

O Financeiro (operador) informa os encargos e liga o contrato financeiro pela função dele (5.6). Quem é só do Comercial: consulta em
Contratos [PENDENTE 12].

## 10. Testes

### 10.1 Vitest (`lib/modulos/contratos/operacoes/*.test.ts`)
1. `avaliarCondicao`:
   - todos os operadores;
   - `todas` e `alguma`;
   - campo não informado dá desconhecido (não falso);
   - campo inexistente gera erro de configuração.
2. `planejarObrigacoes`:
   - avulsa: nenhuma obrigação de contrato;
   - entrega futura com e sem uma condição (exemplos fictícios de teste);
   - condição desconhecida gera `informar_condicao` e o item fica esperando;
   - condição muda de verdadeiro para falso: cancela a obrigação aberta com motivo;
   - mudar o modelo não altera a operação antiga.
3. Dependências:
   - abre só quando todas se resolvem;
   - dispensa conta como resolvida;
   - ciclo é recusado ao ativar o modelo.
4. Prazos: relativos à abertura, à conclusão de dependências e a um campo de data, contados em dias corridos (não há calendário de dias
   úteis no projeto, ver a Central de Gestão §11). Datas no fuso America/Cuiaba.
5. `faturamentoLiberado`:
   - financiamento sem autorização validada nunca libera;
   - autorização `recebida` não libera;
   - `validada` libera;
   - substituída volta a bloquear;
   - modelo de financiamento sem item de trava não pode ser ativado.
6. Contrato `assinado`: só com todas as partes assinadas **e** o documento confirmado.
7. Chave de operação: Rev02 e Rev03 do mesmo número caem na mesma operação; números diferentes, em operações diferentes.
8. Papel da NF: sem `ctr_papel_por_tipo_nota`, sempre "a confirmar".

### 10.2 SQL (PGlite, `tests/db`)
1. RLS:
   - sem a área `contratos`, nada é visível;
   - `consulta` não grava;
   - `operador` não dispensa;
   - `gestor` dispensa com motivo.
2. Sem `delete` em nenhuma `ctr_*`; `ctr_eventos` é imutável.
3. Um modelo `vigente` por modalidade/variante; item de modelo vigente é imutável.
4. O pedido, a NF e o título já ligados a outra operação são recusados [PENDENTE 14].
5. As pendências:
   - abrir a obrigação publica uma pendência (`chave_origem` correta);
   - concluir encerra;
   - rodar duas vezes não duplica;
   - a bloqueada não publica.
6. `ctr_contratos.rec_contrato_id` é único; o Contratos não tem permissão de `insert`/`update` em `rec_contratos`.

### 10.3 Playwright
1. Criar uma operação avulsa: aparecem só as obrigações do modelo avulsa, e nenhuma aba de contrato.
2. Financiamento:
   1. o selo mostra "Faturamento bloqueado: aguardando autorização bancária";
   2. registrar a autorização recebida não muda o selo;
   3. validar (gestor) muda para liberado.
3. Entrega futura: minuta V1 enviada → ajustes → V2 aprovada → assinaturas → obrigação "Obter assinaturas" concluída; histórico
   completo na aba Histórico.
4. Usuário sem Financeiro: a aba Títulos mostra "Sem acesso ao Financeiro".

## 11. Critérios de aceite
1. **Dossiê (Fase 3 do plano):**
   - três operações reais, uma de cada modalidade (entrega futura, financiamento e avulsa), cadastradas e com documentos vinculados;
   - nenhum cliente ou contrato financeiro duplicado;
   - os pedidos, as NFs e os títulos aparecem para quem tem acesso às áreas.
2. **Solicitações (Fase 5):** uma solicitação manual vira operação em um passo e aparece como pendência até ser aceita.
3. **Versões e assinatura (Fase 6):** histórico V1 → V2 → aprovada → assinada visível. O contrato só fica `assinado` com o documento
   confirmado.
4. **Obrigações e trava (Fase 7):**
   - os modelos aprovados pelo responsável estão ativos;
   - para cada modalidade, a simulação gera exatamente as obrigações combinadas com ele;
   - financiamento sem autorização validada não aparece como liberado em nenhuma tela ou relatório;
   - NF emitida antes da liberação abre a pendência crítica.
5. `npm run verificar` passa; nenhuma migration fora de 0300–0399, salvo as interfaces públicas nas faixas dos módulos donos.

## 12. Fases deste módulo
| Fase interna | Escopo | No plano da auditoria | Depende de |
|---|---|---|---|
| C0 | Configuração com o responsável: modalidades, campos de condição, tipos de obrigação e modelos **em rascunho** | Fase 0 (continuação) | respostas da seção 13 |
| C1 | `ctr_operacoes`, condições, dossiê (abas Resumo, Documentos, Pedidos e NFs, Títulos, Histórico), ligação manual a pedidos, NFs e títulos; interfaces públicas do Comercial e do Financeiro | Fase 3 | GED A2; views públicas |
| C2 | Solicitações e fila | Fase 5 | C1 |
| C3 | Contrato operacional, minutas, assinaturas, `rec_registrar_contrato` (Financeiro) | Fase 6 | C1; decisões 7, 8 e 10 |
| C4 | Motor de obrigações, modelos vigentes, trava de faturamento, autorização bancária, remessas, rotina de conferência | Fase 7 | C3; decisões 1, 4, 6, 9 e 11 |
| C5 | Captura pelo Gmail alimentando `ctr_solicitacoes` | Fase 4 | especificação de captura |

## 13. Pontos em aberto (decisões do responsável)
1. **Papel da NF:** qual tipo de nota ou CFOP do Consistem identifica a NF de venda para entrega futura, a de remessa e a de venda comum?
   Deve vir do **Fiscal**. Sem isso, o papel é sempre confirmado à mão.
2. **Locação:** entra neste módulo (operação e contrato) e as faturas mensais e REM × RET ficam no `contratos.rem_ret`? Ou tudo fica
   fora por enquanto?
3. **Condições que mudam o fluxo:** quais são, por modalidade? Exemplos a confirmar: sinal antes da NF; NF só após assinatura; boleto
   antes ou depois da NF; número de remessas; prazo da locação.
4. **Obrigações por modalidade:** a lista, a ordem, as dependências, os prazos e quais travam o faturamento. A tabela da auditoria
   (seção F) é só um exemplo.
5. **Financiamento exige contrato de compra e venda** sempre, nunca ou depende do banco?
6. **Bancos e linhas:** quais existem hoje (CAIXA/BNDES, BNB…) e o que cada um exige antes e depois da autorização (prévia da NF,
   termo de entrega, envio da NF)? Cada um vira uma variante.
7. **Aditivos:** ficam ligados ao contrato original (recomendado) ou viram contrato novo?
8. **Numeração dos contratos:** a sequência é por tipo (venda "229"; locação "137/2026")? Quem atribui? O Neo Admin deve sugerir o
   próximo número?
9. **Quem valida a autorização bancária e quem dispensa uma obrigação que trava o faturamento?** Quem registrou pode validar?
10. **Encargos do contrato financeiro:** o Financeiro informa a multa e os juros a partir do contrato assinado? Qual o prazo? Até lá,
    vale o padrão de 2% da `rec_vw_titulos` (como hoje) ou um alerta?
11. **"NF sem liberação":** basta a pendência crítica, ou deve haver outra providência (ex.: aviso imediato ao gestor)?
12. **Visibilidade cruzada:** quem é só de Contratos deve ver um resumo dos títulos e das NFs mesmo sem acesso ao Financeiro ou ao
    Comercial? Exigiria funções de resumo `security definer`.
13. **Saldo a remeter:** controlar por quantidade e item do pedido, ou basta a contagem de remessas na v1?
14. **Um pedido pode pertencer a mais de uma operação?** E uma operação, ter vários pedidos? Proposta: N pedidos por operação e
    nenhum pedido em duas operações.
15. **Responsáveis e prazos padrão** de cada etapa (administrativo, comercial, fiscal, financeiro).
16. **Nome do módulo** no menu: "Operações e contratos"?
