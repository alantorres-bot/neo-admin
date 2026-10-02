# Prompt inicial para o Claude Code

Cole o texto abaixo na primeira conversa do Claude Code, com o terminal aberto dentro da pasta `neo-admin`.

---

Leia o `CLAUDE.md`, o `docs/VISAO_GERAL.md` e o `docs/modulos/financeiro-recebiveis.md`.

Vamos construir a plataforma por fases. Comece pela **Fase 0 — Núcleo**:
1. Criar o projeto Next.js (App Router, TypeScript, Tailwind, shadcn/ui) nesta pasta, sem apagar os arquivos existentes.
2. Configurar o Supabase CLI e usar as migrations existentes em `supabase/migrations/`.
3. Criar, em nova migration do núcleo, as políticas RLS de todas as tabelas do núcleo usando `tem_acesso_area()` e `eh_admin_geral()`.
4. Login com Supabase Auth (e-mail e senha); registro em `perfis` no primeiro acesso; o primeiro usuário vira `admin_geral`.
5. Layout com menu lateral por área (Financeiro, Fiscal, Contratos, Jurídico, RH/SST, Administrativo), mostrando só as áreas e os módulos ativos que o usuário pode ver.
6. Tela **Início (Fila do dia)** lendo a tabela `pendencias`.
7. Configurações: empresas, contrapartes e contatos, usuários e permissões por área.
8. Importador genérico de CSV/XLSX com mapeamento de colunas salvo em `importacoes.mapeamento` (ainda sem regra de módulo).

Antes de escrever código, me mostre o plano da Fase 0 e a lista de comandos e contas que vou precisar. Não avance para a Fase 1 (Recebíveis) sem minha aprovação.

---

## Para criar um módulo novo depois

> Quero especificar o módulo `<area>.<modulo>`. Copie `docs/modulos/_MODELO.md` para `docs/modulos/<area>-<modulo>.md`, me faça as perguntas necessárias para preencher (como é feito hoje, entradas, regras, saídas) e só depois proponha a migration e as telas.
