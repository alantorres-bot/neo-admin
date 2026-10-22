# Fiscal Control — Gestão de Créditos e Obrigações Tributárias

Módulo **Fiscal > Créditos tributários** do Neo Admin (rota `/fiscal/creditos`, código `fiscal.creditos`).
Progresso real e testes executados: [`STATUS.md`](STATUS.md). Componentes, entidades e regras: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Especificação no padrão do projeto: [`docs/modulos/fiscal-creditos.md`](../modulos/fiscal-creditos.md).

> **Limite de responsabilidade.** É uma ferramenta de gestão, rastreabilidade e apoio à análise fiscal. Não contém legislação,
> alíquotas, prazos legais nem regras de compensação "embutidas": formas de utilização, prazos de aproveitamento, documentos
> exigidos e vencimentos são **parâmetros cadastrados**, que vêm **marcados como não validados** e precisam ser confirmados
> pelo contador responsável. O sistema nunca trata um saldo como juridicamente utilizável só porque ele existe.

## 1. Objetivo
Controlar os créditos tributários de uma indústria (PIS, Cofins, ICMS, IPI, IRPJ, CSLL, INSS, retenções, pagamentos a maior,
saldos negativos, créditos judiciais/administrativos e outros) com razão imutável, apuração mensal com transporte de saldo,
fechamento de competências, consolidado anual, obrigações acessórias com comprovação da entrega, repositório documental
privado, conciliação com regras rastreáveis e fluxo de trabalho entre o departamento fiscal e o contador.

## 2. Funcionalidades implementadas
| Área (menu do módulo) | O que faz |
| --- | --- |
| **Dashboard** | 20 indicadores calculados do banco (registrado, validado, pendente, disponível, utilizado/compensado/baixado no período, saldo inicial e final do exercício, gerado e utilizado no ano, obrigações pendentes/próximas/atrasadas/a conferir, documentos pendentes, divergências); 5 gráficos (saldo mensal, gerados × utilizados, saldo por tributo, evolução anual, situação das obrigações). Filtros: ano, competência, empresa, estabelecimento, tributo, situação do crédito e da obrigação. Estado vazio explica como começar. |
| **Créditos tributários** | Cadastro (nasce *pendente de validação*), consulta com filtros, busca e paginação, ficha detalhada, edição controlada, validação/rejeição/contestação por outra pessoa, reconhecimento parcial (glosa), bloqueio, arquivamento lógico, transferência autorizada, documentos, histórico de decisões e comentários, saldo por competência. |
| **Movimentações** | Razão imutável de todos os créditos (14 tipos + tipos configuráveis), estorno, correção (estorno + lançamento ligado), aprovação/rejeição, bloqueio de duplicidade e de saída acima do saldo elegível. |
| **Apuração mensal** | Por estabelecimento × tributo: 12 meses com saldo inicial, implantado, gerado, reconhecido, ajustes ±, utilizado, compensado, baixado, transferências e saldo final; comparação com o mês anterior; origem dos valores por crédito; lançamentos do mês; saldo oficial e declarado; leitura do saldo da EFD ICMS/IPI; envio para revisão, fechamento, reabertura e reconciliação; documentos da competência. |
| **Consolidado anual** | Por tributo e por estabelecimento; comparação com o ano anterior; conferência de janeiro × fechamento de dezembro anterior; pendentes de validação, documentação incompleta e divergências; Excel e impressão/PDF. |
| **Obrigações fiscais** | Cadastro, geração pelo perfil tributário, lista com alertas, calendário mensal, fluxo de 10 situações, transmissão só com data + recibo + recibo anexado, conferência por outra pessoa, dispensa justificada, retificação, vencimento "a confirmar". |
| **Documentos** | Envio com validação de extensão, tamanho e conteúdo real no servidor, bucket privado, download por link temporário, tipos documentais, versões e histórico de substituições, vínculos com créditos/obrigações/movimentos/competências/divergências, documentos faltantes. |
| **Conciliação** | 15 verificações automáticas rastreáveis (regra, descrição e registros), comparativo interno × oficial × declarado × transportado, compensações com e sem protocolo, registro e tratamento de divergências. |
| **Tarefas e aprovações** | Fila de aprovação (créditos, lançamentos, competências, obrigações), tarefas e solicitações de documento atribuídas (espelhadas na Fila do dia do Neo Admin), comentários, histórico de decisões. |
| **Relatórios** | Excel de créditos, movimentações, apuração, consolidado, obrigações e conciliação, com data de emissão, emitente, período e critérios; modelos de importação. |
| **Configurações** | Estabelecimentos, tributos, categorias e parâmetros de aproveitamento, tipos de movimentação, tipos de obrigação e regra de vencimento, perfil tributário (obrigações aplicáveis), usuários e papéis/escopo por empresa. |
| **Importação** (a partir de Créditos/Movimentações) | Modelo para download, mapeamento de colunas automático e ajustável, validação, área de preparo com prévia, erros por linha, duplicidades, confirmação explícita e resumo. |

