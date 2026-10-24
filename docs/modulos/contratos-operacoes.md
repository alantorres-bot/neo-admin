# Módulo: Contratos / Operações comerciais e dossiê

Status: **aprovada em 24/10/2026** (aprovação documental da revisão 5, pelo responsável). As decisões pendentes da seção 13 continuam
abertas, e a aprovação não libera nenhuma fase (seção 12).
- **Implementação:** nenhuma, e **não autorizada**: cada fase depende dos próprios pré-requisitos e de autorização expressa posterior.
- **Modelos de obrigações:** em rascunho, sem ativação.
- **Regras fiscais e bancárias:** pendentes de validação.
- **Critérios de aceite e testes:** planejados, ainda não executados.

Histórico de revisões:
- **Revisão 1, 24/10/2026:** primeira versão, a partir da auditoria.
- **Revisão 2, 24/10/2026:**
  - documentos de elaboração (raiz `elaboracao`) × arquivo do cliente (raiz `dossie_cliente`);
  - vínculo dos dois à mesma operação;
  - distinção entre minuta, minuta aprovada e contrato assinado (5.5, 5.12).
- **Revisão 3, 24/10/2026:** incorporação das **decisões preliminares** do responsável (seção 0) sobre:
  - locação;
  - financiamento;
  - aditivos;
  - evidência de minutas;
  - remessas;
  - permissões;
  - NF sem liberação;
  - numeração manual;
  - encargos financeiros.

  A especificação continua em rascunho.
- **Revisão 4, 24/10/2026:** revisão técnica de consistência (`docs/auditoria/REVISAO_CONTRATOS_REV3_2026-10-24.md`).
  - Registra bloqueadores e **propostas pendentes de aprovação** (seção 15; marcas **[R4]** no texto).
  - Nenhuma proposta foi tratada como decisão.
  - Status: **rascunho**.
- **Revisão 5, 24/10/2026:** consolidação da **matriz de aprovação R4** do responsável (seção 0.1).
  - Registra o que foi aprovado (regras de negócio e direções técnicas), o que foi aprovado parcialmente e o que continua pendente.
  - Integra as decisões às seções 4.2, 5.2, 5.4, 5.5, 5.6, 5.8, 5.12, 6, 8, 10, 12, 13, 14 e 15.
  - A divergência de numeração das propostas é tratada por referência conjunta a **número e tema** (seção 0.1); nada foi renumerado.
  - Status: **rascunho**. **Não está pronta para produção.** Implementação: nenhuma.
  - Dependência atualizada: `docs/modulos/administrativo-ged.md`, revisão 3 (R4-P4 — Segurança do GED).
  - **Correções pós-auditoria (24/10/2026, mesma revisão 5):** tratados os achados 1 a 22 da auditoria final do diff R5. O relatório
    foi apresentado na conversa, sem arquivo no repositório. Marcas **[AF-n]** no texto (n = número do achado). Nenhuma decisão de
    negócio nova foi registrada como aprovada; as escolhas que dependem do responsável foram para a seção 13 (itens 29 a 33).
    Status: **rascunho**.
- **Aprovação documental, 24/10/2026:** a **revisão 5** foi aprovada pelo responsável como especificação. Não houve mudança de
  conteúdo funcional nem de número de revisão.
  - A aprovação **não** transforma propostas em regras vigentes e **não** encerra pendências: as decisões R4-P1 a R4-P8 mantêm os
    estados da seção 0.1, e os itens 1 a 33 da seção 13 continuam como estavam.
  - **Não autoriza a implementação** de nenhuma fase: os bloqueios da seção 12 continuam valendo.
  - Status: **aprovada em 24/10/2026**.

Origem: `docs/auditoria/AUDITORIA_CONTRATOS_GED_2026-10-24.md`, seções B, D, F e G.
Depende de: `docs/modulos/administrativo-ged.md`, revisão 3 (documentos, vínculos e segurança das raízes).

Código: `contratos.contratos` [EXISTE, inativo, 0001: "Contratos de venda/locação"; propõe-se renomear para "Operações e contratos"]
· área `contratos` [EXISTE, não sensível] · rota proposta `/contratos/operacoes` · migrations **0300–0399** · prefixo **`ctr_`**
(o `crt_` já é do Cartão de crédito, 0131) · regras puras em `lib/modulos/contratos/operacoes/`.

Marcação:
- **[EXISTE]** verificado no repositório;
- **[PROPOSTA]** a construir;
- **[D-n]** decisão preliminar do responsável (seção 0), sujeita à validação interna;
- **[PENDENTE n]** decisão ainda em aberto (seção 13);
- **[R4-Pn]** proposta da revisão técnica (seção 15). Desde a revisão 5, o status de cada uma está na seção 0.1 e é citado sempre
  com **número e tema** (ex.: "R4-P6 — Numeração");
- **[R5 — aprovado]** regra ou direção técnica aprovada pelo responsável na matriz R4 (seção 0.1);
- **[R5 — pendente]** parte que continua aberta depois da matriz;
- **[AF-n]** correção documental do achado n da auditoria final (revisão 5).

> Regra deste módulo: **nenhuma condição comercial, regra fiscal, prazo ou gatilho de faturamento é presumido.** Tudo o que decide
> uma obrigação vem de um modelo configurado e aprovado ou de um campo informado por uma pessoa. Os exemplos deste documento são
> ilustrativos e estão marcados como tal.

---

## 0. Decisões preliminares do responsável — 24/10/2026

> **Preliminares e sujeitas à validação interna.** Orientam esta especificação, mas **não estão aprovadas para produção**. Não
> respondem os pontos que dependem do Fiscal, dos bancos ou de outras áreas, que continuam na seção 13.

| Nº | Tema | Decisão preliminar | Onde foi incorporada |
|---|---|---|---|
| D-1 | Locação | Incluir operação e contrato no módulo. Faturamento mensal e controle REM × RET ficam para módulo próprio. | 3, 5.2, 5.5, 7, 12, 13 |
| D-2 | Financiamento | O contrato de compra e venda é obrigatório em toda operação da modalidade financiamento. Os requisitos específicos de cada banco continuam pendentes. | 5.2, 5.4, 5.7, 5.8, 10, 13 |
| D-3 | Aditivos | Permanecem vinculados ao contrato original, com histórico próprio. Não são tratados como contratos independentes por padrão. | 5.5, 8, 13 |
| D-4 | Evidência da minuta enviada | Registrar a revisão do DOCX e o PDF efetivamente enviado ao cliente, vinculados à versão correspondente da minuta. | 5.5, 5.12, 8, 10, 11 |
| D-5 | Remessas | Na primeira versão, controlar só a quantidade de remessas previstas e realizadas. O controle por item e quantidade do pedido fica para fase futura. | 3, 5.9, 8, 10, 13 |
| D-6 | Acesso aos arquivos de elaboração | O acesso aos arquivos de trabalho da raiz `elaboracao` é restrito à área Contratos, respeitando também as permissões do GED e do Drive. As demais áreas acessam só os documentos autorizados do dossiê do cliente. | 5.12, 7, 9, 10 |
| D-7 | NF emitida sem liberação | Pendência de prioridade crítica para o gestor de Contratos. Notificação imediata adicional não é requisito nesta versão. | 5.8, 6, 7, 10, 11 |
| D-8 | Numeração dos contratos | Número informado manualmente por uma pessoa. Sem sugestão nem geração automática nesta versão. | 5.5, 8, 10, 13 |
| D-9 | Encargos financeiros ausentes | Pendência para o Financeiro. Os encargos não são presumidos e o padrão de 2% não é tratado como condição negociada. | 5.6, 6, 8, 9, 10 |

### 0.1 Matriz de aprovação R4 — decisões do responsável (revisão 5)

> **Numeração das propostas.** Na solicitação do responsável, "R4-P5" foi usado para Encargos, "R4-P6" para Obrigações e "R4-P7" para
> Numeração. **Vale a numeração da seção 15 desta especificação**, citada sempre com o tema:
> R4-P1 — Financiamento · R4-P2 — PDF da minuta · R4-P3 — Aditivos · R4-P4 — Segurança do GED · R4-P5 — Obrigações ·
> R4-P6 — Numeração · R4-P7 — Encargos financeiros · R4-P8 — Locação.
> Qualquer renumeração futura será uma proposta separada [PENDENTE 28].
>
> A aprovação vale **dentro do alcance escrito**. Nada além do que está na coluna "Decisão do responsável" foi considerado aprovado.
> A especificação foi aprovada documentalmente em 24/10/2026 (revisão 5). Isso não muda o estado de nenhuma proposta desta matriz.

| Proposta (número e tema) | Decisão do responsável | Status | O que continua aberto |
|---|---|---|---|
| **R4-P1 — Financiamento** | A liberação para faturamento exige, ao mesmo tempo, **contrato de compra e venda assinado** e **autorização bancária validada**, as duas verificadas pela própria função de liberação, independentemente do modelo. O alerta de NF sem liberação considera o **histórico de liberações** | **Aprovada parcialmente** | variante substitui ou herda o modelo (20); marco inicial das operações antigas (21) e comportamento provisório do alerta (31); quem dispensa a autorização, se a dispensa for mantida (9); ordem contrato × autorização e se o banco assina (27); requisitos por banco (6) |
| **R4-P2 — PDF da minuta** | Permitir **avançar para assinatura** com o PDF da minuta pendente. A ausência fica registrada e rastreável; o PDF não aparece como vinculado sem estar confirmado no GED | **Aprovada parcialmente** (cobre o **avanço**, não a conclusão do contrato) | quem regulariza; prazo; quem registra `sem_pdf_justificado`; se o contrato pode chegar a `assinado` com PDF pendente; inferência sobre a aprovação da minuta (22); efeito na liberação para faturamento (29); fonte de verdade com o GED (30) |
| **R4-P3 — Aditivos** | **Direção técnica aprovada:** corrigir a unicidade das versões, a integridade referencial entre aditivo, contrato, minuta e assinatura, a separação dos estados e verificações do contrato e dos aditivos, e as regras de contrato não cancelado por operação | **Aprovada** (direção técnica; as constraints são desenho a validar tecnicamente) | o aditivo exige contrato assinado? O que acontece com os aditivos se o contrato for cancelado ou encerrado (23) |
| **R4-P4 — Segurança do GED** | **Princípio obrigatório:** autorização efetiva no banco, nas APIs, nas funções, na busca, nas sugestões, nas atividades e na Central de Gestão. A proteção da `elaboracao` não pode depender só de configuração administrativa | **Aprovada** (princípio; os controles estão especificados no GED, revisão 3, e não implementados) | permissões reais do Drive compartilhado (24 e GED PENDENTE 12); nível mínimo na elaboração (17 (Contratos) / GED PENDENTE 14); forma de exibir a verificação da Fase 1 sem persistir metadados (GED PENDENTE 13) |
| **R4-P5 — Obrigações** | Na troca de modalidade, variante ou versão do modelo, **reavaliar cada obrigação**; reaproveitar uma concluída **só se continuar válida e compatível**, preservando o histórico, sem sobrescrever a original | **Aprovada parcialmente** | critério objetivo de "válida e compatível"; reaproveitamento automático ou com confirmação do gestor (25); controle de duplicidade, efeitos de cancelamento, reativação e reabertura e a rastreabilidade (requisitos a definir, 15.5) |
| **R4-P6 — Numeração** | Número do contrato **único por empresa, independentemente do tipo**, com **normalização de zeros à esquerda**. A regra do Financeiro não muda | **Aprovada parcialmente** | normalização de números compostos (ex.: `137/2026`), componentes numéricos e ano; compatibilidade com `rec_contratos.numero` e `rec_registrar_contrato`; colisões históricas antes de qualquer migração (8) |
| **R4-P7 — Encargos financeiros** | O módulo **Recebíveis** recebe e resolve a pendência de encargos, com prazo de **um dia útil** | **Aprovada parcialmente** | marco inicial do prazo; calendário de dias úteis e feriados; responsável operacional; interface no Recebíveis; atualização da especificação do Recebíveis pelo módulo dono (26) |
| **R4-P8 — Locação** | Manter **pendente** até confirmar se a Matriz usa o mesmo fluxo da filial | **Pendente de validação** | confirmação do fluxo da Matriz pelo Financeiro e pelo responsável (2); a proposta de recusar `emitir_nf_*` em modelos de locação continua proposta técnica |

**Separação usada no restante do documento:**
- **Regra de negócio aprovada:**
  - R4-P1 — Financiamento (liberação);
  - R4-P2 — PDF da minuta (avanço com PDF pendente);
  - R4-P5 — Obrigações (reavaliar e reaproveitar só o que continua válido);
  - R4-P6 — Numeração (unicidade por empresa e zeros à esquerda);
  - R4-P7 — Encargos financeiros (Recebíveis e um dia útil).
- **Direção técnica aprovada:**
  - R4-P1 — Financiamento (alerta pelo histórico de liberações);
  - R4-P3 — Aditivos (integridade);
  - R4-P4 — Segurança do GED (autorização efetiva).
- **Requisito técnico derivado:** consequência direta de uma aprovação, especificada aqui e ainda **a validar tecnicamente**.
- **Proposta técnica:** desenho da revisão 4 ainda sem aprovação própria.
- **Validação externa:** Fiscal, bancos, Financeiro, Comercial, administrador do Workspace.
- **Decisão de negócio pendente:** seção 13.

---

## 1. Objetivo
Acompanhar cada operação comercial da proposta fechada ao arquivamento, num **dossiê** único que reúne:
- cliente e proposta;
- solicitação e elaboração do contrato, minutas, aditivos, aprovação e assinatura;
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
  Outro banco pediu a NF "tão logo as formas sejam enviadas", e apareceu o "termo de entrega assinado". Esses fluxos **não** são regra
  do módulo: são amostras que justificam as variantes bancárias [PENDENTE 6].
- Os documentos ficam no Drive, em duas estruturas: elaboração e dossiê do cliente (ver o GED). O acompanhamento das etapas está na
  memória de quem faz.

## 3. Escopo
| Entra | Fica fora |
|---|---|
| Operação comercial (com ou sem contrato) e o dossiê | Emitir NF, boleto ou MDF-e; alterar pedido ou título no Consistem |
| Consultar modelos e arquivos de trabalho (raiz de elaboração, só a área Contratos [D-6]) e definitivos (dossiê do cliente), vinculando os dois à mesma operação | Mover, copiar, renomear ou reorganizar arquivos no Drive; criar a cópia de trabalho a partir do modelo |
| Solicitação de elaboração de contrato (fila) | Redigir a minuta no Neo Admin na v1 (segue nas skills; integração na fase 8) |
| Contrato operacional: minutas, versões, aprovação, assinaturas, **aditivos ligados ao contrato original** [D-3] (registro e evidência) | API de plataforma de assinatura (ForSign) na v1 |
| Autorização bancária: registro, documento, validação humana | Regras específicas de cada banco codificadas no programa |
| Ligação a pedidos, NFs (Comercial) e títulos (Recebíveis) por interfaces públicas | Ler tabelas internas de outros módulos; funções privilegiadas de resumo sem aprovação específica [PENDENTE 12] |
| Remessas: **contagem** de previstas × realizadas, com o vínculo manual a NF de remessa e termo de entrega [D-5] | Saldo por item, quantidade de equipamentos ou de peças [D-5]; cálculo fiscal, CFOP, tributação |
| Modelos de obrigações por modalidade e variante, configuráveis e versionados | Inferir obrigação ou condição a partir de texto |
| Trava de faturamento e pendência crítica "NF sem liberação" [D-7] | Bloquear a emissão no Consistem; notificação imediata própria [D-7] |
| Ligação com `rec_contratos` (contrato financeiro), sem duplicar; pendência ao Financeiro para os encargos [D-9] | Novo cadastro paralelo de encargos ou cessão; preencher encargos com 2% |
| **Locação:** operação, ciclo contratual (minutas, aprovação, assinatura, aditivos, encerramento) e obrigações documentais [D-1] | **Locação:** faturamento mensal, cálculo de aluguel, movimentação de equipamentos (REM × RET) e emissão de documentos fiscais, destinados a módulo próprio [D-1] |
| Número do contrato informado por uma pessoa, com validação de unicidade [D-8] | Sugestão ou geração automática de número [D-8] |

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
  - **Nenhum código preenche `rec_titulos.contrato_id`.**
  - Por isso a `rec_vw_titulos` aplica a multa e os juros padrão de 2% pelo `coalesce` (0116).
  - **Esta especificação não altera essa regra** [D-9], mas também não trata os 2% como condição negociada (5.6).
- `com_pedidos.contraparte_id` só é preenchido quando o cliente existe no núcleo. `numeroUltimaNF` vem sempre vazio. As NFs do
  tipo 12 não trazem `codPedido` (`docs/modulos/comercial-pedidos.md`).
- O MDF-e não informa as NFs (0702), então não liga à operação de forma automática.
- RLS existente: `com_*` exige `tem_acesso_modulo('comercial.pedidos')`; `rec_titulos` e `rec_notas_saida` exigem
  `tem_acesso_area('financeiro')`.
- A leitura de `pendencias` segue o **módulo** da pendência (`pendencias_ler`: `tem_acesso_modulo(modulo)`, 0002), mais o
  responsável e quem criou (`pendencias_ler_proprias`, 0092). `modulo_exibicao` só muda onde a pendência aparece na Central;
  **as permissões seguem `modulo`** (0097). Isso afeta a pendência de encargos (5.6.3 e seção 14).
- Os avisos da Central de Gestão (0098) são por evento e vêm **todos desligados**
  (`administrativo.gestao.notificacoes_eventos`). O módulo não cria aviso próprio [D-7]. Se o admin ligar o evento `atribuicao`, a
  pendência crítica gera o aviso comum de atribuição da Central, como qualquer outra.

### 4.2 Interfaces públicas que precisam ser criadas nos outros módulos [PROPOSTA]
Regra do projeto: um módulo não lê as tabelas internas de outro. Cada interface abaixo é construída **pelo módulo dono**, na faixa
dele, e documentada na especificação dele.

