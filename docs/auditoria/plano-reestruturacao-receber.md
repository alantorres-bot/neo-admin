# Plano de Reestruturação — Contas a Receber (Neo Admin)

Versão de 23/10/2026 · Responsável: Alan Ryccelle Torres

## 1. Resumo executivo

A reestruturação troca um modelo baseado em cópia e texto por um modelo baseado em eventos, saldo e chaves estruturais. O objetivo é que nenhum título a receber se perca, nenhum cliente seja cobrado pelo valor errado e nenhuma tarefa apareça em duplicidade.

**Escopo:** Recebíveis, Cobrança, Faturamento Filial (kits), Filial/unidade e AKF, todos alimentados pelo contas a receber do Consistem. Base: auditoria técnica de 23/10/2026 (constatações F1–F14, G1–G9, H1–H8).

**O que muda, em uma frase por módulo:**

- **Recebíveis:** o título passa a ter saldo, movimentos (baixa, baixa parcial, estorno, ajuste) e uma máquina de estados única, com reabertura.
- **Cobrança:** uma cobrança viva por cliente e unidade, identificada por chave e não por texto; rascunho vinculado ao estado do título.
- **Filial:** unidade definida por cadastro, não por prefixo; kit com checklist completo e religação após cancelamento.
- **AKF:** cessão total e parcial registradas como movimentos, lidas pela mesma visão em todas as telas.
- **Sincronização:** trava contra execução simultânea, conferência de completude e alarme de toda falha.

**Resultado esperado:** zero título divergente sem tratamento, zero pendência duplicada, valor cobrado sempre igual ao saldo real e alteração de estágio somente por função auditada.

**Execução:** 8 fases (0 a 7), começando por decisões de negócio e contenção de risco. Nenhuma fase altera dados de produção sem saneamento planejado e teste que reproduza o cenário.

## 2. Princípios de projeto

Toda decisão técnica da reestruturação deve respeitar os dez princípios abaixo. Uma correção que viole um deles volta para revisão.

1. **O Consistem continua sendo a fonte da verdade.** O Neo Admin espelha, organiza e executa a rotina; não emite título nem dá baixa por conta própria.
2. **Nada some em silêncio.** Toda diferença entre o Neo Admin e o Consistem vira pendência visível, nunca apenas um número em log.
3. **Saldo é calculado, nunca digitado.** Saldo = valor original − movimentos (baixas, baixas parciais, antecipações AKF). Nenhuma tela grava saldo direto.
4. **Estado só muda por função.** Estágio, valor, vencimento e cessão são alterados exclusivamente por funções de banco auditadas; UPDATE direto é bloqueado para todos os perfis.
5. **Tudo é reversível com rastro.** Baixa tem estorno, contestação tem encerramento, kit cancelado pode ser refeito, cessão tem recompra. Nada é apagado; o histórico mostra o antes e o depois.
6. **Identidade por chave, nunca por texto.** Pendências, cobranças e kits são identificados por IDs e chaves estruturais (cliente, unidade, título, marco), não pelo texto exibido.
7. **Uma única leitura por conceito.** "Na AKF", "saldo", "cobrável" e "unidade" têm uma só definição no banco (view ou função), usada por todas as telas, pelo Painel e pela sincronização.
8. **Operação atômica ou nenhuma.** Ações compostas (conferência AKF, baixa em lote, rodada de sincronização por empresa) rodam em uma transação, com trava contra concorrência.
9. **O sistema prepara, a pessoa decide e envia.** Mantém-se a regra de nunca enviar mensagem automaticamente; o rascunho passa a ser validado contra o estado do título.
10. **Teste antes da correção.** Cada constatação da auditoria ganha um teste que reproduz o cenário antes de ser corrigida, e o teste fica permanente na suíte.

## 3. Diagnóstico por causa raiz

As 31 constatações da auditoria nascem de 8 causas estruturais. Corrigir cada constatação isoladamente gera remendos; corrigir a causa elimina o grupo inteiro.

