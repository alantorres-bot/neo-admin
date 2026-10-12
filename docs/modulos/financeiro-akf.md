# Módulo: Financeiro / AKF

Status: em construção (Fase 1 entregue em 06/10/2026; Fase 2 — solicitar antecipação — entregue em 12/10/2026)

## 1. Objetivo
Gerir os títulos da Neo Formas que estão com a AKF Securitizadora (cessão/antecipação de recebíveis): saber o que está na AKF, o que ainda pode ser antecipado, solicitar antecipações, conferir borderôs, controlar o passivo "por fora", prorrogar e cobrar. Traz para o Neo Admin o que o **Gestor AKF** (`C:\Users\alant\gestor-akf`, Streamlit) faz hoje, com persistência, histórico e integração com Recebíveis. O Gestor AKF não tem cobrar, prorrogar nem solicitar antecipação como telas: essas funções são especificadas junto, nas fases 2 e 5.

## 2. Como é feito hoje
- Carteira do Consistem (portador **998** = título na AKF; 91 e 237 = com a Neo) lida pela API no Gestor AKF, sem gravar nada.
- A AKF opera dois borderôs paralelos para os mesmos títulos: **"por dentro"** (conexão PRODUCAO, nº 8xxx, deságio oficial) e **"por fora"** (PRODUCAO02, nº 7xxx, deságio maior). A diferença é um custo extra, controlado numa planilha Excel.
- Seleção de títulos, e-mail de instrução, leitura de borderôs (PDF por OCR), conciliação, passivo e custo efetivo: telas do Gestor AKF, sem persistência.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Carteira na AKF e disponíveis para antecipar (Fase 1) | Leitura automática (OCR) dos PDFs dos borderôs (Fase 6, se pedida) |
| Solicitar antecipação: seleção, e-mail em rascunho (Fase 2, entregue; seção 13) | Envio automático de e-mail à AKF (só rascunho no Gmail) |
| Borderôs com conferência, conciliação, custo efetivo (Fase 3) | Limites de crédito e concentração (o Gestor AKF os removeu por serem voláteis) |
| Passivo "por fora" (Fase 4) | Enquadramento fiscal/jurídico do "por fora" |
| Prorrogação e cobrança de título cedido (Fase 5) | Taxa de prorrogação inventada: o encargo é informado pela AKF |

## 4. Entradas
- Títulos de `rec_vw_titulos` (sincronizados do Consistem por Recebíveis; `cod_portador`, `cedido`).
- Parâmetros em `configuracoes` (`financeiro.akf.*`).
- Fases seguintes: borderôs (PDF anexado + totais e títulos digitados), planilha de passivo (Excel), encargo de prorrogação informado pela AKF.

## 5. Regras de negócio
1. **Na AKF** = `cedido` ou portador 998. Disponível para antecipar = a vencer, fora da AKF, não contestado, em estágio importado/aguardando boleto/boleto enviado/confirmado (`_shared/akf.ts`, regras do Gestor AKF).
2. **Portador manda no `cedido`** (migration 0112, gatilho em `rec_titulos`): entrou no 998 = cedido; saiu do 998 = deixa de ser cedido e volta à régua de Recebíveis. Marcar à mão (`akf_marcar_cedido`) vale enquanto o portador não mudar. Cedido já tira o título da régua de cobrança, da confirmação e do botão "Cobrar" de Recebíveis.
3. Clientes "sem boleto de factoring" (MIP/MB/Janeiro/Raja, Caparaó/House Garden, QRTZ 39, ROCCA/JBL/Leandro/J.Miró, BF Ótica — lista em `financeiro.akf.clientes_sem_boleto`; casa por **palavra inteira** do nome sem acento, desde 12/10/2026: "MB" não marca "AMBIENTAL"): operados com 01 dia após o vencimento, sem emitir boleto (selo na lista de disponíveis; OBS automática no e-mail de solicitação; na tela de solicitação dá para ligar/desligar por título, ex.: Canopus caso a caso).
4. Fórmulas do Gestor AKF a portar nas fases seguintes (arquivo de origem entre parênteses): líquido = total − deságio; desembolso = líquido − recompras + créditos − débitos − abatimento, tolerância R$ 0,05 (`calculos.py`); recompra = título + correção + multa 2% do título + despesas; taxa efetiva = `deságio/(face−deságio)` composta a 30 dias; deságio estimado = valor × taxa a.m. × dias/30, com taxa de referência 2,18% a.m. (`selecao.py`); passivo = gerado − pago + estornado, estorno quando a observação contém "devolu/estorno" (`passivo.py`).
5. Nada é enviado: e-mails à AKF terminam em "Atenciosamente,", sem assinatura, e saem como rascunho no Gmail.

