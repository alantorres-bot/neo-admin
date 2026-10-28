# Continuidade — Contratos e GED (após o checkpoint `b17f09e`)

Data: 24/10/2026 · Branch: `auditoria-contratos-ged`

## 1. Revisão do checkpoint `b17f09e`

Antes do commit, a revisão encontrou e corrigiu dois pontos:
- **Reativação.** `planejarObrigacoes` recriava um item cancelado que voltava a valer. Esse é o caso da reativação, que não tem
  regra aprovada (O-1 a O-4). Agora a função devolve `sem_regra`.
- **Lista cadastral.** A lista de "documentação cadastral" virou uma constante separada, `TIPOS_CADASTRAIS_PROVISORIOS`. O teste
  que a usa tem o rótulo "PROVISÓRIO [PENDENTE 6]". Os exemplos de regra de tipo continuam só nos testes, como ilustrativos.

Também foram conferidos:
- **Segredos e dados reais:** a varredura não achou segredo, credencial nem nome real de cliente.
- **Verificação completa:** o `npm run verificar` passou.
- **Push:** `d30ed80..b17f09e`, sem force; o branch ficou sincronizado com o remoto (0/0).

## 2. Achado de arquitetura e ajuste

O código usado pelas Edge Functions fica em `supabase/functions/_shared/*.ts`, **sem imports**: o Deno exige a extensão `.ts`, e o
`tsc` do app não a aceita. Esses arquivos são testados pelo Vitest e importados pelo app via `@/supabase/functions/_shared/...`
(padrão do Consistem, de Contatos e de Cobrança).

A indexação do GED (classificação, sugestão de cliente, temporários e cliente do Drive) roda na Edge Function. Por isso, as regras
do GED foram **consolidadas em `supabase/functions/_shared/ged.ts`**, local previsto na 11.1 da especificação:
- `normalizar` e `validarCnpj` foram copiados de `lib/nucleo`, porque esses arquivos não importam de `lib`;
- as regras não mudaram;
- os cinco fontes de `lib/nucleo/ged/` foram removidos;
- os testes ficaram em `lib/nucleo/ged/*.test.ts`, agora importando de `_shared/ged`.

As regras de Contratos continuam em `lib/modulos/contratos/operacoes/`. Elas vão rodar em funções SQL e no app, não em Edge Function.

## 3. Funcionalidades novas desta etapa (sem banco)

| Função | O que faz | Especificação |
|---|---|---|
| `aplicarMudanca` | Decide o efeito de uma mudança do Drive no índice: insere, atualiza, sinaliza revisão nova, `removido_no_drive`, `fora_do_escopo`, `ignorado` para temporários, volta a `vigente` quando o arquivo reaparece, pastas até a profundidade máxima. Nunca apaga. É idempotente | 5.3.2, 8.1, 11.1.5 |
| `percorrerMudancas` | Lê o `changes.list` página a página. Só devolve o token novo depois de aplicar todas as páginas; se algo falha, lança e o token não avança. Tem limite por rodada | 5.3.1–5.3.3, 5.3.6, 11.1.7 |
| `listarPasta` | Lê o `files.list` paginado, para a carga inicial e a reconciliação. Recusa ID de pasta com caracteres estranhos (o ID vai dentro da consulta `q`) | 4.1, 5.3.1 |
| Cliente HTTP | Faz novas tentativas em 429 e 5xx, esperando 1 s, 2 s e 4 s (no máximo 4 tentativas, como o Consistem). Erro definitivo não se repete | seção 10 |
| Varredura | Procura chamadas de escrita no `_shared/ged.ts` e em qualquer `supabase/functions/administrativo-ged*` futura | 11.1.6 |

**Pontos de cautela** (comentados no código, sem regra inventada):
- **Documento `substituido`:** a indexação não muda a situação dele, porque é decisão de uma pessoa (8.1). O que fazer com um
  substituído removido do Drive não está especificado.