| # | Causa raiz | Efeito no processo | Constatações | Impacto |
| --- | --- | --- | --- | --- |
| C1 | Título sem saldo nem movimentos: só valor e estágio | Baixa parcial invisível, valor sobrescrito sem rastro, AKF parcial calculada à parte | F2, F13, H1, H2, H5 | Alto — valor cobrado errado |
| C2 | Estágio só avança; não há reabertura, estorno nem saída de contestação | Título baixado por engano some para sempre; contestado nunca volta | F1, F10, H5 | Alto — recebível perdido |
| C3 | Escrita direta nas tabelas liberada pela RLS | Estágio, valor e vencimento alteráveis fora das funções; baixa sem trava | F8, F9, G2 | Alto — controle interno |
| C4 | Sincronização sem transação, sem trava e sem conferência de completude | Execução parcial, alarmes falsos, lista parcial tira títulos da cobrança, falhas engolidas | F7, F11, F12 | Alto — falha silenciosa |
| C5 | Pendências identificadas pelo texto | Duplicadas, presas ou bloqueadas por homônimo e pelo ano | F3, F4, F5, G6, G8 | Médio — retrabalho |
| C6 | Rascunho e cobrança desconectados do estado do título | Cobrar quem já pagou, rascunhos repetidos, status "rascunho" eterno | F6, H6 | Alto — relacionamento e risco jurídico |
| C7 | Unidade e kit por heurística (prefixo 400, vínculo que não se desfaz, "pronta" incompleta) | Kit travado, enviado incompleto ou nunca religado; título na unidade errada | G1, G3, G4, G5, G7, G9 | Médio — retrabalho e duplicidade no ERP |
| C8 | Conceitos com mais de uma definição ("na AKF", "caixa Neo", parcelas em Comercial × Recebíveis) e funções previstas sem implementação | Painel e telas divergem; estágios e tabelas sem uso confundem | H3, H4, H7, H8, F14 | Médio — decisão sobre número errado |

**Leitura:** C1 a C4 são a fundação. Enquanto o título não tiver saldo, reversibilidade e escrita controlada, qualquer melhoria em Cobrança, Filial ou AKF continuará herdando o erro.

## 4. Arquitetura alvo

O centro da nova arquitetura é o título com saldo e livro de movimentos; todos os outros módulos leem dele por views únicas. Os nomes de tabelas abaixo são propostas para orientar o desenvolvimento.

### 4.1 Núcleo do título (Recebíveis)

- **`rec_movimentos` (nova):** livro imutável por título — `baixa_total`, `baixa_parcial`, `estorno_baixa`, `ajuste_valor_erp`, `prorrogacao`, `cessao_akf`, `recompra_akf`, `cancelamento`, `reabertura`. Cada linha guarda valor, data, origem (ERP, usuário, conferência AKF), usuário e motivo.
- **Saldo derivado:** view `rec_vw_saldo` = valor original − baixas + estornos − partes AKF ativas, **limitado a zero**, com alerta quando o cálculo dá negativo.
- **Valor original preservado:** `rec_titulos.valor_original` nunca muda; mudança de valor no ERP vira movimento `ajuste_valor_erp`, com antes e depois.
- **Máquina de estados única:** função `rec_transicionar(titulo, novo_estagio, motivo)` com matriz de transições permitidas (seção 5). Todas as funções atuais (baixa, confirmação, cobrança, envio) passam a chamá-la.
- **Reabertura e estorno:** `rec_reabrir_titulo` (gestor, motivo obrigatório) restaura o estágio anterior ao encerramento e as partes AKF encerradas pela baixa.
- **Bloqueio de escrita:** RLS sem UPDATE direto em `rec_titulos` para todos os perfis; gatilho rejeita alteração de `estagio`, `valor`, `vencimento`, `cedido` fora das funções (flag de sessão definida só pelas funções).
- **Concorrência:** toda função de baixa/transição usa `SELECT … FOR UPDATE` e condição de estágio no UPDATE.
- **Histórico completo:** todo movimento gera interação visível na ficha do título ("Vencimento alterado no Consistem de 10/11 para 25/11").

### 4.2 Sincronização