## 6. Saídas e automações
Fase 1: nenhuma automação nova (o gatilho do portador atua na sincronização existente). Fases seguintes: rascunho de e-mail à AKF, pendências na Fila do dia, interações no histórico do título.

## 7. Telas
- **`/financeiro/akf` (Fase 1):** seletor de unidade (Matriz/Filial Contagem), três cartões (Na AKF, Vencidos na AKF, Disponíveis para antecipar) e três visões com busca e paginação. Operador marca títulos como "na AKF" (na visão Disponíveis) ou os retira (nas visões da AKF), com observação opcional. O documento abre a ficha do título em Recebíveis.

## 8. Dados (prefixo `akf_`)
- Fase 1: `akf_marcar_cedido()` (função, `security invoker`, tudo ou nada, até 100 títulos, interação `akf_cessao`/`akf_retirada` no histórico) e o gatilho `trg_rec_titulos_cedido_portador`. A coluna `rec_titulos.cedido` já existia. Na migration, os 50 títulos abertos que já estavam no portador 998 (R$ 2,48 mi) foram marcados como cedidos.
- Fases 2–5: `akf_operacoes`, `akf_operacao_titulos`, `akf_borderos`, `akf_bordero_titulos`, `akf_passivo_lancamentos`, `akf_prorrogacoes`, `akf_instrucoes` (RLS por `financeiro`, auditoria, sem exclusão de registros de prova).

## 9. Permissões
Área `financeiro`: consulta vê; operador marca/retira e (nas fases seguintes) solicita, registra borderô e prorrogação; gestor aprova. Anexos (PDF dos borderôs) em `financeiro.akf/...` no bucket privado.

## 10. Pontos em aberto
- Regra de cálculo da prorrogação (hoje: valor informado pela AKF) e se a prorrogação altera o vencimento no Consistem (lançamento manual).
- Confirmar com o Financeiro a taxa de referência (2,18% a.m.) e a lista de clientes sem boleto.
- Contatos da AKF: resolvido na Fase 2 — contraparte "AKF Securitizadora" com os contatos (finalidade "akf") criada pela migration 0130; editáveis em Configurações > Contrapartes. Cópia interna em `financeiro.akf.copia`.
- O cliente OAuth do Gmail do Neo Admin está no projeto Google Cloud do Gestor AKF: manter esse projeto.
- A visão "ocultar vencidos há mais de 90 dias" de Recebíveis ainda não existe aqui.

## 11. Antecipação parcial (desdobramento no Neo Admin) — entregue em 06/10/2026

Alguns títulos são antecipados só em parte na AKF e **o Consistem não aceita desdobrar o título em Contas a Receber**. O desdobramento fica só aqui, **por cima** do título: `rec_titulos` continua igual ao Consistem (a sincronização reescreve valor e vencimento dele) e cada antecipação parcial é um lançamento em `akf_desdobramentos`.

