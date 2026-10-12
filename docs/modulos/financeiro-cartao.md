# Módulo: Financeiro / Cartão de crédito

Status: em construção — especificação aprovada em 12/10/2026 (plano); **Fases 1 e 2 entregues em 12/10/2026** (cadastros, importação da fatura em PDF, cruzamento com o espelho do Contas a Pagar, planilha).

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
| Cadastro dos cartões (fechamento, vencimento, tipo de título, leitor de PDF); dicionário estabelecimento → categoria → conta de fluxo; importar a fatura (PDF com ou sem senha, ou CSV) com conferência de integridade; cruzar com os títulos do espelho `cap_lancamentos`; abas A lançar / Divergências / Conciliados / Compensados / Quadro / Linhas / Outros títulos de cartão; planilha XLSX; cancelar fatura (com motivo) | Lançar, alterar ou baixar no Consistem (o Neo Admin só lê o ERP); gravar decisões humanas (reclassificar, casar à mão, "lançado no Consistem") e fechar a conciliação — **Fase 2**; pendências na Fila do dia — Fase 2; leitores Inter, Itaú, Nubank, Unicred — quando houver amostra/senha; PDF digitalizado como imagem (sem texto) |

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
19. A apuração (itens a lançar, diferença, resíduo, provisório) é gravada a cada vez que alguém abre o mês em conciliação.

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
| **Meses** (`/financeiro/cartao/meses`, entrada do módulo) | Grade cartão × mês (6 meses, navegação para trás) com a situação de cada mês, o total, itens a lançar ou data de pagamento; contadores por situação |
| **Mês do cartão** (`/ciclo/[id]`) | Cabeçalho (fechamento, vencimento, situação), linha do tempo (fechou · importada · fechada · paga), Importar fatura (aguardando), conciliação ao vivo (em conciliação) ou resultado congelado (fechada/paga), Fechar o mês (gestor; desabilitado com o motivo), Reabrir (gestor), planilha do fechamento, histórico de fechamentos |
| **Histórico do cartão** (`/historico?cartao=`) | Todos os meses de um cartão: situação, total, a lançar, quem fechou e quando, data de pagamento (link também na aba Cartões) |
| **Faturas** (`/financeiro/cartao/faturas`) | Faturas importadas por empresa/cartão/vencimento (total, linhas, status, quem importou, link para o mês) + "Importar fatura avulsa" |
| **Importar fatura** (`/nova`) | Empresa, cartão, vencimento efetivo, total da fatura, arquivo (PDF/CSV), senha do PDF (opcional) → **pré-visualização** das linhas lidas (data, descrição, parcela, valor, descartadas), soma × total, vencimento e total impressos pelo emissor, avisos do leitor. "Confirmar importação" só com a soma batendo |
| **Conciliação** (`/[id]`) | Cartões: total da fatura, títulos, diferença apurada, **diferença não justificada** (vermelho se ≠ 0), conciliados com cartão divergente; abas A lançar · Divergências · Conciliados · Compensados · Quadro · Linhas da fatura · Outros títulos de cartão na janela; botões Baixar planilha, Cancelar fatura (motivo); rodapé "Não gerar o borderô enquanto houver diferença não justificada" |
| **Cartões** (`/cartoes`) | Cadastro: código, nome, banco, PF/PJ, fechamento, vencimento, tipo de título, leitor, pasta, ativo (gestor edita) |
| **Estabelecimentos** (`/estabelecimentos`) | Dicionário com busca; incluir/editar (operador). A aba A lançar tem o atalho "Cadastrar" para item não identificado |

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
| Funções | `crt_importar_fatura` (com `p_ciclo`), `crt_cancelar_fatura`, `crt_salvar_cartao`, `crt_salvar_estabelecimento`, `crt_normalizar`, `crt_gerar_ciclos`, `crt_registrar_apuracao`, `crt_fechar_ciclo`, `crt_reabrir_ciclo`, `crt_calendario`, `crt_competencia_do_vencimento` |
| Agendamentos | `crt-gerar-ciclos-diario` (07:00 Cuiabá) e `cap-sincronizar-consistem-diario` (07:30; `cap_chamar_sincronizacao`, mesmo segredo do Vault de Recebíveis) |
Migration: `0131_crt_base.sql`. Anexo: o PDF/CSV importado vai para o Storage (`anexos`, módulo `financeiro.cartao`, tabela `crt_faturas`).
Código puro: `lib/modulos/financeiro/cartao/` (`texto`, `cartoes` — porta do motor do Neo Fiscal —, `leitores/`, `fatura-pdf`
(unpdf), `selecao-titulos`, `conciliacao`, `planilha`), com testes ao lado; `tests/db/crt-base.test.ts`.

## 9. Permissões (área Financeiro)
| Nível | Pode |
| --- | --- |
| consulta | ver faturas, conciliação, cartões, dicionário; baixar a planilha |
| operador | importar e cancelar a própria fatura; manter o dicionário |
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
5. A skill registrava à mão uma coluna "Observação" por item — na Fase 1 só a causa provável automática; observação livre é Fase 2.
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
   (**feita**). 2b (a fazer): decisões por item (`crt_conciliacao_itens`: reclassificar, casar à mão, justificar, observação livre). 3. Leitores Inter/Itaú/Nubank/Unicred, aviso de fechamento do cartão
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
