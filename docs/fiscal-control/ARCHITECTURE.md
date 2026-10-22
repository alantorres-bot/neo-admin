# Fiscal Control — Arquitetura

## 1. Componentes

```
Navegador ──► Next.js (App Router, server components + server actions)
                 app/(plataforma)/fiscal/creditos/…        telas (11 seções + importação)
                 app/(plataforma)/fiscal/creditos/acoes.ts  ações: sessão + zod + formatos BR → RPC fis_*
                 …/relatorios/exportar/[tipo]/route.ts      Excel (exceljs)
                 …/documentos/[id]/baixar/route.ts          link assinado de 60 s
                 app/(impressao)/imprimir/fiscal/consolidado  impressão / PDF
                 lib/modulos/fiscal/creditos/*.ts           regras puras e testadas (formatos, apuração, papéis,
                                                            importação, arquivos, SPED, consolidado, planilha)
              │  cliente Supabase com a sessão do usuário (RLS sempre vale; service role nunca no app)
              ▼
Supabase      Postgres: tabelas fis_*, views, funções fis_* (security definer, regras e transação), RLS por papel e empresa
              Storage: bucket privado `fiscal` (políticas ligadas a fis_documentos)
              Auth: login do Neo Admin (e-mail/senha ou Google @neoformas.com.br)
              Núcleo: empresas, perfis, permissoes, pendencias (Fila do dia), importacoes, auditoria
```

O módulo não acessa tabelas internas de outros módulos; usa só o núcleo (empresas, perfis, permissões, pendências, auditoria,
importações).

## 2. Entidades e relacionamentos

```
empresas (núcleo) 1─N fis_estabelecimentos 1─N fis_creditos 1─N fis_movimentos (razão)
fis_tributos 1─N fis_categorias (parâmetros de aproveitamento)         fis_movimentos ─ estorno_de/corrige_id ─► fis_movimentos
fis_creditos N─1 fis_tributos, fis_categorias, fis_origens            fis_movimentos N─1 fis_tipos_movimento (classe, sinal, forma)
fis_periodos (estabelecimento × tributo × competência) 1─N fis_periodos_eventos
fis_tipos_obrigacao 1─N fis_obrigacoes_aplicaveis (perfil) ; 1─N fis_obrigacoes 1─N fis_obrigacoes_eventos ; retificadora_de
fis_documentos (versões: raiz_id/substitui_id) 1─N fis_documentos_vinculos ─► crédito | movimento | obrigação | período | divergência | tarefa
fis_divergencias ─► crédito/período/obrigação ; fis_tarefas ─► alvo ; espelho em pendencias (núcleo)
fis_comentarios, fis_decisoes (alvo genérico) ; fis_membros (perfil → papel + empresas)
fis_imp_lotes 1─N fis_imp_linhas (área de preparo da importação)
```

| Tabela | Papel |
| --- | --- |
| `fis_creditos` | cadastro do crédito; **saldo nunca é digitado** |
| `fis_movimentos` | razão imutável: `classe` (coluna da apuração), `natureza` (entrada/saída), `valor` > 0, `valor_assinado` (efeito), `status` (pendente/efetivo/rejeitado), `estornado` |
| `fis_creditos_saldos` (view) | totais por classe, saldo, saídas pendentes reservadas, disponibilidade e saldo disponível |
| `fis_periodos` | situação da competência, saldo oficial/declarado, snapshot congelado no fechamento, `requer_reconciliacao` |
| `fis_obrigacoes` | obrigação com fluxo de situação, recibo, quem transmitiu e quem conferiu |
| `fis_documentos` | arquivo privado com hash SHA-256, versão e situação (vigente/substituído/arquivado) |
| `fis_decisoes`, `fis_*_eventos`, `fis_comentarios` | trilha imutável de quem fez o quê, quando e por quê |

Valores: `numeric(14,2)`; competência = 1º dia do mês (`date`); fuso America/Cuiaba.

## 3. Regras de negócio

**Estados distintos do crédito** — registrado (existe no razão) ≠ validado (decisão de revisor/contador/admin, nunca de quem
lançou) ≠ disponível (validado, sem bloqueio, dentro do prazo cadastrado, com saldo, descontadas as saídas pendentes) ≠ utilizado
≠ compensado (com ou sem protocolo) ≠ ressarcido/restituído ≠ contestado/rejeitado.