- **Regras (decisões do usuário):** a parte na AKF tem **valor e vencimento próprios** (o do borderô); um título pode ter **várias antecipações parciais**; o que resta com a Neo é **título − soma das partes ativas** e continua em "Disponíveis para antecipar", com o valor restante e o vencimento original do título; a régua de cobrança e a confirmação de Recebíveis usam **só o valor restante** (a parte na AKF não é cobrada pela Neo).
- **Banco (migration 0113):** `akf_desdobramentos` (valor, vencimento da parte, data da operação, observação, status ativo/encerrado, quem e quando criou e encerrou, motivo; RLS de Financeiro; auditoria; **sem exclusão**), a view `akf_vw_valor_restante` (por título com parte ativa: valor na AKF e restante), `akf_desdobrar_titulo()` e `akf_encerrar_desdobramento()` (transação, RLS de quem chama, interação `akf_desdobramento`/`akf_desdobramento_encerrado` no histórico do título). Valida: valor > 0 e com até 2 casas, o valor antecipado (somado às partes) **menor que o título** (para antecipar o título inteiro, "Marcar como na AKF"), vencimento não anterior à emissão e no máximo 3 anos à frente, data da operação não futura, título aberto e ainda não cedido por inteiro.
- **Consistência:** título pago/cancelado/renegociado em Recebíveis **encerra as partes sozinho**; título que passa por inteiro para a AKF (portador 998 ou marcação manual) deixa de contar as partes, e `akf_marcar_cedido` recusa marcar o título inteiro enquanto houver parte ativa (é preciso encerrar as partes antes).
- **Telas:** em `/financeiro/akf`, na visão "Disponíveis para antecipar", o botão **Antecipar parte** abre o valor, o vencimento da parte e a observação; a seção **Antecipações parciais na AKF** lista as partes (valor, vencimento, operação, o que resta com a Neo) com **Encerrar parte** (motivo obrigatório). Os cartões somam a parte em "Na AKF" (e em "Vencidos" quando o vencimento da parte passou) e tiram a parte de "Disponíveis". Em Recebíveis, a Carteira mostra "R$ X na AKF · resta R$ Y" sob o valor, e a ficha do título mostra o selo "Parcial na AKF". A cobrança e a confirmação (telas e Edge Function `rec-sincronizar-consistem`) usam o valor restante.
- **Testado:** 12 testes de banco (antecipação, várias partes, validações, permissões, encerramento, ausência de exclusão, encerramento automático, título inteiro na AKF, view) e, ao vivo com o título de teste `TESTE-NOVO-1` (R$ 30.000): parte de R$ 12.000 com vencimento 30/10 → "Na AKF" +12.000, "Disponíveis" −12.000 e R$ 18.000 restantes; a sincronização rodou sem erro; parte encerrada ao final.
- **Fica para a Fase 2 (solicitar antecipação):** a seleção de títulos deve usar o valor restante dos títulos parciais; o borderô (Fase 3) pode registrar as partes ao conciliar.

### 11.1 Localizar qualquer título para antecipar (06/10/2026)
A visão "Disponíveis para antecipar" só traz título **a vencer**; os títulos antigos e vencidos não aparecem ali. Por isso `/financeiro/akf` tem, logo abaixo dos cartões, o campo **Antecipar um título (parcial ou inteiro)**: busca por documento, código ou nome do cliente em **todos os títulos em aberto** (inclusive vencidos e antigos; respeita a unidade escolhida; até 30 resultados, os de vencimento mais recente primeiro). Em cada resultado há **Antecipar parte** (valor, vencimento da parte, observação) e a caixa para **Marcar como na AKF** (título inteiro); o que já está inteiro na AKF aparece só como "Na AKF", sem ações. Num título vencido, o vencimento da parte pode ser passado (não anterior à emissão); o restante com a Neo segue vencido na carteira de Recebíveis (só título a vencer é "disponível para antecipar").

### 11.2 A parte antecipada é uma linha como outro título qualquer (06/10/2026)
Nas visões **Na AKF** e **Vencidos na AKF**, cada parte antecipada aparece como uma **linha própria** (documento do título com o selo "Parcial", valor e vencimento **da parte**, atraso pelo vencimento da parte, "resta R$ X com a Neo"), misturada aos títulos inteiros e ordenada por vencimento. Conta como título normal nos cartões, nas quantidades das abas e do seletor de unidade, no rodapé ("N títulos") e na paginação (a lista junta títulos inteiros e partes e pagina na tela). Em "Vencidos na AKF" entram as partes cujo vencimento já passou. Cada linha de parte tem **Encerrar parte** (motivo obrigatório); a busca da tela também acha as partes pelo documento ou pelo cliente. A seção separada "Antecipações parciais" ficou só na visão "Disponíveis", onde as partes não são linhas. Recebíveis continua com o título inteiro do Consistem e a nota "X na AKF · resta Y" (decisão do usuário).

### 11.3 Quadro "A vencer na AKF" (06/10/2026)
A tela AKF ganhou o quarto cartão **A vencer na AKF** (títulos inteiros e partes antecipadas ainda não vencidos), com quantidade e a porcentagem do que está na AKF. Ordem dos cartões: Na AKF · A vencer na AKF · Vencidos na AKF · Disponíveis para antecipar. "A vencer" + "Vencidos" = "Na AKF".

## 12. Conferência com a planilha da AKF (08/10/2026)

Tela `Financeiro > AKF > Conferir com a planilha da AKF` (`/financeiro/akf/conferencia`, operador do Financeiro ou acima). A planilha de recebíveis da AKF (`RECEBIVEIS - AKF.xlsx`) é a verdade sobre o que está descontado; a tela a cruza com a carteira em aberto do app e mostra:

