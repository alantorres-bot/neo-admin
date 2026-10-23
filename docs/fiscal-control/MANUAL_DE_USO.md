# Manual de uso — Fiscal > Créditos tributários

Como a Neo Formas usa o módulo no dia a dia: controle dos créditos, rotinas de apuração e acompanhamento das entregas e declarações.
Para o detalhe técnico, ver `README.md` e `ARCHITECTURE.md` nesta pasta. O lançamento mensal das EFDs tem roteiro próprio:
`ROTEIRO_MENSAL_EFD.md`.

> O sistema organiza, comprova e confere. Ele **não decide** se um crédito pode ser usado, nem qual é o prazo legal de uma
> declaração: isso vem do contador e fica registrado como parâmetro (com a fonte informada por ele).

## 1. Conceitos em uma página
| Termo | O que é na prática |
| --- | --- |
| **Crédito** | Um valor que a empresa tem a seu favor num tributo (ex.: saldo credor de ICMS). Na Neo, ICMS, PIS e Cofins da matriz são **um crédito por tributo**. |
| **Razão** | A lista de lançamentos do crédito (créditos do mês, deduções, ajustes, compensações). **O saldo nunca é digitado**: é a soma do razão. Nada se apaga; erro se corrige com estorno. |
| **Validado** | Alguém com papel de revisão confirmou que o crédito existe e está documentado. Sem validação, o crédito não pode ser usado. |
| **Disponível** | Validado, sem bloqueio, dentro do prazo e com saldo. É o que pode ser usado de fato. |
| **Competência** | O mês. Cada mês, por estabelecimento e tributo, pode ser **fechado** (congela os valores) depois de conferido. |
| **Saldo oficial** | O saldo que consta na escrituração (EFD). A meta é **saldo do sistema = saldo oficial** em todos os meses. |
| **Obrigação** | Uma entrega ou declaração (ex.: EFD-Contribuições de 09/2026) ou uma rotina interna. Só conta como transmitida com data, número do recibo e o recibo anexado. |

## 2. Quem faz o quê
| Papel no módulo | Quem (hoje) | Faz |
| --- | --- | --- |
| Administrador | Alan | Tudo, inclusive parâmetros e papéis. |
| Revisor / Contador | Ainda ninguém — sugerido: o Aelson como *Contador*, com acesso só à Neo | Valida créditos, aprova ajustes, aprova a transmissão e confere as entregas. |
| Analista fiscal | A definir | Lança, importa, anexa documentos, prepara as obrigações. |
| Leitor | Diretoria, se quiser | Consulta e exporta. |

**Regra de segregação:** quem lança não aprova; quem registra a transmissão não confere. Enquanto só o Alan tem acesso, a chave
`fiscal.creditos.permitir_autoaprovacao` está **ligada**, o que permite aprovar e validar o próprio lançamento com justificativa
("[autoaprovação]"). Desde a 0205 a exceção vale também para conferir a obrigação cuja transmissão você mesmo registrou.
Para dar acesso: Configurações > Usuários (nível na área Fiscal) e, no módulo, Configurações > Usuários e papéis.

## 3. Calendário de rotinas
| Quando | Rotina | Onde | Seção |
| --- | --- | --- | --- |
| Início do mês | Gerar as obrigações do mês e distribuir | Obrigações fiscais | 4.1 |
| Durante o mês | Acompanhar cada obrigação até "Transmitida" e anexar o recibo | Obrigações fiscais | 4.2 |
| Após a transmissão das EFDs | Lançar a EFD no módulo (ICMS, PIS, Cofins) | Importação | `ROTEIRO_MENSAL_EFD.md` |
| Logo depois | Conferir saldo do sistema × saldo oficial e tratar diferenças | Apuração mensal, Conciliação | 4.6, 4.7 |
| Fim do ciclo do mês | Fechar a competência | Apuração mensal | 4.8 |
| Sempre que surgir | Registrar crédito novo (pagamento a maior, saldo negativo, decisão judicial…) | Créditos tributários | 4.3 |
| Sempre que usar | Registrar compensação, ressarcimento ou dedução fora da EFD | Créditos / Movimentações | 4.4 |
| Trimestral | Revisar créditos disponíveis, prazos e oportunidades de uso (ex.: ressarcimento) com o contador | Dashboard, Consolidado | 4.9 |
| Janeiro | Consolidado do ano anterior; cadastrar as obrigações anuais | Consolidado anual, Obrigações | 4.9, 4.1 |
| Anual | Revisar parâmetros (categorias, tipos de obrigação) com o contador; testar backup | Configurações | 6, 7 |

