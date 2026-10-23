# Módulo: Administrativo geral / Central de Gestão — pendências dos aplicativos externos

Status: aprovada em 23/10/2026 e **construída** (migration 0800, funções `nucleo-apps-pendencias` aqui e `neo-admin-pendencias`
em cada aplicativo); falta publicar (seção 11). Complementa `administrativo-gestao.md` (Central de Gestão).

Decisões do Alan (23/10/2026):
- **Um resumo por tipo**: cada tipo de pendência de cada aplicativo vira **uma** pendência na Central, com a contagem no título
  (ex.: "Vigilância Fiscal: 14 NF de entrada com pendência (3 vencidas)"). Não se traz documento por documento.
- **Responsável padrão por tipo**, definido numa tela de configuração; o gestor pode reatribuir como qualquer pendência.
- **Primeira versão com os tipos principais** de cada aplicativo (seção 3). Estoque mínimo, EPI e empréstimos ficam para depois.

## 1. Objetivo
A Vigilância Fiscal e o NEOControl são sistemas separados (banco, login e código próprios; regra 8 do projeto), abertos dentro
do Neo Admin em `/apps/<codigo>`. O que pede ação neles não aparece na Central de Gestão: a gestão precisa abrir cada aplicativo
para saber o que está parado. Este módulo traz um **resumo** dessas pendências para a Central, com responsável, prazo (quando o
aplicativo tiver) e o link para o aplicativo.

## 2. Como é feito hoje
- **Vigilância Fiscal** (`neo-fiscal-r39`, Supabase `ycokizsmegdwntcsstfh`): tela `/pendencias` (NF de entrada), `/pendencias-saida`
  (NF de saída) e `/nfse` (NFS-e tomadas por etapa). Avisos por e-mail para a lista `destinatarios` por área (fiscal, compras,
  comercial). Nenhuma pendência tem responsável por pessoa.
- **NEOControl** (`protect-track`, Supabase `scrvxqouaicjiogyagfk`): painel inicial com cartões, telas `/notas-pendentes`,
  `/conferencia` e `/conferencia/inventario`. Nenhuma pendência tem responsável designado.
- Já existe um caminho de integração entre os sistemas: a função `cartao-regras` da Vigilância Fiscal, só de leitura, protegida
  por segredo (`x-neo-admin-segredo`), que o Neo Admin chama para o Cartão de crédito. Este módulo segue o mesmo modelo.

## 3. Escopo
**Entra (v1)**

| Aplicativo | Tipo (`codigo`) | O que conta | Prazo |
| --- | --- | --- | --- |
| Vigilância Fiscal | `nf_entrada` | NF de entrada distintas (`pendencias.nota_id`) com pendência `aberta`, `vencida` ou `aguardando_contador` | o menor `prazo` entre as abertas |
| Vigilância Fiscal | `nf_saida` | o mesmo em `pendencias_saida` | o menor `prazo` entre as abertas |
| Vigilância Fiscal | `nfse` | NFS-e nas etapas `sem_cadastro`, `aguardando`, `portal`, `pendencia` e `conferir` (`_shared/nfse/etapa.ts`) | sem prazo |
| NEOControl | os 6 tipos da **Central de Pendências do próprio app** (`src/lib/pendencias.ts`, criada em 20/10/2026): transferência de aço sem baixa, transferência de alumínio sem baixa, requisição de EPI sem baixa, requisição de insumos sem baixa, NF de MP sem lançamento no ERP, nota aguardando entrada | as mesmas consultas de `src/hooks/usePendencias.ts`; o detalhe conta as de **3 dias ou mais** (regra `nivelIdade` do app) | sem prazo |

Na construção, o NEOControl já tinha a sua Central de Pendências; a integração usa a definição dele em vez da lista do
rascunho (inventário aguardando aprovação ficou de fora porque o app não o trata como pendência). Um teste no app garante que
os tipos e rótulos da função continuam iguais aos da tela.

**Não entra (v1)**
- Documento por documento (decisão: resumo por tipo).
- Estoque mínimo de EPI e insumo, troca de EPI a vencer/vencida, empréstimos atrasados, fichas mensais (NEOControl); locação e
  fila do ClickUp (Vigilância Fiscal). Ficam para uma segunda etapa.
- Escrever nos aplicativos: a Central só lê. Resolver a pendência continua sendo no próprio aplicativo.
- Inventar prazo: onde o aplicativo não tem prazo, a pendência fica "sem prazo" na Central.