- **Resumo:** total e quantidade da planilha x "Na AKF" do app (títulos inteiros cedidos/998 mais as partes antecipadas ativas) e a diferença, explicada por categoria.
- **Falta marcar como cedido:** título inteiro na planilha que o app não mostra como antecipado. Botão em lote (`akf_marcar_cedido`); se o título tem parte ativa, ela é encerrada antes.
- **Antecipação parcial:** a AKF tem só parte do título. Mostra o que a planilha tem e o que o app tem; "Aplicar este ajuste" encerra as partes divergentes e lança as da planilha (`akf_encerrar_desdobramento` e `akf_desdobrar_titulo`, valor e vencimento da planilha, data da operação editável com padrão hoje). Se o título está cedido por inteiro no app, retira o cedido antes.
- **No app como AKF, mas fora da planilha:** revisão; "Retirar da AKF" e "Encerrar parte" são opcionais. O portador 998 continua no Consistem.
- **A confirmar** (nunca aplicado sozinho) e **Na planilha, sem título no app** (informação). Linhas "Liquidado Parcial" e "Baixado da Cobrança" contam como na AKF e aparecem com selo.

**Como casa:** o "Número" da planilha não é o `documento` do app (`1266/5` = `1001266E`; `002323` = `4002323U`; `226/2026/2` = `Z00027B`; `7897/2026/03` = parcela C de `Z00026C`). O casamento usa **cliente (nome aproximado, tolera erro de digitação e nome cortado) + valor + vencimento**, com a NF e a letra da parcela só como desempate. Título inteiro: mesmo valor; a diferença de vencimento (a AKF corrige a data) só pesa quando o título está fora da AKF (acima de 5 dias vira "a confirmar"). Parcial: valor da planilha menor que o do título; várias linhas podem ser o mesmo título.

**Código:** `lib/modulos/financeiro/akf/conciliacao.ts` (regras puras: `lerPlanilhaAkf`, `cruzarComCarteira`, `explicarDiferenca`; testes em `conciliacao.test.ts` com os casos reais), `app/(plataforma)/financeiro/akf/conferencia/` (`acoes.ts` lê o arquivo e a carteira, só lê; `componentes.tsx` aplica cada correção com confirmação em dois cliques, reutilizando `marcarNaAkf`, `desdobrarTitulo` e `encerrarParte` de `akf/acoes.ts`). Sem migration e sem Edge Function.

**Resultado com a planilha de 08/10/2026:** 62 títulos, R$ 4.238.477,39; o app tinha 57 títulos inteiros + 1 parte = R$ 3.276.064,02 (diferença R$ 962.413,37 = 2 títulos J Sete a marcar R$ 134.000 + parciais TC `1001349U` R$ 400.000 e Amorim `Z00026C`/`Z00026D` R$ 450.000 + 1 linha sem título R$ 287,57 − 2 títulos só no app R$ 21.874,20). O portador da AKF é **998** (não 908).

## 13. Solicitar antecipação (Fase 2) — entregue em 12/10/2026

Substitui o e-mail montado à mão (print do Consistem) por um registro no Neo Admin e um rascunho no Gmail. Fluxo: **Financeiro > AKF > Solicitar antecipação** → marcar títulos → **Montar solicitação** (rascunho) → página da solicitação → **Criar rascunho no Gmail** (status *solicitada*) → a pessoa confere, anexa as NFs se quiser e envia pelo Gmail.