## 4. Passo a passo

### 4.1 Gerar as obrigações do mês
1. Obrigações fiscais > **Gerar pelo perfil tributário** > escolha a competência > Gerar.
2. Só as obrigações **mensais** marcadas em Configurações > *Perfil tributário* são geradas. As trimestrais, anuais e eventuais
   são cadastradas uma a uma (botão de nova obrigação), de preferência em janeiro (anuais) e no início de cada trimestre.
3. Abra cada obrigação e confira responsável e vencimento. Sem regra cadastrada, o vencimento aparece **"a confirmar"**.

### 4.2 Acompanhar uma obrigação até a entrega
Situações: não iniciada → em preparação → aguardando documentos → em revisão → aguardando aprovação → **pronta para transmissão**
→ **transmitida** → **entregue e conferida**. Também: dispensada (com justificativa) e retificada.
1. Mova a situação conforme o andamento (o escritório prepara; a Neo acompanha).
2. "Pronta para transmissão" exige papel de revisão (aprovação registrada).
3. **Transmitida**: informe a data e o número do recibo/protocolo, e **antes** anexe em Documentos o recibo (tipo "Recibo de
   transmissão") vinculado à obrigação. Arquivo salvo sem recibo não comprova entrega.
4. **Entregue e conferida**: outra pessoa confere o recibo e marca (ou o Administrador, com a autoaprovação e justificativa).
5. Erro depois de transmitida: botão **Retificar** (a original fica "retificada" e nasce a retificadora ligada a ela).
6. Não se aplica naquele mês: **Dispensada**, com justificativa de pelo menos 15 caracteres.

### 4.3 Registrar um crédito novo
Use para créditos que **não** vêm da EFD mensal: pagamento a maior, saldo negativo de IRPJ/CSLL, crédito judicial, retenções etc.
1. Créditos tributários > novo crédito (ou Importação > Créditos, para vários de uma vez).
2. Escolha tributo, **categoria**, origem, competência de origem, valor e o tipo do lançamento inicial
   (*crédito apurado*, *crédito reconhecido* ou *saldo inicial*; saldo inicial exige aprovação).
3. Em Documentos, anexe o que a categoria exige (ex.: memória de cálculo; decisão, no judicial) e vincule ao crédito.
4. Outra pessoa (ou o Administrador, com a autoaprovação) usa **Validar / decidir → Validar**. Sem os documentos exigidos o sistema recusa.
5. Se o crédito estiver em discussão, use **Contestado** ou **Bloquear** — ele fica registrado, mas não disponível.

### 4.4 Usar um crédito
- **Dedução na apuração** (ICMS, IPI, PIS, Cofins): entra pela EFD mensal (roteiro). Não lance à mão.
- **Compensação** (PER/DCOMP): Movimentações / ficha do crédito > novo lançamento > tipo *Compensação*. Informe o **número do
  PER/DCOMP** no protocolo e anexe o comprovante (sem protocolo o sistema aceita, mas a Conciliação acusa).
- **Ressarcimento / restituição**: tipo próprio; aqui o protocolo é obrigatório.
- O sistema recusa saída maior que o saldo disponível **em qualquer mês seguinte**, crédito não validado ou **forma não permitida na
  categoria**. Hoje as categorias de ICMS, PIS e Cofins só permitem *dedução*: para compensar ou pedir ressarcimento, o contador
  precisa antes confirmar e o Administrador liberar a forma em Configurações > Categorias (seção 7).

### 4.5 Corrigir um lançamento
- Nada é apagado. Na ficha do crédito, no razão: **Estornar** (anula o lançamento, na mesma competência) ou **Corrigir**
  (estorno + novo lançamento ligado ao original). Ambos exigem motivo.
- Lançamento ainda **pendente**: aprove ou **rejeite** pelo botão do próprio lançamento no razão.
  Atenção: "Validar / decidir → Rejeitar", no topo da ficha, rejeita o **crédito inteiro**, não o lançamento.

### 4.6 Apuração mensal e saldo oficial
1. Apuração mensal > escolha estabelecimento, tributo e ano. A tabela mostra, por mês: saldo inicial, gerado, ajustes, utilizado,
   saldo final e, quando informado, o saldo oficial e a diferença.
2. ICMS/IPI: **Ler arquivo EFD** preenche o saldo oficial direto da EFD ICMS/IPI. PIS/Cofins: **Informar saldo oficial/declarado**
   (o script do roteiro mensal mostra o valor declarado).
3. **Diferença diferente de zero** = algo a investigar antes de fechar (seção 4.7).

### 4.7 Conciliação e divergências
1. Conciliação mostra as verificações automáticas (transporte entre meses, possível duplicidade, sem documento, saldo negativo,
   compensação sem protocolo, calculado × oficial, prazo de aproveitamento, obrigação atrasada, vencimento a confirmar…).
2. Para cada achado: corrija (estorno/ajuste documentado) ou **Registrar** uma divergência e **Tratar** com a explicação.
3. Diferença que vem da própria escrituração (ex.: saldo anterior errado numa EFD) não se "conserta" no sistema: registre a
   divergência e peça a retificação ao escritório.

### 4.8 Fechar e reabrir a competência
1. Apuração mensal > **Enviar para revisão** (opcional) > **Fechar competência**.
2. Regras: só meses já encerrados; **em ordem** (os anteriores com movimento precisam estar fechados); sem lançamento pendente;
   diferença com o saldo oficial ou divergência aberta exige justificativa.
3. Fechado = congelado; não recebe lançamento. Precisa mexer? **Reabrir** (revisor/administrador, com motivo). Lançamento num mês
   anterior marca os meses fechados seguintes como "a reconciliar": use **Reconciliar**, em ordem.
4. O histórico implantado (ICMS desde 09/2021, PIS/Cofins desde 01/2024) ainda está aberto. Sugestão: fechar o histórico de
   uma vez, depois de o contador olhar as diferenças anotadas — peça ajuda para não fazer mês a mês na mão.

### 4.9 Consolidado, Dashboard e relatórios
- **Dashboard**: visão geral (saldo por tributo, gerados × utilizados, obrigações pendentes, atrasadas e a conferir).
- **Consolidado anual**: saldo inicial de janeiro, movimento do ano e saldo final, por tributo e estabelecimento; Excel e impressão.
  Em janeiro, gere o do ano anterior e guarde o PDF em Documentos.
- **Relatórios**: Excel de créditos, movimentações, apuração, consolidado, obrigações e conciliação.
- **Tarefas e aprovações**: o que está esperando aprovação e as tarefas atribuídas (aparecem também na Fila do dia).

## 5. Situações especiais
| Situação | O que fazer |
| --- | --- |
| Escritório retificou uma EFD já lançada | Não relance o mês. No mês seguinte o script mostra a diferença como ajuste; anexe a retificadora em Documentos. |
| EFD do mês não chegou | Não pule o mês. Cobre o escritório; os meses entram em ordem. |
| Crédito em análise (ex.: IPI da matriz) | Não implante até o contador responder. Se implantar antes, deixe **Contestado/Bloqueado**. |
| Crédito perto de perder o prazo | Na ficha do crédito > Editar, preencha a data limite de aproveitamento (definida pelo contador); a Conciliação passa a alertar. |
| Pagamento a maior identificado | Cadastre na categoria *Pagamento indevido ou a maior*, com o DARF e a memória; use por compensação ou restituição (4.4). |

## 6. Cadastros sugeridos de entregas, declarações e rotinas
Onde: Configurações > **Tipos de obrigação acessória** (o que existe) e > **Perfil tributário** (o que se aplica à matriz).
**Nenhum vencimento está preenchido de propósito.** O dia e o mês de vencimento, a confirmação de que a obrigação se aplica à Neo e a
fonte da regra vêm do contador; ao preencher, marque "regra validada" e escreva a fonte (campo *fonte da regra*).

### 6.1 Entregas e declarações (exigem recibo)
| Código | Nome | Esfera | Periodicidade | Documentos exigidos | Situação no sistema |
| --- | --- | --- | --- | --- | --- |
| `EFD_ICMS_IPI` | EFD ICMS/IPI | estadual | mensal | Recibo de transmissão, Arquivo de declaração | já existe — marcar no perfil |
| `EFD_CONTRIBUICOES` | EFD-Contribuições | federal | mensal | Recibo de transmissão, Arquivo de declaração | já existe — marcar no perfil |
| `DCTFWEB` | DCTFWeb | federal | mensal | Recibo de transmissão | já existe — marcar no perfil |
| `EFD_REINF` | EFD-Reinf | federal | mensal | Recibo de transmissão | criar |
| `ECD` | Escrituração Contábil Digital | federal | anual | Recibo de transmissão, Arquivo de declaração | criar (cadastrar todo ano) |
| `ECF` | Escrituração Contábil Fiscal | federal | anual | Recibo de transmissão, Arquivo de declaração | criar (cadastrar todo ano; base do saldo negativo de IRPJ/CSLL) |
| `PERDCOMP` | PER/DCOMP | federal | eventual | Recibo de transmissão (protocolo) | já existe — usar a cada pedido |
| `ESOCIAL` | eSocial (folha) | federal | mensal | Recibo de transmissão | opcional — só se o RH quiser acompanhar aqui |

A lista parte do que a matriz já entrega ou passou a entregar no lucro real (desde 01/2024). **Peça ao Aelson para confirmar** se cada
uma se aplica, se falta alguma (estadual de MT ou municipal) e qual é o vencimento de cada. Obrigações da filial de Contagem ficam
de fora, como no restante do módulo.

### 6.2 Rotinas internas (sem recibo; prazo definido pela própria Neo)
Ao criar, desmarque "exige recibo" e escolha o documento que comprova a rotina. O "vencimento" aqui é uma meta interna, não prazo legal.
| Código | Nome | Periodicidade | Documento que comprova | Liga com |
| --- | --- | --- | --- | --- |
| `LANCAMENTO_EFD` | Lançar as EFDs do mês no Fiscal Control | mensal | Arquivo de declaração (as EFDs) | `ROTEIRO_MENSAL_EFD.md` |
| `APURACAO_ICMS` | Conferência da apuração de ICMS | mensal | Relatório do ERP ou Memória de cálculo | já existe |
| `APURACAO_IPI` | Conferência da apuração de IPI | mensal | Memória de cálculo | criar (ativar depois de resolvido o IPI) |
| `APURACAO_PIS_COFINS` | Conferência da apuração de PIS/Cofins | mensal | Memória de cálculo | criar |
| `FECHAMENTO_CREDITOS` | Conciliação e fechamento da competência | mensal | Planilha de conciliação | seções 4.7 e 4.8 |
| `REVISAO_CREDITOS` | Revisão trimestral dos créditos com o contador | trimestral | Parecer ou documento de suporte | seção 4.9 |
| `CONSOLIDADO_ANUAL` | Consolidado anual dos créditos | anual | Planilha de conciliação (PDF do consolidado) | seção 4.9 |

### 6.3 Perfil tributário da matriz (sugestão)
Marcar para a matriz (17.209.767/0001-28): `EFD_ICMS_IPI`, `EFD_CONTRIBUICOES`, `DCTFWEB`, `EFD_REINF` (se confirmada),
`LANCAMENTO_EFD`, `APURACAO_ICMS`, `APURACAO_PIS_COFINS`, `FECHAMENTO_CREDITOS`. Responsável: Alan; contador responsável: Aelson Miranda.
Anuais, trimestrais e eventuais (`ECD`, `ECF`, `REVISAO_CREDITOS`, `CONSOLIDADO_ANUAL`, `PERDCOMP`) não são geradas pelo botão:
cadastre-as quando chegar a hora.

## 7. Parâmetros que dependem do contador
Em Configurações > **Categorias de crédito**: as categorias vieram como exemplo **não validado** (formas de uso, documentos exigidos,
exige processo). Revise com o contador pelo menos as usadas hoje — *Saldo credor de ICMS*, *Crédito de PIS/Cofins não cumulativo* —
e as que podem surgir (*Saldo credor de IPI*, *Pagamento indevido*, *Saldo negativo de IRPJ/CSLL*), e informe a data limite de
aproveitamento quando houver.

## 8. Pendências em 22/10/2026
1. IPI da matriz: aguardando o contador (estorno de R$ 153.159,57 no livro de 08/2024; NCM 7610.90.00).
2. EFD-Contribuições de 01/2026 não baixada (valores deduzidos da EFD de 02/2026).
3. Dar acesso a um segundo aprovador (revisor/contador) e então desligar a autoaprovação.
4. Confirmar com o contador a lista e os vencimentos da seção 6 e cadastrá-los.
5. Fechar o histórico implantado (seção 4.8, item 4).
