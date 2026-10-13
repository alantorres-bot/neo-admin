# Módulo: Financeiro / Cartão de crédito

Status: em construção — especificação aprovada em 12/10/2026 (plano); **Fases 1, 2 e 2b entregues em 12/10/2026** (cadastros, importação da fatura em PDF, cruzamento com o espelho do Contas a Pagar, planilha).

## 1. Objetivo
Cruzar a **fatura do cartão de crédito** com os **títulos já lançados no Contas a Pagar do Consistem**, apontar o que falta lançar
(IOF, anuidade, tarifas, juros, estornos, passagens, hospedagens, alimentação, combustível e demais despesas sem nota fiscal),
as divergências (cartão trocado, vencimento errado, duplicidade) e o **quadro de conciliação** do Passo 15 do POP "Compras e
Fechamento de Fatura de Cartão de Crédito", entregando a planilha com as sugestões de lançamento prontas para digitação.
Substitui a skill `conciliacao-fatura-cartao`, que rodava à mão com dois arquivos a cada fechamento.

## 2. Como é feito hoje
1. O financeiro baixa a fatura do emissor (PDF) e a guarda em `ADMINISTRATIVO\03 - FINANCEIRO\02 - FATURA CARTAO\<CARTÃO>\<MM.MES>`.
2. Exporta do Consistem a "Consulta Documentos em Aberto" do cartão (tipo de título + vencimento).
3. Roda a skill (Python) com os dois arquivos: ela gera `Conciliacao Cartao <CARTAO> - dd-mm-aaaa.xlsx` com seis abas.
4. O financeiro lança no Consistem o que falta, corrige divergências e só então gera o borderô.
Frequência: um fechamento por cartão por mês (8 cartões). As datas de fechamento e vencimento vêm da **Planilha Cartões**.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Cadastro dos cartões (fechamento, vencimento, tipo de título, leitor de PDF); dicionário estabelecimento → categoria → conta de fluxo; importar a fatura (PDF com ou sem senha, ou CSV) com conferência de integridade; cruzar com os títulos do espelho `cap_lancamentos`; abas A lançar / Divergências / Conciliados / Compensados / Quadro / Linhas / Outros títulos de cartão; planilha XLSX; cancelar fatura (com motivo) | Lançar, alterar ou baixar no Consistem (o Neo Admin só lê o ERP), **exceto o título de encargos do mês e as compras sem título** (regras 31 a 43, 13/10/2026); gravar decisões humanas (reclassificar, casar à mão, "lançado no Consistem") e fechar a conciliação — **Fase 2**; pendências na Fila do dia — Fase 2; leitores Inter, Itaú, Nubank, Unicred — quando houver amostra/senha; PDF digitalizado como imagem (sem texto) |

## 4. Entradas
- **Fatura do emissor**, enviada pela tela (até 8 MB): PDF (texto) ou CSV. O PDF vira **itens de texto posicionados** (x, y) e cada
  emissor tem um leitor (`crt_cartoes.leitor`): `sicredi` (colunas Data e hora · Cidade · Compra · Descrição · Parcela · Valor em
  reais; descrição quebrada em até 3 linhas; "Pagamento NNN" é pagamento), `picpay` (duas colunas por página; parcela colada ao
  nome, `PARC07/08`; "PAGAMENTO DE FATURA" é pagamento), `generico` (linha = data + descrição + valor; também lê CSV, inclusive o
  do Nubank com ponto decimal). Inter e Itaú mandam PDF **com senha**: a senha é informada na importação e não é guardada.
- **Títulos**: lidos **na hora da API do Consistem** pela Edge Function `cap-sincronizar-consistem`, ação só de leitura
  `titulos_vencimento` (nível consulta): títulos C com vencimento na janela, **com qualquer saldo**, marcando quem está em borderô.
  Motivo: no fechamento o financeiro põe os títulos do cartão num borderô (saldo zero) e eles nunca chegam ao espelho
  `cap_lancamentos`, que só guarda saldo > 0. Se a função falhar, a tela cai para o espelho e avisa. Nada de planilha.
- **Cartões**: carga inicial = Planilha Cartões (12/10/2026): INTER PF 20/28 (tipo 8) · INTER PJ 3/10 (8) · ITAÚ PJ 10/28 (10) ·
  NUBANK PF 20/27 (7) · PICPAY PF 15/25 (75) · SICREDI PF 26/10 (9) · SICREDI PJ 10/23 (9) · UNICRED PF 10/20 (73).
- **Dicionário**: carga inicial = `dicionario-estabelecimentos.csv` da skill (43 padrões).
- Amostras: só no Drive (dados reais). O repositório tem faturas **sintéticas** com o mesmo layout (`lib/modulos/financeiro/cartao/fixtures/`).

## 5. Regras de negócio
1. **Regra de ouro:** nunca inventar valor, fornecedor, data ou classificação. O que não se identifica com segurança vai para
   "Não identificado" com `[CONFERIR]`.
2. **Integridade da leitura:** a importação só é aceita se a **soma das linhas não descartadas = total da fatura informado**
   (função `crt_importar_fatura` recusa). Linhas descartadas: pagamento da fatura anterior, saldo, totais, limite.
3. **Seleção dos títulos** (`selecao-titulos.ts`): tipo C com `data_vencimento` na janela de **±5 dias** do vencimento efetivo
   (o emissor desloca o vencimento nominal para o dia útil) e complemento que identifica o cartão: palavra CARTÃO + banco
   (tolera "SICRED", "NUBANCK"); sem PF/PJ no texto, desempata pelo **dia do vencimento** (Inter PF 28 × PJ 10; Sicredi PF 10 × PJ 23);
   ainda ambíguo com o cartão entre os candidatos → entra. Títulos de cartão na janela que citam **outro** cartão, ficam ambíguos
   sem o cartão ou só dizem "CARTÃO" vão para **Outros títulos de cartão na janela** (base do alerta de cartão trocado).
   Valor do título: `valor_atualizado` (saldo) enquanto aberto; `valor_documento` quando já baixado no Consistem.
   **Título provisório da fatura** (processo confirmado pelo Alan em 12/10/2026): no fechamento o financeiro insere todos os
   títulos do cartão num **borderô** do valor da fatura e lança um **título provisório contra o banco**; ao pagar a fatura, baixa
   o borderô no valor pago e **exclui o provisório**. O módulo reconhece o provisório (valor exatamente igual ao total da fatura,
   citando o cartão ou contra o banco emissor; ex.: "CARTÃO CREDITO SICREDI PF", Banco Sicredi, R$ 78.528,72, venc. 13/10): fica
   fora do cruzamento linha a linha e aparece num aviso próprio. Os títulos no borderô entram pelo **valor do documento** e
   levam a marca "borderô" na aba Conciliados.
4. **Compensação:** pares que se anulam saem do cruzamento e vão para a aba Compensados: `IOF de X` × `IOF de volta de X`;
   `Estorno de X` × relançamento de `X` (mesmo valor absoluto, semelhança ≥ 0,60). Estorno **sem** par permanece: é crédito real.