- **Telas:** `/financeiro/akf/solicitar` (operador): os títulos "Disponíveis para antecipar" (mesma regra da tela AKF; por unidade), com caixa de marcação, **Valor a solicitar** (vazio = o que resta com a Neo; menor = antecipação parcial; acima do restante recusa), caixa **Sem boleto** (pré-marcada pelo cadastro, alterável por título) e **Observação** por título; filtro por cliente/documento; barra fixa com a soma e o botão Montar solicitação (diálogo: data, que vai no assunto, e observação geral, que vira a última OBS). Títulos já em solicitação aberta aparecem apagados com "na solicitação nº N". `/financeiro/akf/solicitacoes/[id]`: cartões (total, parciais, sem boleto), títulos copiados, **prévia do e-mail** (Para, Cc, assunto, corpo), botões **Criar rascunho no Gmail** e **Cancelar solicitação** (motivo obrigatório). `/financeiro/akf/solicitacoes`: histórico por situação. A tela AKF ganhou os atalhos "Solicitar antecipação" e "Solicitações" e, em Disponíveis, a nota "na solicitação nº N".
- **E-mail** (regras puras em `lib/modulos/financeiro/akf/solicitacao.ts`, testadas): assunto `ANTECIPAÇÕES - dd/mm/aaaa` (lote) ou `Antecipação NF 1335/2 - EFATA` (título único); corpo `André/Kayza, / Bom dia!|Boa tarde!|Boa noite! (hora de Cuiabá) / Favor operar os títulos abaixo: / NF 1335/2 | EFATA CONSTRUTORA LTDA | Venc. 20/10/2026 | R$ 120.000,00 / … / Total: R$ X (N títulos) / OBS 01 - NF 2318 - Operar com 01 dia após o vencimento e não emitir boleto. / OBS 02 - NF 1360 - Operar R$ 200.000,00 (parcial; valor do título R$ 350.000,00). / OBS 03 - NF 1360 - <observação do título>. / OBS - <observação geral>` (uma OBS só sai sem número) e termina em `Atenciosamente,` sem assinatura (regra global 3). O tratamento vem dos primeiros nomes dos destinatários. Para = contatos da contraparte `financeiro.akf.contraparte_id` com finalidade "akf" e e-mail; Cc = `financeiro.akf.copia`. O texto gravado em `akf_operacoes.assunto/corpo` é o que foi para o rascunho.
- **Rascunho no Gmail:** Edge Function `akf-rascunho-gmail` (mesmos segredos de `rec-rascunho-gmail`; o rascunho aparece na caixa autorizada, `GMAIL_REMETENTE`), chamada pela ação `criarRascunhoSolicitacao` depois de gravar a mensagem (`mensagens`, módulo `financeiro.akf`, com a coluna nova `cc`). `_shared/gmail.ts` passou a aceitar vários destinatários e Cc. Se o Gmail falhar, a mensagem é descartada e a solicitação continua em montagem. Nada é enviado pelo Neo Admin.
- **Banco (migration 0130):** `akf_operacoes` (nº sequencial, data, status rascunho → solicitada | cancelada, observação, assunto/corpo gravados, mensagem, quem/quando; sem exclusão; cabeçalho só muda pelas funções) e `akf_operacao_titulos` (cópia do título: documento, cliente, vencimento, valor do título, valor restante, valor solicitado, parcial, sem boleto, observação, ordem; imutável). Funções `akf_criar_solicitacao(itens jsonb, observação, data)` (operador; até 100 títulos; valida disponível para antecipar, valor ≤ restante com 2 casas, título não repetido em solicitação aberta; tudo ou nada; interação `akf_solicitacao` por título), `akf_marcar_solicitada` (service role, pela Edge Function; interação `akf_solicitacao_rascunho`) e `akf_cancelar_solicitacao` (motivo ≥ 5 caracteres; descarta a mensagem; interação `akf_solicitacao_cancelada`). Views `akf_vw_operacoes` e `akf_vw_titulos_solicitados`. A solicitação **não** marca o título como cedido: isso continua vindo do portador 998 na sincronização, da marcação manual ou da conferência com a planilha (Fase 3 ligará o borderô à solicitação).
- **Parâmetros atualizados pela migration:** lista de clientes sem boleto (seção 5, regra 3), `financeiro.akf.observacao_sem_boleto` = "Operar com 01 dia após o vencimento e não emitir boleto.", `financeiro.akf.copia` (rodrigofelicio@ e financeiro@neoformas.com.br), `financeiro.akf.contraparte_id` (AKF Securitizadora, contatos André Kamil e Kayza).
- **Testado:** 12 testes de banco (`tests/db/akf-solicitacao.test.ts`: parâmetros, criação, parcial, validações, tudo ou nada, repetição, permissões, marcar solicitada, cancelar, imutabilidade, visibilidade), 11 de regras do e-mail (`solicitacao.test.ts`), Gmail com vários destinatários/Cc e o match por palavra inteira (`akf.test.ts`). Falta o teste ao vivo com o Gmail depois de publicar a migration e a função (seção abaixo).
- **Publicar:** `npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f supabase/migrations/0130_akf_solicitacao.sql`, registrar em `supabase_migrations.schema_migrations` (`docs/PUBLICACAO.md`, seção 2) e `npx supabase functions deploy akf-rascunho-gmail`.