- **Trava:** `pg_try_advisory_lock` por empresa; segunda execução simultânea termina como "ignorada", sem alarme.
- **Controle de rodada:** tabela de rodadas com início, fim, status, contagens e erros por etapa; uma etapa com erro marca a rodada como "parcial" e abre pendência, sem engolir a falha.
- **Conferência de completude:** compara total de registros e de páginas da API com o esperado; queda abrupta (ex.: mais de 10% dos títulos abertos somem numa rodada) entra em **quarentena** — nada vira "Possível baixa" até confirmação humana.
- **Reconciliação bidirecional:** encerrado no Neo Admin e aberto no ERP abre pendência "Divergência: título reaberto no Consistem" com botão de reabrir.
- **Esteira sem perda:** títulos que entraram como `importado` por excesso de lote vão para fila de reprocessamento, liberada em lotes de até 50.
- **Monitor de saúde:** última rodada bem-sucedida, tempo desde a última, falhas da semana; alerta se passar de 2 horas sem rodada em horário útil.
- **Paginação nas telas:** remover `.limit(500/1000)` sem paginação; leituras críticas passam a ser views filtradas no banco.

### 4.3 Cobrança

- **`rec_cobrancas` (nova):** um caso de cobrança vivo por **cliente + unidade**, com marco atual, títulos vinculados (`rec_cobranca_titulos`), responsável, próxima ação e status (`aberta`, `aguardando_cliente`, `promessa`, `contestada`, `encerrada`).
- **Pendência única:** a pendência de cobrança aponta para o caso (`referencia_id` = caso), não para um texto. Ao avançar de marco, a mesma pendência é atualizada; marcos anteriores não acumulam.
- **Rascunho vinculado:** `mensagens` guarda `draft_id` do Gmail, títulos e saldo no momento da criação. Antes de exibir "Enviei", o sistema reconfere o saldo; se algum título foi baixado ou mudou de valor, o rascunho é marcado **obsoleto** e o sistema tenta apagá-lo no Gmail (`drafts.delete` não envia nada).
- **Um rascunho por caso e marco:** novo clique abre o rascunho existente em vez de criar outro.
- **Contestação reversível:** `rec_encerrar_contestacao` (procedente → cancelamento/ajuste; improcedente → volta à régua).
- **Promessa com desfecho:** na data da promessa, o sistema marca `cumprida` (título baixado) ou `descumprida` (reabre o caso no marco atual).
- **Encargos por contrato:** `rec_contratos` ganha tela; sem contrato, a régua usa o padrão aprovado na Fase 0 e sinaliza "encargo padrão".

### 4.4 Filial e kit

- **Cadastro de unidades:** tabela `unidades` com regra de identificação explícita (série da NF, código de filial do Consistem ou faixa de documento), substituindo o prefixo `400`.
- **Kit com checklist:** `pronta` exige NF, demonstrativo, quantidade de parcelas informada = encontrada no ERP, cada parcela com boleto, transferência **ou já paga**, e carta de cessão quando houver cessão total ou parcial.
- **Cancelamento desfaz vínculo:** cancelar o kit libera os títulos para o kit novo da mesma NF.
- **Parcela tardia:** parcela que chega a kit `enviada` abre pendência "Enviar parcela complementar".
- **Pendências da filial por chave** (kit, remessa), não por texto.
- **Regra "Cuiabá só anexa":** aplicada no banco e na Edge Function para qualquer perfil.

### 4.5 AKF

- **Cessão como movimento:** cessão total, parcial e recompra são movimentos em `rec_movimentos`; `cedido` e o portador `998` deixam de ser a fonte e passam a ser apenas evidência conferida.
- **View única de exposição:** `akf_vw_exposicao` (valor na AKF, valor Neo, por título) usada pela tela AKF, pelo Painel e pela cobrança.
- **Conferência atômica:** "Aplicar ajuste" vira uma única função de banco por título.
- **Ciclo da solicitação:** `rascunho → solicitada → operada | recusada | cancelada`; "operada" lança as partes/cessão automaticamente.
- **Idempotência do rascunho AKF:** um rascunho por solicitação; clique repetido reaproveita.

### 4.6 Integração com Comercial

- `com_notas`/`com_nota_parcelas` passam a referenciar `rec_titulos` (FK pela chave da NF-e) ou viram view sobre os recebíveis, eliminando a dupla cópia de parcelas.

## 5. Fluxo do processo redesenhado

O título percorre um caminho único de estágios, controlado por uma só função de transição, e qualquer encerramento pode ser revertido pelo gestor com motivo registrado.