5. **Casamento** (o valor é a chave; a descrição só desempata): (a) valor **exato** em centavos, um para um, escolhendo o título de
   maior semelhança com a descrição; (b) **tolerância de 5 centavos** (arredondamento de desdobramento); (c) **agrupamento**: várias
   linhas iguais da fatura num título só (4 pedágios de R$ 20 → título de R$ 80). Semelhança < 0,45 → "Conferir descrição".
   A soma das diferenças dos casamentos com tolerância entra no quadro como **"arredondamento de desdobramento"** (acertado como
   desconto na baixa), e não como diferença não justificada.
6. **Classificação** do que sobrou da fatura, na ordem: valor negativo → **Estorno / crédito**; descrição com IOF, ANUIDADE, TARIFA,
   JUROS, MULTA, ENCARGO, SEGURO, MORA, ROTATIVO, PARCELAMENTO DE FATURA → **Encargo financeiro**; parcela > 1 → **Parcela não
   desdobrada** (o erro se repete nas faturas seguintes); padrão do dicionário → **Despesa sem nota fiscal** (categoria e conta de
   fluxo; conta vazia = `[CONFERIR]`, caso dos marketplaces); senão **Não identificado**.
7. **Sugestão de lançamento:** parcelas = total de parcelas da linha (ou 1), vencimento = o da fatura, complemento na máscara do
   POP `CARTÃO <NOME> <Nx> — <DESCRIÇÃO>` (até 70 caracteres, limite do campo no Consistem).
8. **Divergência** (título sem linha na fatura), causa provável: complemento cita outro cartão → "possível cartão trocado"; outro
   título de mesmo valor no ciclo → "possível duplicidade"; vencimento fora da janela → "vencimento digitado errado"; senão "sem
   correspondência — apurar antes de qualquer exclusão". Nenhum título é excluído sem apuração.
9. **Quadro de conciliação:** total da fatura − total dos títulos = diferença apurada; justificativas por natureza (encargos,
   despesas sem NF, parcelas não desdobradas, estornos, não identificados) e arredondamento − títulos sem correspondência = **diferença não
   justificada**, que deve ser zero. **Não gerar o borderô enquanto houver diferença não justificada.**
10. Título conciliado pelo valor cujo complemento cita outro cartão não gera diferença, mas é erro de classificação: alerta na aba Conciliados.
11. A fatura importada é **prova**: cabeçalho e linhas imutáveis, nunca apagados; só `importada → cancelada` com motivo (gestor ou
    quem importou). Um ciclo (empresa + cartão + vencimento) só pode ter uma fatura importada por vez.
12. Nunca gravar número completo do cartão, CPF ou endereço do titular: só as linhas de transação. A senha do PDF não é gravada.
13. **Ciclo mensal** (Fase 2) = empresa + cartão + **competência** (mês do vencimento nominal). Calendário pela Planilha Cartões:
    vencimento = dia de vencimento no mês da competência; fechamento = o último dia de fechamento antes dele (Sicredi PF 10/2026:
    fecha 26/09, vence 10/10; Inter PJ 10/2026: fecha 03/10, vence 10/10). Vencimento efetivo deslocado para o dia útil volta à
    competência mais próxima (13/10 → 10/2026).
14. **Situações:** *Aguardando fatura* (nasce no dia seguinte ao fechamento; `crt_gerar_ciclos`, diário às 07:00 e ao abrir a tela,
    a partir de `financeiro.cartao.ciclos_a_partir_de` = 10/2026) → *Em conciliação* (fatura importada no mês) → *Fechada* →
    *Paga*. Cancelar a fatura devolve o mês a *Aguardando fatura*. Mês fechado ou pago não aceita importar nem cancelar fatura.
15. **Fechar:** só **gestor**, só com **nada a lançar e diferença não justificada R$ 0,00**, recalculando no servidor com os títulos
    lidos do Consistem (não fecha com o espelho de plano B). Grava `crt_fechamentos` (foto do resultado: prova, imutável) e anexa a
    planilha do fechamento. A tela do mês fechado mostra o **resultado congelado**, não o ao vivo.
16. **Reabrir:** só gestor, com motivo, só mês *Fechada* (pago não reabre). O fechamento fica no histórico como reaberto; o próximo
    fechamento ganha a versão seguinte.
17. **Paga automática:** o título provisório identificado no fechamento (pelo código do lançamento) é vigiado: quando a
    sincronização do contas a pagar marca `baixado_em` nele (o financeiro o exclui após pagar), o mês vira *Paga* com essa data
    (gatilho em `cap_lancamentos`). Se o provisório já tinha saído do Consistem ao fechar, o mês já fecha como *Paga*. Sem
    provisório identificado, *Paga* não é detectada (a tela avisa). A sincronização do contas a pagar passou a rodar **todo dia às
    07:30** (pg_cron `cap-sincronizar-consistem-diario`).
18. **Pendências na Fila do dia** (módulo `financeiro.cartao`, link para o mês): "Importar fatura <CARTÃO> MM/AAAA" (ao nascer o
    mês), "Conciliar fatura …" (enquanto houver item a lançar ou resíduo, na última apuração) e "Fechar a fatura …" (quando zera,
    para o gestor). Prazo = vencimento nominal; criticidade alta a 3 dias ou menos. São só criadas, concluídas ou canceladas.
19. A apuração (itens pendentes, diferença, resíduo, provisório) é gravada a cada vez que alguém abre o mês em conciliação.
20. **Decisões por item** (Fase 2b, `crt_decisoes`): o operador registra, numa linha a lançar ou num título sem linha, uma de cinco
    decisões — **classificar** (troca categoria/conta; opcionalmente grava no dicionário), **justificar** (não gera título; motivo),
    **casar à mão** (linhas ↔ títulos, inclusive título que cita outro cartão; a diferença vira ajuste justificado no quadro),
    **compensar** (linhas que somam zero) e **observar** (texto livre). Motivo obrigatório em justificar, casar e compensar.
21. A conciliação aplica primeiro as compensações e os casamentos à mão, depois o cruzamento automático no que sobrou, e por fim
    classificação, justificativa e observação nos itens que restaram.
22. **Pendente** = item a lançar sem justificativa. O fechamento exige **zero pendentes** e diferença não justificada zero. Item
    justificado continua no quadro (o valor justifica a diferença) mas não bloqueia o fechamento.
23. Uma linha (ou título) só entra numa decisão ativa de justificar/casar/compensar; classificar substitui a anterior da linha.
24. Decisão que deixa de se aplicar (o item foi resolvido pelo cruzamento, o título saiu da janela, a compensação não fecha) aparece
    como **sem efeito**, com aviso na tela; não é apagada.
25. Nada é apagado: desfazer grava quem, quando e o motivo. Mês fechado ou pago não aceita decisão nova nem desfazer (reabrir antes).
    A planilha ganha a coluna "Decisão" e a aba "Decisões"; a foto do fechamento guarda as decisões aplicadas.