## 4. Entradas
Cada aplicativo ganha uma Edge Function **só de leitura**, `neo-admin-pendencias`:
- `POST`, corpo vazio; cabeçalho `x-neo-admin-segredo` comparado em tempo constante (como `cartao-regras`). Segredo ausente no
  servidor → 500; inválido → 401; outro método → 405.
- Lê com a service role e devolve **só contagens e datas**, nada de dados de terceiros (nome de fornecedor, CNPJ, valores):

```json
{ "versao": 1, "geradoEm": "2026-10-23T15:00:00Z",
  "tipos": [
    { "codigo": "nf_entrada", "titulo": "NF de entrada com pendência", "quantidade": 14,
      "detalhe": [{ "rotulo": "vencidas", "quantidade": 3 }, { "rotulo": "aguardando o contador", "quantidade": 2 }],
      "prazo": "2026-10-22", "maisAntiga": "2026-10-18", "caminho": "/pendencias" }
  ] }
```

- Tipo com `quantidade = 0` também volta (permite encerrar na Central). `prazo` e `maisAntiga` em `aaaa-mm-dd`, fuso de Cuiabá.
- As regras de "o que conta" ficam **no aplicativo** (cada um é dono das suas), em função pura com teste.

## 5. Regras de negócio
1. **Sincronização**: uma Edge Function do Neo Admin, `nucleo-apps-pendencias`, roda a cada 30 minutos (pg_cron) e chama cada
   aplicativo com a integração ligada. Falha de um aplicativo não impede o outro; a falha fica registrada (seção 6).
2. **Publicação**: para cada tipo com `quantidade > 0`, `publicar_pendencia` com
   - `modulo` = o módulo do aplicativo (`fiscal.vigilancia` ou `estoques.neocontrol`, seção 8);
   - `chave_origem` = `app:<codigo do aplicativo>:<codigo do tipo>`;
   - título = `"<Nome do aplicativo> — <título do tipo>: <quantidade>"` + o detalhe entre parênteses quando houver
     (ex.: "Vigilância Fiscal — NF de entrada com pendência: 14 (3 vencidas, 2 aguardando o contador)");
   - `prazo` = o `prazo` devolvido (só a Vigilância Fiscal tem); descrição com "mais antiga desde dd/mm/aaaa";
   - `prioridade` = `alta` quando o prazo já passou, senão `normal`;
   - `responsavel_id` = o responsável padrão do tipo (seção 7); sem padrão, fica sem responsável e `precisa_distribuir`;
   - `link` = `/apps/<codigo do aplicativo>?tela=<caminho>`: abre o aplicativo dentro do painel já na tela do tipo (só caminho
     interno simples; `enderecoDaTela` em `lib/nucleo/aplicativos.ts`).
3. **Encerramento**: tipo com `quantidade = 0` ou que deixou de vir → `encerrar_pendencia(..., 'concluida')`. Se voltar a ter
   quantidade, a mesma chave reabre como pendência nova (regra atual do `publicar_pendencia`).
4. **Reatribuição**: se o gestor trocar o responsável na Central, a sincronização **não** devolve ao padrão (só preenche o
   responsável quando a pendência nasce sem ninguém).
5. **Avisos**: seguem as regras da Central (Fase 7). O responsável padrão recebe "tarefa atribuída" quando a pendência nasce; o
   aviso de atraso sai uma vez por prazo (se o menor prazo mudar, pode sair outro).
6. Aplicativo fora do ar: as pendências ficam como estavam (não se encerra nada sem resposta válida).

## 6. Saídas e automações
- pg_cron `nucleo-apps-pendencias-30min` → `nucleo-apps-pendencias` (segredo da sincronização, como as demais rotinas).
- Registro de cada rodada por aplicativo (`apps_pendencias_rodadas`: aplicativo, início, fim, ok, erro, tipos recebidos), para a
  tela mostrar "última leitura" e o erro.

## 7. Telas
- **Configurações › Aplicativos** (admin_geral), no cadastro de cada aplicativo, nova seção "Pendências na Central":
  - ligar/desligar a leitura;
  - endereço da função `neo-admin-pendencias` do aplicativo (https; nada fixo no código, regra 8);
  - responsável padrão de cada tipo (lista de pessoas com acesso à área do módulo);
  - última leitura, situação e erro; botão "Ler agora".
- **Central de Gestão**: nada novo. As pendências aparecem com o módulo "Vigilância Fiscal" ou "NEOControl", entram nos
  filtros, indicadores, avisos e na atribuição em lote. "Abrir no módulo" abre o aplicativo dentro do painel.