**Máquina de estados do título:**

```
Novo no Consistem → Aguardando boleto → Boleto enviado → Confirmado cliente
                                              │                  │
                                              └── vence sem pagamento ──┘
                                                        ▼
                     Promessa  ◄──────►  Vencido (cobrança)  ◄──────►  Contestado
                                                        │
                                                 baixa conferida
                                                 ▼              ▼
                                               Pago         Cancelado
                                                 │              │
                                                 └── reabertura ou estorno (gestor, com motivo) ──► Vencido (cobrança)
```

Baixa parcial não muda o estágio: reduz o saldo e o título segue na cobrança pelo restante. Promessa descumprida e contestação improcedente voltam a "Vencido (cobrança)"; contestação procedente leva a cancelamento ou ajuste de valor.

### 5.1 Etapas e responsáveis

| Etapa | O que acontece | Responsável | Controle automático |
| --- | --- | --- | --- |
| 1. Faturamento | NF emitida no Consistem (Matriz) ou no Syslock e implantada no Consistem (Filial) | Faturamento / Cuiabá | Kit da filial com checklist e vínculo pela NF |
| 2. Entrada do título | Sincronização copia o título e liga à NF | Sistema | Trava, completude, quarentena, fila da esteira |
| 3. Boleto | Anexar boleto ou marcar transferência por parcela | Cuiabá (Matriz e Filial) | Pendência "Anexar boleto" por título |
| 4. Envio | Rascunho no Gmail ou WhatsApp; pessoa revisa e envia | Cuiabá (Matriz) · Filial (Contagem) | Um rascunho por caso; validação de saldo antes do "Enviei" |
| 5. Confirmação | Títulos ≥ R$ 25 mil ou clientes marcados confirmam pagamento | Financeiro | Pendência com saldo real (descontada a AKF) |
| 6. Cobrança | Caso único por cliente e unidade, avançando D+1 → D+5 → D+10 | Financeiro | Pendência única; marco atualizado; encargos por contrato |
| 7. Promessa / contestação | Pausa da régua com desfecho registrado | Financeiro | Desfecho automático na data da promessa |
| 8. Baixa | Conferência da evidência do Consistem e baixa total ou parcial | Financeiro | Trava de concorrência; rascunhos abertos marcados obsoletos |
| 9. AKF | Solicitação, operação e conferência da planilha | Financeiro | Movimentos de cessão; view única de exposição; conferência atômica |
| 10. Exceção | Reabertura, estorno, divergência com o ERP | Gestor administrativo | Pendência de divergência; motivo obrigatório |

## 6. Decisões de negócio pendentes (Fase 0)

Nenhuma fase de código começa sem as respostas abaixo; elas definem regras que o sistema vai aplicar automaticamente.

| # | Decisão | Por que importa | Quem responde | Bloqueia |
| --- | --- | --- | --- | --- |
| D1 | No Consistem, `valorTitulo` em aberto é saldo ou valor original? Como a API mostra baixa parcial, estorno e prorrogação? | Define todo o modelo de saldo e movimentos (F2) | Consistem (Alexandre) — ticket técnico | Fase 2 |
| D2 | Multa e juros padrão (2% + 2% a.m. pro rata) estão previstos nos contratos de venda e locação? Há carência? | Sem base contratual, cobrar encargo no D+10 gera questionamento | Financeiro + jurídico | Fase 4 |
| D3 | Quem pode reabrir título encerrado e estornar baixa? Exige segunda aprovação acima de algum valor? | Controle interno da reabertura | Gestor administrativo | Fase 2 |
| D4 | Quem encerra contestação e com quais desfechos possíveis? | Hoje o título contestado sai da régua para sempre | Financeiro | Fase 4 |
| D5 | Regra oficial de identificação da unidade (série da NF, código de filial no Consistem, faixa de documento)? | Substitui o prefixo `400` | Financeiro + Consistem | Fase 5 |
| D6 | Lista de documentos obrigatórios do kit da filial e quando a carta de cessão é exigida (cessão parcial inclusive)? | Define "kit pronto" | Financeiro + filial Contagem | Fase 5 |
| D7 | Ciclo da solicitação à AKF: quem marca "operada" e com base em qual documento (borderô, e-mail, planilha)? | Fecha o ciclo e lança a cessão sem digitação dupla | Financeiro | Fase 6 |
| D8 | Limiar da quarentena da sincronização (percentual ou quantidade de títulos que somem numa rodada) | Evita que uma falha da API tire títulos da cobrança | Financeiro + TI | Fase 3 |
| D9 | Prioridade: Comercial passa a ler Recebíveis (uma cópia só) agora ou em fase posterior? | Escopo da Fase 7 | Diretoria | Fase 7 |