- **Raiz (profundidade 0):** é governada pelo cadastro (`ged_pastas_raiz`), não pela indexação.
- **Pasta que sai do escopo:** o Drive não manda mudança para os arquivos dentro dela. Quem os acerta é a reconciliação (5.3.4).

## 4. Pré-requisitos da camada de banco

**Já existem no núcleo** (conferido nas migrations):

| Item | Onde |
|---|---|
| `tem_acesso_area`, `nivel_area`, `eh_admin_geral` | 0001 |
| `fn_auditoria`, `fn_bloquear_delete`, `fn_atualizado_em` | 0001 |
| `pendencias`; `publicar_pendencia`, `encerrar_pendencia`, `encerrar_pendencias_exceto` (só `service_role`) | 0001, 0097 |
| Áreas `contratos` e `administrativo`; módulo `contratos.contratos` (inativo) | 0001 |
| Padrão OAuth + Vault (`gmail_conexoes`, `segredo_id`) | 0153 |
| Trava de rodada (`rec_sincronizacao_trava`); chamada agendada (`com_chamar_sincronizacao`) | 0186, 0701 |
| Testes de banco: `tests/db/harness.ts` (PGlite com as migrations reais, `criarBanco`, `novoUsuario`, `como`) | — |

**Faixas de migrations livres:** Contratos 0300–0399 (nenhuma usada); GED 0801+ (a 0800 já foi usada).

**O que impede cada migration:**

| Migration | Situação | Impedimentos (decisão do responsável) |
|---|---|---|
| GED A0 (`ged_conexao`, `ged_conexao_estados`, raiz candidata) | **Bloqueada** | PENDENTE 1 (IDs), **PENDENTE 3** (conta e cliente OAuth), **PENDENTE 13** (exibir a verificação sem persistir), **PENDENTE 17** (proteção por coluna), controles mínimos da 5.2.4.5 aprovados |
| GED A1a (tabelas `ged_*`, RLS, projeções) | **Bloqueada** | A0 concluída e mais os PENDENTES 15, 16, 17, 19, 14 e 2 |
| Contratos C0 (catálogos em rascunho) | **Bloqueada** | PENDENTES 3, 4, 6 e 20 |
| Contratos C1–C4 | **Bloqueadas** | GED A2 básica, views do Comercial/Financeiro e os pendentes da seção 12 |

**Conclusão:** nenhuma migration pode ser escrita agora sem inventar decisão. Mesmo a estrutura "neutra" das tabelas `ged_*` depende
do mecanismo de proteção por coluna (PENDENTE 17), que define se o desenho é de tabela com projeção ou de view, e da forma das
pendências (PENDENTE 15). Os PENDENTES 3, 13 e 17 **não foram respondidos**, e a A0 **continua bloqueada**.

## 5. Testes

- `npx vitest run lib/modulos/contratos lib/nucleo/ged`: 12 arquivos, **87 testes, todos passaram**.
- `npm run verificar`: typecheck e lint ok; 186 arquivos de teste passaram e 4 foram pulados; **1.861 testes passaram** e 1 foi
  pulado. Os pulados já existiam antes.
- Um erro de tipo num teste novo (tipagem do `vi.fn`) foi corrigido no próprio teste. A regra não mudou.

## 6. Próxima tarefa concreta

1. **Decisão do responsável:** os PENDENTES 3, 13 e 17 do GED.
2. Com eles decididos, escrever a migration `0801_ged_conexao.sql` (A0): `ged_conexao` e `ged_conexao_estados` no padrão da 0153,
   com testes PGlite dos itens 13 e 14 da 11.5.
3. Enquanto isso, sem depender de decisão:
   - a Edge Function de indexação pode ser **esboçada**, sem deploy e sem credencial, sobre `aplicarMudanca` e `percorrerMudancas`;
   - a situação calculada da operação (5.8.1) **não** foi implementada: falta saber se "todas concluídas" inclui as dispensadas e
     as canceladas. É uma pergunta para o responsável.
