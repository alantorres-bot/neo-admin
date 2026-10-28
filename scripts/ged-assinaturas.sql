-- GED — assinatura do que está instalado no banco (só leitura). Usada pelo teste tests/db/ged-assinaturas.test.ts (gera
-- scripts/ged-assinaturas.json a partir das migrations do repositório) e por scripts/ged-conferir-assinaturas.mjs (compara com produção).
-- Corpo: md5 do texto da função sem \r (o fim de linha do Windows não pode virar "divergência"). Nenhum dado de tabela é lido.
select jsonb_build_object(
  'funcoes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'nome', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'security_definer', p.prosecdef,
             'corpo_md5', md5(replace(p.prosrc, E'\r', '')),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
             'service_role', has_function_privilege('service_role', p.oid, 'execute'))
           order by p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and (p.proname like 'ged\_%' or p.proname = 'fn_ged_pastas_raiz_imutavel')), '[]'),
  'tabelas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'tabela', c.relname, 'rls', c.relrowsecurity,
             'anon_select', has_table_privilege('anon', c.oid, 'select'),
             'authenticated_select', has_table_privilege('authenticated', c.oid, 'select'),
             'authenticated_escrita', has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
                                      or has_table_privilege('authenticated', c.oid, 'delete'))
           order by c.relname)
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'ged\_%'), '[]'),
  'politicas', coalesce((
    select jsonb_agg(jsonb_build_object('tabela', tablename, 'politica', policyname, 'comando', cmd, 'papeis', roles::text[])
           order by tablename, policyname)
      from pg_policies where schemaname = 'public' and tablename like 'ged\_%'), '[]')
) as assinatura;