**Saída da Fase 0:** documento de regras aprovado (uma página por decisão) e ticket do Consistem respondido. Onde a resposta do Consistem demorar, a Fase 2 começa pelo que não depende de D1 (reabertura, bloqueio de escrita).

## 7. Plano por fases

A execução segue 8 fases em sequência; cada uma só termina quando todos os critérios de aceite passam em homologação. Porte: P = poucos dias, M = 1 a 2 semanas, G = mais de 2 semanas (estimativa a calibrar no Claude Code).

### Fase 0 — Decisões e linha de base (P)

- Responder D1 a D9 (seção 6) e abrir o ticket no Consistem.
- Tirar fotografia dos dados atuais: títulos encerrados no Neo Admin e abertos no ERP, pendências duplicadas, kits travados, partes AKF ativas em títulos `998`, títulos `importado` fora da esteira, contestados.
- Criar ambiente de homologação (projeto Supabase separado) com cópia anonimizada.
- **Aceite:** regras aprovadas por escrito; relatório da linha de base com a contagem de cada problema.

### Fase 1 — Contenção imediata (P)

Correções pequenas que fecham os riscos mais graves sem mudar o modelo.

- Remover UPDATE direto em `rec_titulos` da RLS (operador e usuária da filial); manter só as funções (F9, G2).
- `FOR UPDATE` e condição de estágio em `rec_registrar_baixa`, `rec_baixar_titulos` e `akf_desdobrar_titulo` (F8).
- Trava `advisory lock` na sincronização (F7, parte).
- Divergentes (encerrado aqui, aberto no ERP) passam a abrir pendência (F1, parte).
- Restante AKF limitado a zero nas mensagens (H1, parte).
- Alarme quando régua, cadastro ou evidência falham (F7, parte).
- **Aceite:** teste prova que PATCH direto em `estagio` é recusado; duas baixas simultâneas resultam em uma; divergência gera pendência.

### Fase 2 — Núcleo do título (G)

- `rec_movimentos`, `valor_original`, `rec_vw_saldo` (depende de D1).
- `rec_transicionar` com matriz de estados; refatorar as funções atuais para usá-la.
- `rec_reabrir_titulo` e estorno de baixa, com restauração das partes AKF (F1, H5).
- Mudanças de valor e vencimento do ERP como movimento e interação (F13).
- Baixa parcial registrada a partir da evidência do ERP, somando todos os pagamentos e não só o mais recente (F2).
- **Aceite:** testes de cenário para baixa parcial, estorno, prorrogação, reabertura e ajuste de valor; saldo nunca negativo.

### Fase 3 — Sincronização robusta (M)

- Controle de rodada por etapa, com status parcial e pendência.
- Transação por empresa nas etapas de gravação; uma empresa com erro não interrompe as demais.
- Conferência de completude e quarentena (D8) (F7).
- Fila de reprocessamento da esteira (F11).
- Leitura do resultado do `pg_net` e alerta de timeout.
- Monitor de saúde da sincronização na tela do gestor.
- **Aceite:** simulação de API com página faltando não gera "Possível baixa"; rodada com 120 títulos novos coloca todos na esteira em 3 lotes.

### Fase 4 — Cobrança (G)

- `rec_cobrancas` e pendência única por caso (F3, F4, F5).
- Rascunho vinculado, validação antes do "Enviei", obsolescência e exclusão do rascunho no Gmail (F6).
- Um rascunho por caso e marco.
- Encerramento de contestação (F10) e desfecho automático de promessa.
- Tela de contratos e encargos conforme D2.
- Paginação das filas (F12).
- **Aceite:** título baixado com rascunho aberto → rascunho marcado obsoleto; homônimos recebem pendências separadas; avanço D+1 → D+5 mantém uma única pendência.