| Interface (nome proposto) | Módulo e faixa | Retorna | Segurança |
|---|---|---|---|
| `com_vw_pedidos_publico` | Comercial, 07xx | empresa, `cod_pedido`, situação, cliente (`contraparte_id`, código, nome), representante, datas (emissão, previsão de faturamento, último faturamento), valores (total, faturado, saldo) | `security_invoker`: exige acesso ao Comercial |
| `com_vw_notas_publico` | Comercial, 07xx | empresa, `cod_pedido`, nota, série, `chave_acesso`, situação, `cod_tipo_nota`, emissão, saída, valor | idem |
| `rec_vw_titulos_publico` | Financeiro, 01xx | empresa, cliente, documento, parcela, vencimento, valor, estágio, `nota_fiscal`, `chave_nfe`, boleto enviado em, data e valor pagos | `security_invoker`: exige o Financeiro |
| `rec_registrar_contrato(...)` / `rec_vincular_titulos_contrato(...)` | Financeiro, 01xx | ver 5.6 | `security definer`, checa o nível no Financeiro |
| ~~`ctr_vw_contratos_sem_encargos`~~ → **`ctr_contratos_sem_encargos()`** (sentido inverso: o Contratos oferece, o **Recebíveis** consulta) [R5, R4-P7 — Encargos financeiros] | Contratos, 03xx | só: empresa, cliente, número, tipo, data de assinatura e o indicador "contrato assinado está no dossiê do cliente: sim/não". **O id do documento `contrato_assinado` não é prometido nem devolvido** enquanto o GED PENDENTE 2 (leitura do dossiê pelo Financeiro) não for decidido; ver 5.6.3 [AF-21] | função `security definer` com `tem_acesso_area('financeiro','operador')`; nenhum dado de minuta, elaboração ou obrigação. A view anterior foi descartada (bloqueador E-2). Desenho a validar |
| Publicação e resolução da pendência de encargos [R5, R4-P7 — Encargos financeiros] | **Recebíveis** (`financeiro.recebiveis`), 01xx | pendência no módulo do Recebíveis, prazo de um dia útil; resolução com `rec_registrar_contrato` | construção e especificação são do Recebíveis [PENDENTE 26] |

**Quem não tem a área de origem** vê no dossiê o bloco "Pedidos e NFs" ou "Títulos" com o aviso "Sem acesso ao Comercial/Financeiro".
O dossiê **não contorna** a permissão. Funções `security definer` de resumo **não serão criadas** sem aprovação específica
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
1. Catálogo `ctr_modalidades`. O gestor da área edita; a v1 vem com as quatro abaixo.

   | Código | Nome | Exige contrato | Observação |
   |---|---|---|---|
   | `entrega_futura` | Venda para entrega futura | sim | cerca de 60% das operações (informado) |
   | `financiamento` | Financiamento sujeito à autorização bancária | **sim, sempre: contrato de compra e venda** [D-2] | exige autorização bancária validada para liberar o faturamento |
   | `avulsa` | Proposta avulsa (sem contrato) | não | segue para o faturamento |
   | `locacao` | Locação | sim [D-1] | ciclo contratual neste módulo; faturamento mensal e REM × RET em módulo próprio |

2. **Financiamento** [D-2]:
   - `exige_contrato = true`;
   - o contrato da operação tem de ser do tipo `venda` (compra e venda);
   - a operação **não satisfaz o requisito contratual** sem um `ctr_contratos` do tipo `venda` em situação `assinado` (5.5);
   - o que cada banco exige além disso continua **pendente** e entra como variante [PENDENTE 6];
   - **[R5 — aprovado, R4-P1 — Financiamento]:** a liberação para faturamento exige, ao mesmo tempo, contrato de compra e venda assinado
     e autorização bancária validada, verificados pela função de liberação (5.8.2);
   - **[R5 — pendente]:** ordem entre contrato e autorização e se o banco assina [PENDENTE 27]; quem pode dispensar a autorização, se a
     dispensa for mantida [PENDENTE 9].
3. **Locação** [D-1]:
   - a operação e o contrato (tipo `locacao`) seguem o mesmo ciclo dos demais: solicitação, minutas, aprovação, assinatura, aditivos
     e encerramento;
   - as obrigações documentais são as dos tipos genéricos (5.4.1) que o modelo de locação incluir;
   - **não há** regra de faturamento mensal, cálculo de aluguel, movimentação de equipamentos nem emissão de documentos fiscais;
   - as obrigações específicas, os responsáveis, os prazos e as integrações da locação continuam **pendentes** [PENDENTE 2];
   - o papel de NF `fatura_locacao` (5.9.2) só serve para **ligar e consultar** uma fatura já emitida, sem controlar o faturamento;
   - **[R5 — pendente, R4-P8 — Locação]:**
     - continua pendente a confirmação de que a locação da **Matriz** usa o mesmo fluxo do Faturamento Filial (`rec_kits`,
       `financeiro.filial`). A confirmação será pedida ao **Financeiro** e ao **responsável pelo processo** [PENDENTE 2];
     - o princípio continua: **não duplicar o faturamento existente**. O Contratos não recria faturamento mensal, dados de kits,
       demonstrativos nem boletos;
     - a proposta de a validação de modelos de `locacao` recusar tipos `emitir_nf_*` continua **proposta técnica a validar** (15.8).
4. **Variante** (`ctr_variantes`): uma subdivisão da modalidade com obrigações próprias, por exemplo um banco ou uma linha de
   financiamento. A v1 **não traz variantes cadastradas**: elas são criadas quando o responsável descrever as regras de cada banco
   [PENDENTE 6]. Não se inventam etapas para CAIXA/BNDES, BNB ou outros bancos.
5. A modalidade e a variante são escolhidas **por uma pessoa** na abertura. Trocar depois exige gestor e motivo, e reavalia as
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
   | `programar_remessas` | Programar remessas | evento: quantidade de remessas previstas informada (5.9.4) |
   | `acompanhar_remessas` | Acompanhar remessas | evento: realizadas = previstas (5.9.4) |
   | `enviar_documentos_banco` | Enviar documentos ao banco | manual + documento (tipos da variante) |
   | `regularizar_pdf_minuta` | Vincular o PDF enviado da minuta | evento: PDF vinculado à versão (5.5.3), criada pelo próprio módulo |
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
   - **A v1 entrega os modelos em rascunho**, montados com o responsável na fase de configuração C0 [PENDENTE 4].
   - Nenhum é ativado sem aprovação.
   - **Validações na ativação** (`ctr_validar_modelo`), que impedem ativar o modelo se falharem:
     - não há ciclo nas dependências;
     - todo item cita um tipo de obrigação ativo;
     - **modalidade `financiamento`** [D-2], o modelo (ou o modelo da variante) tem de ter, **sem condição de aplicação**, isto é,
       aplicável sempre:
       - um item `obter_assinaturas`, que exige contrato do tipo `venda` assinado;
       - um item `aguardar_autorizacao_bancaria` com `trava_faturamento = true`;
     - modalidade com `exige_contrato = true` (`entrega_futura`, `financiamento`, `locacao`): o modelo tem de ter um item
       `obter_assinaturas`.
   - Se o contrato também deve **travar o faturamento** no financiamento continua pendente: a decisão D-2 diz que o contrato é
     obrigatório, não quando ele trava [PENDENTE 4].
   - **[R4] Bloqueador F-1/F-2:** como está, uma operação de financiamento pode aparecer liberada sem contrato assinado. Há também a
     dúvida se o modelo da variante substitui ou complementa o da modalidade. Proposta: **R4-P1 — Financiamento** (seção 15.1).
   - **[R5 — aprovado, R4-P1 — Financiamento]:** a F-1 fica resolvida pela regra aprovada da 5.8.2. A **função de liberação** exige
     contrato de compra e venda assinado e autorização validada **independentemente do modelo**. A validação do modelo continua como
     segunda camada.
   - **[R5 — pendente]** F-2: o modelo da variante substitui ou herda o da modalidade [PENDENTE 20].
   - Para a liberação, não importa mais se o modelo marca a trava no contrato, porque a função já exige o contrato assinado. A
     configuração do modelo (ordem, dependências e trava) continua pendente [PENDENTE 4].
4. **Criação das obrigações**, ao abrir a operação ou ao mudar uma condição, a modalidade ou a variante. Para cada item do modelo vigente:
   - a condição dá **verdadeiro**: a obrigação é criada (ou mantida);
   - dá **falso**: não é criada; se já existia aberta, é cancelada com o motivo "deixou de se aplicar: <condição>";
   - é **desconhecida**: cria-se `informar_condicao` para o campo, e o item espera.
   A avaliação é uma função pura (`avaliarCondicao`, `planejarObrigacoes`) testada, chamada pela função SQL que grava.
5. Cada obrigação guarda o **modelo e a versão** que a criaram. Mudar o modelo não altera as operações em andamento. Elas só migram
   por ação explícita do gestor ("aplicar a versão nova"), com antes/depois.
6. **Dependências:** a obrigação com dependência não concluída fica `bloqueada`. Quando todas as dependências se resolvem, ela passa a
   `aberta`, ganha prazo (se relativo) e é publicada como pendência.
   - **Contam como resolvidas:** a dependência `concluida` e a `dispensada`.
   - **[AF-16] Dependência cancelada ou reaberta: regra ainda não definida.**
     - O tratamento da dependência `cancelada` ("deixou de se aplicar" ou operação cancelada), da reativação e da reabertura está só
       como **desenho a validar** (15.5, itens 3, 4 e 6).
     - **Não** é regra vigente que a cancelada conta como resolvida.
     - Até a validação técnica das regras O-1 a O-4 do relatório de revisão, esse caso fica **sem regra aprovada**, e a C4 continua
       bloqueada (seção 12).
     - Nada disso foi implementado nem testado.
   - **[R4] Bloqueador O-1 a O-4:** uma dependência cancelada nunca se resolve, e faltam as regras de reaplicação, troca de modelo e
     reabertura. Proposta: **R4-P5 — Obrigações** (seção 15.5).
   - **[R5 — aprovado, R4-P5 — Obrigações]:**
     - na troca de modalidade, variante ou versão do modelo, **cada obrigação é reavaliada**;
     - uma obrigação concluída só é reaproveitada se **continuar válida e compatível** com o novo contexto;
     - **o histórico é preservado:** a obrigação original nunca é sobrescrita para simular uma nova execução; o reaproveitamento é
       registrado à parte, com referência à original.
   - **[R5 — pendente]** requisitos a definir (15.5):
     - o critério objetivo de "válida e compatível";
     - reaproveitamento automático ou com confirmação do gestor [PENDENTE 25];
     - controle de duplicidade de obrigações ativas;
     - efeito de cancelamento, reativação e reabertura nas dependências;
     - rastreabilidade entre a obrigação original e a reaproveitada.
7. **Obrigação manual extra:** o operador pode acrescentar uma obrigação de qualquer tipo a uma operação (exceção da negociação),
   com motivo. Ela fica marcada como "fora do modelo".
8. **Dispensa:** só o gestor dispensa, com motivo, e só se o tipo permitir. A dispensa entra na linha do tempo e conta como resolvida
   para as dependências. **Uma obrigação que trava o faturamento só pode ser dispensada pelo nível definido em [PENDENTE 9].**
   - Na modalidade `financiamento`, o item `obter_assinaturas` **não é dispensável**. É uma leitura da D-2 (contrato obrigatório em
     toda operação) e precisa ser confirmada na validação interna.
   - **[AF-14] Item `aguardar_autorizacao_bancaria` no financiamento:**
     - **dispensar a obrigação não libera o faturamento**, porque a função de liberação continua exigindo a autorização `validada` e o
       contrato de compra e venda `assinado`, independentemente do modelo (R4-P1 — Financiamento, 5.8.2);
     - uma dispensa só fecha a obrigação e a pendência. Para mudar o efeito sobre a liberação, seria necessária uma regra própria,
       aprovada pelo responsável;
     - **continuam pendentes:** se a dispensa dessa obrigação será permitida e quem pode dispensar [PENDENTE 9].
9. **Conclusão:**
   - `manual`: confirmação da pessoa, com observação opcional;
   - `documento`: só conclui se `ged_tipos_presentes` tiver pelo menos um dos tipos exigidos **confirmado** e vinculado à operação
     (ou ao contrato dela); a pessoa confirma;
   - `evento`: o próprio fato conclui, e a tela mostra qual foi;
   - concluir não apaga nada: reabrir exige gestor e motivo.

### 5.5 Contrato operacional, minutas, aditivos e assinatura
1. `ctr_contratos`: no máximo **um contrato não cancelado por operação**. O contrato `encerrado` também conta para essa regra.
   - **[R5 — aprovado, direção técnica R4-P3 — Aditivos; AF-19]:** essa regra substitui "um contrato vigente", da revisão 3. O termo
     "vigente" não é usado como regra em nenhuma parte deste documento.
   - O índice correspondente é desenho a validar (15.3).
   - **"Contrato principal"** é o registro de `ctr_contratos`. Minutas e assinaturas dele são as linhas com `aditivo_id` nulo.

   Campos:
   - número;
   - tipo (`venda`, `locacao`, `servico`, `outro`, o mesmo domínio de `rec_contratos.tipo`);
   - situação;
   - assinado em;
   - meio de assinatura.
2. **Número do contrato** [D-8]:
   - **informado manualmente** por uma pessoa;
   - o sistema **não sugere nem gera** número e **não presume** padrão por tipo, ano ou modalidade;
   - ~~unicidade `(empresa_id, tipo, numero)`~~ (revisões 3 e 4; substituída na revisão 5);
   - **[R5 — aprovado, R4-P6 — Numeração]:** **o número é único por empresa, independentemente do tipo**, com **normalização de zeros à
     esquerda**. Desenho proposto, a validar tecnicamente e quanto à compatibilidade com o Financeiro:
     - `numero`, como digitado, mais `numero_normalizado`;
     - unicidade `(empresa_id, numero_normalizado)`;
   - número repetido é recusado com mensagem clara, sem corrigir sozinho;
   - **a regra do Financeiro não muda** (`rec_contratos`: `unique (empresa_id, numero)`, 0100);
   - **[R5 — pendente]** [PENDENTE 8]:
     - normalização de números compostos (ex.: `137/2026`): componentes numéricos e ano;
     - compatibilidade com `rec_contratos.numero` e com a busca de `rec_registrar_contrato`. Se o Financeiro guardar "0137" e o
       Contratos buscar "137", a ligação falha ou duplica;
     - levantamento e resolução de colisões históricas **antes de qualquer migração**;
     - nenhuma normalização de dados nem mudança de restrição foi executada;
   - **[R4] Bloqueador N-1 (para a fase C3):** com a chave anterior, a pendência de encargos podia ficar sem solução. A decisão R5
     remove a divergência de chave, mas a C3 continua bloqueada pelos itens pendentes acima.
3. **Minutas** (`ctr_minutas`) [D-4]. Cada versão registra:
   - número da versão (sequencial);
   - **arquivo de trabalho** no GED: tipo `contrato_minuta`, normalmente na raiz `elaboracao`, com a **revisão do Drive**
     (`drive_revisao`) **do momento do envio**, que é obrigatória ao marcar como enviada;
   - **PDF efetivamente enviado ao cliente** (`pdf_documento_id`), em qualquer raiz, com a **situação da evidência** (`pdf_situacao`).
     Na revisão 5, o ciclo de vida abaixo substitui os dois estados anteriores (`vinculado`/`ausente`). É **requisito técnico
     derivado** da R4-P2 — PDF da minuta, a validar:

     | Estado | Significado | Origem | Saídas |
     |---|---|---|---|
     | `vinculado_no_envio` | O PDF enviado foi vinculado ao registrar o envio, e está **confirmado no GED** | operador | final |
     | `pendente` | O PDF ainda não está disponível. Motivo obrigatório, autor e data registrados. **Nunca se associa outro arquivo para preencher** | operador | `regularizado`, `sem_pdf_justificado` |
     | `regularizado` | O PDF foi vinculado depois, uma vez, com autor e data, e está confirmado no GED | quem regulariza [R5 — pendente] | final |
     | `sem_pdf_justificado` | O envio não teve PDF, ou ele não pode ser recuperado. Justificativa e outra evidência | quem pode registrar [R5 — pendente] | final |

   - **Regras do vínculo do PDF** (normativas; o mecanismo é desenho a validar):
     - **[AF-10] Um PDF, uma versão.** Um PDF confirmado no GED só pode ser o PDF enviado de **uma** versão de minuta, do contrato ou de
       um aditivo. Vincular a outra versão um PDF já vinculado é recusado.
       - Mecanismo proposto, **não implementado**: índice único em `ctr_minutas.pdf_documento_id` quando preenchido (seção 8).
     - Para `vinculado_no_envio` e `regularizado`, o documento tem de estar **confirmado no GED** (`tipo_situacao = confirmado`, tipo
       `contrato_minuta` ou `aditamento`, PDF, `vigente`). Sem isso, a única opção é `pendente`.
     - **[AF-11] Fonte de verdade entre Contratos e GED: decisão pendente** [PENDENTE 30]. Hoje existem dois registros para a mesma
       evidência: `ctr_minutas.pdf_documento_id` (imutável depois do envio) e o vínculo ativo do GED (que admite desvínculo lógico,
       GED 5.7.3). Proposta a aprovar, **sem escolha feita**:
       - um único registro autoritativo para a evidência da versão enviada; o outro é derivado;
       - um documento referenciado como PDF enviado de uma versão não pode ser desvinculado no GED enquanto a referência existir;
       - se o documento sair do Drive ou do escopo (`removido_no_drive`, `fora_do_escopo`), a versão continua com a referência
         histórica, ganha a marca "evidência indisponível" e uma pendência de conferência. Ela **não** volta a `pendente` sozinha;
       - a sincronização entre os estados dos dois módulos fica documentada nos dois documentos.
   - **[R5 — aprovado, R4-P2 — PDF da minuta]:** o processo **pode avançar para assinatura** com `pdf_situacao = pendente`. Regras:
     - a ausência fica **visível e rastreável** em todo o ciclo, inclusive depois da assinatura, no dossiê e na linha do tempo;
     - **nenhuma tela, função ou relatório mostra o PDF como vinculado** enquanto o documento não estiver confirmado no GED e com
       vínculo ativo (`administrativo-ged.md`, 5.6.1);
     - a obrigação `regularizar_pdf_minuta` (origem `sistema`) é aberta ao registrar `pendente` e **não trava a passagem para
       `em_assinatura`**;
     - **[AF-2] Efeito do PDF pendente na liberação para faturamento: decisão pendente** [PENDENTE 29]. A decisão aprovada não trata do
       faturamento, e esta especificação **não presume** que o PDF pendente bloqueie nem que libere o faturamento. A frase "nem a
       liberação para faturamento", das versões anteriores desta revisão, foi retirada por ampliar a decisão;
     - a passagem `pendente` → `regularizado` ou `sem_pdf_justificado` é **auditada** (`fn_auditoria` + evento em `ctr_eventos`);
     - a decisão cobre o **avanço para assinatura**. **Não** autoriza, por si, que o contrato chegue a `assinado` com o PDF de alguma
       versão pendente: isso continua decisão pendente [PENDENTE 22];
     - **[AF-20] Aprovação da minuta com PDF pendente: inferência a confirmar.** O avanço para assinatura pressupõe, no fluxo atual, que
       a minuta foi aprovada. Isso **sugere**, mas não decide, que registrar a minuta como `aprovada` com o PDF pendente é permitido.
       Fica como **inferência pendente de confirmação** [PENDENTE 22]. Esta especificação não declara essa aprovação permitida nem
       bloqueada;
   - **[R5 — pendente]** [PENDENTE 22]: quem regulariza; o prazo; quem pode registrar `sem_pdf_justificado`; se o contrato pode chegar a
     `assinado` com PDF pendente; e a confirmação da inferência do AF-20;
   - **[R4] Bloqueador P-1/P-2** (revisão 4): os dois estados não bastavam e a obrigação de sistema não tinha regra de origem. O ciclo
     acima responde à P-1; a origem `sistema` responde à P-2 (15.5);
   - o **modelo de origem** (`modelo_documento_id`, um `modelo_contrato` do GED), opcional;
   - data de envio;
   - retorno do cliente (`ajustes`, `aprovada`), com data e observação.

   A versão nova marca a anterior como substituída. A minuta aprovada **do contrato principal** (`aditivo_id` nulo) conclui
   `aguardar_aprovacao_cliente`. A aprovação da minuta de um aditivo não conclui obrigação da operação [AF-19].

   Depois de **enviada**, a versão é **imutável**: arquivo de trabalho, revisão e PDF vinculado não mudam; uma correção vira nova versão.
   Isso preserva o histórico mesmo que o `.docx` continue sendo editado no mesmo arquivo do Drive. **Única exceção:**
   - com `pdf_situacao = pendente`, pode-se vincular o PDF **uma vez** (vai para `regularizado`), ou registrar `sem_pdf_justificado`;
   - a vinculação é auditada e fica na linha do tempo;
   - não se troca um PDF já vinculado.
