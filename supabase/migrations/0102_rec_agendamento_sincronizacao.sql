-- =========================================================
-- Neo Admin — 0102 Agendamento diário da sincronização com o Consistem
-- pg_cron chama, todo dia às 07:00 de Cuiabá (11:00 UTC; Cuiabá é UTC-4 e não tem horário de verão), a função
-- rec_chamar_sincronizacao(), que faz um POST (pg_net) para a Edge Function rec-sincronizar-consistem.
--
-- Não há segredo nesta migration. Dois valores ficam no Vault do banco (por projeto, criados à mão uma vez):
--   rec_sincronizar_url      https://<ref>.supabase.co/functions/v1/rec-sincronizar-consistem
--   rec_sincronizar_segredo  texto aleatório (>= 32 caracteres); o MESMO valor vai no segredo de Edge Functions
--                            SINCRONIZACAO_SEGREDO. A função só aceita o agendamento com esse cabeçalho.
-- Sem esses dois valores, o job roda e não faz nada (aviso no log do Postgres).
--
-- Os blocos que dependem de pg_cron/pg_net só rodam onde as extensões existem (Supabase). No Postgres em memória
-- dos testes (PGlite) elas não existem, e a migration passa sem criá-las.
-- =========================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- Quem executa é o job (usuário postgres). Ninguém mais chama: a função lê segredos do Vault.
create or replace function rec_chamar_sincronizacao() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_requisicao bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'rec_sincronizar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Sincronização agendada sem configuração: faltam rec_sincronizar_url e/ou rec_sincronizar_segredo no Vault.';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sincronizacao-segredo', v_segredo),
    body := '{"acao":"sincronizar"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_requisicao;
  return v_requisicao;
end $$;
revoke all on function rec_chamar_sincronizacao() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Mesmo nome = atualiza o agendamento existente (pode reaplicar sem duplicar).
    perform cron.schedule('rec-sincronizar-consistem-diario', '0 11 * * *', 'select public.rec_chamar_sincronizacao()');
  end if;
end $$;