### Fase 5 — Filial e kit (M)

- Cadastro de unidades e migração da coluna gerada (G5, D5).
- Checklist de "kit pronto" (G3, D6); parcela paga conta como resolvida (G4).
- Cancelamento libera vínculo; kit refeito religa (G1).
- Parcela tardia e regressão do kit abrem pendência (G3, G8).
- Título que some do ERP sai do kit e do rascunho (G7).
- Pendências por chave (G6) e regra "Cuiabá só anexa" (G9).
- **Aceite:** cenários G1, G3, G4 e G7 reproduzidos e corrigidos em teste.

### Fase 6 — AKF (M)

- Cessão, cessão parcial e recompra como movimentos (H2, H4).
- `akf_vw_exposicao` única para tela, Painel e cobrança (H7).
- Conferência atômica (H3).
- Ciclo `operada`/`recusada` (H8, D7) e idempotência do rascunho (H6).
- **Aceite:** título R$ 1.000 com parte de R$ 400 mostra R$ 400 na AKF em todas as telas; recompra não ressuscita parte; falha no meio da conferência não altera nada.

### Fase 7 — Integração, limpeza e documentação (M)

- Comercial lendo Recebíveis (D9).
- Remover ou implementar estágios e tabelas sem uso (`em_renegociacao`, `renegociado`, `juridico`, `rec_acordos`) (F14).
- Atualizar especificações (`docs/modulos/*.md`) e POPs do processo.
- **Aceite:** nenhuma divergência entre especificação e código nos módulos do escopo.

### Depois do plano (backlog)

Renegociação/acordos, fluxo jurídico, cartas D+15/D+30/D+45, importação por planilha (plano B) e lançamento manual — construídos sobre o núcleo novo, não antes dele.

## 8. Saneamento e migração de dados

Cada fase que muda o modelo traz um script de saneamento que roda primeiro em homologação, gera relatório e só vai para produção com conferência humana.

| Fase | Saneamento | Conferência |
| --- | --- | --- |
| 1 | Abrir pendência para todo título encerrado no Neo Admin e ainda aberto no Consistem | Financeiro decide reabrir ou manter, um a um |
| 2 | Gerar `valor_original` e o primeiro movimento de cada título; reconstruir baixas a partir de `data_pagamento`/`valor_pago` | Soma do saldo antes × depois por cliente deve bater |
| 2 | Títulos com `valor_pago` diferente do valor: classificar como baixa parcial, desconto ou juros | Revisão manual da lista |
| 3 | Colocar na fila da esteira os títulos `importado` ainda abertos e sem boleto | Amostra conferida antes da liberação |
| 4 | Converter pendências "Cobrar D+n" abertas em casos de cobrança; concluir as duplicadas e as de marcos anteriores | Total de clientes em cobrança antes × depois |
| 4 | Listar títulos `contestado = true` para decisão (manter, encerrar procedente, encerrar improcedente) | Financeiro |
| 4 | Marcar como obsoletas as mensagens `rascunho` de títulos já baixados | Automático, com relatório |
| 5 | Recalcular unidade pela nova regra; listar títulos que mudariam de unidade | Financeiro + filial antes de aplicar |
| 5 | Desfazer vínculos de kits cancelados e religar aos kits vivos da mesma NF | Lista de kits afetados |
| 6 | Converter `cedido`, portador `998` e `akf_desdobramentos` em movimentos; conferir com a última planilha da AKF | Exposição total antes × depois × planilha AKF |

**Regra:** nenhum script apaga dado. Correções viram movimentos ou interações com origem "saneamento" e a data da execução.

## 9. Governança, testes e implantação

A qualidade da reestruturação depende mais do método de entrega do que do código; as regras abaixo valem para todas as fases.

### 9.1 Testes