4. **Partes e assinaturas** (`ctr_assinaturas`):
   - parte (`contratante`, `contratada`, `interveniente`, `testemunha`, `banco`);
   - signatário (nome, e-mail; opcional: `contato_id`);
   - meio (`plataforma`, com o nome da plataforma; `certificado_digital`; `fisica`);
   - situação (`pendente`, `assinada`, `recusada`);
   - data;
   - documento de evidência no GED.
   O contrato fica `assinado` quando **todas** as partes cadastradas estão `assinada` e há um documento `contrato_assinado` confirmado.
   **[R5 — aprovado, direção técnica R4-P3 — Aditivos; AF-19]:** "partes do contrato principal" são só as assinaturas com `aditivo_id`
   nulo. Assinaturas de aditivo não mudam a situação do contrato principal, e minutas de aditivo não levam o contrato a
   `em_negociacao`. Se o contrato pode ficar `assinado` com PDF de minuta pendente: [PENDENTE 22]. O efeito do cancelamento ou
   encerramento do contrato sobre os aditivos continua pendente [PENDENTE 23].
5. **Quatro registros que não se confundem** (exigência do responsável):

   | O quê | Onde está registrado | Como se chega lá | O que não basta |
   |---|---|---|---|
   | **Arquivo de trabalho** (`.docx`) | `ctr_minutas.documento_id` + `drive_revisao` (raiz `elaboracao`) | o operador vincula a versão | — |
   | **PDF enviado** | `ctr_minutas.pdf_documento_id` (`pdf_situacao = vinculado_no_envio` ou `regularizado`) | o operador vincula o arquivo que foi ao cliente, confirmado no GED | um PDF qualquer com nome parecido; o `.docx`; PDF não confirmado no GED |
   | **Minuta aprovada** | `ctr_minutas.situacao = aprovada`, **uma única** versão por contrato | o operador registra o aceite do cliente, com data e evidência opcional (e-mail ou anotação) | arquivo em PDF; nome com "final" |
   | **Contrato assinado** | `ctr_contratos.situacao = assinado` + documento `contrato_assinado` **confirmado** no GED, normalmente no dossiê do cliente | todas as assinaturas registradas (5.5.4) e o documento confirmado | minuta aprovada; PDF da minuta; arquivo com o mesmo nome do `.docx` |

   A tela mostra os quatro com selos distintos. A minuta aprovada nunca aparece como "contrato assinado".
6. **Aditivos** (`ctr_aditivos`) [D-3]:
   - **ficam ligados ao contrato original** (`contrato_id`) e não viram contrato independente por padrão;
   - **identificação:** número ou identificação informados por uma pessoa (sem geração automática, como em D-8), objeto e data;
   - **histórico próprio:** o aditivo tem situação (`em_elaboracao`, `enviado`, `aprovado`, `em_assinatura`, `assinado`,
     `cancelado`), minutas próprias (`ctr_minutas.aditivo_id`), assinaturas próprias (`ctr_assinaturas.aditivo_id`) e documentos no GED
     (tipo `aditamento`; o vínculo aponta para `ctr_aditivos`);
   - **rastreabilidade:** elaboração, versões, aprovação e assinatura seguem as mesmas regras de 5.5.3 a 5.5.5, inclusive a evidência
     do DOCX e do PDF enviado e a imutabilidade depois do envio;
   - **não altera sozinho o contrato original:** o aditivo **não substitui nem encerra** obrigações do contrato nem da operação.
     Mudanças decorrentes (uma condição nova, uma remessa a mais) são lançadas por uma pessoa, citando o aditivo como documento de
     origem (`ctr_operacao_condicoes.documento_id`). Criar obrigações a partir de aditivos por modelo próprio continua pendente
     [PENDENTE 7];
   - transformar um aditivo em contrato independente exige gestor e motivo; é uma exceção, não o padrão;
   - **[R4] Bloqueadores A-1 a A-4:** as unicidades com `aditivo_id` nulo não funcionam, falta FK composta, e as regras "do contrato"
     não excluem as minutas e assinaturas de aditivo. Proposta: **R4-P3 — Aditivos** (seção 15.3);
   - **[R5 — aprovado, direção técnica R4-P3 — Aditivos]:** corrigir a unicidade das versões, a integridade referencial entre aditivo,
     contrato, minuta e assinatura, a separação dos estados e verificações do contrato e dos aditivos, e a regra de contrato não
     cancelado por operação. As constraints, chaves compostas e índices parciais da 15.3 e da seção 8 são **desenho técnico a validar**,
     não implementação;
   - **[R5 — pendente]** [PENDENTE 23]: o aditivo exige o contrato original assinado? O que acontece com os aditivos quando o contrato
     original é cancelado ou encerrado?
7. Comunicação com o cliente: o envio da minuta segue a regra global, **rascunho no Gmail** (`modo_rascunho`) com o padrão de
   `gmail_contas` [EXISTE, 0153], e é registrado em `mensagens`/`interacoes`. Na v1 basta registrar "Enviada em" à mão.

### 5.6 Relação com `rec_contratos` (sem cadastro duplicado)
Papéis diferentes, um registro de cada lado e uma ligação 1:1:
- **`ctr_contratos` (Contratos):** o ciclo de vida do documento — minutas, aditivos, partes, assinatura, obrigações.
- **`rec_contratos` (Financeiro):** os parâmetros financeiros que a cobrança usa — multa, juros, cessão/cessionário — e a ligação
  com `rec_titulos.contrato_id`.

Regras:
1. `ctr_contratos.rec_contrato_id` (único, nulo até ligar) aponta para `rec_contratos.id`. O Contratos **não grava** em
   `rec_contratos` e **não altera** títulos do Financeiro.
2. A ligação é feita pela função do Financeiro `rec_registrar_contrato(p_empresa, p_contraparte, p_numero, p_tipo, p_multa_pct,
   p_juros_mes_pct, p_cedido, p_cessionario)` [PROPOSTA, faixa do Financeiro]:
   - procura `rec_contratos` por `(empresa_id, numero)`, que é a chave única existente;
   - se achar, devolve o id (e confere cliente e tipo, recusando divergência);
   - se não achar, cria;
   - exige `operador` no Financeiro.
3. **Encargos** [D-9]:
   - **a multa e os juros são informados pelo Financeiro**, a partir do contrato assinado;
   - nunca são lidos do texto, presumidos ou preenchidos com o padrão de 2,00%;
   - a função recebe os valores explicitamente e **recusa chamada sem eles** (nem o padrão da coluna nem nulo valem);
   - enquanto não forem informados:
     - o contrato financeiro não é criado;
     - o dossiê mostra "Encargos do contrato: aguardando o Financeiro";
     - **uma pendência para o Financeiro fica aberta** e só é encerrada quando a ligação acontece.
   - **[R5 — aprovado, R4-P7 — Encargos financeiros]:**
     - o módulo **Recebíveis** (`financeiro.recebiveis`) **recebe e resolve** a pendência de encargos;
     - o prazo é de **um dia útil**;
     - assim, a pendência é **publicada pelo Recebíveis**, no módulo dele, e não pelo Contratos. Isso resolve a visibilidade (I-1) sem dar
       ao usuário do Financeiro acesso à interface de Contratos.
   - **Requisitos técnicos derivados** (a validar e a construir pelo módulo dono):
     - o Contratos oferece a **função de consulta mínima** `ctr_contratos_sem_encargos()` [PROPOSTA]: `security definer`, acesso só com
       `tem_acesso_area('financeiro','operador')` (o que já exclui a `unidade_restrita`, 0152), devolvendo só empresa, cliente, número,
       tipo, data de assinatura e o indicador "contrato assinado está no dossiê do cliente: sim/não". O id do documento
       `contrato_assinado` só pode passar a ser devolvido depois da decisão do GED PENDENTE 2, e só a quem puder ler a raiz
       `dossie_cliente`;
       - **[AF-21] Dependência:** o id do documento só é devolvido se o usuário puder ler a raiz `dossie_cliente` pelo GED
         (`ged_pode_ler_raiz`). Hoje a leitura do dossiê pelo Financeiro ainda é proposta (GED PENDENTE 2). Até a decisão, a função
         **não devolve** o id do documento: devolve só o indicador "contrato assinado está no dossiê: sim/não";
       - nenhum outro identificador de documento ou de contrato além dos campos acima, e nenhum acesso geral a `ctr_contratos`;
       - continua **proposta técnica sujeita à validação** [PENDENTE 26];
     - a view `ctr_vw_contratos_sem_encargos` proposta na revisão 3 **deixa de ser usada** (bloqueador E-2: daria acesso a
       `ctr_contratos` inteira);
     - `rec_registrar_contrato` recebe **multa e juros explicitamente**; sem eles, recusa. Nunca se presume 2%;
     - a resolução acontece numa tela do Recebíveis, sem exigir acesso ao Contratos.
   - **[R5 — pendente]** [PENDENTE 26]:
     - o **marco inicial** do prazo;
     - o **calendário de dias úteis e feriados**: o projeto não tem calendário de feriados (Central de Gestão, §11), e esta tarefa não
       cria nenhum;
     - o **responsável operacional** pela resolução;
     - a **interface** no Recebíveis;
     - a **atualização da especificação do Recebíveis** (`docs/modulos/financeiro-recebiveis.md`) pelo módulo dono. Não foi feita aqui;
   - eventuais controles adicionais continuam pendentes [PENDENTE 10].
4. A regra atual da `rec_vw_titulos` (o `coalesce` com 2% quando o título não tem contrato) **não é alterada** por esta especificação.
   O dossiê mostra os títulos como o Financeiro os mostra, sem apresentar os 2% como condição contratada.
5. A ligação dos títulos ao contrato (`rec_titulos.contrato_id`) é feita pelo Financeiro, por uma função própria
   (`rec_vincular_titulos_contrato`) a partir dos títulos que o dossiê mostrar. O Contratos não altera `rec_titulos`.
6. Antes da ligação, o Financeiro precisa criar políticas de RLS para `rec_contratos`, que hoje não tem nenhuma. Sugestão, igual a
   `rec_titulos`: leitura com `financeiro` e escrita só pelas funções. A construção é do Financeiro, na faixa dele.

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
4. Só uma autorização **validada** conclui `aguardar_autorizacao_bancaria`. No financiamento, essa é **condição obrigatória para
   liberar o faturamento** (5.8.2), garantida pela validação do modelo (5.4.3).
5. A autorização bancária **não substitui** o contrato de compra e venda: no financiamento, as duas são exigidas [D-2].
6. As etapas que alguns bancos exigem antes da autorização (ex.: prévia da NF) ou depois (envio da NF, termo de entrega) entram como
   **itens do modelo da variante**, e não como regra fixa. Nenhuma está definida [PENDENTE 6].

### 5.8 Situação da operação e liberação para faturamento
1. **Situação da operação** (`ctr_situacao_operacao(id)`, calculada):
   - `cancelada` ou `encerrada` (estados explícitos);
   - senão, o **rótulo da obrigação aberta de menor ordem no modelo**, por exemplo "Em elaboração da minuta", "Aguardando
     assinatura" ou "Aguardando autorização bancária";
   - sem obrigações abertas e com todas concluídas: "Pronta para encerrar".
2. **Liberação para faturamento** (`ctr_faturamento_liberado(id)` → `nao_se_aplica` | `bloqueada` (com a lista de motivos) | `liberada`):
   - `liberada` quando todas as obrigações da operação marcadas `trava_faturamento` estão concluídas ou dispensadas pelo nível autorizado;
   - **[R5 — aprovado, R4-P1 — Financiamento]:** na modalidade **financiamento**, a função **só** devolve `liberada` quando há, **ao mesmo
     tempo**:
     1. contrato do tipo `venda` (compra e venda) em situação `assinado`, com o documento `contrato_assinado` confirmado;
     2. autorização bancária em situação `validada`.

     A verificação é feita **pela própria função, independentemente do modelo de obrigações**. Os motivos de `bloqueada` citam o que
     falta ("contrato de compra e venda não assinado", "autorização bancária não validada").
   - A validação do modelo (5.4.3) continua como **segunda camada**. Ela deixa de ser a única garantia;
   - ~~"no financiamento, se a falta do contrato também bloqueia a liberação depende do modelo"~~ (revisões 3 e 4): **substituído** pela
     regra aprovada acima. Fica pendente só a configuração do modelo [PENDENTE 4];
   - modalidade sem item de trava: `nao_se_aplica`, e a tela não exibe a liberação [PENDENTE 4]. Isso não se aplica ao financiamento,
     que sempre tem as duas verificações.
3. A passagem para `liberada` é registrada na linha do tempo, com quem concluiu a última obrigação de trava. Voltar para `bloqueada`
   (ex.: autorização substituída) também é registrado.
4. **"NF emitida sem liberação"** [D-7; R5 — aprovado, direção técnica R4-P1 — Financiamento; AF-1]:
   - **Regra única vigente.** Uma NF ligada à operação (5.9) gera o alerta quando, **pelo histórico dos eventos de liberação**
     (`ctr_eventos`: passou a `liberada`, voltou a `bloqueada`), **não havia liberação vigente na data de emissão** da NF.
     - **Reversão:** uma NF emitida numa data em que a operação estava liberada **não** gera alerta, mesmo que a operação volte a
       `bloqueada` depois.
     - **Mesmo dia** (requisito técnico derivado, a validar): a data de emissão é comparada com a **data local (America/Cuiaba)** dos
       eventos. Uma NF emitida no mesmo dia de uma mudança de liberação **não** gera alerta automático; fica marcada para conferência
       humana.
     - **Operações cadastradas depois do fato:** sem regra aprovada. Ver abaixo, AF-15.
   - ~~"quando: uma NF ligada à operação tem emissão anterior à liberação, ou existe com a operação `bloqueada`"~~ (revisões 3 e 4):
     **fora de vigência.** Fica só como histórico. A comparação direta com o estado atual gerava falsos positivos (F-3).
   - **O que acontece:** abre-se uma pendência de prioridade `critica` para o **gestor de Contratos**, com a chave
     `ctr:nf_sem_liberacao:<operacao>:<chave_nfe>`;
   - **nada é desfeito nem alterado no Consistem;**
   - a pendência e o evento na linha do tempo ficam para **análise humana**;
   - concluir a pendência exige uma observação (o que foi apurado), e nada apaga o registro do fato;
   - **não há notificação imediata própria** nesta versão. Vale só o que a Central de Gestão já faz, conforme a configuração dela (4.1);
   - **[R4] Bloqueador F-3** (histórico): a regra antiga disparava alarme falso em reversões, em operações cadastradas depois do fato e
     no mesmo dia. A regra única acima trata os dois primeiros casos; o terceiro depende do PENDENTE 21;
   - **[R5 — pendente]:** o **marco inicial de controle** para operações cadastradas depois do fato [PENDENTE 21]. Esta especificação
     **não define** nenhuma data, período de corte nem critério para separar essas operações;
   - **[AF-15] Comportamento provisório recomendado, sujeito à aprovação** [PENDENTE 31]:
     - sem o marco aprovado, não há como separar as operações afetadas;
     - por isso, a recomendação é manter a rotina que gera o alerta **desligada para todas as operações** até a decisão. Ela já nasce
       desligada (`contratos.operacoes.conferir_erp = false`, seção 6);
     - essa recomendação ainda **não foi aprovada** pelo responsável.
5. O Neo Admin **não impede a emissão no Consistem**. O que ele faz é deixar a situação visível e abrir a pendência crítica.

### 5.9 Pedidos, NFs, títulos e remessas
1. **Pedidos:** `ctr_operacao_pedidos (operacao_id, empresa_id, cod_pedido)`.
   - O operador escolhe numa lista dos pedidos do cliente, pela `com_vw_pedidos_publico`.
   - **Sugestão automática:** pedido do mesmo cliente digitado após a data da proposta.
   - Nunca se liga automaticamente.