26. **Regra fornecedor → cartão** (Fase 3): o cadastro é **só no Neo Fiscal** (`fornecedor_cartao`, com vigência). O Neo Admin
    guarda uma cópia em `crt_regras_fornecedor`, atualizada pela Edge Function `crt-sincronizar-regras` (botão "Atualizar do Neo
    Fiscal" na aba Cartões e pg_cron diário às 07:15), que chama a função `cartao-regras` do Neo Fiscal com o segredo compartilhado
    (`NEO_FISCAL_SEGREDO` aqui = `NEO_ADMIN_SEGREDO` lá). Resposta vazia com cópia cheia não apaga nada (trava).
27. Na seleção dos títulos, vale a regra **vigente na emissão** do título (ou no vencimento, sem emissão): título sem a marca
    "CARTÃO" no complemento entra na fatura quando a regra do fornecedor é este cartão ("pela regra"); título que cita outro
    cartão mas cuja regra é este cartão aparece em "Outros títulos de cartão" com o aviso de provável cartão trocado.
28. Título que cita este cartão mas cuja regra é **outro** cartão conta como **cartão divergente** (alerta nos conciliados;
    causa "a regra do fornecedor no Neo Fiscal é o cartão X" nas divergências).
29. Título que entrou só pela regra e ficou sem linha na fatura: causa "fornecedor pago neste cartão pela regra, mas sem linha —
    confirmar se esta compra foi no cartão" (pode ter sido paga por boleto; registrar a decisão).
30. **Antecipações a fornecedor pagas no cartão** (13/10/2026, caso CPV Digital na Sicredi PF 10/2026): a consulta ao Consistem
    traz também as antecipações (tipo A) com **data de pagamento** na janela do vencimento (emitidas até 60 dias antes; data de
    pagamento do espelho ou do detalhe `lancamentoContasPagar/{id}`, mesmo já abatidas por NF). A antecipação entra direto quando
    o complemento cita este cartão ou a regra do fornecedor é este cartão; senão é **candidata**: casa sozinha só com linha que
    sobrou do cruzamento e tem o **mesmo valor em centavos** (modo "Antecipação", aderência "conferir" — Inter PJ e Sicredi PF vencem
    no mesmo dia 10), ou por decisão "casar". Candidata que não casa aparece em "Outros títulos" e não entra no total.
31. **Encargos lançados pelo painel** (13/10/2026, decisões do Alan): as linhas "Encargo financeiro" que ficaram a lançar (sem
    justificativa e sem lançamento anterior) viram **um título com a soma** no Consistem, contra o banco emissor, pela operação
    "Gerar um Lançamento de Contas a Pagar" (`PUT financeiro/v10/lancamentoContasPagar`). É a **única escrita** do Neo Admin no ERP.
32. Campos do título: emissão e entrada = **fechamento** da fatura (mês do cartão); vencimento = o da fatura; documento = **DDMM do
    fechamento**; complemento `CARTÃO <NOME> — ENCARGOS: IOF, JUROS…` (tipos presentes, até 70 caracteres; a conciliação reconhece
    o cartão); fornecedor, histórico, portador, categoria, grupo/conta de fluxo e contas contábeis vêm de
    `crt_cartoes.lancamento_encargos` (gestor edita na aba Cartões). Valores iniciais = os dos lançamentos manuais desde jun/2026
    (levantados pela API em 12/10/2026, confirmados pelo Alan): histórico 2, portador 91, categoria 17, fluxo 22/28, contábil
    débito 3473 / crédito 2004; fornecedor Sicredi 80, Inter 76, Nubank 360, PicPay 391, Itaú 276, Unicred 607.
33. **Botão com conferência**: "Lançar no Consistem" mostra o título exato; operador ou gestor confirma. Nada sai sozinho. A chave
    geral `financeiro.cartao.lancar_encargos_no_erp` começa **desligada** (o quadro só mostra a prévia). Só mês **em conciliação**.
34. **Um lançamento de encargos ativo por mês** (reservado, enviando ou lançado): clique duplo ou duas pessoas não duplicam o título.
    O painel recalcula a conciliação e confere que o título é o que a pessoa viu antes de reservar.
35. **Nunca reenviar sozinho**: 4xx do Consistem = erro (nada criado, pode tentar de novo); 2xx com código = lançado; queda de rede,
    tempo esgotado, 5xx ou 2xx sem código = **sem resposta**: fica "enviando" e uma pessoa confere no Consistem e resolve
    ("Foi criado" com o código, ou "Não foi criado"), registrando o que conferiu.
36. Lançado: grava a decisão **casar** das linhas com o título criado (as linhas saem de "A lançar"). Tudo fica em
    `crt_lancamentos_erp` (o que foi enviado, a resposta, o código, erros e resoluções), nunca apagado.
37. **Compras sem título lançadas pelo painel** (13/10/2026, decisões do Alan): linha pendente de "Despesa sem nota fiscal",
    "Não identificado" ou "Parcela não desdobrada" (valor positivo, sem decisão) ganha o botão **Lançar**. Encargos têm o quadro
    próprio; estornos não viram título.
38. **Sugestão pelo estabelecimento**: o estabelecimento do dicionário (chave mais longa que aparece na descrição) traz os
    códigos de `crt_estabelecimentos.lancamento_erp` (fornecedor, histórico, categoria, fluxo, contas, todos opcionais); o que
    faltar vem dos padrões do cartão (`crt_cartoes.lancamento_compras`: portador, categoria, histórico, conta contábil de
    crédito); o resto o operador escolhe. Cada estabelecimento terá um **fornecedor próprio cadastrado no Consistem**; o
    operador busca o fornecedor no espelho `cap_fornecedores` da empresa.
39. O operador pode **mudar todos os códigos**. Com **"Lembrar para as próximas compras de <trecho>"**, os códigos viram a
    sugestão do estabelecimento (cria o estabelecimento no dicionário, se não existir).
40. **Parcelada sem título** (ex.: 2/5): lança **todas as parcelas restantes** de uma vez, uma por mês: a da fatura no vencimento
    da fatura; as seguintes no vencimento nominal das competências seguintes (Planilha Cartões). Emissão e entrada = data da
    compra; documento = DDMM da compra (com "/k" quando parcelada); complemento `CARTÃO <NOME> <N>x — <DESCRIÇÃO> PARC k/N`
    (até 70); valor = o da linha em todas as parcelas. Aviso no diálogo: conferir se a compra não foi lançada pelo total.
41. Um clique = um **lote**. O envio é em ordem, um título de cada vez, sem repetir; para no primeiro que não voltar lançado.
    Os seguintes ficam "Não lançado: envio interrompido" e o botão **Reenviar o que faltou** cria só as parcelas sem lançamento
    ativo. Parcela já lançada nunca duplica (índice único por linha e parcela).
42. Lançada: a decisão **casar** liga a linha só ao título da parcela **desta** fatura; as parcelas futuras casam sozinhas nas
    próximas faturas (mesmo valor, cartão citado, vencimento na janela).
43. Uma só chave libera encargos e compras: `financeiro.cartao.lancar_no_erp` (era `..._encargos_no_erp`), começa desligada.
44. **Fornecedor de estabelecimento de cartão** (13/10/2026, decisões do Alan): cadastrado no Consistem como **classificação 3
    ("Outros")**, sem CNPJ, pelo `PUT cadastrosgerais/v10/fornecedor`. Nome = descrição do estabelecimento (maiúsculas, até 60;
    nome fantasia = 30 primeiros); endereço **igual para todos** (Rua Canadá, 277, Santa Rosa, 78040-050, Cuiabá/MT — o mesmo de
    19 dos 28 "Outros" existentes); categoria 17 e grupo 22 sugeridos, o operador pode trocar. Configuração
    `financeiro.cartao.fornecedor_outros`. O corpo é montado pelo banco (ninguém troca o endereço). O Consistem exige no tipo 3 o cpfCnpj e a inscrição estadual (recusa do primeiro cadastro real, UNIDAS, 13/10/2026): como nos "Outros" existentes, cpfCnpj = o próprio código com 7 dígitos (928 → 0000928), inscrição ISENTO e IBGE 5103403 (migration 0142). A Edge Function escolhe o código: maior do espelho + 1, conferido no Consistem.
45. **Marcas** (Nuviagens, Latam, Google…): na aba Estabelecimentos, **Ligar ou cadastrar** — lista os fornecedores do espelho
    com o nome parecido (ex.: GOOGLE → 1370, 889, 928) para ligar; se não houver, cadastra. O código vai para a sugestão do
    estabelecimento.
46. Não cadastra nome que já existe no espelho (nome ou nome fantasia iguais, sem acento): mostra o código para ligar. O mesmo
    nome não é cadastrado duas vezes pelo painel.
47. **Genéricos** (posto, restaurante, padaria, hotel, pousada, supermercado; caixa "fornecedor por compra"): sem fornecedor
    fixo; no diálogo de lançar, o operador busca o fornecedor da compra ou **cadastra** um "Outros" com a descrição dela.
48. **Marketplace** (Mercado Livre, EBAZAR; caixa "marketplace"): a nota é emitida pelo **vendedor**; sem fornecedor próprio e
    **sem botão Lançar** — a conciliação casa pelo **valor** com o título da nota lançada no Consistem.
50. **Listas do Consistem** (planilhas enviadas pelo Alan em 13/10/2026; migration 0143): `cap_categorias_fornecedor` (27) e
    `cap_contas_fluxo` (209, grupo × item, ativa/inativa). No fornecedor, **codGrupo = grupo do fluxo** e **item = a conta**
    (confirmado pelo Alan). Cadastro do fornecedor, diálogo de lançar, estabelecimento e códigos de encargos do cartão usam
    listas em vez de números. Correções: alimentação 12/6 (era 10/15 Insumos); Mercado Livre sem conta de fluxo.
51. **Fornecedores genéricos por tipo de aquisição** (decisão do Alan, 13/10/2026; cadastrados por ele na tela do Consistem;
    migration 0144): 1372 HOSPEDAGEM (13/7), 1373 ESTACIONAMENTO E PEDAGIOS (estacionamento 18/7, pedágio 18/8), 1374 PASSAGENS
    AEREAS (13/6), 1375 LOCACAO DE VEICULOS (22/26), 1376 TRANSPORTE POR APLICATIVO (13/5), 1377 COMBUSTIVEIS E LUBRIFICANTES
    (18/4), 1378 ALIMENTACAO E REFEICOES (12/6), 1379 SOFTWARES E ASSINATURAS (16/4), 1380 MATERIAL DE COPA E LIMPEZA (16/7, sem
    estabelecimento no dicionário), 1381 FARMACIA E MEDICAMENTOS (12/24; DROGARIA e FARMACIA). Cada estabelecimento do tipo sugere
    o genérico e a conta de fluxo do tipo (a conta do título vem do estabelecimento, mesmo onde o cadastro do fornecedor tem
    outra). Google fica no 928 GOOGLE SUITE. Os genéricos do dicionário deixam de ser "fornecedor por compra". Compras com nota
    fiscal continuam pela nota; marketplace casa pelo valor. A sincronização do contas a pagar passou a reler o cadastro de
    fornecedores a cada rodada (fornecedor novo aparece no painel mesmo sem título).
52. **Lançamento agrupado** (pedido do Alan, 13/10/2026, Sicredi PJ 10/2026 com 14 linhas de transporte por aplicativo;
    migration 0150): várias linhas à vista, positivas e pendentes viram **um título** com a soma — vencimento da fatura, emissão
    e entrada no fechamento, documento DDMM do fechamento + "-" + o menor número de linha, complemento
    `CARTÃO <NOME> 1x — <GRUPO> (<n> LANÇ.)`. Códigos: os comuns às sugestões das linhas (diferentes → aviso). Na aba A lançar:
    caixa de seleção por linha, atalhos "Agrupar: <fornecedor> — n linhas, R$ X" e "Lançar agrupado". Lançado: "casar" liga
    todas as linhas. Estabelecimento "99" (a fatura traz só "99").
53. **Documento único por fornecedor** (recusa real de 13/10/2026: duas compras da 99 no mesmo dia, documento 0810 no 1376):
    o documento da compra leva o número da linha na fatura (DDMM-ordem, e /k nas parcelas). **Contas contábeis:** o painel recusa
    débito igual ao crédito e débito igual à conta de crédito padrão do cartão (2004, fornecedores) — o título 33626 saiu com
    débito 2004 e crédito 3241 (invertidas) e foi corrigido no Consistem pelo financeiro; a sugestão da "99" foi corrigida
    (migration 0151). "Reenviar o que faltou" só aparece para envio interrompido (recusa pede correção e novo lançamento).
49. Cadastro com a mesma regra de envio dos títulos: reserva, envio único, erro (nada criado) ou sem resposta (conferir e
    resolver à mão); cadastrado vai na hora para o espelho `cap_fornecedores`. Prova em `crt_fornecedores_cadastrados`.

Exemplo numérico (ciclo correto, como a calibração da skill): fatura R$ 1.736,70 com 12 linhas (2 pares compensados; 4 pedágios de
R$ 20) × 5 títulos (um de R$ 120,00 para linha de R$ 120,01) → 4 exatos + 1 agrupamento, diferença apurada R$ 0,01 = arredondamento,
zero a lançar, zero divergências (`conciliacao.test.ts`). Detecção: tirando 2 títulos e trocando um cartão → 2 itens a lançar
(Hospedagem/Hospedagens e Encargo financeiro) e 1 alerta de cartão divergente.

## 6. Saídas e automações
- **Planilha XLSX** `Conciliacao Cartao <CARTAO> - dd-mm-aaaa.xlsx` com as abas Resumo, A Lançar, Divergências, Conciliados,
  Compensados e Conciliação (mesmo layout da skill), gerada na hora pelo botão "Baixar planilha".
- Na tela, a conciliação é **calculada ao vivo** sobre o espelho (depois de "Atualizar do Consistem" em Contas a pagar, basta recarregar).
- Fase 1 não cria pendências nem mensagens.

## 7. Telas (rota `/financeiro/cartao`, menu Financeiro > Cartão de crédito)
| Tela | O que mostra |
| --- | --- |
| **Meses** (`/financeiro/cartao/meses`, entrada do módulo) | Grade cartão × mês com 6 meses: começa no mês inicial do módulo (`ciclos_a_partir_de`, 10/2026) ou dois meses antes do atual, o que for mais recente, e segue para o futuro (navegação até 12 meses à frente; nunca antes do início). Mês com ciclo mostra a situação, o total, itens a lançar ou data de pagamento; mês que ainda não fechou aparece como **Previsto**, com o vencimento; cores: **Paga** verde, **Aguardando fatura** amarelo, **Em conciliação** azul, **Fechada** cinza e **Atrasada** vermelho (vencimento já passou, com sábado e domingo levados para a segunda, e o mês não está pago; vale para qualquer situação); contadores por situação e de atrasados |
| **Mês do cartão** (`/ciclo/[id]`) | Cabeçalho (fechamento, vencimento, situação), linha do tempo (fechou · importada · fechada · paga), Importar fatura (aguardando), conciliação ao vivo (em conciliação) ou resultado congelado (fechada/paga), Fechar o mês (gestor; desabilitado com o motivo), Reabrir (gestor), planilha do fechamento, histórico de fechamentos |
| **Histórico do cartão** (`/historico?cartao=`) | Todos os meses de um cartão: situação, total, a lançar, quem fechou e quando, data de pagamento (link também na aba Cartões) |
| **Relatório** (`/imprimir/cartao/ciclo/[id]`, botão "Imprimir / salvar PDF" no mês) | Folha A4 sem a moldura: empresa e CNPJ, cartão e mês, fechamento/vencimento/situação, quadro de conciliação, itens sem título (com a decisão ou PENDENTE), títulos sem linha, conciliados, compensados, decisões, fechamento (versões e reaberturas) e pagamento. Mês fechado/pago imprime o resultado congelado; em conciliação, o cálculo do momento com o selo "SEM VALIDADE — MÊS NÃO FECHADO" |
| **Faturas** (`/financeiro/cartao/faturas`) | Faturas importadas por empresa/cartão/vencimento (total, linhas, status, quem importou, link para o mês) + "Importar fatura avulsa" |
| **Importar fatura** (`/nova`) | Empresa, cartão, vencimento efetivo, total da fatura, arquivo (PDF/CSV), senha do PDF (opcional) → **pré-visualização** das linhas lidas (data, descrição, parcela, valor, descartadas), soma × total, vencimento e total impressos pelo emissor, avisos do leitor. "Confirmar importação" só com a soma batendo |
| **Conciliação** (`/[id]`) | Cartões: total da fatura, títulos, diferença apurada, **diferença não justificada** (vermelho se ≠ 0), conciliados com cartão divergente; abas A lançar · Divergências · Conciliados · Compensados · Quadro · Linhas da fatura · Outros títulos de cartão na janela; botões Baixar planilha, Cancelar fatura (motivo); rodapé "Não gerar o borderô enquanto houver diferença não justificada" |
| **Cartões** (`/cartoes`) | Cadastro: código, nome, banco, PF/PJ, fechamento, vencimento, tipo de título, leitor, pasta, ativo, os **códigos do Consistem dos encargos** e os **padrões de compra** (gestor edita) |
| **Lançar compra** (botão na aba A lançar; diálogo) | Fornecedor (busca por nome ou código), códigos com a origem (do estabelecimento, do cartão, informado, escolher), títulos que serão criados (parcela, vencimento, documento, valor, complemento), "Lembrar para as próximas compras de", botão "Lançar N títulos" |
| **Compras lançadas no Consistem** (lista acima das abas) | Lotes do mês: compra, parcela, vencimento, valor, situação (Lançado nº, Sem resposta, Não enviado, Não lançado), quem e quando; Resolver e Reenviar o que faltou |
| **Encargos do mês** (quadro na conciliação e no mês em conciliação) | Linhas de encargo pendentes, soma e o título que vai para o Consistem (fornecedor, documento, datas, valor, complemento, códigos); botão **Lançar no Consistem** com conferência; lançamento ativo (lançado com o código, ou sem resposta com **Resolver**); erros anteriores |
| **Estabelecimentos** (`/estabelecimentos`) | Dicionário com busca; incluir/editar (operador), com a **sugestão de lançamento no Consistem** (fornecedor, códigos). A aba A lançar tem o atalho "Cadastrar" para item não identificado |

## 8. Dados (prefixo `crt_`, tudo em `public`)
| Tabela / objeto | Papel |
| --- | --- |
| `crt_cartoes` | Cartões (código = nome sem acento; fechamento; vencimento; `tipo_titulo`; `leitor`; `pasta_faturas`) — gestor edita; auditoria |
| `crt_estabelecimentos` | Dicionário (`padrao` único normalizado, categoria, `conta_fluxo` nula = [CONFERIR]) — operador edita; auditoria |
| `crt_faturas` | Cabeçalho da fatura importada (empresa, cartão, vencimento, total informado, soma, contagens, leitor, arquivo, status) — prova |
| `crt_fatura_linhas` | Linhas de transação como lidas (data, descrição, valor, parcela, descartada, texto de origem) — imutáveis |
| `crt_vw_faturas` | View com nomes (empresa, cartão, quem importou/cancelou) |
| `crt_ciclos` | Mês do cartão: competência, fechamento, vencimento, situação, fatura vigente, última apuração, provisório, fechada/paga — sem delete; auditoria das mudanças de situação |
| `crt_fechamentos` | Fechamentos (versão, foto do resultado em jsonb, totais, provisório, quem fechou/reabriu e motivo) — prova; planilha anexada |
| `crt_vw_ciclos` | View dos meses com nomes e total da fatura |
| `crt_lancamentos_erp` / `crt_vw_lancamentos_erp` | Títulos lançados pelo painel no Consistem (tipo encargos ou compra; lote; linha de origem; parcela/parcelas; vencimento): linhas, valor, complemento, payload enviado, situação (reservado → enviando → lançado/erro), código criado, resposta, quem/quando, resolução à mão; sem delete; auditoria |
| `crt_fornecedores_cadastrados` | Fornecedores "Outros" cadastrados pelo painel: nome, corpo enviado, situação, código, resposta, quem/quando; sem delete; auditoria |
| `crt_decisoes` / `crt_vw_decisoes` | Decisões por item (tipo, linhas, títulos, categoria/conta, motivo, quem/quando, desfeita por/quando/motivo) — sem delete; auditoria |
| Funções | `crt_importar_fatura` (com `p_ciclo`), `crt_cancelar_fatura`, `crt_salvar_cartao`, `crt_salvar_estabelecimento`, `crt_normalizar`, `crt_gerar_ciclos`, `crt_registrar_apuracao`, `crt_fechar_ciclo`, `crt_reabrir_ciclo`, `crt_calendario`, `crt_competencia_do_vencimento`, `crt_registrar_decisao`, `crt_desfazer_decisao`, `crt_reservar_lancamento_encargos`, `crt_reservar_lancamento_compra`, `crt_reenviar_lancamentos`, `crt_iniciar_envio_erp`, `crt_concluir_lancamento_erp` e `crt_interromper_lote` (só service role), `crt_resolver_lancamento_encargos` |
| Agendamentos | `crt-gerar-ciclos-diario` (07:00 Cuiabá) e `cap-sincronizar-consistem-diario` (07:30; `cap_chamar_sincronizacao`, mesmo segredo do Vault de Recebíveis) |
Migration: `0131_crt_base.sql`. Anexo: o PDF/CSV importado vai para o Storage (`anexos`, módulo `financeiro.cartao`, tabela `crt_faturas`).
Código puro: `lib/modulos/financeiro/cartao/` (`texto`, `cartoes` — porta do motor do Neo Fiscal —, `leitores/`, `fatura-pdf`
(unpdf), `selecao-titulos`, `conciliacao`, `planilha`), com testes ao lado; `tests/db/crt-base.test.ts`.

## 9. Permissões (área Financeiro)
| Nível | Pode |
| --- | --- |
| consulta | ver faturas, conciliação, cartões, dicionário; baixar a planilha |
| operador | importar e cancelar a própria fatura; manter o dicionário; registrar e desfazer decisões por item |
| gestor | tudo acima + cancelar qualquer fatura; editar o cadastro de cartões; **fechar e reabrir o mês** |

## 10. Pontos em aberto
1. **Valor do título:** a skill usava "Valor Total (R$)" da exportação (≠ "Valor Documento" por arredondamento de desdobramento). No
   espelho usamos `valor_atualizado` (saldo) em aberto e `valor_documento` após a baixa. Confirmar na primeira fatura real.
2. **Tipo de título** (7, 8, 9, 10, 73, 75): se algum campo do espelho (`categoria_doc`? `cod_historico`?) trouxer esse código, a
   seleção dos títulos passa a ser exata e o complemento vira só conferência.
3. **Leitores Inter e Unicred calibrados em 12/10/2026** (senhas informadas pelo Alan; nunca gravadas). Ainda sem leitor próprio:
   **Itaú PJ e Nubank PF** (nenhuma fatura deles na pasta do Drive). Os PDFs "Inter_Agosto_Contagem.pdf" e "1026 -INTER CONTAGEM.pdf"
   (INTER PJ) **não abriram com nenhuma das duas senhas** — provavelmente usam a senha do titular do cartão PJ.
   Arquivamento: `ITAÚ PJ/08.AGOSTO/FATURA INFINITE_Agosto.pdf` é na verdade a **Unicred Visa Infinite** (vence 19/08, débito em
   conta); `INTER PJ/08.AGOSTO/Fatura (20) 012165 - senha.pdf` é a fatura **Inter PF** (vence 28/08).
4. Ciclos pagos antes de 09/10/2026 não têm títulos no espelho (só o que estava aberto na primeira sincronização).
5. ~~Observação livre por item~~ — feita na Fase 2b (decisão "observar").
6. O leitor Sicredi junta à descrição o final do cartão quando ele aparece sob a anuidade ("Anuidade Diferenc 07/12 0000"); não atrapalha a classificação (encargo).
7. ~~Como o fechamento é lançado no Consistem?~~ **Respondido em 12/10/2026** (borderô + título provisório; regra 3). Registro original: No teste ao vivo (Sicredi PF 10/10/2026) o espelho não tinha mais os títulos por
   compra (Shock Metais 461723/3 etc., que a exportação de 10/10 no Drive ainda mostrava em aberto): havia só **um título no valor
   total da fatura** contra o Banco Sicredi (131026, venc. 13/10 — dia útil seguinte ao sábado 10/10). O mesmo para o Inter PJ
   ("FATURA CARTÃO INTER PJ CONTAGEM", R$ 15.706,44). Confirmar com o financeiro: os títulos por compra são baixados e
   substituídos pelo título da fatura no fechamento? Se sim, o cruzamento linha a linha precisa rodar **antes** dessa
   consolidação (ou ler também os títulos já baixados, que hoje só entram no espelho se estavam abertos em alguma sincronização).

## 11. Fases
0. Especificação (plano aprovado em 12/10/2026). 1. Cadastros, importação PDF/CSV, cruzamento e planilha (**feita**).
2. Ciclo mensal por cartão, fechamento (gestor) com foto e planilha, reabertura, paga automática, pendências, grade e histórico
   (**feita**). 2b. Decisões por item: classificar, justificar, casar à mão, compensar, observar (**feita**). 3. Leitores Inter/Itaú/Nubank/Unicred, aviso de fechamento do cartão
   (pendência "Importar fatura"), relatório de impressão, regra fornecedor → cartão compartilhada com o Neo Fiscal.

## 12. Fase 1 — o que foi feito (12/10/2026)
- Migration `0131_crt_base.sql`: módulo `financeiro.cartao`; `crt_cartoes` (8 cartões), `crt_estabelecimentos` (43 padrões),
  `crt_faturas` + `crt_fatura_linhas` (prova: imutáveis, sem delete, auditoria; ciclo único por fatura importada), view
  `crt_vw_faturas`, funções `crt_importar_fatura` (recusa soma ≠ total), `crt_cancelar_fatura`, `crt_salvar_cartao` (gestor),
  `crt_salvar_estabelecimento` (operador), `crt_normalizar`. Testes `tests/db/crt-base.test.ts` (7 casos).
- Dependência nova **`unpdf`** (pdf.js sem DOM) para extrair texto posicionado; `next.config.ts` com `serverActions.bodySizeLimit = 10mb`.
- Regras puras com testes: `texto.ts` (centavos, semelhança Ratcliff/Obershelp como o Python), `cartoes.ts` (porta do motor do
  Neo Fiscal), `leitores/` (sicredi, picpay, generico + CSV), `selecao-titulos.ts`, `conciliacao.ts` (porta de `conciliar.py`),
  `planilha.ts` (exceljs, 6 abas). **Calibração com as faturas reais do Drive** (`calibracao.test.ts`, roda com
  `NEO_AMOSTRAS_CARTAO=<pasta>`): Sicredi PF 10/2026, Sicredi PJ 08/2026 (Visa Empresas) e a Mastercard de 08/2026, PicPay 08/2026 —
  nos quatro a soma das linhas lidas **bateu com o total impresso** e o vencimento foi reconhecido. Inter e Itaú pulados (senha).
- Telas: Faturas, Importar fatura (pré-visualização + confirmação), Conciliação (abas e planilha), Cartões, Estabelecimentos.
- **Migration aplicada em produção em 12/10/2026** (`0131_crt_base`, registrada em `schema_migrations`; 8 cartões, 43 padrões).
- **Testado ao vivo (12/10/2026):** fatura Sicredi PF 10/10/2026 (PDF real) importada pela tela: 10 linhas de despesa + 1
  descartada (pagamento), soma = total informado = total impresso (R$ 78.528,72), vencimento impresso reconhecido; fatura
  gravada (id c8716e3b…) com o PDF anexado. Conciliação: o espelho tinha só o título único da fatura (ver ponto em aberto 7),
  reconhecido pelo aviso "Fatura lançada como título único"; 10 itens a lançar classificados (anuidade → encargo; Mundo Azul →
  Passagens pelo dicionário; Belenus e Ckt → não identificados com atalho "Cadastrar"; 4 parcelas > 1 → "parcela não desdobrada";
  crédito de anuidade → estorno). A fatura importada no teste é real (ciclo de outubro) e ficou gravada.
- Avisos no console do `next dev` (Base UI `nativeButton`, hidratação por extensão do Chrome) já existiam nas outras telas; não são deste módulo.
- **Leitores Inter e Unicred (12/10/2026):** `leitores/inter.ts` (data "09 de abr. 2026", "(Parcela 05 de 10)", "+ R$" = crédito,
  "PGTO PIX" descartado, total em "Fatura atual") e `leitores/unicred.ts` (letras espaçadas desfeitas por `desespacar`, "Parc.5/5",
  "TOTAL: R$", "VENCIMENTO: 19 AGO 2026"). Migration `0132_crt_leitores_inter_unicred.sql` (aplicada e registrada em produção):
  INTER PF/PJ → `inter`, UNICRED PF → `unicred`. Calibração: Inter 08/2026 (14 linhas, R$ 4.731,40) e Unicred 08/2026 (21 linhas,
  R$ 9.878,23) fecham com o total impresso. Testes sintéticos em `leitores/inter-unicred.test.ts`.
- Observação de arquivamento: na pasta `SICREDI PJ/08.AGOSTO` há duas faturas — `SICREDI.pdf` é o Visa Empresas (vence 23/08, o
  SICREDI PJ) e `sicredi_AGOSTO - PJ.pdf` é a Mastercard Black que vence dia 10 (ou seja, o SICREDI PF, guardado na pasta errada).
- **Títulos do borderô pela API (12/10/2026):** Edge Function `cap-sincronizar-consistem` ganhou a ação só de leitura
  `titulos_vencimento` (publicada em produção; `deno check` ok); `dados.ts` usa a API e cai para o espelho se falhar; o título
  provisório é reconhecido e o arredondamento é justificado no quadro. **Testado ao vivo** com a Sicredi PF 10/10/2026: 7 títulos do
  cartão lidos do borderô e conciliados (5 exatos, 2 por arredondamento), provisório 131026 reconhecido, 3 itens a lançar (anuidade,
  crédito da anuidade, Ckt Assessoria não identificado), **diferença não justificada R$ 0,00**. Mesmo resultado da skill no Drive,
  que também apontou a Ckt Assessoria.

## 13. Fase 2 — o que foi feito (12/10/2026)
Pedido do Alan: "todo mês vai ter esse fechamento… não está falando que mês está fechado". Decisões: 4 situações com paga
automática; fechar só gestor com zero a lançar e diferença zero; pendências Importar, Conciliar e Fechar.
- Migration `0134_crt_ciclos.sql` (aplicada e registrada em produção; a primeira tentativa foi recusada e desfeita inteira porque
  o gatilho de imutabilidade da fatura barrava o vínculo `ciclo_id` — corrigido e coberto por teste de backfill):
  calendário em SQL, `crt_ciclos`, `crt_fechamentos`, `crt_faturas.ciclo_id`, funções das regras 13–19, gatilho de paga,
  backfill (a fatura Sicredi PF 10/2026 virou o mês em conciliação) e os dois agendamentos (conferidos em `cron.job`).
- Código: `lib/modulos/financeiro/cartao/ciclos.ts` (+ testes); `dados.ts` (ciclos, fechamentos, apuração); `acoes.ts`
  (`fecharCiclo` recalcula e anexa a planilha, `reabrirCiclo`, importação com `ciclo`); páginas `meses/`, `ciclo/[id]/`,
  `historico/`, `faturas/` (a lista que era a raiz); a raiz redireciona para Meses; painel da conciliação extraído para
  `[id]/painel.tsx` e usado pela fatura e pelo mês.
- Testes: `tests/db/crt-ciclos.test.ts` (9 casos: calendário, competência, geração idempotente, importar/cancelar, apuração e
  pendências, fechar/reabrir/versões, paga pelo gatilho, backfill). Suíte do módulo: 85+ testes; typecheck e lint limpos.
- **Testado ao vivo (12/10/2026):** grade com 10/2026 — Inter PJ, Itaú PJ, Sicredi PJ e Unicred PF aguardando fatura (já
  fecharam), Sicredi PF em conciliação; Inter PF, Nubank PF e PicPay PF ainda sem mês (fecham depois de hoje). Pendências criadas
  na Fila do dia. Mês Sicredi PF: 3 a lançar, resíduo R$ 0,00, provisório 33392 (título 131026) gravado, "Fechar o mês"
  desabilitado com o motivo. Fechar/reabrir/paga não foram executados no mês real (há itens a lançar); estão cobertos pelos testes.

## 14. Fase 2b — o que foi feito (12/10/2026)
- Migration `0135_crt_decisoes.sql` (aplicada e registrada em produção): `crt_decisoes` (imutável, sem delete, auditoria), view
  `crt_vw_decisoes`, `crt_registrar_decisao` (valida tipo, linhas da fatura, soma zero na compensação, motivo, exclusividade,
  mês aberto) e `crt_desfazer_decisao`. Testes `tests/db/crt-decisoes.test.ts` (5 casos).
- Motor (`conciliacao.ts`): decisões aplicadas antes e depois do cruzamento; `pendentes`, `ajusteManualCentavos`,
  `decisoesSemEfeito`; casamento "Manual"; compensação à mão; títulos de outro cartão como candidatos ao casamento.
  Testes no `conciliacao.test.ts` (cenário da Sicredi PF: anuidade + crédito, cartão trocado, título pelo total).
- Telas: botão **Decidir** em cada linha de "A lançar" e de "Divergências" (diálogo com as opções do item, soma das linhas e dos
  títulos e a diferença), selo da decisão na linha, aba **Decisões** com Desfazer, avisos de decisão sem efeito; fechamento e
  pendências usam os pendentes. Planilha com a coluna Decisão e a aba Decisões.
- **Testado ao vivo (12/10/2026)** na Sicredi PF 10/2026: compensar anuidade + crédito da anuidade levou "A lançar" de 3 para 1
  pendente, Compensados 1, diferença não justificada R$ 0,00; desfeito em seguida pela aba Decisões (registro fica como
  "desfeita", com motivo). A decisão real sobre esse par ficou para o financeiro.

## 15. Fase 3 — andamento (12/10/2026)
- **Relatório de impressão: feito.** Página `app/(impressao)/imprimir/cartao/ciclo/[id]/page.tsx` (reusa o botão de impressão do
  Contas a pagar), botão "Imprimir / salvar PDF" na página do mês. Conferido com a Sicredi PF 10/2026.
- **Aviso de fechamento do cartão:** já entregue na Fase 2 (pendência "Importar fatura").
- **Leitores Itaú PJ e Nubank PF:** aguardando uma fatura de cada na pasta do Drive (o PDF da pasta ITAÚ PJ é da Unicred).
- **Regra fornecedor → cartão do Neo Fiscal: feita no Neo Admin** (decisão do Alan: função pública de leitura no Neo Fiscal).
  Migration `0136_crt_regras_fornecedor.sql` (aplicada e registrada em produção; job `crt-sincronizar-regras-diario` ativo),
  Edge Function `crt-sincronizar-regras` (publicada; lógica pura em `_shared/regras-cartao.ts`), segredos `NEO_FISCAL_SEGREDO`
  e `NEO_FISCAL_REGRAS_URL` (gravados; o valor do segredo fica em `C:\Users\alant\.neo-admin\neo-fiscal-integracao.env`, fora
  do Git), `regraVigente` em `cartoes.ts`, seleção com `opcoes.regras`, seção de regras na aba Cartões, marca "pela regra".
  A Edge Function do contas a pagar passou a devolver `data_emissao` em `titulos_vencimento` (republicada).
  Testes: `regras.test.ts` (vigência, seleção, causa, validação e plano do espelho) e `tests/db/crt-regras.test.ts`.
  **Lado do Neo Fiscal:** função `cartao-regras` (só leitura) commitada no repositório `alantorres-bot/neo-fiscal-navigator`
  (commit "Cartão: função cartao-regras (só leitura) para o Neo Admin"); falta enviar ao GitHub, pedir ao Lovable para
  publicar a função e gravar o segredo `NEO_ADMIN_SEGREDO` no Lovable Cloud. Até lá, "Atualizar do Neo Fiscal" responde erro
  e a conciliação segue sem a regra (como antes).
- Observação: a pasta local `C:\dev\neo-fiscal-navigator` é um worktree cujo repositório principal foi movido para
  `C:\dev\_arquivo` (git não funciona nela) e difere do GitHub em arquivos de NFS-e; o trabalho foi feito num clone do GitHub.

## 16. Encargos lançados no Consistem — o que foi feito (13/10/2026)
- Pedido do Alan: "Quando vêm encargos na fatura, nós temos que lançar manualmente. Seria possível fazer esse lançamento através
  de API apenas com comando?" Decisões: um título com a soma; botão com conferência; gestor e operador; códigos dos lançamentos
  manuais; emissão no fechamento; documento DDMM do fechamento.
- Descoberta (só leitura): o Swagger do Financeiro tem `PUT /lancamentoContasPagar` (`GerarLancamentoContaPagar`, corpo
  `novoLancamentoContaPagar`; obrigatórios `codDocumento`, `codFornecedor`, `dadosContabilidade.contaContabilDebito`, `dataEmissao`,
  `dataEntrada`, `valorDocumento`). A ação `exemplos_encargos` de `cap-sincronizar-consistem` lê os encargos de cartão já lançados
  à mão (136 no último ano) com o detalhe completo; daí saíram os códigos da regra 32.
- Migration `0137_crt_lancamento_encargos.sql` (aplicada e registrada em produção): `crt_cartoes.lancamento_encargos`,
  chave `financeiro.cartao.lancar_encargos_no_erp` (false), `crt_lancamentos_erp`, funções de reservar, iniciar, concluir e resolver.
- Edge Function `crt-lancar-encargos` (publicada; só usuário operador ou acima; envia uma vez); cliente puro
  `_shared/consistem-inclusao.ts`; regra pura `lib/modulos/financeiro/cartao/lancamento-encargos.ts`.
- Telas: quadro "Encargos do mês" (fatura e mês em conciliação) e códigos na edição do cartão.
- Testes: `lancamento-encargos.test.ts`, `lib/integracoes/consistem/consistem-inclusao.test.ts`, `tests/db/crt-lancamento-encargos.test.ts`.
- Testado ao vivo (servidor local, 12/10/2026): edição do cartão com os códigos; quadro com o título da anuidade da Sicredi PF
  (forçado localmente, porque estava justificada) e a recusa do banco com a chave desligada. **Ainda não houve envio real.**
- **Falta:** confirmar se o token da API (CSMEN050) tem permissão de inclusão; ligar a chave e fazer o primeiro lançamento real
  acompanhado pelo Alan, conferindo no Consistem se o título ficou igual a um lançamento manual.

## 17. Compras sem título lançadas no Consistem — o que foi feito (13/10/2026)
- Pedido do Alan: lançar pelo painel toda linha sem título, com o sistema sugerindo de que se trata pelos estabelecimentos
  recorrentes (Nuviagens, Petrobras, posto, pousada, restaurante, passagens), o operador escolhe o fornecedor, confere e lança.
- Descoberta (só leitura): ação `exemplos_compras_cartao` de `cap-sincronizar-consistem`: 1.203 compras de cartão lançadas à mão
  no último ano (173 fornecedores), com detalhe de 2 por fornecedor. Padrão recente das despesas sem nota fiscal: histórico 2,
  categoria 17, portador 91 (77 nos títulos do Inter PJ), contábil crédito 2004; débito e fluxo variam com o tipo de despesa.
  Proposta aprovada pelo Alan ("pode carregar todas") e carregada pela migration `0139_crt_codigos_sugeridos.sql` (aplicada e
  registrada): padrões dos 8 cartões (portador 91, Inter PJ 77) e fluxo/débito de 27 estabelecimentos (passagens, Uber, Petrobras,
  softwares, Mercado Livre, alimentação, locação). Fornecedor fica vazio (cada estabelecimento terá o seu no Consistem).
  "Combustível no Inter PJ" (29/11, 3238) não entrou: o dicionário é por estabelecimento, não por cartão.
- Migration `0138_crt_lancamento_compras.sql` (aplicada e registrada em produção): chave única `financeiro.cartao.lancar_no_erp`,
  `crt_cartoes.lancamento_compras`, `crt_estabelecimentos.lancamento_erp`, colunas de lote e parcela em `crt_lancamentos_erp`,
  funções de reservar compra, reenviar, interromper lote e as de envio com nomes genéricos.
- Edge Function `crt-lancar-no-consistem` (publicada; substitui `crt-lancar-encargos`, que segue publicada mas sem uso e sem as
  funções do banco que usava). Regra pura `lib/modulos/financeiro/cartao/lancamento-compras.ts`.
- Telas: botão Lançar na aba A lançar, diálogo com fornecedor e códigos, lista "Compras lançadas no Consistem", campos de padrões
  de compra no cartão e de sugestão no estabelecimento.
- Testes: `lancamento-compras.test.ts` e `tests/db/crt-lancamento-compras.test.ts` (e os dos encargos ajustados à chave nova).
- Testado ao vivo (servidor local): diálogo numa linha real (forçada localmente), busca de fornecedor, prévia do título com
  documento, vencimento e complemento, legendas de origem. **Ainda não houve envio real.**

## 18. Fornecedor "Outros" e marketplace — o que foi feito (13/10/2026)
- Pedido do Alan: cadastrar fornecedor pela API (documentação Cadastros Gerais v1.0 / fornecedor), tipo 3 "Outros", sem CNPJ,
  endereço igual para todos; marcas uma a uma (ligar ou cadastrar); genéricos pela compra; Mercado Livre casa pelo valor da
  nota (marketplace).
- Descoberta (só leitura): ação `exemplos_fornecedores` de `cap-sincronizar-consistem` — 1.338 fornecedores ativos, 28 "Outros";
  19 deles com Rua Canadá, 277 (endereço aprovado); categoria e grupo variam (17/22 aprovado como sugestão).
- Migrations `0140_crt_fornecedores.sql` (configuração, `marketplace`, `crt_fornecedores_cadastrados`, reservar/iniciar/
  concluir/resolver, `crt_ligar_fornecedor`) e `0141_crt_fornecedor_por_compra.sql` (genéricos) — aplicadas e registradas.
- Edge Function `crt-cadastrar-fornecedor` (publicada); `_shared/consistem-inclusao.ts` generalizado (`incluir`,
  `incluirFornecedor`).
- Telas: coluna Fornecedor na aba Estabelecimentos (ligado, marketplace, fornecedor por compra ou Ligar ou cadastrar), caixas
  marketplace e genérico no formulário, "Cadastrar fornecedor" no diálogo de lançar, aviso de marketplace na aba A lançar.
- Testes: `tests/db/crt-fornecedores.test.ts`, `consistem-inclusao.test.ts`.
- Testado ao vivo (local): coluna Fornecedor, "Ligar" do GOOGLE (1370, 889, 928), marketplace e genéricos. **Nenhum fornecedor foi
  ligado nem cadastrado** (chave desligada; decisão do Alan).
- **Pendente (13/10/2026):** a API recusa o tipo 3 mesmo com o próximo código certo e o registro no formato da tela
  ("cpfCnpj: 0001375. CNPJ/CPF inválido!"). A tela do Consistem usa o campo "Registro Fornecedor", que o corpo `FornecedorPut`
  não documenta. Chamado à Consistem com o exemplo exato. Até a resposta: cadastrar "Outros" pela tela do Consistem e usar
  **Ligar** no painel. A chave `financeiro.cartao.lancar_no_erp` fica ligada (decisão do Alan).