1. **Teste de cenário primeiro:** cada constatação (F, G, H) vira um teste de banco que falha antes da correção e passa depois.
2. **Simulador da API do Consistem:** respostas gravadas (fixtures) para lista vazia, lista parcial, título que volta, baixa parcial, estorno e prorrogação, usadas para testar a Edge Function de ponta a ponta.
3. **Testes de concorrência:** duas execuções simultâneas de sincronização, baixa, desdobramento AKF e conferência.
4. **Teste de paridade:** o mesmo cálculo de saldo, encargos e unidade no banco e no TypeScript, comparado automaticamente.
5. **Suíte obrigatória:** nenhuma migration vai para produção com teste falhando.

### 9.2 Implantação

- **Homologação antes:** toda fase roda alguns dias em homologação com dados copiados do Consistem real.
- **Liga e desliga:** funcionalidades novas atrás de configuração (`config` por empresa), permitindo voltar ao comportamento anterior sem migration de reversão.
- **Janela segura:** migrations de modelo fora do horário da sincronização (após 18:30 ou fim de semana).
- **Reversão planejada:** toda migration tem script de volta testado.
- **Execução paralela na Fase 2 e na Fase 6:** saldo antigo e novo calculados lado a lado por uma semana; divergência gera relatório antes da troca.

### 9.3 Papéis

| Papel | Responsabilidade |
| --- | --- |
| Gestor administrativo (Alan) | Aprova regras (Fase 0), prioriza fases, valida aceite |
| Financeiro (Cuiabá) | Confere saneamento, testa telas em homologação, valida cobrança |
| Filial Contagem | Valida kit, unidade e telas restritas |
| Desenvolvimento (Claude Code) | Implementa, escreve testes, gera relatórios de saneamento |
| Consistem | Responde D1 e D5, confirma comportamento da API |

### 9.4 Rotina de acompanhamento

- Ao fim de cada fase: relatório com o que mudou, testes adicionados, indicadores antes × depois e pendências.
- Toda nova constatação encontrada no caminho entra na matriz da seção 11 antes de ser corrigida.

## 10. Indicadores de sucesso

Os indicadores abaixo medem se a reestruturação reduziu erro e retrabalho; a linha de base é levantada na Fase 0 e todos aparecem no monitor do gestor.

| Indicador | Meta | Mede |
| --- | --- | --- |
| Títulos divergentes (Neo Admin × Consistem) sem pendência | 0 | Integridade |
| Pendências de cobrança duplicadas ou de marco anterior abertas | 0 | Retrabalho |
| Rascunhos obsoletos enviados (título já pago) | 0 | Cobrança indevida |
| Diferença entre saldo no Neo Admin e no Consistem, por cliente | R$ 0,00 | Valor cobrado |
| Exposição AKF no Painel × tela AKF × planilha AKF | Iguais | Caixa e securitizadora |
| Alterações de estágio fora de função | 0 (bloqueadas) | Controle interno |
| Títulos com boleto enviado antes do vencimento | Acima da linha de base | Fluxo do processo |
| Tempo entre baixa no Consistem e baixa no Neo Admin | Até 1 dia útil | Agilidade |
| Rodadas de sincronização com falha não sinalizada | 0 | Confiabilidade |
| Kits da filial parados há mais de 3 dias úteis | Abaixo da linha de base | Fluxo da filial |

## 11. Matriz de rastreabilidade

Todas as 31 constatações da auditoria têm fase e causa raiz definidas; a coluna Situação deve ser atualizada a cada entrega.