## 3. Arquitetura e tecnologias
Reaproveita a pilha do Neo Admin: **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + componentes do projeto**,
**Supabase (Postgres 15+/16, Auth, Storage, RLS)**, **zod** (validação no servidor), **exceljs** (Excel), **Vitest** + **PGlite**
(testes de banco com as migrations reais) e **Playwright** (interface). Nenhuma biblioteca nova foi adicionada; os gráficos são SVG próprios.
Toda regra que protege dados está no banco (funções `fis_*` em transação + RLS); a aplicação valida de novo e só decide o que mostrar.
Detalhes: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 4. Pré-requisitos
- Node.js 22 e npm.
- Um projeto Supabase (de **teste** para avaliar; produção só depois da validação) **ou** Supabase local:
  `npx supabase start` (requer Docker) ou, sem Docker, `scripts/local-sem-docker/` (Postgres 16 instalado; ver item 9).

## 5. Instalação e variáveis de ambiente
```
npm install
cp .env.example .env.local      # preencher NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (nunca commitar)
```
O módulo não exige variável nova. A chave *service role* fica só nas Edge Functions/CLI, nunca no app.

## 6. Banco: migrations
Migrations do módulo (faixa fiscal 0200–0299):

| Arquivo | Conteúdo |
| --- | --- |
| `0200_fiscal_creditos_base.sql` | módulo, papéis e escopo, cadastros, créditos, competências, razão, saldos, apuração |
| `0201_fiscal_creditos_obrigacoes_documentos.sql` | obrigações, documentos + bucket privado `fiscal`, divergências, tarefas, comentários, decisões |
| `0202_fiscal_creditos_funcoes.sql` | todas as funções de escrita (regras) e privilégios |
| `0203_fiscal_creditos_verificacoes_importacao.sql` | verificações da conciliação, painel e importação |

- Supabase local/novo: `npx supabase db push` (ou `npx supabase db reset` no local).
- Produção do Neo Admin (CLI ligado a outro projeto): seguir `docs/PUBLICACAO.md`, seção 2 — aplicar cada arquivo com
  `npx supabase db query ... -f` **e** registrar `(version, name)` em `supabase_migrations.schema_migrations` logo em seguida.
- As migrations só criam estruturas e dados de referência (tributos, categorias de exemplo não validadas, tipos); nenhum dado de empresa.

## 7. Dados de demonstração (fictícios)
Ficam em `supabase/demo/fiscal_creditos_demo.sql` — **não** são migration e nunca entram sozinhos. Carga explícita:
```
node scripts/fiscal-demo.mjs --banco "postgresql://usuario:senha@host:5432/banco" --confirmar   # Postgres/Supabase local
node scripts/fiscal-demo.mjs --ref <ref-do-projeto-de-TESTE> --confirmar                          # Supabase de teste (CLI logada)
```
O SQL recusa: base com créditos reais, base marcada como produção e segunda carga. **Em produção, bloqueie de vez:**
`insert into configuracoes (chave, valor) values ('fiscal.creditos.bloquear_demonstracao', 'true');`
Conteúdo: empresa e estabelecimentos fictícios, 8 créditos (ICMS, PIS, Cofins, IPI, pagamento a maior, saldo negativo de IRPJ
pendente sem documentos, INSS em análise, judicial bloqueado), 01/2025 a 09/2026 com saldos transportados, utilização parcial,
compensação com e sem protocolo, estorno, competências fechadas, diferença com a EFD e divergência aberta, obrigações entregues,
transmitida a conferir, atrasada e com arquivo salvo mas não transmitida, tarefas e comentário. Tudo com "(FICTÍCIA)"/"[FICTÍCIO]".

## 8. Executar
```
npm run dev                  # http://localhost:3000  → menu Fiscal > Créditos tributários
npm run build && npm start   # produção
```

## 9. Testes
```
npm test                                     # Vitest: regras puras + banco (PGlite com as migrations reais), todo o projeto
npx vitest run tests/db/fis-creditos.test.ts tests/db/fis-creditos-demo.test.ts lib/modulos/fiscal   # só o módulo
npm run typecheck && npx eslint app lib tests e2e scripts
```
**Testes de interface** (precisam de banco com migrations, demonstração e usuários de teste
`admin|analista|revisor|contador|leitor@neoformas.com.br`, senha em `FISCAL_E2E_SENHA`):
```
FISCAL_E2E_URL=http://127.0.0.1:3000 npx playwright test -c playwright.fiscal.config.ts
# se o navegador do Playwright não estiver instalado: PLAYWRIGHT_CHROMIUM=/caminho/do/chrome
```
**Sem Docker** (desenvolvimento/teste): `bash scripts/local-sem-docker/iniciar.sh` sobe Postgres 16 + PostgREST + Supabase Auth +
um proxy com as rotas do Supabase e um Storage mínimo que respeita as políticas do bucket (ver `scripts/local-sem-docker/LEIA-ME.md`).
É só para teste: não substitui o Supabase em produção.

