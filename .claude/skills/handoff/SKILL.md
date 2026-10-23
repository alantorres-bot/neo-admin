---
name: handoff
description: Resumo de passagem do Neo Admin para retomar o trabalho em outra sessão ou no dia seguinte. Use quando o usuário disser "handoff", "/handoff", "resumo para retomar", "vamos parar", "amanhã continuo" ou pedir onde paramos.
---

# Handoff do Neo Admin

Objetivo: quem abrir a próxima sessão (o Alan ou o Claude) retoma sem reler a conversa. Seja factual: só afirme publicado o que você conferiu.

## 1. Conferir o estado real (não confie só na conversa)

Rode em paralelo:
- `git status --short` e `git log --oneline -8`: o que está commitado, o que falta e o que é de outra frente (não mexa nesses arquivos).
- `git log origin/main..HEAD --oneline`: commits ainda não enviados.
- Migrations da sessão: compare `ls supabase/migrations` com o registro em produção, só leitura:
  `npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "select version, name from supabase_migrations.schema_migrations order by version desc limit 10"`.
  Migration aplicada e não registrada é pendência crítica: registrar `(version, name)` (docs/PUBLICACAO.md, seção 2).
- Cloud Run: use a última revisão que apareceu na conversa (saída do `gcloud run deploy`). Se não apareceu, escreva "não conferido".

Nunca rode comandos que mudem produção nesta skill.

## 2. Escrever o handoff (na resposta, em português)

```
## Handoff — <área/módulo> (<dd/mm/aaaa>)

**Estado:** publicado / parcialmente publicado / só local — migrations (aplicadas e registradas?), Edge Functions, commit, revisão do Cloud Run.

**O que está no ar:** 1 a 3 linhas por módulo, regra de negócio em linguagem simples.

**Pendências do usuário:** lista numerada (dados a completar, configurações, arquivos a apagar, validações com escritório/jurídico).

**Pendências técnicas:** o que falta construir, testar ou publicar, com o arquivo/migration.

**Decisões tomadas nesta sessão:** só as que não estão no código nem na especificação (regras dadas pelo Alan, com as palavras dele quando forem trabalhistas, fiscais ou jurídicas).

**Lembretes:** migration e deploy em produção só com OK do Alan (ele roda o `gcloud run deploy` com `!`, de cópia limpa por `git archive`); registrar migration aplicada; LGPD; nunca inventar regra legal; arquivos fora do escopo no `git status`.
```

Omita a seção que ficar vazia. Datas em dd/mm/aaaa, absolutas (nada de "ontem").

## 3. Atualizar a memória

- Para cada módulo tocado, atualize o arquivo em `C:\Users\alant\.claude\projects\C--dev-neo-admin\memory\` (ou crie um, no formato dos existentes): estado, decisões e pendências com data. Remova o que ficou superado; não duplique o que o repositório já registra.
- Ajuste a linha correspondente em `MEMORY.md` (uma linha por memória).
- Se a especificação `docs/modulos/<area>-<modulo>.md` estiver desatualizada em relação ao que foi publicado, liste isso como pendência técnica (não edite sem pedido).

## 4. Fechar

Termine com uma linha dizendo o que não foi conferido (ex.: revisão do Cloud Run, push) e quais arquivos de memória foram atualizados.