| Item | Resumo | Causa | Fase | Situação |
| --- | --- | --- | --- | --- |
| F1 | Título encerrado nunca reabre | C2 | 1 (aviso) · 2 (reabertura) | Feito (0184: aviso e reabertura) |
| F2 | Baixa parcial e saldo não modelados | C1 | 2 | A fazer |
| F3 | Pendência deduplicada pelo texto, sem cliente e sem ano | C5 | 4 | A fazer |
| F4 | Nova pendência quando o mais antigo é pago | C5 | 4 | A fazer |
| F5 | Pendências de marcos anteriores ficam abertas | C5 | 4 | A fazer |
| F6 | Rascunho no Gmail sem vínculo com o título | C6 | 4 | A fazer |
| F7 | Falhas silenciosas e execução parcial da sincronização | C4 | 1 (trava, alarme) · 3 | Fase 1 feita (0186: trava e pendência de falha parcial); resto na Fase 3 |
| F8 | Baixa sem trava de concorrência | C3 | 1 | Feito (0184 baixa; 0186 antecipação AKF) |
| F9 | UPDATE direto em `rec_titulos` | C3 | 1 | Feito (0184: gatilho de integridade) |
| F10 | Contestação sem volta | C2 | 4 | A fazer |
| F11 | Títulos fora da esteira por lote grande | C4 | 3 | A fazer |
| F12 | Limites de leitura sem paginação | C4 | 3 · 4 | A fazer |
| F13 | Mudanças do ERP sem histórico | C1 | 2 | A fazer |
| F14 | Funcionalidades da spec não implementadas | C8 | 7 · backlog | A fazer |
| G1 | Kit recriado não religa | C7 | 5 | A fazer |
| G2 | Filial altera estágio livremente | C3 | 1 | Feito (0184) |
| G3 | Kit pronto sem documentos e parcelas | C7 | 5 | A fazer |
| G4 | Parcela paga sem boleto trava o kit | C7 | 5 | A fazer |
| G5 | Regra do prefixo `400` | C7 | 5 | Remendo (0182: correção manual pelo gestor); cadastro na Fase 5 |
| G6 | Pendências da filial duplicadas por texto | C5 | 5 | A fazer |
| G7 | Título que some do ERP continua no kit | C7 | 5 | A fazer |
| G8 | Kit regride sem pendência | C5 | 5 | A fazer |
| G9 | Cuiabá pode criar rascunho da filial | C7 | 5 | A fazer |
| H1 | Restante AKF negativo | C1 | 1 (limite) · 2 | Fase 1 feita (0186: limite a zero e `excedido`) |
| H2 | Parte AKF ressuscita após recompra | C1 | 6 | A fazer |
| H3 | Conferência AKF não atômica | C8 | 6 | A fazer |
| H4 | Dupla contagem na tela AKF | C8 | 6 | A fazer |
| H5 | Reabertura não restaura partes | C2 | 2 | Feito (0184) |
| H6 | Rascunho duplicado à AKF | C6 | 6 | A fazer |
| H7 | Painel × tela AKF divergem | C8 | 6 | A fazer |
| H8 | Solicitação AKF sem desfecho | C8 | 6 | A fazer |

Riscos adicionais da seção 7.4 da auditoria (corrida em `akf_desdobrar_titulo`, gatilho com RLS de quem baixa, carta de cessão para cessão parcial, documentação desatualizada) entram nas Fases 1, 2, 5 e 7, respectivamente.

## 12. Riscos do plano e próximos passos

O maior risco é a resposta do Consistem sobre saldo e baixa parcial (D1) atrasar a Fase 2; por isso as Fases 0 e 1 começam em paralelo.

| Risco | Efeito | Mitigação |
| --- | --- | --- |
| Consistem demora ou não documenta a API (D1) | Fase 2 parada | Testar empiricamente em homologação com um título real de baixa parcial; avançar reabertura e bloqueio de escrita, que não dependem de D1 |
| Saneamento muda números que o Financeiro já conhece | Desconfiança no sistema | Execução paralela e relatório antes × depois por cliente |
| Fase 1 bloqueia algo que a operação faz hoje por UPDATE direto | Operação travada | Levantar antes quais telas gravam direto e criar a função equivalente na mesma entrega |
| Mudança de unidade (Fase 5) altera o que a filial enxerga | Títulos aparecem ou somem para Contagem | Lista prévia validada com a filial |
| Escopo cresce com o backlog (renegociação, jurídico) | Atraso nas fases críticas | Backlog só depois da Fase 6 |
| Encargo padrão sem respaldo contratual (D2) | Questionamento do cliente | Manter sinalização "encargo padrão" até a validação jurídica |

### Próximos passos

- [ ] Enviar ao Consistem o ticket técnico de D1 (saldo, baixa parcial, estorno, prorrogação) e D5 (unidade)
- [ ] Validar com o jurídico os encargos padrão nos contratos de venda e locação (D2)
- [ ] Definir D3, D4, D6, D7 e D8 com o Financeiro
- [ ] Rodar o levantamento da linha de base em produção (somente leitura)
- [ ] Criar o projeto Supabase de homologação
- [x] Fase 1 (0184 e 0186, 23/10/2026)