2. **NFs:** `ctr_operacao_notas (operacao_id, empresa_id, nota, serie, chave_acesso, papel, papel_confirmado_por/em)`.
   - **Origem:** NFs dos pedidos ligados (`com_vw_notas_publico`) ou informadas pela chave de acesso de 44 dígitos (para as NFs sem
     pedido, como as do tipo 12).
   - **Papel:** `venda`, `entrega_futura`, `remessa`, `fatura_locacao` (só consulta, 5.2.3) ou `outra`.
     - **É confirmado por uma pessoa.**
     - A sugestão automática só existe se o Fiscal configurar a tabela `ctr_papel_por_tipo_nota (cod_tipo_nota → papel)` [PENDENTE 1].
     - Sem essa tabela, todas as NFs entram como "papel a confirmar".
   - NF cancelada (`situacao = 3` no espelho) aparece riscada e não conclui obrigação.
3. **Títulos:** vistos pela `rec_vw_titulos_publico`, de duas formas:
   - **pelas NFs ligadas** (`chave_nfe` ou empresa + `nota_fiscal`);
   - **por vínculo direto** (`ctr_operacao_titulos (operacao_id, empresa_id, documento, parcela)`), para títulos sem NF, como o sinal
     da amostra. A chave `(empresa, documento, parcela)` é a mesma `unique` de `rec_titulos`.
   O dossiê mostra vencimento, valor, estágio, boleto enviado e pago. O Contratos **não altera** título.
4. **Remessas: só contagem na v1** [D-5].
   - **Previstas:** `ctr_operacoes.remessas_previstas` (inteiro ≥ 0), informado por uma pessoa e auditado. Não se deduz do contrato
     nem do pedido.
   - **Registro de cada remessa** (`ctr_remessas`):
     - número de ordem;
     - data prevista (opcional);
     - observação em texto livre;
     - situação: `prevista`, `remetida`, `entregue` ou `cancelada`;
     - NF de remessa (vínculo manual a `ctr_operacao_notas` com papel `remessa`);
     - termo de entrega (vínculo manual a um documento `termo_entrega` do GED, quando o modelo exigir).
   - **Realizadas** = remessas `remetida` ou `entregue`, cada uma com a NF de remessa ligada.
   - **Indicador:** "Remessas: realizadas X de Y previstas". As canceladas não contam.
   - **Não há** saldo por item, quantidade de equipamentos ou de peças, nem comparação com os itens do pedido.
   - O MDF-e só é exibido quando o operador ligar um manifesto à remessa, porque a API não informa as NFs dele (0702).
   - O controle por item e quantidade do pedido é **evolução futura** [PENDENTE 13].

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
   - PDF de minuta ausente ou regularizado;
   - aditivo registrado ou assinado;
   - assinatura registrada;
   - autorização validada;
   - faturamento liberado ou bloqueado;
   - NF ligada;
   - NF sem liberação;
   - remessa remetida;
   - encargos informados pelo Financeiro.
   A `auditoria` (só admin geral) guarda o antes/depois técnico.
2. Todas as tabelas `ctr_*`:
   - `fn_auditoria` e `fn_bloquear_delete` (regra global 4: prova não se apaga);
   - cancelamento por situação.
3. Regras em `atividade_regras` para as ações principais ("Abriu a operação {proposta_numero}", "Validou a autorização bancária…").

### 5.12 Documentos de elaboração × arquivo do cliente
As duas estruturas do Drive têm finalidades diferentes e **não são duplicadas** (ver `administrativo-ged.md`, 2.1 e 5.2):

| Raiz do GED | Finalidade | O que o Contratos busca nela | Quem acessa [D-6] |
|---|---|---|---|
| `elaboracao` (`02 - COMERCIAL / 02 - CONTRATOS`, a confirmar) | arquivos editáveis de trabalho | modelos (por tipo de contrato) e arquivos de trabalho da minuta | **só a área Contratos**, e também conforme o GED e o Drive |
| `dossie_cliente` (`02 - COMERCIAL / 01 - CLIENTES`, a confirmar) | arquivo documental das operações | proposta original, documentação cadastral, contrato assinado, aditivos, NFs e demais definitivos | conforme as permissões definidas para essa raiz no GED |

Regras:
1. **Um dossiê, duas origens.** A operação reúne, por vínculos do GED com papéis distintos, os documentos das duas raízes:
   - `proposta_original` (dossiê);
   - `minuta_trabalho` vN (elaboração);
   - `minuta_enviada_pdf` vN (qualquer raiz) [D-4];
   - `contrato_assinado` (dossiê);
   - `autorizacao_bancaria`, `nf`, `termo_entrega`, `aditamento`.
   O arquivo **não precisa estar** numa pasta específica para ser vinculado.
2. **Nada é movido, copiado nem renomeado** para "completar" o dossiê. Se o contrato assinado ainda não está na pasta do cliente, o
   dossiê mostra "contrato assinado: faltando". Arquivar continua sendo feito pela pessoa, no Drive.
3. **Apoio à elaboração** (dentro do dossiê, aba Contrato; só para a área Contratos [D-6]):
   - **Modelos** do tipo de contrato (`ged_modelos`): os aprovados primeiro; os não avaliados com aviso. Escolher um modelo só registra
     `modelo_documento_id` na versão e abre o arquivo no Drive. **O Neo Admin não copia o modelo**: a cópia de trabalho é criada pela
     pessoa, no Drive, como hoje.
   - **Arquivos de trabalho** (`ged_buscar_trabalho`): busca pelo número do contrato ("229") ou pelo cliente, com **Abrir no Drive**
     e "Vincular como minuta vN".
4. **Sugestão de vínculo** (nunca automático):
   - ao informar o número do contrato, o sistema procura nas duas raízes arquivos que começam por "<número> - ", e no dossiê, propostas
     com o número da proposta da operação;
   - a pessoa confirma cada sugestão e o papel dela;
   - a sugestão usa a função pública `ctr_alvos_por_numero(p_numero_contrato, p_proposta)` [PROPOSTA], que o GED chama para propor
     vínculos (GED 5.4.8) sem ler as tabelas `ctr_*`;
   - para quem não é da área Contratos, a sugestão nunca traz arquivos da raiz `elaboracao`.
5. **O mesmo nome nas duas raízes** (ex.: `229 - CONTRATO … .docx` na elaboração e na pasta do cliente) são **dois documentos**. A
   pessoa escolhe qual é o arquivo de trabalho da minuta. O outro pode ser vinculado com outro papel ou ignorado. Nenhum dos dois
   "vira" o contrato assinado por estar no dossiê.
6. **Sem presunção pela extensão nem pela pasta:** um `.docx` na pasta de modelos não é um modelo aprovado; um `.pdf` no dossiê não é
   contrato assinado. Valem o tipo confirmado no GED e o estado registrado neste módulo.
7. **Permissões dos documentos** [D-6]:
   - **arquivos de elaboração:**
     - só os vê quem tem acesso à área Contratos e leitura na raiz `elaboracao` do GED;
     - abrir o arquivo ainda depende do Drive;
     - **consultar uma operação não dá acesso a eles**;
     - o nível mínimo dentro da área Contratos continua a definir [PENDENTE 17 (Contratos) / GED PENDENTE 14];
   - **dossiê do cliente:** os documentos aparecem conforme as permissões da raiz `dossie_cliente` no GED;
   - **sem contornar nada:** o dossiê usa só as funções do GED (`ged_documentos_do_alvo`), que respeitam a RLS. Não há função
     privilegiada para mostrar documentos;
   - **sem acesso, sem metadados:** quem não pode ver uma raiz recebe só o aviso fixo "Documentos de elaboração: acesso restrito à área
     Contratos" (ou o equivalente da outra raiz). O aviso **não revela** nomes, links, quantidades, datas nem tipos, e é o mesmo haja ou
     não documento;
   - o mesmo vale para as minutas na aba Contrato: quem não lê a raiz `elaboracao` vê a versão e o estado (enviada, aprovada), mas
     **não** o nome nem o link do arquivo de trabalho. O PDF enviado e o contrato assinado aparecem conforme a raiz em que estão;
   - **[AF-12] Identificadores e revisões também são metadados protegidos:**
     - `ctr_minutas.documento_id`, `ctr_minutas.drive_revisao`, `ctr_minutas.modelo_documento_id` e qualquer id de documento da raiz
       `elaboracao` guardado em tabelas `ctr_*` **não** podem ser entregues a quem não lê essa raiz pelo GED;
     - pertencer à área Contratos **não basta**, se a pessoa não tiver o nível exigido para ler a raiz;
     - como a RLS de `ctr_minutas` é por linha (área Contratos), essas colunas precisam ser servidas por projeção de campos autorizados
       (view ou função), por permissões por coluna, ou por mecanismo equivalente, **a validar**. A RLS por linha **não esconde
       colunas**;
     - a escolha do mecanismo depende do nível mínimo, ainda pendente [PENDENTE 17 (Contratos) / GED PENDENTE 14]: se o nível mínimo para ler a raiz for o mesmo
       nível mínimo da área Contratos, a projeção pode não ser necessária;
     - teste negativo: 10.2, item 7;
   - **[R4] Bloqueadores G-1 a G-5:** esconder na tela não é controle. A restrição precisa valer:
     - nas políticas de **todas** as tabelas `ged_*`;
     - nas funções (modo de segurança definido);
     - na `ctr_alvos_por_numero`;
     - nas descrições de atividades, pendências e Slack (sem nome de arquivo);
     - no acesso por id.
     Proposta: **R4-P4 — Segurança do GED** (seção 15.4). Dependência externa: os membros do Drive compartilhado (PENDENTE 24);
   - **[R5 — aprovado, R4-P4 — Segurança do GED]:** princípio obrigatório. A autorização é efetiva no banco, nas APIs, nas funções, na
     busca, nas sugestões, nas atividades e na Central de Gestão. A proteção da `elaboracao` **não depende só de configuração
     administrativa**. Os controles estão especificados no GED (`administrativo-ged.md`, revisão 3: 5.11, seção 9 e testes 11.5),
     **não implementados nem testados**. Consequências neste módulo:
     - `ctr_alvos_por_numero` verifica a autorização de quem pergunta e devolve vazio sem a área Contratos;
     - a regra de não colocar nome de arquivo vale também para `ctr_eventos`, `atividade_regras` do Contratos, títulos de pendência e
       mensagens do Slack ou ClickUp;
     - as rotas `/contratos/operacoes/[id]` e as funções que recebem id respondem "não encontrado" sem distinguir de "sem acesso";
   - **[R5 — pendente]:** permissões reais do Drive compartilhado (PENDENTE 24 (Contratos) / GED PENDENTE 12); nível mínimo na
     elaboração (PENDENTE 17 (Contratos) / GED PENDENTE 14).

## 6. Saídas e automações
1. **Pendências** (`publicar_pendencia`, módulo `contratos.contratos`, salvo indicação):

   | Pendência | Chave | Responsável | Prioridade |
   |---|---|---|---|
   | uma por obrigação `aberta` | `ctr:obrigacao:<id>` | o da obrigação | a do modelo |
   | "N solicitações de contrato aguardando" | `ctr:solicitacoes` | gestor de Contratos | normal |
   | "Vincular o PDF enviado da minuta vN — contrato <n>" (obrigação `regularizar_pdf_minuta`) [D-4, R4-P2 — PDF da minuta] | `ctr:obrigacao:<id>` | **a definir** [PENDENTE 22]; até lá, o responsável da operação (proposta) | normal (a validar); não trava a passagem para `em_assinatura`; efeito na liberação para faturamento: [PENDENTE 29] |
   | ~~"Informar encargos do contrato <n>"~~ — **não é publicada pelo Contratos desde a revisão 5** | — | **Recebíveis publica e resolve no módulo dele** (5.6.3) [R5 — aprovado, R4-P7 — Encargos financeiros] | prazo de **um dia útil**; marco e calendário [PENDENTE 26] |
   | "NF emitida sem liberação" [D-7] | `ctr:nf_sem_liberacao:<operacao>:<chave>` | gestor de Contratos | **`critica`** |

   - O `link` é `/contratos/operacoes/<id>`.
   - Ao concluir, dispensar ou cancelar a obrigação: `encerrar_pendencia('contratos.contratos', chave, 'concluida' | 'cancelada')`.
   - A obrigação `bloqueada` **não** vira pendência. Ela só aparece no dossiê, para não poluir a Fila do dia.
   - A pendência de encargos é do Recebíveis e só é encerrada por ele, quando o contrato financeiro é ligado com os encargos informados
     (5.6.3). O Contratos só oferece a função de consulta mínima.
   - Nenhum título ou descrição de pendência leva nome de arquivo [R4-P4 — Segurança do GED].
2. **Rotina de conferência** (pg_cron, desligada por `contratos.operacoes.conferir_erp = false`):
   - lê, pelas interfaces públicas, as NFs dos pedidos ligados;
   - sugere novas NFs para confirmação;
   - abre "NF emitida sem liberação" (5.8.4).
   Sem escrita no ERP.
3. **Notificações e ClickUp:** os da Central de Gestão [EXISTE, 0098], com a configuração dela. **Este módulo não cria notificação
   própria**, nem para a NF sem liberação [D-7].

## 7. Telas [PROPOSTA]
Todas as grades usam `components/ui/table.tsx`.

1. **Operações** (`/contratos/operacoes`):
   - grade com:
     - operação, cliente, proposta/revisão e valor;
     - modalidade/variante e situação calculada;
     - faturamento (selo bloqueado/liberado/não se aplica);
     - próxima obrigação, prazo e responsável;
     - remessas "X/Y";
   - filtros por modalidade (inclui `locacao`), situação, responsável, cliente, "faturamento bloqueado" e "NF sem liberação";
   - "Nova operação": cliente (busca em `contrapartes`), proposta, modalidade, variante, responsável e obra.
2. **Solicitações** (`/contratos/solicitacoes`): fila com aceitar (abrir a operação), marcar duplicada e cancelar.
3. **Dossiê** (`/contratos/operacoes/[id]`), em abas:
   1. **Resumo:**
      - cliente, modalidade/variante, situação e responsável;
      - faturamento, com os motivos do bloqueio;
      - no financiamento, "Contrato de compra e venda: assinado / pendente" e "Autorização bancária: validada / pendente" [D-2];
      - aviso **"NF emitida sem liberação"**, em destaque, enquanto a pendência estiver aberta [D-7];
      - condições informadas e a pendência de condição;
      - "Encargos do contrato: aguardando o Financeiro" quando for o caso [D-9].
   2. **Obrigações:** lista em ordem do modelo, com estado, dependências, responsável, prazo, documento exigido (ok/faltando/aguardando
      conferência) e as ações concluir, dispensar e incluir.
   3. **Documentos:** `<DocumentosDoRegistro>` do GED em dois blocos:
      - **Arquivo do cliente** (raiz `dossie_cliente`): definitivos, conforme a permissão da raiz;
      - **Em elaboração** (raiz `elaboracao`): arquivos de trabalho, **só para a área Contratos**. Os demais veem o aviso fixo de acesso
        restrito, sem nenhum metadado [D-6].
      Os blocos são agrupados por papel, com os faltantes destacados, e mostram a raiz de origem de cada arquivo.
   4. **Contrato:**
      - número (informado à mão [D-8]) e modelo usado;
      - minutas: versões, revisão do DOCX (**[AF-12] exibida só a quem pode ler a raiz `elaboracao` pelo GED**; para os demais, a
        tela não mostra a revisão, o id nem o nome do arquivo de trabalho, e não indica se ele existe. O nível exigido é o do
        [PENDENTE 17 (Contratos) / GED PENDENTE 14]; a regra vale na tela e nas consultas que a alimentam, e não só no banco), PDF enviado (situação da evidência: **vinculado no envio**, **pendente** com a pendência de regularização, **regularizado** ou **sem PDF justificado** [D-4, R5, 5.5.3]; o PDF só aparece como vinculado se estiver confirmado no GED), envio e
        retorno, com o selo da minuta aprovada;
      - **aditivos** ligados ao contrato, cada um com as próprias minutas, assinaturas e situação [D-3];
      - partes e assinaturas;
      - contrato assinado (documento confirmado ou "faltando");
      - ligação com o contrato financeiro e situação dos encargos [D-9];
      - **Modelos** e **Arquivos de trabalho** para abrir no Drive (5.12.3), só para a área Contratos.

      Na locação, a aba mostra o mesmo ciclo, sem nada de faturamento mensal [D-1].
   5. **Banco:** autorizações bancárias (aparece sempre no financiamento).
   6. **Pedidos e NFs:** pedidos ligados, NFs com papel e confirmação, aviso de NF sem liberação.
   7. **Títulos:** os da `rec_vw_titulos_publico` (ou o aviso de sem acesso).
   8. **Remessas:** "Realizadas X de Y previstas", lista com situação, NF de remessa e termo de entrega, sem saldo por item [D-5].
   9. **Histórico:** `ctr_eventos`.