## 10. Usuários e permissões
1. O administrador geral cria o usuário em **Configurações > Usuários** (cadastro fechado; e-mail `@neoformas.com.br`).
2. Dá o nível na **área Fiscal**: consulta → *Leitor*; operador → *Analista fiscal*; gestor → *Revisor*; administrador → *Administrador*.
3. Em **Fiscal Control > Configurações > Usuários e papéis**, o administrador pode escolher *Contador* (para quem tem nível gestor),
   rebaixar o papel e **restringir as empresas** visíveis (vazio = todas).

| Ação | Leitor | Analista | Revisor | Contador | Administrador |
| --- | :-: | :-: | :-: | :-: | :-: |
| Consultar e exportar | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cadastrar créditos, lançamentos, obrigações, documentos, divergências | | ✓ | ✓ | ✓ | ✓ |
| Validar créditos, aprovar lançamentos, aprovar transmissão, conferir entrega | | | ✓ | ✓ | ✓ |
| Fechar e reconciliar competências, atribuir tarefas a outros | | | ✓ | ✓ | ✓ |
| Reabrir competências | | | ✓ | | ✓ |
| Parâmetros fiscais e papéis | | | | | ✓ |

Segregação: quem lançou um crédito ou movimento não o valida/aprova; quem registrou a transmissão não confere a entrega.

## 11. Backup e restauração
- **Dados:** `node scripts/banco-copia.mjs exportar --ref <ref>` (todas as tabelas de `public`, inclusive `fis_*`) e
  `importar ... --mesclar`/`--sim` (ver `docs/PUBLICACAO.md`). No plano pago do Supabase, ativar também o backup diário/PITR.
- **Arquivos:** bucket privado `fiscal` → `npx supabase storage cp -r "ss:///fiscal" backups/fiscal --linked --project-ref <ref> --experimental`
  (e o caminho inverso para restaurar).
- **Teste de restauração:** restaurar num projeto de teste e conferir contagens (`banco-copia.mjs conferir`) e o consolidado do último exercício.
- Nada no módulo é apagado (razão, decisões, eventos e documentos são imutáveis), o que facilita auditoria e conferência pós-restauração.

## 12. Limitações conhecidas
- **Regras tributárias não validadas:** todas as categorias, formas de utilização, documentos exigidos e tipos de obrigação vêm como
  exemplo *não validado*; nenhum prazo de aproveitamento ou vencimento legal está cadastrado (ficam "não parametrizado"/"a confirmar").
- **Atualização monetária** não é calculada: é um tipo de ajuste lançado com documento e aprovação.
- **Leitura de arquivos fiscais:** só a EFD ICMS/IPI, e só os registros 0000, E110 (saldo credor de ICMS a transportar) e E520
  (saldo credor de IPI), para preencher o saldo oficial; testado apenas com arquivo sintético. Não lê EFD-Contribuições, XML de NF-e,
  PER/DCOMP nem ECF.
- **Upload até 9 MB** por arquivo (limite de corpo das server actions do projeto, 10 MB).
- Arquivo enviado ao bucket cujo registro falhe fica órfão (o bucket não permite apagar); raro e sem acesso por terceiros.
- Gráficos e tabelas foram verificados em navegador desktop (1440 px) e celular (390 px); não houve teste de leitor de tela.
- A transferência entre créditos de empresas diferentes é permitida desde que haja fundamento e aprovação; o sistema não julga o mérito.

## 13. Funcionalidades ainda não implementadas
- Notificações por e-mail/WhatsApp de vencimentos e tarefas (o módulo publica na Fila do dia; o envio externo seguiria a regra `modo_rascunho`).
- Agendamento automático (pg_cron) para gerar obrigações do mês e recalcular alertas — hoje é pelo botão.
- Importadores de EFD-Contribuições, PER/DCOMP e XML; integração com o Consistem.
- Cálculo de atualização monetária (Selic) parametrizado.

## 14. Recomendações para implantação segura
1. Aplicar as migrations primeiro num **projeto de teste**, carregar a demonstração e validar com o contador os parâmetros
   (Configurações > Categorias e Tipos de obrigação), marcando-os como validados.
2. Em produção: **não** carregar a demonstração e marcar `fiscal.creditos.bloquear_demonstracao = true`.
3. Conferir que o bucket `fiscal` ficou **privado** (a migration força `public = false`).
4. Restringir quem tem nível na área Fiscal; usar o escopo por empresa para o contador externo.
5. Implantar saldos de abertura com o tipo *Saldo inicial* (exige aprovação) e fechar as competências em ordem.
6. Manter o backup (item 11) e testar uma restauração antes de entrar em operação.