**Apuração** (função `fis_apuracao`, espelho em `lib/modulos/fiscal/creditos/apuracao.ts`), por crédito e competência:
`saldo final = saldo inicial + gerado + reconhecido + ajustes(+) − ajustes(−) − utilizado − compensado − baixado + transf. recebida − transf. enviada`.
Saldo inicial = saldo final do mês anterior **do mesmo crédito** (mesma empresa, estabelecimento e tributo) + implantação do mês.
O transporte é consequência do razão: não há cópia de saldo entre meses, nem entre créditos, tributos, empresas ou estabelecimentos
(só a transferência explícita, com fundamento e aprovação). Estorno entra na coluna do lançamento original, com sinal invertido.
Consolidado do exercício: inicial = saldo inicial de janeiro (com a implantação de janeiro); implantações posteriores em coluna própria.

**Lançamentos** (`fis_mov_inserir`): valor > 0 com no máximo 2 casas (não arredonda em silêncio); data não futura; competência
≥ origem do crédito; saída exige saldo em **todas** as competências seguintes (`fis_saldo_minimo_apos`), reservando as saídas
pendentes; utilização/compensação/ressarcimento/restituição/transferência exigem crédito validado, desbloqueado, no prazo e com a
forma permitida na categoria; duplicidade exata barrada por índice único; reenvio do mesmo formulário (chave de idempotência)
devolve o mesmo lançamento; lançamentos do crédito são serializados por bloqueio de linha. Tipos que exigem aprovação nascem pendentes.

**Correções**: estorno na mesma competência do original (que precisa estar aberta); correção = estorno + novo lançamento ligado;
nada é apagado (gatilhos bloqueiam `delete` e mudanças em registros de prova, inclusive para a service role).

**Competências**: fechamento sequencial, sem pendentes, com justificativa para diferença com o saldo oficial ou divergência aberta;
congela os valores (snapshot). Competência fechada não recebe lançamento. Reabrir: revisor/admin, com motivo. Lançamento numa
competência anterior marca as fechadas seguintes como "requer reconciliação"; reconciliar recalcula o congelado em ordem cronológica.

**Obrigações**: só "transmitida" com data, número do recibo e (se o tipo exige) o recibo **vinculado**; arquivo salvo não muda a
situação; "pronta para transmissão" e "entregue e conferida" exigem revisor/contador/admin, a conferência por pessoa diferente de
quem transmitiu; dispensa justificada; retificação preserva a original. Vencimento só por regra cadastrada; sem regra validada,
"a confirmar".

**Documentos**: extensão permitida, tamanho e conteúdo real (assinatura dos bytes) conferidos no servidor; caminho
`fiscal.creditos/<empresa>/<uuid>-<nome>`; leitura do arquivo só para quem enxerga o registro (política do Storage ligada a
`fis_documentos`); versão nova herda os vínculos; recibo de obrigação transmitida não é desvinculado nem arquivado.

**Conciliação** (`fis_verificar`): R01 transporte entre fechadas; R01b reconciliação pendente; R02 possível duplicidade; R03 sem
documento; R04 saldo negativo / utilizado sem validação; R05 declaração sem recibo; R06 compensação sem protocolo; R07 documentação
exigida pendente; R08 fechado com divergência; R09/R10 calculado × oficial/declarado; R11 prazo de aproveitamento; R12 obrigação
atrasada; R13 vencimento a confirmar. Cada resultado traz a chave, a descrição e os registros envolvidos; pode virar divergência.

**Segurança**: RLS em todas as tabelas; escrita só por funções que conferem papel (`fis_pode`) e empresa (`fis_empresa_permitida`);
funções internas sem execução para usuários; auditoria do núcleo em todas as tabelas de cadastro e movimento; logs sem dados
sensíveis (`[fiscal]` + código do erro).

## 4. Decisões
| Decisão | Motivo |
| --- | --- |
| Módulo do Neo Admin, não sistema separado | reaproveita login, permissões, auditoria, Fila do dia e padrões; regra do CLAUDE.md |
| Saldo derivado do razão | elimina divergência entre "saldo digitado" e lançamentos; transporte correto por construção |
| Regras no banco (funções + RLS) | mesmas regras para tela, importação e qualquer cliente; transação única |
| Papéis do módulo derivados do nível da área | compatível com o núcleo (pendências, Configurações > Usuários) |
| Parâmetros fiscais como dados não validados | o sistema não inventa legislação; o contador confirma |
| Importação em área de preparo | nada entra sem validação, prévia e confirmação |
| Gráficos em SVG próprio | sem dependência nova; paleta validada para daltonismo, tabela equivalente em cada gráfico |