4. **Modelos** (`/contratos/modelos`, gestor):
   - modalidades e variantes;
   - campos de condição;
   - tipos de obrigação;
   - modelos com itens, condições, dependências, prazos e trava;
   - o botão "Simular" mostra quais obrigações uma combinação de condições geraria, sem gravar;
   - "Ativar a versão" roda as validações de 5.4.3 e mostra o que impede a ativação (ex.: "financiamento sem autorização bancária
     com trava").

## 8. Dados [PROPOSTA] (migrations 0300+, prefixo `ctr_`)
Todas as tabelas:
- RLS por `tem_acesso_area('contratos', …)`;
- `fn_auditoria` e `fn_bloquear_delete`;
- `atualizado_em` com `fn_atualizado_em` onde couber;
- escrita das transições só por funções `security invoker` que checam o nível (como `rec_registrar_baixa`, 0107), ou `security definer`
  quando precisam publicar pendência.

| Tabela | Campos principais | Restrições |
|---|---|---|
| `ctr_modalidades` | `codigo` pk, `nome`, `exige_contrato`, `tipo_contrato_exigido` (ex.: `venda` no financiamento [D-2]), `ativa`, `ordem` | — |
| `ctr_variantes` | `id`, `modalidade`, `codigo`, `nome`, `banco_contraparte_id`, `ativa` | único `(modalidade, codigo)`; nenhuma pré-cadastrada |
| `ctr_condicao_campos` | `codigo` pk, `rotulo`, `tipo`, `opcoes jsonb`, `ajuda`, `modalidades text[]`, `ativo` | — |
| `ctr_obrigacao_tipos` | `codigo` pk, `nome`, `area`, `conclui_por` (`manual`/`documento`/`evento`), `evento`, `documentos_exigidos text[]` (→ `ged_tipos`), `dispensavel`, `ativo` | — |
| `ctr_modelos` | `id`, `modalidade`, `variante_id`, `versao`, `situacao` (`rascunho`/`vigente`/`encerrado`), `ativado_por/em`, `observacao` | um `vigente` por `(modalidade, variante_id)`; ativação só com `ctr_validar_modelo` sem erro (5.4.3) |
| `ctr_modelo_itens` | `id`, `modelo_id`, `ordem`, `obrigacao_tipo`, `condicao jsonb`, `prazo_dias`, `prazo_base` (`abertura`/`dependencias`/`campo:<codigo>`), `trava_faturamento`, `dispensavel_no_modelo`, `responsavel_padrao`, `papel_documento` | imutável depois de `vigente` |
| `ctr_modelo_dependencias` | `item_id`, `depende_de_item_id` | sem ciclos (checado ao ativar) |
| `ctr_operacoes` | `id`, `numero` (sequencial interno da operação, não é o número do contrato), `empresa_id`, `contraparte_id`, `modalidade`, `variante_id`, `proposta_numero`, `proposta_revisao`, `descricao`/`obra`, `valor_referencia numeric(14,2)` (informativo), `remessas_previstas int` (nulo = não informado) [D-5], `responsavel_id`, `origem`, `solicitacao_id`, `situacao_base` (`ativa`/`encerrada`/`cancelada`), `encerrada_por/em`, `cancelada_por/em`, `motivo_cancelamento`, `criado_por/em`, `atualizado_em` | único `(empresa_id, proposta_numero)`; `contraparte_id` obrigatório; `remessas_previstas >= 0` |
| `ctr_operacao_condicoes` | `operacao_id`, `campo`, `valor jsonb`, `informado_por/em`, `documento_id` (ex.: o aditivo de origem) | pk `(operacao_id, campo)`; histórico pela auditoria e por `ctr_eventos` |
| `ctr_obrigacoes` | `id`, `operacao_id`, `obrigacao_tipo`, `modelo_item_id`, `modelo_versao`, `fora_do_modelo`, `ordem`, `estado` (`bloqueada`/`aberta`/`concluida`/`dispensada`/`cancelada`), `responsavel_id`, `prazo`, `trava_faturamento`, `campo_condicao` (para `informar_condicao`), `minuta_id` (para `regularizar_pdf_minuta`), `concluida_por/em`, `conclusao_obs`, `dispensada_por/em`, `dispensa_motivo`, `cancelada_motivo`, `pendencia_chave` | **[R4-P5 — Obrigações; desenho a validar]:** `origem` (`modelo`/`sistema`/`manual`), `substitui_obrigacao_id`, `aproveitada_de_id`, `dependencia_reaberta_em`; índices únicos parciais `(operacao_id, modelo_item_id) where estado in ('bloqueada','aberta')` e `(operacao_id, campo_condicao) where obrigacao_tipo='informar_condicao' and estado in ('bloqueada','aberta')` |
| `ctr_obrigacao_dependencias` | `obrigacao_id`, `depende_de_id` | — |
| `ctr_solicitacoes` | ver 5.10; `message_id` único quando `origem = email` | — |
| `ctr_contratos` | `id`, `operacao_id`, `empresa_id`, `numero` (**informado manualmente** [D-8]), `numero_normalizado` [R4-P6 — Numeração], `tipo`, `situacao` (`em_elaboracao`/`em_negociacao`/`aprovado`/`em_assinatura`/`assinado`/`encerrado`/`cancelado`), `assinado_em`, `rec_contrato_id` (único), `encargos_situacao` (`aguardando_financeiro`/`informados`; calculado pela ligação) | ~~único `(empresa_id, tipo, numero)`~~ — **[R5 — aprovado, R4-P6 — Numeração]:** único `(empresa_id, numero_normalizado)`, independentemente do tipo, com normalização de zeros à esquerda; regra completa de normalização e compatibilidade com `rec_contratos` [PENDENTE 8]; **[R5 — aprovado, direção técnica R4-P3 — Aditivos]** índice único parcial `(operacao_id) where situacao <> 'cancelado'` (desenho a validar); sem sequência nem valor padrão para `numero` |
| `ctr_aditivos` [D-3] | `id`, `contrato_id` (obrigatório, FK para `ctr_contratos`), `identificacao` (informada à mão), `identificacao_normalizada` [AF-18: a mesma identificação reduzida a uma forma comparável, para que grafias diferentes do mesmo aditivo não passem como dois; a regra exata de normalização é **detalhe técnico a validar**], `objeto`, `data`, `situacao` (`em_elaboracao`/`enviado`/`aprovado`/`em_assinatura`/`assinado`/`cancelado`), `assinado_em`, `observacao`, `criado_por/em` | ~~único `(contrato_id, identificacao)`~~ (substituído) — **[R5 — aprovado como direção técnica, R4-P3 — Aditivos; constraints a validar]:** `unique (id, contrato_id)` (alvo da FK composta); único `(contrato_id, identificacao_normalizada)`; `identificacao` e `objeto` imutáveis depois de `enviado`; sem `delete`; não altera o contrato nem as obrigações sozinho |
| `ctr_minutas` | `id`, `contrato_id` (**obrigatório** [AF-3]), `aditivo_id` (nulo = minuta do contrato principal) [D-3], `versao`, `documento_id` (arquivo de trabalho), `drive_revisao`, `pdf_documento_id`, `pdf_situacao` (`vinculado_no_envio`/`pendente`/`regularizado`/`sem_pdf_justificado`, 5.5.3) [D-4, R5], `pdf_pendente_motivo`, `pdf_pendente_por/em`, `pdf_regularizado_por/em`, `pdf_justificativa`, `pdf_justificado_por/em`, `modelo_documento_id`, `enviada_em`, `retorno` (`ajustes`/`aprovada`), `retorno_em`, `observacao`, `situacao` (`em_elaboracao`/`enviada`/`ajustes_solicitados`/`aprovada`/`substituida`) | ~~único `(contrato_id, aditivo_id, versao)`~~ — **obsoleto, fora da lista vigente** [AF-17]: não funciona com `aditivo_id` nulo (A-1). **[R5 — aprovado como direção técnica, R4-P3 — Aditivos; constraints a validar, nada existe no banco]:** `contrato_id not null` e FK simples `contrato_id → ctr_contratos(id)`; FK composta `(aditivo_id, contrato_id) → ctr_aditivos (id, contrato_id)` (**[AF-3]** no PostgreSQL, com a regra padrão `MATCH SIMPLE`, a FK composta **não é verificada se qualquer coluna for nula**: por isso `contrato_id` tem de ser obrigatório e ter a sua própria FK; com `aditivo_id` nulo, a linha é do contrato principal, e a FK simples garante o contrato); índice único em `pdf_documento_id` quando preenchido (**[AF-10]** proposta, não implementada); índices únicos parciais `(contrato_id, versao) where aditivo_id is null`, `(aditivo_id, versao) where aditivo_id is not null`, `(contrato_id) where aditivo_id is null and situacao='aprovada'` e `(aditivo_id) where aditivo_id is not null and situacao='aprovada'`; `pdf_situacao` com os estados do R4-P2 — PDF da minuta (5.5.3), garantidos por gatilho; uma `aprovada` por contrato ou aditivo; ao ir para `enviada`: `documento_id`, `drive_revisao` e `pdf_situacao` obrigatórios; depois de `enviada`, imutável, salvo `situacao`, retorno e a saída única de `pdf_situacao = pendente` (para `regularizado` ou `sem_pdf_justificado`), auditada |
| `ctr_assinaturas` | `id`, `contrato_id` (**obrigatório** [AF-3]), `aditivo_id` (nulo = do contrato principal), `parte`, `nome`, `email`, `contato_id`, `meio`, `plataforma`, `situacao`, `assinado_em`, `documento_id` | **[R5 — direção técnica R4-P3 — Aditivos; constraints a validar]:** `contrato_id not null` com FK simples para `ctr_contratos`; FK composta `(aditivo_id, contrato_id) → ctr_aditivos (id, contrato_id)` (mesma ressalva do `MATCH SIMPLE`, AF-3); as regras do contrato principal filtram `aditivo_id is null` [AF-19] |
| `ctr_autorizacoes_bancarias` | ver 5.7 | — |
| `ctr_operacao_pedidos` | `operacao_id`, `empresa_id`, `cod_pedido`, `ligado_por/em`, `removido_por/em/motivo` | único ativo `(empresa_id, cod_pedido)`: um pedido em uma operação só [PENDENTE 14] |
| `ctr_operacao_notas` | ver 5.9.2 | único ativo `(empresa_id, nota, serie)` |
| `ctr_operacao_titulos` | `operacao_id`, `empresa_id`, `documento`, `parcela`, `ligado_por/em`, `removido_*` | único ativo `(empresa_id, documento, parcela)` |
| `ctr_papel_por_tipo_nota` | `empresa_id`, `cod_tipo_nota`, `papel`, `definido_por/em` | vazia até o Fiscal preencher [PENDENTE 1] |
| `ctr_remessas` [D-5] | `id`, `operacao_id`, `ordem`, `data_prevista`, `observacao`, `situacao` (`prevista`/`remetida`/`entregue`/`cancelada`), `nota_id` (→ `ctr_operacao_notas`, papel `remessa`), `remetida_em`, `entregue_em` | `remetida`/`entregue` exigem `nota_id`; **sem colunas de quantidade ou item** |
| `ctr_eventos` | `id` bigserial, `operacao_id`, `tipo`, `descricao`, `referencia_tabela`, `referencia_id`, `usuario_id`, `em` | imutável |

Views e funções públicas do módulo [PROPOSTA]:
- ~~`ctr_vw_contratos_sem_encargos`~~ → `ctr_contratos_sem_encargos()`: consulta mínima pelo Recebíveis (4.2, 5.6.3) [R5, R4-P7 — Encargos financeiros];
- `ctr_alvos_por_numero(...)`: usada pelo GED (5.12.4);
- `ctr_validar_modelo(modelo)`, `ctr_faturamento_liberado(operacao)`, `ctr_situacao_operacao(operacao)`.

Os documentos não têm tabela própria no Contratos: são **vínculos do GED** com `modulo = 'contratos.contratos'` e `tabela` igual a
`ctr_operacoes`, `ctr_contratos`, `ctr_aditivos`, `ctr_minutas`, `ctr_assinaturas`, `ctr_autorizacoes_bancarias`, `ctr_remessas` ou
`ctr_obrigacoes` (registradas em `ged_alvos`).

### 8.1 Relacionamentos
```
contrapartes 1─N ctr_operacoes N─1 ctr_modalidades / ctr_variantes
ctr_solicitacoes 0..1─1 ctr_operacoes
ctr_operacoes 1─N ctr_operacao_condicoes N─1 ctr_condicao_campos
ctr_operacoes 1─N ctr_obrigacoes N─1 ctr_modelo_itens N─1 ctr_modelos ; ctr_obrigacoes N─N (dependências)
ctr_obrigacoes 1─0..1 pendencias (chave_origem 'ctr:obrigacao:<id>')
ctr_operacoes 1─0..1 ctr_contratos (não cancelado; AF-19) 1─N ctr_minutas / ctr_assinaturas (aditivo_id nulo = contrato principal)
ctr_contratos 1─N ctr_aditivos 1─N ctr_minutas / ctr_assinaturas (aditivo_id)
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
| Obrigação | `bloqueada` → `aberta` (sistema, dependências resolvidas) → `concluida` (operador/evento) · `aberta`/`bloqueada` → `dispensada` (gestor, se dispensável) · qualquer não final → `cancelada` (sistema: deixou de se aplicar / operação cancelada) · `concluida` → `aberta` (reabrir, gestor) | — |
| Contrato | `em_elaboracao` → `em_negociacao` (1ª minuta enviada) → `aprovado` (minuta aprovada) → `em_assinatura` → `assinado` (5.5.4) → `encerrado` (gestor; ex.: termo de quitação) · qualquer → `cancelado` (gestor) | — |
| Aditivo [D-3] | `em_elaboracao` → `enviado` → `aprovado` → `em_assinatura` → `assinado` · qualquer não final → `cancelado` (gestor, motivo) | operador; cancelar: gestor |
| Minuta | `em_elaboracao` → `enviada` → `ajustes_solicitados` \| `aprovada`; versão nova → anterior `substituida`. PDF: `vinculado_no_envio` (final) ou `pendente` → `regularizado` \| `sem_pdf_justificado` (uma vez, auditado) [D-4, R5]. Com `pendente`, o contrato pode avançar para `em_assinatura` [R5 — aprovado, R4-P2 — PDF da minuta] | quem regulariza e quem justifica: [PENDENTE 22] |
| Autorização bancária | `aguardando` → `recebida` → `validada` \| `recusada`; nova → anterior `substituida` | validar: nível do PENDENTE 9 |
| Solicitação | `recebida` → `em_conferencia` → `aceita` → `atendida`; → `cancelada`/`duplicada` | — |
| Remessa [D-5] | `prevista` → `remetida` (com NF de remessa) → `entregue`; → `cancelada` | — |
| Encargos do contrato [D-9] | `aguardando_financeiro` → `informados` (quando o Recebíveis liga `rec_contrato_id` com os valores) | Recebíveis [R5, R4-P7 — Encargos financeiros] |
| Faturamento (calculado) | `nao_se_aplica` · `bloqueada` ↔ `liberada` | — |

## 9. Permissões (área `contratos`)
| Nível | Pode |
|---|---|
| `consulta` | ver operações, dossiê e histórico. Os blocos de Comercial e Financeiro seguem a permissão dessas áreas; os documentos seguem as permissões das raízes do GED |
| `operador` | criar operação e solicitação; informar condições e remessas previstas; concluir obrigação; incluir obrigação fora do modelo; registrar minutas (com DOCX/revisão e PDF ou ausência), aditivos, assinaturas, autorização recebida, remessas; informar o número do contrato; ligar pedidos, NFs e títulos; confirmar o papel da NF; vincular documentos (nas raízes em que tiver permissão de operação no GED) |
| `gestor` | trocar modalidade ou variante; dispensar e reabrir obrigação dispensável; validar autorização bancária [PENDENTE 9]; cancelar e encerrar operação; cancelar aditivo; concluir a pendência de NF sem liberação; editar e ativar modelos, catálogos e `ctr_papel_por_tipo_nota` [PENDENTE 1] |
| `admin_geral` | tudo; ativar o módulo |

Regras adicionais:
- **Arquivos de elaboração** [D-6]:
  - só a área Contratos, e conforme o GED e o Drive; o nível mínimo continua pendente [PENDENTE 17 (Contratos) / GED PENDENTE 14];
  - quem tem só outras áreas, ou acessa a operação por um link da Fila do dia, não vê nome, link nem metadado dos arquivos da raiz
    `elaboracao`.
- **Financeiro (operador na área `financeiro`):** informa os encargos e liga o contrato financeiro pela função dele (5.6). Não precisa
  de acesso à área Contratos para tratar a pendência de encargos, desde que a pendência seja publicada de forma visível a ele (5.6.3).
- **Comercial:** acesso de consulta em Contratos, se concedido, segue as mesmas regras [PENDENTE 12].
- **Nenhuma função privilegiada** de resumo de dados do Comercial ou do Financeiro é criada sem aprovação específica [PENDENTE 12].

## 10. Testes (planejados; não implementados)

### 10.1 Vitest (`lib/modulos/contratos/operacoes/*.test.ts`)
1. `avaliarCondicao`:
   - todos os operadores;
   - `todas` e `alguma`;
   - campo não informado dá desconhecido (não falso);
   - campo inexistente gera erro de configuração.
2. `planejarObrigacoes`:
   - avulsa: nenhuma obrigação de contrato;
   - entrega futura com e sem uma condição (exemplos fictícios de teste);
   - locação: ciclo contratual sem nenhuma obrigação de faturamento mensal [D-1];
   - condição desconhecida gera `informar_condicao` e o item fica esperando;
   - condição muda de verdadeiro para falso: cancela a obrigação aberta com motivo;
   - mudar o modelo não altera a operação antiga.
3. Dependências:
   - abre só quando todas se resolvem;
   - dispensa conta como resolvida;
   - ciclo é recusado ao ativar o modelo.
4. Prazos: relativos à abertura, à conclusão de dependências e a um campo de data, contados em dias corridos (não há calendário de dias
   úteis no projeto, ver a Central de Gestão §11). Datas no fuso America/Cuiaba.
5. `faturamentoLiberado` [R5 — aprovado, R4-P1 — Financiamento]:
   - financiamento sem autorização validada nunca libera;
   - autorização `recebida` não libera;
   - **financiamento com autorização validada e sem contrato de compra e venda `assinado` não libera, mesmo que o modelo não tenha
     trava no contrato** (a função verifica independentemente do modelo);
   - contrato `venda` assinado **e** autorização validada liberam;
   - substituída volta a bloquear.
5a. **Alerta "NF sem liberação" pelo histórico** [R5 — aprovado, direção técnica R4-P1 — Financiamento]:
   - NF emitida enquanto a operação estava liberada não gera alerta depois de um novo bloqueio;
   - NF emitida numa data sem liberação vigente gera alerta;
   - NF do mesmo dia da liberação fica marcada para conferência (requisito derivado, a validar);
   - operação antiga: depende do marco inicial [PENDENTE 21]. O teste fica pendente até a decisão.
6. **`validarModelo`** [D-2]:
   - modelo de financiamento sem `obter_assinaturas` sem condição: recusado;
   - sem `aguardar_autorizacao_bancaria` com trava: recusado;
   - com o item de autorização condicionado (não aplicável sempre): recusado;
   - modelo de modalidade que exige contrato sem `obter_assinaturas`: recusado.
7. **Financiamento sem contrato de compra e venda** [D-2]:
   - a operação não satisfaz o requisito contratual sem um contrato `venda` `assinado`;
   - um contrato `locacao` ou `servico` não satisfaz;
   - `obter_assinaturas` não pode ser dispensado nessa modalidade.
8. Contrato `assinado`:
   - só com todas as partes assinadas **e** o documento `contrato_assinado` confirmado;
   - minuta aprovada não basta;
   - PDF da minuta não basta.
9. **Minutas** [D-4; R5 — aprovado, R4-P2 — PDF da minuta]:
   - uma única `aprovada` por contrato ou aditivo;
   - marcar `enviada` exige a revisão do DOCX e `pdf_situacao`;
   - com `pdf_situacao = pendente`, a ausência fica explícita, o motivo é obrigatório e a obrigação `regularizar_pdf_minuta` é criada;
   - **com `pdf_situacao = pendente`, o contrato pode passar a `em_assinatura`**, e a pendência continua aberta e visível;
   - nenhuma consulta devolve o PDF como vinculado enquanto `pdf_situacao = pendente` ou o documento não está confirmado no GED;
   - `pendente` → `regularizado` só com PDF confirmado no GED e não vinculado a outra versão; a transição é auditada e conclui a
     obrigação; não se troca o PDF já vinculado;
   - **[AF-10]** vincular a uma segunda versão (do mesmo contrato, de outro contrato ou de um aditivo) um PDF já vinculado a uma versão
     é recusado, tanto no envio quanto na regularização;
   - **[AF-2]** nenhum teste presume efeito do PDF pendente sobre a liberação para faturamento. O teste fica a definir depois do
     [PENDENTE 29];
   - **[AF-11]** os testes de sincronização entre `ctr_minutas` e o vínculo do GED (desvínculo bloqueado, documento indisponível)
     ficam a definir depois do [PENDENTE 30];
   - **se o contrato pode chegar a `assinado` com PDF pendente**: teste a definir depois do [PENDENTE 22];
   - a versão enviada não aceita troca de arquivo nem de revisão;
   - a versão nova substitui a anterior sem apagá-la.
10. **Aditivo** [D-3; R5 — direção técnica aprovada, R4-P3 — Aditivos]:
    - fica ligado ao contrato original;
    - não cria contrato novo;
    - tem minutas e assinaturas próprias;
    - assinar o aditivo não conclui, cancela nem altera obrigações do contrato original nem da operação;
    - a assinatura pendente de um aditivo não muda a situação do contrato; a aprovação da minuta de um aditivo não conclui
      `aguardar_aprovacao_cliente` do contrato.
10a. **Obrigações na troca de modelo** [R5 — aprovado, R4-P5 — Obrigações]. Testes necessários. Os resultados esperados dependem:
     - para cancelamento, reativação e reabertura, da **validação técnica das regras de dependência O-1 a O-4**, ainda pendente
       (5.4.6, AF-16; bloqueio da C4);
     - para o reaproveitamento, do critério de "válida e compatível" [PENDENTE 25].
    - **cancelamento** por condição que deixou de valer: **[AF-16]** o efeito sobre as dependentes **não está definido**. O teste não
      presume que a obrigação cancelada conta como resolvida; o resultado esperado será escrito quando as regras O-1 a O-4 forem
      validadas e aprovadas;
    - **reativação** (**conforme a proposta da seção 15.5, item 4, a validar** junto com as regras O-1 a O-4; não é regra aprovada nem
      resultado garantido) [R-1]: o resultado esperado proposto é criar uma obrigação nova, rastreável até a cancelada, sem duas
      ativas do mesmo item;
    - **troca de modalidade, variante ou versão:** cada obrigação é reavaliada; uma concluída só é reaproveitada se passar no critério
      de "válida e compatível"; a original continua intacta e o reaproveitamento aponta para ela;
    - **dependências:** reaproveitar ou cancelar não deixa dependente em estado incoerente;
    - **reabertura** (**conforme a proposta da seção 15.5, item 6, a validar** junto com as regras O-1 a O-4; não é regra aprovada nem
      resultado garantido) [R-1]: o resultado esperado proposto é que as dependentes não concluídas voltem a `bloqueada` e as
      concluídas fiquem marcadas para conferência.
11. **Remessas** [D-5]:
    - "realizadas X de Y" conta só `remetida`/`entregue` com NF de remessa;
    - canceladas não contam;
    - nenhuma função calcula saldo por item ou quantidade;
    - `remessas_previstas` nulo aparece como "não informado".
12. Elaboração × dossiê:
    - a mesma operação aceita vínculos de documentos das duas raízes;
    - arquivos com o mesmo nome nas duas raízes ficam como vínculos distintos;
    - a sugestão pelo número "229" encontra os arquivos das duas raízes **para a área Contratos** e só os do dossiê para os demais;
    - nada é vinculado sem confirmação.
13. Chave de operação: Rev02 e Rev03 do mesmo número caem na mesma operação; números diferentes, em operações diferentes.
14. Papel da NF: sem `ctr_papel_por_tipo_nota`, sempre "a confirmar".
15. **Numeração** [D-8; R5 — aprovado, R4-P6 — Numeração]:
    - não existe função de sugestão nem de geração de número;
    - o número vazio é recusado;
    - **o mesmo número na mesma empresa é recusado, qualquer que seja o tipo** (venda × locação);
    - "0137" e "137" na mesma empresa são o mesmo número (zeros à esquerda);
    - o mesmo número em empresas diferentes é aceito;
    - números compostos (ex.: `137/2026`): testes a definir depois do [PENDENTE 8].

### 10.2 SQL (PGlite, `tests/db`)
1. RLS:
   - sem a área `contratos`, nada é visível;
   - `consulta` não grava;
   - `operador` não dispensa;
   - `gestor` dispensa com motivo.
2. Sem `delete` em nenhuma `ctr_*`; `ctr_eventos` é imutável.
3. Um modelo `vigente` por modalidade/variante; item de modelo vigente é imutável; ativação bloqueada quando `ctr_validar_modelo` falha.
4. O pedido, a NF e o título já ligados a outra operação são recusados [PENDENTE 14].
5. As pendências:
   - abrir a obrigação publica uma pendência (`chave_origem` correta);
   - concluir encerra;
   - rodar duas vezes não duplica;
   - a bloqueada não publica.
6. `ctr_contratos.rec_contrato_id` é único; o Contratos não tem permissão de `insert`/`update` em `rec_contratos` nem em `rec_titulos`.
7. **Usuário sem permissão de Contratos** [D-6]:
   - nenhuma consulta pelo dossiê, pela busca ou pela sugestão de vínculo devolve documento da raiz `elaboracao`, nem nome, link ou
     contagem;
   - um usuário de Contratos sem leitura na raiz `elaboracao` do GED também não vê;
   - [R5 — R4-P4 — Segurança do GED] valem também os testes de autorização do GED (`administrativo-ged.md`, 11.5): acesso por id,
     funções, atividades da Central (usuário com `acompanha_equipe` sem a área Contratos não vê nome de arquivo) e `ctr_alvos_por_numero`
     vazia sem a área Contratos;
   - **[AF-12]** um usuário que não lê a raiz `elaboracao` não obtém, por consulta direta à API ou pela tela, `documento_id`,
     `drive_revisao` nem `modelo_documento_id` de `ctr_minutas` (teste por coluna, e não só por linha). O resultado esperado depende
     do mecanismo e do nível mínimo [PENDENTE 17 (Contratos) / GED PENDENTE 14].
8. **NF sem liberação** [D-7; R5 — R4-P1 — Financiamento]:
   - NF ligada emitida numa data sem liberação vigente (pelo histórico de liberações) abre uma pendência `critica` para o gestor de
     Contratos (chave única: não duplica);
   - NF emitida enquanto estava liberada não abre pendência depois de um novo bloqueio;
   - NF emitida no mesmo dia (data local de Cuiabá) de uma mudança de liberação não abre pendência automática; fica marcada para
     conferência;
   - operações cadastradas depois do fato: teste a definir depois do [PENDENTE 21] / [PENDENTE 31];
   - nenhuma linha é gravada em `notificacoes` pelo módulo;
   - nada é escrito em tabelas do Comercial.
9. **Encargos não informados** [D-9; R5 — aprovado, R4-P7 — Encargos financeiros]:
   - contrato `assinado` sem `rec_contrato_id` aparece em `ctr_contratos_sem_encargos()` para um operador do Financeiro, sem dar a ele
     acesso a nenhuma tabela `ctr_*`;
   - a função devolve vazio para quem não tem `financeiro` operador e para o usuário com `unidade_restrita`;
   - **[AF-21]** sem a decisão do GED PENDENTE 2, a função não devolve o id do documento, só o indicador sim/não;
   - a função não devolve dados de minuta, elaboração ou obrigação;
   - a pendência é do Recebíveis (testes na especificação dele, a ser atualizada pelo módulo dono); o prazo de um dia útil depende do
     marco e do calendário [PENDENTE 26];
   - `rec_registrar_contrato` sem multa ou juros é recusado;
   - nenhum caminho grava 2% como encargo contratual;
   - a `rec_vw_titulos` não muda.

### 10.3 Playwright
1. Criar uma operação avulsa: aparecem só as obrigações do modelo avulsa, e nenhuma aba de contrato.
2. Financiamento [R5 — R4-P1 — Financiamento]:
   1. o selo mostra "Faturamento bloqueado: aguardando autorização bancária" e "contrato de compra e venda não assinado";
   2. o Resumo mostra "Contrato de compra e venda: pendente";
   3. registrar a autorização recebida não muda o selo;
   4. validar a autorização **sem** o contrato assinado mantém o bloqueio;
   5. com o contrato assinado **e** a autorização validada, muda para liberado.
3. Entrega futura: minuta V1 enviada (com DOCX e PDF) → ajustes → V2 enviada com o PDF **pendente** (aparece a pendência de
   regularização) → V2 aprovada → **contrato em assinatura com o PDF ainda pendente**, com o selo de evidência pendente visível
   [R5 — R4-P2 — PDF da minuta] → PDF regularizado → assinaturas → obrigação "Obter assinaturas" concluída; histórico completo na aba
   Histórico. A variante "assinaturas concluídas com o PDF ainda pendente" fica para depois do [PENDENTE 22].
4. Aditivo: registrar um aditivo no contrato assinado; ele aparece na aba Contrato com histórico próprio e as obrigações da operação
   não mudam.
5. Remessas: "Realizadas 1 de 3 previstas" depois de uma remessa com NF de remessa.
6. Usuário sem Financeiro: a aba Títulos mostra "Sem acesso ao Financeiro".
7. Usuário sem Contratos (ou sem a raiz de elaboração): a aba Documentos mostra só o aviso fixo de acesso restrito no bloco "Em
   elaboração", sem nomes nem links.
8. NF sem liberação: a pendência crítica aparece na Fila do dia do gestor de Contratos e o aviso no Resumo; nenhuma notificação própria
   é enviada.

## 11. Critérios de aceite (planejados; não executados)
1. **Dossiê (Fase 3 do plano):**
   - operações reais cadastradas e com documentos vinculados, uma de cada modalidade: entrega futura, financiamento, avulsa e locação;
   - nenhum cliente ou contrato financeiro duplicado;
   - os pedidos, as NFs e os títulos aparecem para quem tem acesso às áreas;
   - quem não tem Contratos não vê nenhum arquivo de elaboração.
2. **Solicitações (Fase 5):** uma solicitação manual vira operação em um passo e aparece como pendência até ser aceita.
3. **Versões, aditivos e assinatura (Fase 6):**
   - histórico V1 → V2 → aprovada → assinada visível;
   - cada versão enviada tem a revisão do DOCX e o PDF enviado, ou a ausência explícita com pendência de regularização [D-4];
   - um contrato avança para assinatura com o PDF de uma versão pendente, e a ausência continua visível e rastreável [R5, R4-P2 — PDF
     da minuta]; nenhum PDF aparece como vinculado sem confirmação no GED;
   - o contrato só fica `assinado` com o documento confirmado (com PDF de minuta pendente: [PENDENTE 22]);
   - numa operação real, a proposta original (dossiê), as versões da minuta (elaboração) e o contrato assinado (dossiê) aparecem juntos
     no dossiê, sem nenhum arquivo movido, copiado ou renomeado no Drive;
   - a minuta aprovada e o contrato assinado têm selos diferentes;
   - um aditivo real fica registrado ligado ao contrato original, com o próprio histórico, e as constraints da direção técnica R4-P3 —
     Aditivos foram validadas tecnicamente [D-3, R5];
   - o número do contrato foi informado à mão e é único por empresa, independentemente do tipo, com zeros à esquerda normalizados
     [D-8, R5, R4-P6 — Numeração]; colisões históricas levantadas antes de qualquer migração.
4. **Obrigações e trava (Fase 7):**
   - os modelos aprovados pelo responsável estão ativos;
   - para cada modalidade, a simulação gera exatamente as obrigações combinadas com ele;
   - não é possível ativar um modelo de financiamento sem o contrato de compra e venda e a autorização bancária com trava [D-2];
   - financiamento sem autorização validada **ou** sem contrato de compra e venda assinado não aparece como liberado em nenhuma tela ou
     relatório, verificado pela função de liberação, independentemente do modelo [R5, R4-P1 — Financiamento];
   - NF emitida numa data sem liberação vigente abre a pendência crítica para o gestor de Contratos, sem notificação própria; NF emitida
     enquanto liberado não gera alerta depois de um novo bloqueio [D-7, R5];
   - na troca de modelo, as obrigações são reavaliadas e só as concluídas válidas e compatíveis são reaproveitadas, com o histórico
     preservado [R5, R4-P5 — Obrigações; critério: PENDENTE 25];
   - remessas exibidas como contagem [D-5].
5. **Encargos:** contrato assinado sem encargos informados aparece para o **Recebíveis** pela função de consulta mínima, e a pendência
   (do Recebíveis) fica aberta até a ligação; nenhum encargo de 2% é gravado como condição contratual [D-9, R5, R4-P7 — Encargos
   financeiros]. O prazo de um dia útil só é testável depois do marco e do calendário [PENDENTE 26].
5a. **Segurança:** os testes de autorização do GED (`administrativo-ged.md`, 11.5) passam também pelas telas e funções do Contratos
    [R5, R4-P4 — Segurança do GED].
6. `npm run verificar` passa; nenhuma migration fora de 0300–0399, salvo as interfaces públicas nas faixas dos módulos donos.

## 12. Fases deste módulo
| Fase interna | Escopo | No plano da auditoria | Depende de |
|---|---|---|---|
| C0 | Configuração com o responsável: modalidades (inclui locação [D-1] e o financiamento com contrato obrigatório [D-2]), campos de condição, tipos de obrigação e modelos **em rascunho** | Fase 0 (continuação) | respostas da seção 13 |
| C1 | `ctr_operacoes`, condições, dossiê (abas Resumo, Documentos, Pedidos e NFs, Títulos, Histórico), ligação manual a pedidos, NFs e títulos; interfaces públicas do Comercial e do Financeiro | Fase 3 | GED A2 básica (AF-9); views públicas |
| C2 | Solicitações e fila | Fase 5 | C1 |
| C3 | Contrato operacional (número manual e único por empresa [D-8, R4-P6 — Numeração]), minutas com DOCX/PDF e ciclo de `pdf_situacao` [D-4, R4-P2 — PDF da minuta], aditivos com a integridade da R4-P3 — Aditivos, assinaturas, `rec_registrar_contrato` e a consulta mínima para o Recebíveis [R4-P7 — Encargos financeiros] | Fase 6 | ver os bloqueios abaixo |
| C4 | Motor de obrigações (reavaliação na troca de modelo [R4-P5 — Obrigações]), validação de modelos, modelos vigentes, liberação do financiamento pela função [R4-P1 — Financiamento], autorização bancária, remessas por contagem [D-5], rotina de conferência e alerta de NF pelo histórico [D-7, R4-P1 — Financiamento] | Fase 7 | ver os bloqueios abaixo |
| C5 | Captura pelo Gmail alimentando `ctr_solicitacoes` | Fase 4 | especificação de captura |
| — | Locação: faturamento mensal e REM × RET | **outro módulo** [D-1]; não duplica o Faturamento Filial [R4-P8 — Locação] | especificação própria; [PENDENTE 2] |

**Bloqueios por fase (revisão 5).** Nenhuma fase está liberada para implementação. A especificação foi aprovada documentalmente em
24/10/2026, mas essa aprovação **não libera** fase alguma: cada uma depende dos bloqueios abaixo e de autorização expressa posterior do
responsável.

| Fase | Bloqueios |
|---|---|
| **C0** | respostas aos PENDENTES 3, 4, 6 e 20 para montar os modelos em rascunho |
| **C1** | GED **A2 básica** (vínculos sem a sugestão por número; ver GED, seção 13, e AF-9), que depende da A1 do GED, dos testes de autorização da 11.5 do GED e do PENDENTE 24 (Contratos) / GED PENDENTE 12; views públicas do Comercial e do Financeiro (4.2); PENDENTE 14 (Contratos); mecanismo de proteção das colunas de documentos de elaboração em `ctr_minutas` (AF-12; depende do nível mínimo, PENDENTE 17 (Contratos) / GED PENDENTE 14) quando as minutas entrarem (C3). **Sem dependência circular:** a C1 não depende de nenhuma função entregue na C3 |
| **C2** | C1 |
| **C3** | **R4-P6 — Numeração:** normalização de números compostos, compatibilidade com `rec_contratos` e `rec_registrar_contrato`, colisões históricas (PENDENTE 8). **R4-P2 — PDF da minuta:** quem regulariza, prazo, `sem_pdf_justificado`, a conclusão com PDF pendente e a inferência sobre a aprovação (PENDENTE 22); efeito do PDF pendente na liberação para faturamento (PENDENTE 29, AF-2); fonte de verdade e sincronização com o GED (PENDENTE 30, AF-11); unicidade do PDF por versão a validar (AF-10). **R4-P3 — Aditivos:** validação técnica das constraints, inclusive `contrato_id` obrigatório e FK simples (AF-3), e PENDENTE 23. **R4-P4 — Segurança do GED:** proteção das colunas de elaboração em `ctr_minutas` (AF-12), que depende do nível mínimo de acesso à elaboração, **PENDENTE 17 (Contratos) / GED PENDENTE 14**; não confundir com o GED PENDENTE 17, mecanismo de proteção por coluna das tabelas do GED [R-2]. **Função `ctr_alvos_por_numero`** (entregue aqui, consumida depois pela A2 completa do GED). Dependência do GED PENDENTE 2 para o id do documento na consulta de encargos (AF-21). **R4-P7 — Encargos financeiros:** marco inicial, calendário de dias úteis e feriados, responsável operacional, interface e especificação do Recebíveis (PENDENTE 26), mais as políticas de RLS de `rec_contratos` pelo Financeiro (5.6.6) |
| **C4** | **R4-P1 — Financiamento:** PENDENTES 20, 21, 31 (comportamento provisório do alerta), 9 e 27; o alerta de NF segue a regra única da 5.8.4 (AF-1). **R4-P5 — Obrigações:** critério de "válida e compatível" e modo de reaproveitamento (PENDENTE 25); **validação técnica das regras O-1 a O-4** (dependência cancelada, reativação, troca de modelo e reabertura), hoje sem regra aprovada (5.4.6, AF-16). Demais: PENDENTES 1, 3, 4 e 6 |
| **C5** | especificação de captura |

## 13. Pontos em aberto
Os itens respondidos por decisão preliminar (seção 0) ficam registrados aqui, com o que **ainda** falta. Nada nesta lista está aprovado
para produção. Na revisão 5, os itens afetados pela matriz R4 (seção 0.1) ganharam a linha **"R5:"** com o que foi decidido e o que
continua aberto. Nenhum item foi apagado nem marcado como resolvido por inferência.

1. **Papel da NF — Fiscal** (pendente): qual tipo de nota ou CFOP do Consistem identifica a NF de venda para entrega futura, a de
   remessa e a de venda comum? Sem isso, o papel é sempre confirmado à mão.
2. **Locação** (parcialmente decidido, D-1):
   - **decidido:** operação e contrato entram; faturamento mensal e REM × RET vão para módulo próprio;
   - **pendente:** as obrigações documentais, os responsáveis, os prazos e as integrações da locação; qual módulo recebe o faturamento
     mensal (ver a seção 14, sobre o Faturamento Filial existente).
   - **R5 (R4-P8 — Locação, pendente de validação):** confirmar se a locação da Matriz usa o mesmo fluxo da filial. A pergunta vai ao
     **Financeiro** e ao **responsável pelo processo**. Mantém-se o princípio de não duplicar o faturamento existente.
3. **Condições que mudam o fluxo** (pendente): quais são, por modalidade? Exemplos a confirmar: sinal antes da NF; NF só após
   assinatura; boleto antes ou depois da NF; prazo da locação.
4. **Obrigações por modalidade** (pendente):
   - lista, ordem, dependências, prazos, responsáveis e quais travam o faturamento; a tabela da auditoria (seção F) é só um exemplo;
   - no financiamento, se o contrato assinado também trava o faturamento.
   - **R5 (R4-P1 — Financiamento):** para a **liberação**, a pergunta foi respondida: a função exige o contrato assinado
     independentemente do modelo. Continua aberta só a **configuração do modelo** (ordem, dependências, prazos, responsáveis).
5. **Financiamento exige contrato de compra e venda** (decidido preliminarmente, D-2: sempre).
   - Pendente: confirmar a leitura de que `obter_assinaturas` não é dispensável nessa modalidade (5.4.8).
6. **Bancos e linhas** (pendente): quais existem hoje (CAIXA/BNDES, BNB…) e o que cada um exige antes e depois da autorização (prévia
   da NF, termo de entrega, envio da NF)? Cada um vira uma variante.
7. **Aditivos** (decidido preliminarmente, D-3: ligados ao contrato original, com histórico próprio).
   - Pendente: se aditivos podem gerar obrigações por modelo próprio; e quando um aditivo pode, como exceção, virar contrato
     independente.
8. **Numeração dos contratos** (decidido preliminarmente, D-8: manual, sem sugestão nem geração).
   - Pendente: confirmar a chave de unicidade. A especificação usa `(empresa, tipo, número)`, mas `rec_contratos` usa
     `(empresa, número)` (seção 14). Se a numeração for única por empresa, a chave deve ser `(empresa, número)`.
   - **R5 (R4-P6 — Numeração, aprovada parcialmente):** a chave foi decidida, **único por empresa, independentemente do tipo**, com
     normalização de zeros à esquerda. Continuam pendentes:
     - a normalização de números compostos (ex.: `137/2026`), dos componentes numéricos e do ano;
     - a compatibilidade com `rec_contratos.numero` e com `rec_registrar_contrato` (validação do **Financeiro**; a regra dele não muda);
     - o levantamento e a resolução de colisões históricas antes de qualquer migração.
9. **Quem valida a autorização bancária e quem dispensa uma obrigação que trava o faturamento?** Quem registrou pode validar?
   (pendente)
   - **R5 (R4-P1 — Financiamento):** continua pendente, inclusive **se a dispensa da autorização será mantida**. Como a função de
     liberação exige a autorização validada no financiamento, uma eventual dispensa precisaria de regra própria aprovada.
10. **Encargos do contrato financeiro** (decidido preliminarmente, D-9: informados pelo Financeiro, com pendência; sem 2% presumido).
    - Pendente:
      - o prazo para informar;
      - eventuais controles adicionais;
      - o caminho de publicação da pendência (5.6.3).
    - **R5 (R4-P7 — Encargos financeiros):** o caminho e o prazo foram decididos: **o Recebíveis publica e resolve**, com prazo de **um
      dia útil**. Os detalhes que faltam estão no item 26; eventuais controles adicionais continuam aqui.
11. **"NF sem liberação"** (decidido preliminarmente, D-7: pendência crítica ao gestor de Contratos, sem notificação própria).
    - Pendente: se no futuro haverá outra providência.
12. **Visibilidade cruzada** (pendente): quem é só de Contratos deve ver um resumo dos títulos e das NFs mesmo sem acesso ao Financeiro
    ou ao Comercial? Exigiria funções de resumo `security definer`, que não serão criadas sem aprovação específica.
13. **Remessas** (decidido preliminarmente, D-5: só a contagem de previstas e realizadas na v1).
    - Pendente, para fase futura: o controle por item e quantidade do pedido.
14. **Um pedido pode pertencer a mais de uma operação?** E uma operação, ter vários pedidos? Proposta: N pedidos por operação e
    nenhum pedido em duas operações. (pendente)
15. **Responsáveis e prazos padrão** de cada etapa: Administrativo, Comercial, Fiscal e Financeiro. (pendente)
16. **Nome do módulo** no menu: "Operações e contratos"? (pendente)
17. **Acesso à elaboração** (decidido preliminarmente, D-6: restrito à área Contratos, e também conforme o GED e o Drive).
    - Pendente: o nível mínimo dentro da área Contratos (consulta ou operador). Mesmo item do GED, ponto 14.
    - **R5 (R4-P4 — Segurança do GED):** a restrição passa a ser travada no banco (GED 5.11.1), e não só configuração. O nível mínimo
      continua pendente.
18. **Evidência da versão enviada** (decidido preliminarmente, D-4: revisão do DOCX + PDF efetivamente enviado).
    - Pendente:
      - o fluxo de regularização quando o PDF não está disponível no registro (prazo, responsável e se impede marcar a minuta como
        aprovada);
      - atualizar o ponto 10 do GED (seção 14).
    - **R5 (R4-P2 — PDF da minuta):** a decisão cobre o **avanço até a assinatura**: o PDF pendente não impede, e a ausência fica
      registrada. Se ele impede **aprovar a minuta** é **inferência a confirmar** (AF-20, item 22), e não resposta. O ponto 10 do GED
      foi atualizado (GED revisão 3). O restante segue nos itens 22, 29 e 30.
19. **Modelos aprovados** (pendente): quem aprova um modelo de contrato e com que periodicidade a lista é revista? (ver GED, ponto 11)

20. **[R4] Modelo da variante** (pendente; técnica e negócio): ele **substitui** o modelo da modalidade (proposta) ou **herda** dele
    e acrescenta itens? (F-2)
    - **R5 (R4-P1 — Financiamento):** continua pendente.
21. **[R4] Operações cadastradas depois do fato** (pendente): existirá uma **data de início do controle** por operação, para que NFs
    anteriores não gerem o alarme "NF sem liberação"? Quem a informa? (F-3)
    - **R5 (R4-P1 — Financiamento):** o alerta pelo histórico de liberações foi aprovado; o **marco inicial** das operações antigas
      continua pendente. Sem ele não há como separar essas operações; o comportamento provisório recomendado está no item 31 (AF-15),
      ainda não aprovado.
22. **[R4] PDF da minuta pendente** (pendente):
    - ~~a minuta pode ser marcada aprovada antes da regularização? Recomendação: alternativa (b), "aprovada — evidência pendente", sem
      concluir `aguardar_aprovacao_cliente` e sem passar a `em_assinatura`~~ — **substituído na revisão 5** pela decisão do responsável
      (R4-P2 — PDF da minuta): **o processo pode avançar para assinatura com o PDF pendente**. A recomendação mais restritiva do
      assistente foi descartada;
    - quem pode registrar `sem_pdf_justificado`? Proposta: gestor (pendente);
    - versão substituída com PDF pendente: a pendência continua? (P-4, P-5) (pendente)
    - **R5 — continuam pendentes:**
      - **quem regulariza** o PDF;
      - o **prazo** de regularização;
      - **se o contrato pode chegar a `assinado`** enquanto o PDF de alguma versão continuar pendente. A decisão cobre o avanço, não a
        conclusão;
      - **[AF-20]** confirmar a inferência de que a minuta pode ser registrada como `aprovada` com o PDF pendente.
23. **[R4] Aditivo e situação do contrato** (pendente): o aditivo exige o contrato `assinado`? O que acontece com os aditivos em
    andamento quando o contrato é cancelado ou encerrado? (A-5)
    - **R5 (R4-P3 — Aditivos):** a direção técnica foi aprovada; estas duas perguntas de negócio continuam pendentes.
24. **[R4] Drive compartilhado** (dependência externa, administrador do Workspace): quem é membro do Drive compartilhado onde estão as
    duas raízes? A elaboração precisa de permissões próprias no Drive para que a D-6 valha fora do Neo Admin? (G-8)
    - **R5 (R4-P4 — Segurança do GED):** continua pendente; é o mesmo item do GED, ponto 12. Bloqueia a indexação (GED A1b).
25. **[R4] Aproveitamento de conclusões** na troca de modalidade, variante ou versão do modelo (pendente): o gestor decide item a item
    (proposta) ou nunca se aproveita? (O-3)
    - **R5 (R4-P5 — Obrigações, aprovada parcialmente):** "nunca se aproveita" está descartado: aproveita-se **se a obrigação continuar
      válida e compatível**, preservando o histórico. Continuam pendentes:
      - o **critério objetivo** de "válida e compatível". Alternativas para decidir, **sem nenhuma aprovada**:
        - (a) mesmo tipo de obrigação e mesma evidência ainda vigente no GED;
        - (b) a alternativa (a) mais a mesma condição comercial que gerou o item;
        - (c) decisão caso a caso do gestor;
      - **automático ou com confirmação do gestor**;
      - o controle de duplicidade, os efeitos de cancelamento, reativação e reabertura nas dependências e a rastreabilidade
        original × reaproveitada (desenho em 15.5, a validar).
26. **[R4] Encargos** (pendente; complementa o 10):
    - ~~escolha da alternativa de publicação (R4-P7 — Encargos financeiros)~~ e ~~o módulo do Financeiro que recebe a pendência~~ — **decididos na revisão 5**:
      o **Recebíveis** publica e resolve, com prazo de **um dia útil** (R4-P7 — Encargos financeiros);
    - o tratamento quando o contrato assinado não estiver no dossiê do cliente (E-3) (pendente);
    - **R5 — continuam pendentes:**
      - o **marco inicial** do prazo;
      - o **calendário de dias úteis e feriados**: o projeto não tem calendário de feriados, e nenhum foi criado;
      - o **responsável operacional** pela resolução;
      - a **interface** no Recebíveis;
      - a **atualização da especificação do Recebíveis** (`docs/modulos/financeiro-recebiveis.md`) pelo módulo dono;
      - **[AF-21]** a leitura mínima do dossiê pelo Financeiro no GED (GED PENDENTE 2), da qual depende devolver o id do contrato
        assinado na consulta mínima.
27. **[R4] Ordem contrato × autorização e assinatura do banco** (dependência externa, bancos): a autorização pode ser validada antes do
    contrato assinado? O banco é parte que assina o contrato de compra e venda? (F-4, F-7)
    - **R5 (R4-P1 — Financiamento):** continua pendente, assim como os requisitos que variam por banco (item 6).
28. **[R5] Numeração das propostas** (pendente; organização documental): o responsável usou, na solicitação, uma numeração diferente da
    seção 15 para R4-P5 a R4-P7. A especificação mantém a numeração da seção 15 com o tema ao lado (seção 0.1). Uma eventual
    renumeração, ou a adoção de identificadores só por tema, é **proposta separada**, a decidir.
29. **[AF-2] Efeito do PDF pendente na liberação para faturamento** (decisão de negócio pendente): a decisão R4-P2 — PDF da minuta
    cobre só o avanço para assinatura. Um PDF de minuta pendente bloqueia, não afeta ou afeta de outra forma a liberação para
    faturamento? Nada foi presumido.
30. **[AF-11] Fonte de verdade da evidência do PDF** (decisão técnica pendente, afeta Contratos e GED): qual registro é autoritativo
    (`ctr_minutas.pdf_documento_id` ou o vínculo do GED), como impedir o desvínculo de documento referenciado, como tratar documento
    que sai do Drive ou do escopo e como sincronizar os estados. A proposta está em 5.5.3, sem escolha feita. Mesmo item do GED, ponto 18.
31. **[AF-15] Comportamento provisório do alerta "NF sem liberação"** (decisão pendente): recomenda-se manter a rotina desligada para
    todas as operações até a decisão do marco inicial (item 21). A recomendação **não está aprovada**.
32. **[AF-13] Assinatura técnica da checagem de módulo em `ged_tipos_presentes`** (validação técnica): a função do GED precisa
    validar o módulo do alvo e a área correspondente (GED 5.10). Os nomes e parâmetros exatos são propostos e ainda não validados
    contra o código. Mesmo item do GED, ponto 19.
33. **[AF-9] Ordem GED A2 × Contratos C3** (proposta técnica a aprovar): a A2 do GED entrega os vínculos básicos sem a sugestão por
    número de contrato; a sugestão (`ctr_alvos_por_numero`) entra depois da C3. Isso elimina a dependência circular.

## 14. Inconsistências e dependências encontradas (revisão 3)
Registradas para decisão. **Nenhum outro documento foi alterado** pela revisão 3.

**Situação na revisão 5:**
- **I-1:** o caminho foi decidido (R4-P7 — Encargos financeiros): o Recebíveis publica a pendência no módulo dele. A view citada na
  proposta foi substituída pela função de consulta mínima `ctr_contratos_sem_encargos()` (4.2, 5.6.3). Os detalhes continuam no
  PENDENTE 26.
- **I-2:** a chave do Contratos foi decidida (R4-P6 — Numeração): `(empresa, número normalizado)`, alinhada a `rec_contratos`. A
  compatibilidade da normalização com `rec_contratos.numero` continua pendente (PENDENTE 8), e a regra do Financeiro não muda.
- **I-3 e I-4:** o GED foi atualizado na revisão 3 dele (pontos 2 e 10, seções 5.2.1, 5.6.1, 5.9.1 e 5.11).
- **I-5 a I-8:** sem mudança. A I-5 corresponde à R4-P8 — Locação, ainda pendente.

| # | Onde | O que | Proposta |
|---|---|---|---|
| I-1 | `pendencias` (0002, 0092, 0097) × D-9 | A leitura de pendências segue o módulo. Publicada em `contratos.contratos`, a pendência de encargos **não aparece** para quem é só do Financeiro, a menos que seja atribuída a uma pessoa dele (`pendencias_ler_proprias`). `modulo_exibicao` não muda a permissão. | O Financeiro publica a pendência no módulo dele a partir de `ctr_vw_contratos_sem_encargos`; ou o Contratos atribui a uma pessoa do Financeiro. Decidir (PENDENTE 10). |
| I-2 | `rec_contratos` (0100) × 5.5.2 | Unicidade diferente: `rec_contratos` é `unique (empresa_id, numero)`; `ctr_contratos` é `(empresa_id, tipo, numero)`. Dois contratos de tipos diferentes com o mesmo número seriam aceitos no Contratos e recusados no Financeiro. | Confirmar se a numeração é única por empresa ou por tipo (PENDENTE 8). Não alterar `rec_contratos` sem o Financeiro. |
| I-3 | `administrativo-ged.md`, ponto 10 | Ainda pergunta se basta a revisão do DOCX ou o PDF; a D-4 responde preliminarmente (os dois). | Atualizar o GED numa próxima revisão dele (fora do escopo desta tarefa). |
| I-4 | `administrativo-ged.md`, 5.2.1 e 5.9.1 | Trazem "proposta: elaboração só Contratos" como pendente. A D-6 confirma preliminarmente, mas o nível mínimo continua aberto. | Atualizar o GED numa próxima revisão; manter o PENDENTE 17 (Contratos) / GED PENDENTE 14. |
| I-5 | `docs/modulos/financeiro-recebiveis.md` (Faturamento Filial Contagem: kit de nota fatura, demonstrativo e implantação pelo POP "Implantação de Faturas de Locação", 0146–0149) × D-1 | Já existe no Financeiro um fluxo para faturas de **locação** da filial. O "módulo próprio" de faturamento mensal da locação precisa considerar esse fluxo, para não duplicá-lo. | Dependência a validar com o Financeiro antes de especificar o faturamento mensal. |
| I-6 | `docs/VISAO_GERAL.md` | Lista "Contratos de venda/locação" e "Remessas e retornos (locação)" como módulos de Contratos. Coerente com a D-1, mas o faturamento mensal não tem módulo indicado. | Indicar o módulo do faturamento mensal quando for decidido. |
| I-7 | Central de Gestão (0098) × D-7 | O módulo não cria notificação, mas, se o admin ligar o evento `atribuicao`, a pendência crítica gera o aviso comum da Central. | Aceitável. Apenas registrar que esse aviso não é requisito do módulo. |
| I-8 | GED (tipo `aditamento`) × termo "aditivo" | O GED chama o tipo documental de `aditamento`; esta especificação usa "aditivo" para a entidade (`ctr_aditivos`) e `aditamento` para o documento. | Manter os dois nomes, com essa correspondência. |

**Dependências de validação externa:**
- **Fiscal:** a correspondência tipo de nota/CFOP → papel da NF (PENDENTE 1).
- **Bancos** (pelo responsável, com os gerentes de cada banco): variantes, documentos antes e depois da autorização, e quem autoriza
  (PENDENTE 6).
- **Financeiro:**
  - ~~prazo e caminho da pendência de encargos (PENDENTE 10, I-1)~~ — decididos na R5: Recebíveis, um dia útil. Continuam o marco, o
    calendário, o responsável operacional, a interface e a especificação do Recebíveis (PENDENTE 26);
  - políticas de RLS e funções de `rec_contratos` (5.6.6);
  - compatibilidade da numeração normalizada com `rec_contratos.numero` e `rec_registrar_contrato`, e colisões históricas (I-2,
    PENDENTE 8);
  - relação com o Faturamento Filial e fluxo da locação da Matriz (I-5, R4-P8 — Locação).
- **Administrador do Workspace:** membros e permissões do Drive compartilhado (PENDENTE 24 (Contratos) / GED PENDENTE 12).
- **Comercial:** views públicas `com_vw_pedidos_publico` e `com_vw_notas_publico` (4.2).
- **Responsável pelo processo:** PENDENTES 3, 4, 9, 14, 15, 16, 17, 18 e 19.

## 15. Revisão técnica de consistência — propostas da revisão 4
Detalhes, análise e classificação em `docs/auditoria/REVISAO_CONTRATOS_REV3_2026-10-24.md`. Na revisão 4, nada aqui era decisão
aprovada. **Na revisão 5, o status de cada proposta passou a ser o da matriz do responsável (seção 0.1)**, mostrado na coluna "Status
R5". O texto das subseções foi mantido como desenho técnico e histórico. Onde a decisão do responsável difere da proposta, prevalece a
decisão, e isso está marcado na subseção.

| Proposta (número e tema) | Resolve | Resumo | Aprovação necessária (revisão 4) | Status R5 |
|---|---|---|---|---|
| **R4-P1 — Financiamento** | F-1 a F-3, F-5 | ver 15.1 | responsável pelo processo (ampliação da D-2); bancos (PENDENTE 27) | **Aprovada parcialmente:** itens 1 e 4 aprovados (função e histórico); itens 2, 3 e 5 a validar; PENDENTES 9, 20, 21 e 27 |
| **R4-P2 — PDF da minuta** | P-1 a P-6 | ver 15.2 | responsável (PENDENTE 22) | **Aprovada parcialmente:** avanço para assinatura com PDF pendente; o item 3 foi **substituído** pela decisão; PENDENTE 22 |
| **R4-P3 — Aditivos** | A-1 a A-7 | ver 15.3 | técnica (A-1 a A-4); responsável (PENDENTE 23) | **Aprovada** como direção técnica; constraints a validar; PENDENTE 23 |
| **R4-P4 — Segurança do GED** | G-1 a G-9 | ver 15.4 | técnica; ajuste na especificação do GED; admin do Workspace (PENDENTE 24) | **Aprovada** como princípio obrigatório; incorporada ao GED, revisão 3; PENDENTE 24 |
| **R4-P5 — Obrigações** | O-1 a O-8 | ver 15.5 | técnica; responsável (PENDENTE 25) | **Aprovada parcialmente:** reavaliar e reaproveitar só o que continua válido e compatível; critério e modo pendentes (PENDENTE 25) |
| **R4-P6 — Numeração** | N-1 a N-5 | ver 15.6 | responsável e Financeiro (PENDENTE 8) | **Aprovada parcialmente:** único por empresa e zeros à esquerda; números compostos e compatibilidade pendentes (PENDENTE 8) |
| **R4-P7 — Encargos financeiros** | E-1 a E-5 | ver 15.7 | Financeiro e responsável (PENDENTE 26) | **Aprovada parcialmente:** Recebíveis e um dia útil; marco, calendário, responsável e interface pendentes (PENDENTE 26) |
| **R4-P8 — Locação** | L-1 a L-4 | ver 15.8 | responsável e Financeiro (PENDENTE 2) | **Pendente de validação** |

### 15.1 R4-P1 — Financiamento
1. Na modalidade `financiamento`, `ctr_faturamento_liberado` só devolve `liberada` com as duas condições:
   - contrato do tipo `venda` em situação `assinado`, com o documento confirmado;
   - autorização bancária `validada`.

   A verificação é **fixa na função, para essa modalidade**, além do que o modelo disser.
2. A validação de ativação do modelo de financiamento exige:
   - `obter_assinaturas` e `aguardar_autorizacao_bancaria`, os dois sem condição e com trava;
   - `obter_assinaturas` não dispensável;
   - a dispensa da autorização só pelo nível do PENDENTE 9, que começa como "ninguém".
3. O modelo da variante é **completo** (substitui o da modalidade), e a validação roda em cada um (PENDENTE 20).
4. O alarme de NF compara a **data local** da emissão com o histórico de liberações (`ctr_eventos`):
   - NF de dia sem liberação vigente: alarme;
   - NF do mesmo dia da liberação: marcada "conferir";
   - NF anterior à data de início do controle: sem alarme (PENDENTE 21).
5. Contrato cancelado depois da liberação: volta a `bloqueada`, com evento. NFs já emitidas não geram alarme retroativo.

**Status R5:**
- **Aprovados:** o item 1 (regra de negócio) e o princípio do item 4, o alerta pelo histórico de liberações (direção técnica). A
  regra normativa única está na 5.8.4 (AF-1).
- **Requisitos técnicos a validar:** os itens 2 (validação do modelo como segunda camada) e 5, e o detalhe "mesmo dia = conferir" do
  item 4.
- **Pendentes:** a "dispensa só pelo nível do PENDENTE 9" do item 2 (se a dispensa será mantida); o item 3 (PENDENTE 20); o marco
  inicial do item 4 (PENDENTE 21).

### 15.2 R4-P2 — PDF da minuta
1. **Estados de `pdf_situacao`:**
   - `vinculado_no_envio`;
   - `pendente` (motivo obrigatório; abre `regularizar_pdf_minuta`);
   - `regularizado` (vinculação única, depois);
   - `sem_pdf_justificado` (gestor, justificativa e outra evidência).
2. **Conclusão de `regularizar_pdf_minuta`:** só por `regularizado` ou `sem_pdf_justificado`. Para `regularizado`, o PDF tem de:
   - estar confirmado no GED (`contrato_minuta` ou `aditamento`, `mime` PDF, `vigente`);
   - não estar vinculado como PDF enviado de outra versão.
   A obrigação tem origem `sistema`.
3. ~~**Aprovação antes da regularização** (recomendada, a aprovar): permitida com o selo "evidência pendente". Enquanto isso:
   `aguardar_aprovacao_cliente` não conclui; o contrato não passa a `em_assinatura`.~~ — **Substituído na revisão 5.** O responsável
   decidiu que o processo **pode avançar para assinatura** com o PDF pendente. A restrição proposta pelo assistente foi descartada; a
   ausência continua registrada e rastreável (5.5.3).
4. **Versão substituída com PDF pendente:** a obrigação continua até `regularizado` ou `sem_pdf_justificado`.
5. **Gatilho de imutabilidade** depois de `enviada`. Só aceita:
   - `situacao` e o retorno;
   - a transição `pendente` → `regularizado` | `sem_pdf_justificado`, uma vez.

**Status R5:**
- **Aprovado:** avançar para assinatura com o PDF pendente, sem simular vínculo nem confirmação documental. Nada além disso: o
  efeito sobre o faturamento é o PENDENTE 29 (AF-2), e a fonte de verdade da evidência é o PENDENTE 30 (AF-11).
- **Requisitos técnicos derivados, a validar:** os itens 1, 2 e 5 (ciclo de vida da 5.5.3, conclusão da regularização e auditoria).
- **Pendentes** (PENDENTE 22): quem regulariza; o prazo; quem registra `sem_pdf_justificado` (a proposta "gestor" do item 1 continua
  só proposta); o item 4; e se o contrato pode chegar a `assinado` com PDF pendente.

### 15.3 R4-P3 — Aditivos e unicidades
1. **FK composta** `(aditivo_id, contrato_id) → ctr_aditivos (id, contrato_id)` em `ctr_minutas` e `ctr_assinaturas`, com
   `unique (id, contrato_id)` em `ctr_aditivos`.
   - **[AF-3]** No PostgreSQL, com `MATCH SIMPLE`, a FK composta não é verificada se qualquer coluna for nula. Por isso:
     - `contrato_id` é obrigatório nas duas tabelas;
     - `contrato_id` tem a sua própria FK simples para `ctr_contratos`.
   - Continua desenho a validar; nada existe no banco.
2. **Índices únicos parciais** (seção 8), no lugar das unicidades com NULL:
   - versões e aprovada, separados entre contrato e aditivo;
   - um contrato não cancelado por operação. O termo "vigente" sai: o encerrado continua contando;
   - identificação normalizada do aditivo.
3. **Toda regra "do contrato" filtra `aditivo_id is null`:** situação do contrato, `obter_assinaturas` e `aguardar_aprovacao_cliente`.
4. **Ciclo do aditivo:** só com o contrato `assinado`. O contrato cancelado ou encerrado não aceita aditivo novo, e os aditivos em
   andamento vão para a conferência do gestor (PENDENTE 23).
5. **Imutabilidade:** `identificacao` e `objeto` imutáveis depois de `enviado`; sem `delete`; auditoria e `ctr_eventos`.

**Status R5:**
- **Aprovada como direção técnica:** os itens 1, 2, 3 e 5. As constraints, chaves compostas e índices parciais são **desenho a validar
  tecnicamente**, não implementação.
- **Pendente:** o item 4 é proposta de negócio (PENDENTE 23).

### 15.4 R4-P4 — Segurança do GED (raiz `elaboracao`)
**Status R5:** aprovada como **princípio obrigatório** e incorporada à especificação do GED, revisão 3 (5.2.1, 5.2.4.4, 5.10, 5.11,
seção 9 e testes 11.5). Os controles estão especificados, **não implementados nem testados**. Pendentes: PENDENTE 24 (Contratos) / GED PENDENTE 12 (Drive
compartilhado), PENDENTE 17 (Contratos) / GED PENDENTE 14 (nível mínimo) e GED PENDENTE 13 (verificação da Fase 1 sem persistir
metadados). Texto original da
revisão 4:
1. **Restrição fixa:**
   - a raiz `elaboracao` tem `area = area_operacao = 'contratos'` e `areas_leitura` vazio, garantido por `check`/gatilho;
   - mudar isso exige uma migration, e não uma tela de configuração.
2. **`ged_pode_ler_raiz(raiz_id)` nas políticas de todas as tabelas `ged_*`:** documentos, pastas, pastas de cliente, revisões, vínculos,
   indexações e raízes.
3. **Modo de segurança das funções do GED:**
   - as de leitura são `security invoker`;
   - `ged_tipos_presentes` é `security definer`, devolve só tipos ou booleanos (nunca nome, link ou id) e checa
     `tem_acesso_area('contratos','operador')`;
   - `ctr_alvos_por_numero` é `security definer`, checa `tem_acesso_area('contratos','consulta')` e devolve vazio para os demais.
4. **Busca e sugestões** calculadas na hora, com o cliente do usuário, sem gravar sugestões fora da RLS.
5. **Sem nome de arquivo** nas descrições de `atividade_regras`, nos títulos de pendência e nas mensagens do Slack, porque `atividades`
   é lida por `acompanha_equipe` sem filtro de área (0094).
6. **Next e Edge Functions:**
   - as telas usam o cliente do usuário (`lib/supabase/servidor.ts`);
   - as Edge Functions devolvem só contagens ou mensagens genéricas;
   - o acesso por id responde "não encontrado" sem distinguir de "sem acesso".
7. **Drive:** os membros do Drive compartilhado precisam ser conferidos (PENDENTE 24). Sem isso, a D-6 vale no Neo Admin e não no Drive.

### 15.5 R4-P5 — Integridade das obrigações
1. **Origem** `modelo` / `sistema` / `manual`. Só as de origem `modelo` reagem a condição, modalidade, variante ou versão.
2. **Uma obrigação ativa por item do modelo e por campo de condição** (índices da seção 8).
3. **"Deixou de se aplicar"** vai para `cancelada`, com motivo `nao_aplicavel`, e **conta como resolvida** para as dependentes. As
   concluídas e dispensadas não mudam.
4. **"Voltou a se aplicar"** cria uma obrigação nova (`substitui_obrigacao_id`); a cancelada não é reaberta.
5. **Troca de modalidade, variante ou versão** (gestor, motivo, uma transação):
   - cancela as `modelo` abertas e bloqueadas;
   - mantém as concluídas, as dispensadas e as de origem `sistema`/`manual`;
   - cria as novas;
   - o aproveitamento de conclusões do mesmo tipo é escolhido pelo gestor, item a item (PENDENTE 25);
   - **[R5]** a regra aprovada é "reavaliar cada obrigação e reaproveitar só a concluída que continuar válida e compatível,
     preservando o histórico". "Escolhido pelo gestor, item a item" continua sendo **uma das alternativas**, não a decisão
     (PENDENTE 25).
6. **Reabertura:**
   - as dependentes não concluídas voltam a `bloqueada`;
   - as concluídas ganham a marca "dependência reaberta";
   - a liberação é recalculada, com evento.
7. **Responsável:**
   - a fonte é `ctr_obrigacoes.responsavel_id`;
   - a troca feita na Central volta por gatilho.
8. **Concorrência e pendências:**
   - toda mudança de plano trava a operação (`for update`);
   - cada obrigação nova tem chave nova;
   - estado final: `encerrar_pendencia`.

**Status R5:**
- **Aprovada parcialmente:** a reavaliação e o reaproveitamento condicional, com histórico preservado.
- **Requisitos a definir:** os itens 1 a 4 e 6 a 8 continuam desenho técnico **a validar**. Respondem aos requisitos de duplicidade,
  cancelamento, reativação, reabertura e rastreabilidade, mas não foram aprovados como solução final.
- **Pendentes:** o critério objetivo e o modo de aplicação (PENDENTE 25).

### 15.6 R4-P6 — Numeração
1. Gravar `numero` (como digitado) e `numero_normalizado`. A regra de normalização ainda precisa ser validada.
2. Enquanto o PENDENTE 8 não for decidido, a chave é a **mais restritiva**, `(empresa_id, numero_normalizado)`, alinhada a
   `rec_contratos`, cuja regra **não é alterada**.
3. Se se confirmar que tipos diferentes podem repetir número, a chave passa a incluir o tipo **e** o Financeiro decide como fica
   `rec_contratos`. Até lá, a pendência de encargos pode ficar sem solução (N-1).

**Status R5:**
- **Aprovado:** número único por empresa, independentemente do tipo, com normalização de zeros à esquerda. O item 2 deixa de ser
  provisório; o item 3 fica **sem efeito**.
- **Pendentes** (PENDENTE 8):
  - normalização de números compostos (`137/2026`): componentes e ano;
  - compatibilidade com `rec_contratos.numero` e `rec_registrar_contrato`;
  - colisões históricas antes de qualquer migração.
- A regra do Financeiro não muda; nenhuma normalização de dados foi executada.

### 15.7 R4-P7 — Encargos no Financeiro (alternativa A recomendada)
1. **Função** `ctr_contratos_sem_encargos()` [PROPOSTA, no lugar da view `ctr_vw_contratos_sem_encargos` da 4.2]:
   - `security definer`, checa `tem_acesso_area('financeiro','operador')`, o que já exclui a `unidade_restrita` (0152);
   - devolve só empresa, cliente, número, tipo, data de assinatura e o indicador "contrato assinado está no dossiê do cliente:
     sim/não";
   - **[AF-21]** o id do documento `contrato_assinado`, previsto na redação original desta proposta, **não é prometido nem devolvido**
     enquanto o GED PENDENTE 2 (leitura do dossiê pelo Financeiro) não for decidido. Regra harmonizada com a 5.6.3.
2. **O Financeiro publica e resolve:** publica a pendência no módulo dele e a resolve numa tela dele, com `rec_registrar_contrato`. Sem
   acesso ao Contratos.
3. **Exposição:** os dados expostos não ampliam o que o Financeiro já vê dos clientes (`rec_titulos`). Nenhum dado de minuta,
   elaboração ou obrigação é exposto.
4. **Alternativas descartadas** (detalhes no relatório):
   - B: responsável nominal;
   - C: consulta em Contratos;
   - D: o Contratos publica no módulo de outro.
   Decisão no PENDENTE 26.

**Status R5:**
- **Aprovado:** o **Recebíveis** recebe e resolve a pendência, com prazo de **um dia útil**. Isso confirma o item 2 (o módulo do
  Financeiro é o Recebíveis).
- **Requisitos técnicos derivados, a validar:** os itens 1 e 3 (função de consulta mínima com acesso restrito e só os campos
  necessários) e a regra de `rec_registrar_contrato` com multa e juros explícitos, sem 2% presumido.
- **Pendentes** (PENDENTE 26): marco inicial, calendário de dias úteis e feriados, responsável operacional, interface e atualização da
  especificação do Recebíveis pelo módulo dono. Nada disso foi criado.

### 15.8 R4-P8 — Locação
1. **Confirmado:** o escopo não duplica o Faturamento Filial (`rec_kits`, `financeiro.filial`), porque o `fatura_locacao` só liga e
   consulta.
2. **Proposta:** a validação do modelo de `locacao` recusa os tipos `emitir_nf_*`; `acompanhar_titulos` só com aprovação.
3. **Documentar** a diferença entre `rec_remessas` (kits da filial) e `ctr_remessas` (mercadoria).
4. **Dependência externa:** saber se o faturamento de locação da Matriz usa o mesmo fluxo da filial (I-5).

**Status R5:** **pendente de validação.** A confirmação do fluxo da Matriz vai ao Financeiro e ao responsável pelo processo
(PENDENTE 2). O princípio de não duplicar o faturamento existente se mantém (item 1). O item 2 continua **proposta técnica a
validar**, e não regra consolidada.