## 8. Dados
- `modulos`: `fiscal.vigilancia` ("Vigilância Fiscal") e `estoques.neocontrol` ("NEOControl"), **inativos** no menu (o menu já
  mostra os aplicativos pelo cadastro `aplicativos`), como "Tarefas gerais".
- `aplicativos`: colunas novas `pendencias_ligado boolean default false`, `pendencias_url text check (~ '^https://')`,
  `pendencias_modulo text references modulos`, `pendencias_segredo text` (nome do segredo da Edge Function, não o valor),
  `pendencias_responsaveis jsonb default '{}'` (`{<tipo>: <perfil id>}`).
- `apps_pendencias_rodadas` (registro de prova, sem exclusão).
- Segredos do Neo Admin: Vigilância Fiscal reaproveita `NEO_FISCAL_SEGREDO` (já é o mesmo valor de `NEO_ADMIN_SEGREDO` lá);
  NEOControl ganha `NEOCONTROL_SEGREDO` aqui e `NEO_ADMIN_SEGREDO` lá, com o mesmo valor.

## 9. Permissões
- Ver as pendências na Central: quem tem a área do módulo (Fiscal ou Estoques), como qualquer pendência.
- Configurar a integração e os responsáveis: só `admin_geral`.
- As funções dos aplicativos só respondem a quem tem o segredo; não há acesso de usuário.
- LGPD: só contagens e datas atravessam os sistemas.

## 10. Pontos em aberto
1. ~~Faixa de migration~~: aprovada a faixa **0800–0899 (núcleo estendido / integrações)**, registrada no `CLAUDE.md`.
2. **Edição dos aplicativos**: a Vigilância Fiscal e o NEOControl são projetos do Lovable. A função `neo-admin-pendencias` será
   escrita direto nos repositórios (`C:\dev\neo-fiscal-r39` e `C:\dev\protect-track`); editar pelo Lovable ao mesmo tempo pode
   gerar conflito. A publicação é no Supabase de cada aplicativo.
3. **Rótulos dos tipos** na Central (texto do título) — proposta na seção 3; ajustar se preferir outros nomes.
4. NFS-e na etapa `lancada` ("em conferência") ficou de fora por ser espera do sistema, não ação de pessoa.

## 11. Construção (23/10/2026) e como publicar
| Onde | O quê |
| --- | --- |
| Neo Admin | `0800_nucleo_apps_pendencias.sql` (módulos `fiscal.vigilancia` e `estoques.neocontrol`, colunas em `aplicativos`, `apps_pendencias_rodadas`, `apps_pendencias_publicar`, agendamento de 30 min) |
| Neo Admin | Edge Function `nucleo-apps-pendencias`; lógica pura `supabase/functions/_shared/apps-pendencias.ts` (testes em `lib/nucleo/gestao/apps-pendencias.test.ts`) |
| Neo Admin | Configurações › Aplicativos: coluna "Pendências na Central" (ligada/desligada, "Ler agora", última leitura) e botão "Pendências" (endereço, segredo, responsável por tipo); `/apps/<codigo>?tela=` |
| Vigilância Fiscal | função `neo-admin-pendencias` + `_shared/pendencias-neo-admin.ts` (testes `tests/pendencias-neo-admin.test.ts`); usa o segredo `NEO_ADMIN_SEGREDO` que já existe |
| NEOControl | função `neo-admin-pendencias` + `_shared/pendencias-neo-admin.ts` (teste `src/lib/pendenciasNeoAdmin.test.ts`); segredo novo `NEO_ADMIN_SEGREDO` |

**Publicar (nesta ordem)**
1. Aplicativos: enviar os commits (o Lovable sincroniza e publica as funções). No NEOControl, criar o segredo
   `NEO_ADMIN_SEGREDO` (Lovable Cloud › Secrets) com um valor aleatório de 64 caracteres.
2. Neo Admin: gravar o mesmo valor em `NEOCONTROL_SEGREDO` (`node scripts/gravar-segredo.mjs NEOCONTROL_SEGREDO --ref chdszjpbtfpstjrqnmmm`).
   A Vigilância Fiscal usa o `NEO_FISCAL_SEGREDO` que já existe.
3. Aplicar a 0800 e registrar em `schema_migrations`; publicar a função `nucleo-apps-pendencias` e a aplicação.
4. Configurações › Aplicativos › Pendências: endereço de cada função
   (`https://ycokizsmegdwntcsstfh.supabase.co/functions/v1/neo-admin-pendencias` e
   `https://scrvxqouaicjiogyagfk.supabase.co/functions/v1/neo-admin-pendencias`), "Ler agora" com a leitura desligada
   (confere a conexão e mostra os tipos), escolher os responsáveis e só então ligar.